import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import {
  brokerById,
  checkPassword,
  cleanEmail,
  hashPassword,
  newKey,
  seal,
  unseal,
  validEmail,
  type BrokerId,
} from "./vault.ts";

const COOKIE = "desk_session";
const WEEK = 60 * 60 * 24 * 14;

type Owner = { email: string; salt: string; hash: string };
type BrokerRecord = { id: BrokerId; paper: boolean; fields: Record<string, string> };
type Session = { email: string; exp: number };
type Vault = { owner: Owner; broker: BrokerRecord; sessions: Record<string, Session> };

function dir(): string {
  return join(process.cwd(), ".desk");
}

function readKey(): Buffer {
  mkdirSync(dir(), { recursive: true });
  const path = join(dir(), "key");
  try {
    const key = readFileSync(path);
    if (key.length === 32) return key;
  } catch {
    /* a new desk has no key yet */
  }
  const key = newKey();
  writeFileSync(path, key, { mode: 0o600 });
  return key;
}

function readVault(): Vault | null {
  try {
    const payload = readFileSync(join(dir(), "vault"), "utf8");
    return unseal<Vault>(readKey(), payload);
  } catch {
    return null;
  }
}

function writeVault(vault: Vault) {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(join(dir(), "vault"), seal(readKey(), vault), { mode: 0o600 });
}

function prune(vault: Vault, now = Date.now()) {
  for (const [token, session] of Object.entries(vault.sessions)) {
    if (session.exp <= now) delete vault.sessions[token];
  }
}

function putCookie(token: string) {
  setCookie(COOKIE, token, { path: "/", httpOnly: true, secure: false, sameSite: "lax", maxAge: WEEK });
}

function clearCookie() {
  setCookie(COOKIE, "", { path: "/", httpOnly: true, secure: false, sameSite: "lax", maxAge: 0 });
}

function currentSession(): { vault: Vault; token: string } | null {
  const token = getCookie(COOKIE);
  if (!token) return null;
  const vault = readVault();
  if (!vault) return null;
  prune(vault);
  const session = vault.sessions[token];
  if (!session || session.exp <= Date.now() || session.email !== vault.owner.email) return null;
  return { vault, token };
}

function publicBroker(broker: BrokerRecord) {
  return {
    id: broker.id,
    name: brokerById(broker.id)?.name ?? broker.id,
    paper: broker.paper,
  };
}

function cleanFields(id: BrokerId, incoming: unknown): { fields: Record<string, string> } | { error: string } {
  const broker = brokerById(id);
  if (!broker) return { error: "Choose a brokerage." };
  const raw = incoming && typeof incoming === "object" ? (incoming as Record<string, unknown>) : {};
  const fields: Record<string, string> = {};
  for (const field of broker.fields) {
    const value = String(raw[field.id] ?? "").trim().slice(0, 4000);
    if (!value && field.id === "gateway") fields[field.id] = "127.0.0.1:5000";
    else if (!value && !field.optional) return { error: `Enter the ${field.label.toLowerCase()}.` };
    else fields[field.id] = value;
  }
  return { fields };
}

function readBroker(input: unknown): { broker: BrokerRecord } | { error: string } {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const id = String(raw.broker ?? "");
  if (!brokerById(id)) return { error: "Choose a brokerage." };
  const fields = cleanFields(id as BrokerId, raw.fields);
  if ("error" in fields) return fields;
  return { broker: { id: id as BrokerId, paper: raw.paper !== false, fields: fields.fields } };
}

export const readGate = createServerFn({ method: "GET" }).handler(() => {
  const vault = readVault();
  if (!vault?.owner) return { ready: false as const };
  const session = currentSession();
  if (!session) return { ready: true as const, signedIn: false as const };
  return { ready: true as const, signedIn: true as const, email: vault.owner.email, broker: publicBroker(vault.broker) };
});

export const setupGate = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => {
    if (readVault()?.owner) return { ok: false as const, error: "This computer already has a desk owner." };
    const raw = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const email = cleanEmail(raw.email);
    const password = String(raw.password ?? "");
    if (!validEmail(email)) return { ok: false as const, error: "Enter an email address." };
    if (password.length < 8) return { ok: false as const, error: "Use a password of at least 8 characters." };
    const broker = readBroker(raw);
    if ("error" in broker) return { ok: false as const, error: broker.error };
    const owner = { email, ...hashPassword(password) };
    const token = randomBytes(32).toString("base64url");
    writeVault({
      owner,
      broker: broker.broker,
      sessions: { [token]: { email, exp: Date.now() + WEEK * 1000 } },
    });
    putCookie(token);
    return { ok: true as const };
  });

export const loginGate = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => {
    const vault = readVault();
    if (!vault?.owner) return { ok: false as const, error: "Set up this desk first." };
    const raw = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const email = cleanEmail(raw.email);
    const password = String(raw.password ?? "");
    if (email !== vault.owner.email || !checkPassword(password, vault.owner.salt, vault.owner.hash)) {
      return { ok: false as const, error: "That email or password is wrong." };
    }
    prune(vault);
    const token = randomBytes(32).toString("base64url");
    vault.sessions[token] = { email, exp: Date.now() + WEEK * 1000 };
    writeVault(vault);
    putCookie(token);
    return { ok: true as const };
  });

export const updateBroker = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(({ data }) => {
    const session = currentSession();
    if (!session) return { ok: false as const, error: "Sign in again." };
    const broker = readBroker(data);
    if ("error" in broker) return { ok: false as const, error: broker.error };
    session.vault.broker = broker.broker;
    writeVault(session.vault);
    return { ok: true as const };
  });

export const logoutGate = createServerFn({ method: "POST" }).handler(() => {
  const session = currentSession();
  if (session) {
    delete session.vault.sessions[session.token];
    writeVault(session.vault);
  }
  clearCookie();
  return { ok: true as const };
});
