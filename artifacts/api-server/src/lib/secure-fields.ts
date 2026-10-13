import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const secret = process.env["SESSION_SECRET"];
if (!secret) throw new Error("SESSION_SECRET is required to encrypt private fields.");
const key = scryptSync(secret, "wa-campaign-private-data-v1", 32);

export function encryptPrivateValue(value: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptPrivateValue(value: string): string {
  const [version, nonceText, tagText, ciphertextText] = value.split(".");
  if (version !== "v1" || !nonceText || !tagText || !ciphertextText) {
    throw new Error("Stored private value has an unsupported format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(nonceText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskAccountNumber(value: string): string {
  const visible = value.slice(-4);
  return `${"•".repeat(Math.max(value.length - visible.length, 4))}${visible}`;
}
