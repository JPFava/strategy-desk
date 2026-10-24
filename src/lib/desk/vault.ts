import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export { BROKERS, brokerById, cleanEmail, validEmail } from "./vault-brokers.ts";
export type { BrokerChoice, BrokerField, BrokerId } from "./vault-brokers.ts";

export function hashPassword(password: string, salt = randomBytes(16)): { salt: string; hash: string } {
  const hash = scryptSync(password, salt, 64);
  return { salt: salt.toString("base64url"), hash: hash.toString("base64url") };
}

export function checkPassword(password: string, salt: string, hash: string): boolean {
  const next = scryptSync(password, Buffer.from(salt, "base64url"), 64);
  const prev = Buffer.from(hash, "base64url");
  if (next.length !== prev.length) return false;
  return timingSafeEqual(next, prev);
}

export function seal(key: Buffer, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, body]).toString("base64url");
}

export function unseal<T>(key: Buffer, payload: string): T {
  const raw = Buffer.from(payload, "base64url");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const text = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  return JSON.parse(text) as T;
}

export function newKey(): Buffer {
  return randomBytes(32);
}
