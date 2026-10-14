import { defineConfig } from "drizzle-kit";
import path, { dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const envFile = path.join(workspaceRoot, ".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
