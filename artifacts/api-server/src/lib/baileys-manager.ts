import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Server, type Socket } from "socket.io";
import jwt from "jsonwebtoken";
import pino from "pino";
import makeWASocket, {
  DisconnectReason,
  generateMessageIDV2,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  proto,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { and, eq, or } from "drizzle-orm";
import {
  db,
  contactsTable,
  usersTable,
  waSessionsTable,
} from "@workspace/db";
import { logger } from "./logger";

type LiveSession = {
  socket: ReturnType<typeof makeWASocket>;
  userId: string;
  connected: boolean;
  qrDataUrl: string | null;
  pairingCode: string | null;
};

const liveSessions = new Map<string, LiveSession>();
const idleTimers = new Map<string, NodeJS.Timeout>();
const reconnectTimers = new Map<string, NodeJS.Timeout>();
const reconnectAttempts = new Map<string, number>();
const maxReconnectAttempts = 5;
let realtime: Server | null = null;
const authSecret = process.env["SESSION_SECRET"];
if (!authSecret) throw new Error("SESSION_SECRET is required for live sessions.");

const authRoot = path.resolve(
  process.env["WA_SESSION_DIR"] ??
    path.join(process.cwd(), "artifacts", "api-server", ".wa-sessions"),
);

const roomName = (userId: string) => `user:${userId}`;
const sessionPath = (id: string) => path.join(authRoot, id);

function clearSocketListeners(socket: LiveSession["socket"]): void {
  socket.ev.removeAllListeners("connection.update");
  socket.ev.removeAllListeners("creds.update");
  socket.ev.removeAllListeners("messages.upsert");
}

export function attachRealtime(io: Server): void {
  realtime = io;
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth["token"];
      if (typeof token !== "string") {
        next(new Error("Authentication required"));
        return;
      }
      const payload = jwt.verify(token, authSecret!);
      if (typeof payload === "string" || typeof payload.sub !== "string") {
        next(new Error("Invalid authentication"));
        return;
      }
      const [user] = await db
        .select({ id: usersTable.id, status: usersTable.status })
        .from(usersTable)
        .where(eq(usersTable.id, payload.sub))
        .limit(1);
      if (!user || user.status !== "active") {
        next(new Error("Account is not active"));
        return;
      }
      socket.data["userId"] = user.id;
      next();
    } catch {
      next(new Error("Authentication expired"));
    }
  });
  io.on("connection", (socket: Socket) => {
    const userId = socket.data["userId"] as string | undefined;
    if (userId) socket.join(roomName(userId));
  });
}

function publish(userId: string, event: string, value: unknown): void {
  realtime?.to(roomName(userId)).emit(event, value);
}

export function publishUserEvent(userId: string, event: string, value: unknown): void {
  publish(userId, event, value);
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

function statusFromDisconnect(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const output = Reflect.get(error, "output");
  const statusCode = output && Reflect.get(output, "statusCode");
  return typeof statusCode === "number" ? statusCode : null;
}

function isTransientSendError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = Reflect.get(error, "code");
  if (
    typeof code === "string" &&
    [
      "ECONNRESET",
      "ETIMEDOUT",
      "EPIPE",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "ECONNABORTED",
      "EAI_AGAIN",
    ].includes(code)
  ) {
    return true;
  }
  const statusCode = statusFromDisconnect(error);
  if (statusCode === 408 || statusCode === 429 || (statusCode ?? 0) >= 500) {
    return true;
  }
  const message = Reflect.get(error, "message");
  return (
    typeof message === "string" &&
    /connection closed|socket closed|network|timed? ?out|temporarily unavailable/i.test(
      message,
    )
  );
}

export function isWhatsAppConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = Reflect.get(error, "code");
  if (
    typeof code === "string" &&
    [
      "ECONNRESET",
      "ETIMEDOUT",
      "EPIPE",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "ECONNABORTED",
      "EAI_AGAIN",
    ].includes(code)
  ) {
    return true;
  }
  const message = Reflect.get(error, "message");
  return (
    typeof message === "string" &&
    /whatsapp session is offline|connection closed|socket closed|socket is not open|websocket closed|not connected/i.test(
      message,
    )
  );
}

