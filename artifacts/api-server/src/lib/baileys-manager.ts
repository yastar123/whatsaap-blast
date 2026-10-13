import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Server, type Socket } from "socket.io";
import jwt from "jsonwebtoken";
import pino from "pino";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { and, eq } from "drizzle-orm";
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
  qrDataUrl: string | null;
  pairingCode: string | null;
};

const liveSessions = new Map<string, LiveSession>();
let realtime: Server | null = null;
const authSecret = process.env["SESSION_SECRET"];
if (!authSecret) throw new Error("SESSION_SECRET is required for live sessions.");

const authRoot = path.resolve(
  process.env["WA_SESSION_DIR"] ??
    path.join(process.cwd(), "artifacts", "api-server", ".wa-sessions"),
);

const roomName = (userId: string) => `user:${userId}`;
const sessionPath = (id: string) => path.join(authRoot, id);

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

async function updateSession(
  sessionId: string,
  userId: string,
  status: "offline" | "connecting" | "online" | "logged_out",
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
  const socket = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  const live: LiveSession = {
    socket,
    userId,
    qrDataUrl: null,
    pairingCode: null,
  };
  liveSessions.set(sessionId, live);
  await updateSession(sessionId, userId, "connecting");

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
      live.qrDataUrl = null;
      const phone = socket.user?.id.split(":")[0]?.split("@")[0] ?? null;
      await updateSession(sessionId, userId, "online", phone);
      finishAuthSetup();
      return;
    }
    if (update.connection !== "close") return;

    const statusCode = statusFromDisconnect(update.lastDisconnect?.error);
    const loggedOut = statusCode === DisconnectReason.loggedOut;
    await updateSession(sessionId, userId, loggedOut ? "logged_out" : "offline");
    finishAuthSetup();
    if (liveSessions.get(sessionId) !== live || loggedOut) {
      if (liveSessions.get(sessionId) === live) liveSessions.delete(sessionId);
      return;
    }

    const waitMs =
      statusCode === DisconnectReason.restartRequired ? 250 : 5_000;
    setTimeout(() => {
      if (liveSessions.get(sessionId) !== live) return;
      void startSocket(sessionId, userId).catch((error: unknown) => {
        logger.warn({ sessionId, error }, "Could not reconnect WhatsApp session");
      });
    }, waitMs);
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
  if (existing) {
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
  return live?.userId === userId ? live.socket : undefined;
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
  const live = liveSessions.get(sessionId);
  if (live) {
    liveSessions.delete(sessionId);
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
  phone: string,
  content: { text: string; imageUrl?: string | null; ctaUrl?: string | null },
) {
  const socket = getLiveSocket(sessionId, userId);
  if (!socket || !socket.user) throw new Error("WhatsApp session is offline.");
  const number = normalizePhone(phone);
  if (number.length < 8) throw new Error("Nomor penerima tidak valid.");
  const text =
    content.text +
    (content.ctaUrl ? `\n\n${content.ctaUrl}` : "") +
    "\n\nBalas BERHENTI untuk berhenti menerima pesan.";
  const jid = `${number}@s.whatsapp.net`;
  if (content.imageUrl) {
    const result = await socket.sendMessage(jid, {
      image: { url: content.imageUrl },
      caption: text,
    });
    return result?.key.id ?? null;
  }
  const result = await socket.sendMessage(jid, { text });
  return result?.key.id ?? null;
}

export async function stopAllLiveSessions(): Promise<void> {
  const live = [...liveSessions.values()];
  liveSessions.clear();
  await Promise.all(
    live.map(async ({ socket }) => {
      try {
        socket.end(new Error("API server shutting down."));
      } catch (error) {
        logger.warn({ error }, "Could not stop WhatsApp socket cleanly");
      }
    }),
  );
}
