import { createServerFn } from "@tanstack/react-start";
import type { AccountSettings, DeskParams, Interval } from "./model.ts";
import { INTERVALS } from "./model.ts";
import { disarmSession, loadAlpacaBars, readSession, requireSigned, runSession, type SessionPublic } from "./session-run.ts";

export type { SessionPublic };

type JobInput = {
  symbol: string;
  interval: Interval;
  params: DeskParams;
  account: AccountSettings;
  slippageCents: number;
  dailyLossPct: number;
  allowClosed: boolean;
  liveArm: unknown;
};

function job(input: unknown, once: boolean): JobInput & { once: boolean } {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const interval = INTERVALS.some((item) => item.id === raw.interval) ? (raw.interval as Interval) : "5m";
  return {
    symbol: String(raw.symbol ?? ""),
    interval,
    params: raw.params as DeskParams,
    account: raw.account as AccountSettings,
    slippageCents: Number(raw.slippageCents ?? 15),
    dailyLossPct: Number(raw.dailyLossPct ?? 3),
    allowClosed: raw.allowClosed === true,
    liveArm: raw.liveArm,
    once,
  };
}

export const sessionRead = createServerFn({ method: "GET" }).handler((): SessionPublic => readSession());

export const sessionArm = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => runSession(job(data, false)));

export const sessionOnce = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => runSession(job(data, true)));

export const sessionDisarm = createServerFn({ method: "POST" }).handler(() => ({ ok: true as const, session: disarmSession() }));

export const alpacaBars = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }) => {
    const signed = requireSigned();
    if (!signed.ok) return signed;
    const raw = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const interval = INTERVALS.some((item) => item.id === raw.interval) ? (raw.interval as Interval) : "5m";
    const symbol = String(raw.symbol ?? "");
    const loaded = await loadAlpacaBars(symbol, interval);
    if (!loaded.ok) return loaded;
    return {
      ok: true as const,
      tape: { symbol: symbol.toUpperCase(), interval, source: "alpaca" as const, notice: null, bars: loaded.bars },
    };
  });