async function updateSession(
  sessionId: string,
  userId: string,
  status: "offline" | "connecting" | "online" | "logged_out" | "inactive",
  phone?: string | null,
): Promise<void> {
  await db
    .update(waSessionsTable)
    .set({
      status,
      ...(phone !== undefined ? { phone } : {}),
      ...(status === "online" ? { lastConnectedAt: new Date() } : {}),
    })
    .where(and(eq(waSessionsTable.id, sessionId), eq(waSessionsTable.userId, userId)));
  publish(userId, "wa:status", { sessionId, status, phone: phone ?? null });
}

export function markSessionInUse(sessionId: string): void {
  const timer = idleTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  idleTimers.delete(sessionId);
}

export function scheduleSessionIdleExpiry(
  sessionId: string,
  userId: string,
  idleMinutes: number,
): void {
  markSessionInUse(sessionId);
  const live = liveSessions.get(sessionId);
  if (!live || live.userId !== userId) return;

  const timer = setTimeout(() => {
    void (async () => {
      if (idleTimers.get(sessionId) !== timer) return;
      idleTimers.delete(sessionId);
      if (liveSessions.get(sessionId) !== live) return;

      const reconnectTimer = reconnectTimers.get(sessionId);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimers.delete(sessionId);
      reconnectAttempts.delete(sessionId);
      liveSessions.delete(sessionId);
      clearSocketListeners(live.socket);
      live.socket.end(new Error("WhatsApp session expired after inactivity."));
      await rm(sessionPath(sessionId), { recursive: true, force: true });
      await updateSession(sessionId, userId, "inactive");
      logger.info({ sessionId, userId }, "WhatsApp session expired after inactivity");
    })().catch((error: unknown) => {
      logger.error({ sessionId, userId, error }, "Could not expire idle WhatsApp session");
    });
  }, idleMinutes * 60_000);
  timer.unref();
  idleTimers.set(sessionId, timer);
}

function messageText(message: Record<string, unknown>): string {
  const content = message["message"];
  if (!content || typeof content !== "object") return "";
  const record = content as Record<string, unknown>;
  const conversation = record["conversation"];
  const extended = record["extendedTextMessage"];
  const image = record["imageMessage"];
  const video = record["videoMessage"];
  const nested =
    extended && typeof extended === "object"
      ? Reflect.get(extended, "text")
      : image && typeof image === "object"
        ? Reflect.get(image, "caption")
        : video && typeof video === "object"
          ? Reflect.get(video, "caption")
          : null;
  return typeof conversation === "string"
    ? conversation
    : typeof nested === "string"
      ? nested
      : "";
}

async function applyOptOut(message: Record<string, unknown>): Promise<void> {
  const key = message["key"];
  const remoteJid =
    key && typeof key === "object" ? Reflect.get(key, "remoteJid") : null;
  if (typeof remoteJid !== "string" || !remoteJid.endsWith("@s.whatsapp.net")) return;
  const text = messageText(message).trim().toLowerCase();
  if (!["stop", "unsubscribe", "berhenti", "berhenti pesan"].includes(text)) return;
  const phone = normalizePhone(remoteJid.split("@", 1)[0]);
  if (!phone) return;
  const now = new Date();
  await db
    .update(contactsTable)
    .set({
      consentRevokedAt: now,
      status: "opted_out",
      lockedByUserId: null,
      lockedAt: null,
      waSessionId: null,
      errorReason: "Penerima memilih untuk berhenti menerima pesan.",
    })
    .where(eq(contactsTable.phone, phone));
}

