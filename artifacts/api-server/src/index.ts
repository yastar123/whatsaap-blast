import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { Server as SocketServer } from "socket.io";
import { attachRealtime, stopAllLiveSessions } from "./lib/baileys-manager";
import {
  startBalanceReleaseWorker,
  stopBalanceReleaseWorker,
} from "./lib/balance-release";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);
const io = new SocketServer(server, {
  path: "/api/socket.io",
  cors: { origin: true, credentials: false },
  maxHttpBufferSize: 1_000_000,
});
attachRealtime(io);
startBalanceReleaseWorker();

server.listen(port, () => {
  const shutdown = () => {
    stopBalanceReleaseWorker();
    void stopAllLiveSessions();
    io.close();
    server.close(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  logger.info({ port }, "Server listening");
});