async function startSocket(
  sessionId: string,
  userId: string,
  options?: { method?: "qr" | "pairing_code"; phone?: string },
): Promise<LiveSession> {
  const pairingPhone =
    options?.method === "pairing_code"
      ? normalizePhone(options.phone ?? "")
      : undefined;
  if (
    options?.method === "pairing_code" &&
    (!pairingPhone || pairingPhone.length < 8)
  ) {
    throw new Error("Nomor WhatsApp untuk pairing code tidak valid.");
  }

  const dir = sessionPath(sessionId);
  await mkdir(dir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  await updateSession(sessionId, userId, "connecting");
  let socket: ReturnType<typeof makeWASocket>;
  try {
    socket = makeWASocket({
      auth: state,
      logger: pino({ level: "silent" }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
  } catch (error) {
    await updateSession(sessionId, userId, "offline");
    throw error;
  }
  const live: LiveSession = {
    socket,
    userId,
    connected: false,
    qrDataUrl: null,
    pairingCode: null,
  };
  liveSessions.set(sessionId, live);

  let finishAuthSetup!: () => void;
  let authSetupFinished = false;
  let authSetupError: Error | null = null;
  let pairingCodeRequested = false;
  const authSetupReady = new Promise<void>((resolve) => {
    finishAuthSetup = () => {
      if (authSetupFinished) return;
      authSetupFinished = true;
      clearTimeout(authSetupTimeout);
      resolve();
    };
  });
  const authSetupTimeout = setTimeout(finishAuthSetup, 12_000);
  authSetupTimeout.unref();

  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("connection.update", async (update) => {
    if (update.qr) {
      if (options?.method === "pairing_code") {
        if (state.creds.registered) {
          finishAuthSetup();
        } else if (!pairingCodeRequested) {
          pairingCodeRequested = true;
          try {
            live.pairingCode = await socket.requestPairingCode(pairingPhone!);
            publish(userId, "wa:pairing-code", {
              sessionId,
              pairingCode: live.pairingCode,
            });
          } catch (error) {
            authSetupError =
              error instanceof Error
                ? error
                : new Error("Gagal membuat kode pairing WhatsApp.");
          } finally {
            finishAuthSetup();
          }
        }
      } else {
        try {
          live.qrDataUrl = await QRCode.toDataURL(update.qr, {
            width: 256,
            margin: 2,
            color: { dark: "#111827", light: "#FFFFFF" },
          });
          publish(userId, "wa:qr", {
            sessionId,
            qrDataUrl: live.qrDataUrl,
          });
        } finally {
          finishAuthSetup();
        }
      }
    }
    if (update.connection === "open") {
      live.connected = true;
      live.qrDataUrl = null;
      reconnectAttempts.delete(sessionId);
      const phone = socket.user?.id.split(":")[0]?.split("@")[0] ?? null;
      await updateSession(sessionId, userId, "online", phone);
      finishAuthSetup();
      return;
    }
    if (update.connection !== "close") return;

    live.connected = false;
    const statusCode = statusFromDisconnect(update.lastDisconnect?.error);
    const loggedOut = statusCode === DisconnectReason.loggedOut;
    const isCurrent = liveSessions.get(sessionId) === live;
    await updateSession(sessionId, userId, loggedOut ? "logged_out" : "offline");
    finishAuthSetup();
    clearSocketListeners(socket);
    if (!isCurrent || loggedOut) {
      if (isCurrent) liveSessions.delete(sessionId);
      if (loggedOut) {
        reconnectAttempts.delete(sessionId);
        await rm(sessionPath(sessionId), { recursive: true, force: true });
      }
      return;
    }

    const nextAttempt = (reconnectAttempts.get(sessionId) ?? 0) + 1;
    if (nextAttempt > maxReconnectAttempts) {
      liveSessions.delete(sessionId);
      reconnectAttempts.delete(sessionId);
      logger.warn({ sessionId, userId }, "WhatsApp reconnect limit reached");
      return;
    }
    reconnectAttempts.set(sessionId, nextAttempt);
    const waitMs =
      statusCode === DisconnectReason.restartRequired
        ? 250
        : Math.min(5_000 * 2 ** (nextAttempt - 1), 60_000);
    const reconnectTimer = setTimeout(() => {
      if (reconnectTimers.get(sessionId) !== reconnectTimer) return;
      reconnectTimers.delete(sessionId);
      if (liveSessions.get(sessionId) !== live) return;
      void startSocket(sessionId, userId).catch((error: unknown) => {
        logger.warn({ sessionId, error }, "Could not reconnect WhatsApp session");
      });
    }, waitMs);
    reconnectTimer.unref();
    reconnectTimers.set(sessionId, reconnectTimer);
  });
  socket.ev.on("messages.upsert", async ({ messages }) => {
    for (const message of messages) {
      if (message.key.fromMe) continue;
      await applyOptOut(message as unknown as Record<string, unknown>);
    }
  });

  await authSetupReady;
  if (authSetupError) {
    if (liveSessions.get(sessionId) === live) liveSessions.delete(sessionId);
    socket.end(authSetupError);
    throw authSetupError;
  }

  return live;
}

export async function connectWaSession(
  sessionId: string,
  userId: string,
  method: "qr" | "pairing_code",
  phone?: string,
) {
  if (method === "pairing_code" && normalizePhone(phone ?? "").length < 8) {
    throw new Error("Nomor WhatsApp untuk pairing code tidak valid.");
  }

  const [session] = await db
    .select()
    .from(waSessionsTable)
    .where(and(eq(waSessionsTable.id, sessionId), eq(waSessionsTable.userId, userId)))
    .limit(1);
  if (!session) return null;

  const existing = liveSessions.get(sessionId);
  markSessionInUse(sessionId);
  const reconnectTimer = reconnectTimers.get(sessionId);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimers.delete(sessionId);
  reconnectAttempts.delete(sessionId);
  if (existing) {
    clearSocketListeners(existing.socket);
    existing.socket.end(new Error("Connection restarted by account owner."));
    liveSessions.delete(sessionId);
  }
  const live = await startSocket(sessionId, userId, { method, phone });
  return {
    session,
    qrDataUrl: live.qrDataUrl,
    pairingCode: live.pairingCode,
  };
}

export function getLiveSocket(sessionId: string, userId: string) {
  const live = liveSessions.get(sessionId);
  return live?.userId === userId && live.connected ? live.socket : undefined;
}

export function isLiveSessionReady(
  sessionId: string,
  userId: string,
  expectedPhone: string | null,
): boolean {
  const socket = getLiveSocket(sessionId, userId);
  if (!socket?.user || !expectedPhone) return false;
  const actualPhone = normalizePhone(
    socket.user.id.split(":")[0]?.split("@")[0] ?? "",
  );
  return actualPhone.length > 0 && actualPhone === normalizePhone(expectedPhone);
}

export async function restoreConnectedWaSessions(): Promise<void> {
  const sessions = await db
    .select({
      id: waSessionsTable.id,
      userId: waSessionsTable.userId,
    })
    .from(waSessionsTable)
    .where(
      or(
        eq(waSessionsTable.status, "online"),
        eq(waSessionsTable.status, "connecting"),
      ),
    );

  await Promise.all(
    sessions.map((session) => updateSession(session.id, session.userId, "offline")),
  );

  await Promise.all(
    sessions.map(async (session) => {
      try {
        const { state } = await useMultiFileAuthState(sessionPath(session.id));
        if (!state.creds.registered) {
          logger.info(
            { sessionId: session.id, userId: session.userId },
            "Skipped WhatsApp session restoration without registered credentials",
          );
          return;
        }
        await startSocket(session.id, session.userId);
        logger.info(
          { sessionId: session.id, userId: session.userId },
          "Restoring WhatsApp session",
        );
      } catch (error) {
        await updateSession(session.id, session.userId, "offline");
        logger.error(
          { sessionId: session.id, userId: session.userId, error },
          "Could not restore WhatsApp session",
        );
      }
    }),
  );
}

export async function disconnectWaSession(
  sessionId: string,
  userId: string,
  removeAuth = false,
): Promise<boolean> {
  const [session] = await db
    .select({ id: waSessionsTable.id })
    .from(waSessionsTable)
    .where(and(eq(waSessionsTable.id, sessionId), eq(waSessionsTable.userId, userId)))
    .limit(1);
  if (!session) return false;
  markSessionInUse(sessionId);
  const reconnectTimer = reconnectTimers.get(sessionId);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimers.delete(sessionId);
  reconnectAttempts.delete(sessionId);
  const live = liveSessions.get(sessionId);
  if (live) {
    liveSessions.delete(sessionId);
    clearSocketListeners(live.socket);
    live.socket.end(new Error("Connection closed by account owner."));
  }
  await updateSession(sessionId, userId, "offline");
  if (removeAuth) {
    await rm(sessionPath(sessionId), { recursive: true, force: true });
    await db
      .delete(waSessionsTable)
      .where(and(eq(waSessionsTable.id, sessionId), eq(waSessionsTable.userId, userId)));
  }
  return true;
}

export async function sendWhatsAppMessage(
  sessionId: string,
  userId: string,
  expectedSessionPhone: string,
  recipientPhone: string,
  content: {
    text: string;
    imageUrl?: string | null;
    ctaText?: string | null;
    ctaUrl?: string | null;
  },
  signal?: AbortSignal,
) {
  const socket = getLiveSocket(sessionId, userId);
  if (!socket?.user) {
    await updateSession(sessionId, userId, "offline");
    throw new Error("WhatsApp session is offline.");
  }
  const actualSender = normalizePhone(
    socket.user.id.split(":")[0]?.split("@")[0] ?? "",
  );
  const expectedSender = normalizePhone(expectedSessionPhone);
  if (!expectedSender || actualSender !== expectedSender) {
    await updateSession(sessionId, userId, "offline");
    throw new Error("Nomor WhatsApp aktif tidak cocok dengan sesi yang ditugaskan.");
  }
  const number = normalizePhone(recipientPhone);
  if (number.length < 8) throw new Error("Nomor penerima tidak valid.");
  const ctaText = content.ctaText?.trim();
  const ctaUrl = content.ctaUrl?.trim();
  const ctaFallback = ctaUrl ? "" : ctaText;
  const text = [
    content.text,
    ctaFallback,
    "Balas BERHENTI untuk berhenti menerima pesan.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const jid = `${number}@s.whatsapp.net`;
  const messageId = generateMessageIDV2(socket.user.id);
  let buttonMessage: proto.IMessage | undefined;
  if (ctaUrl) {
    const media = content.imageUrl
      ? await prepareWAMessageMedia(
          { image: { url: content.imageUrl } },
          { upload: socket.waUploadToServer },
        )
      : undefined;
    const interactiveMessage = proto.Message.InteractiveMessage.fromObject({
      header: {
        hasMediaAttachment: Boolean(media?.imageMessage),
        ...(media?.imageMessage ? { imageMessage: media.imageMessage } : {}),
      },
      body: { text: content.text },
      footer: { text: "Balas BERHENTI untuk berhenti menerima pesan." },
      nativeFlowMessage: {
        buttons: [
          {
            name: "cta_url",
            buttonParamsJson: JSON.stringify({
              display_text: ctaText || "Buka tautan",
              url: ctaUrl,
              merchant_url: ctaUrl,
            }),
          },
        ],
        messageVersion: 1,
      },
    });
    buttonMessage = proto.Message.fromObject({
      viewOnceMessage: {
        message: { interactiveMessage },
      },
    });
  }
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    let sendSocket = socket;
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      if (signal?.aborted) throw lastError;
      const reconnectedSocket = getLiveSocket(sessionId, userId);
      if (!reconnectedSocket?.user) throw lastError;
      const reconnectedSender = normalizePhone(
        reconnectedSocket.user.id.split(":")[0]?.split("@")[0] ?? "",
      );
      if (reconnectedSender !== expectedSender) {
        throw new Error("Nomor WhatsApp aktif tidak cocok dengan sesi yang ditugaskan.");
      }
      sendSocket = reconnectedSocket;
    }
    try {
      if (ctaUrl) {
        if (!buttonMessage) throw new Error("Tombol CTA tidak dapat disiapkan.");
        const generatedMessage = generateWAMessageFromContent(
          jid,
          buttonMessage,
          { userJid: sendSocket.user!.id, messageId },
        );
        if (!generatedMessage.message) {
          throw new Error("Pesan CTA tidak dapat dibentuk oleh Baileys.");
        }
        return await sendSocket.relayMessage(
          jid,
          generatedMessage.message,
          { messageId },
        );
      }
      const messageContent = content.imageUrl
        ? { image: { url: content.imageUrl }, caption: text }
        : { text };
      const result = await sendSocket.sendMessage(jid, messageContent, { messageId });
      return result?.key.id ?? null;
    } catch (error) {
      lastError = error;
      if (attempt === 0 && isTransientSendError(error)) continue;
      throw error;
    }
  }
  return null;
}

export async function stopAllLiveSessions(): Promise<void> {
  const live = [...liveSessions.values()];
  liveSessions.clear();
  for (const timer of idleTimers.values()) clearTimeout(timer);
  for (const timer of reconnectTimers.values()) clearTimeout(timer);
  idleTimers.clear();
  reconnectTimers.clear();
  reconnectAttempts.clear();
  await Promise.all(
    live.map(async ({ socket }) => {
      try {
        clearSocketListeners(socket);
        socket.end(new Error("API server shutting down."));
      } catch (error) {
        logger.warn({ error }, "Could not stop WhatsApp socket cleanly");
      }
    }),
  );
}
