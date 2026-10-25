import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCookie } from "@tanstack/react-start/server";
import { simulate, type BookLedger } from "./engine.ts";
import { barDuration, sessionKey, type AccountSettings, type Bar, type DeskParams, type Interval } from "./model.ts";
import { unseal } from "./vault.ts";
import {
  alpacaHost,
  asNumber,
  barIndexAt,
  cleanSymbol,
  closedBarIndex,
  dailyStopHit,
  isWorking,
  nextAccountSignal,
  openingPosition,
  planOrder,
  readFills,
  readLiveArm,
  type AlpacaSide,
} from "./alpaca.ts";

type BrokerRecord = { id: string; paper: boolean; fields: Record<string, string> };
type Vault = { owner: { email: string }; broker: BrokerRecord; sessions: Record<string, { email: string; exp: number }> };

export type SessionState = {
  pid: number;
  armed: boolean;
  paper: boolean;
  liveOk: boolean;
  stopped: boolean;
  allowClosed: boolean;
  slippageCents: number;
  dailyLossPct: number;
  dayKey: string;
  dayStartEquity: number;
  symbol: string;
  interval: Interval;
  params: DeskParams | null;
  account: AccountSettings | null;
  lastBar: number;
  lastClientOrderId: string;
  decision: string;
  reconciledAt: string;
};

export type SessionPublic = {
  armed: boolean;
  paper: boolean;
  stopped: boolean;
  allowClosed: boolean;
  slippageCents: number;
  dailyLossPct: number;
  decision: string;
  reconciledAt: string;
  lastClientOrderId: string;
};

const DATA = "https://data.alpaca.markets";
const FRAME: Record<Interval, string> = { "1m": "1Min", "5m": "5Min", "15m": "15Min", "1h": "1Hour", "1d": "1Day" };
const DAYS: Record<Interval, number> = { "1m": 5, "5m": 60, "15m": 60, "1h": 700, "1d": 1800 };

function dir(): string {
  return join(process.cwd(), ".desk");
}

function readVault(): Vault | null {
  try {
    const key = readFileSync(join(dir(), "key"));
    if (key.length !== 32) return null;
    return unseal<Vault>(key, readFileSync(join(dir(), "vault"), "utf8"));
  } catch {
    return null;
  }
}

function localBroker(): { broker: BrokerRecord } | { error: string } {
  const vault = readVault();
  if (!vault?.owner) return { error: "Set up this desk first." };
  if (vault.broker.id !== "alpaca") return { error: "Choose Alpaca under Change brokerage." };
  if (!vault.broker.fields.keyId?.trim() || !vault.broker.fields.secret?.trim()) return { error: "Paste an Alpaca key and secret." };
  return { broker: vault.broker };
}

function broker(): { broker: BrokerRecord } | { error: string } {
  const token = getCookie("desk_session");
  const vault = readVault();
  if (!token || !vault) return { error: "Sign in again." };
  const session = vault.sessions[token];
  if (!session || session.exp <= Date.now() || session.email !== vault.owner.email) return { error: "Sign in again." };
  return localBroker();
}

async function call(broker: BrokerRecord, url: string, method = "GET", body?: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method,
    headers: {
      "APCA-API-KEY-ID": broker.fields.keyId,
      "APCA-API-SECRET-KEY": broker.fields.secret,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text.slice(0, 300) };
    }
  }
  return { status: response.status, body: parsed };
}

function message(status: number, body: unknown): string {
  const text = body && typeof body === "object" && "message" in body ? String((body as { message: unknown }).message) : "";
  if (status === 401) return "Alpaca refused the key. Paper and live keys are different pairs.";
  return text || `Alpaca returned ${status}.`;
}

function blank(): SessionState {
  return {
    pid: process.pid,
    armed: false,
    paper: true,
    liveOk: false,
    stopped: false,
    allowClosed: false,
    slippageCents: 15,
    dailyLossPct: 3,
    dayKey: "",
    dayStartEquity: 0,
    symbol: "",
    interval: "5m",
    params: null,
    account: null,
    lastBar: 0,
    lastClientOrderId: "",
    decision: "Orders are off.",
    reconciledAt: "",
  };
}

function readState(): SessionState {
  try {
    const raw = JSON.parse(readFileSync(join(dir(), "session.json"), "utf8")) as SessionState;
    return { ...blank(), ...raw, pid: raw.pid || 0 };
  } catch {
    return blank();
  }
}

function writeState(state: SessionState) {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(join(dir(), "session.json"), JSON.stringify(state), { mode: 0o600 });
}

function logLine(text: string) {
  mkdirSync(dir(), { recursive: true });
  const line = `${new Date().toISOString()} ${text}\n`;
  appendFileSync(join(dir(), "orders.log"), line, { mode: 0o600 });
}

function publish(state: SessionState): SessionPublic {
  return {
    armed: state.armed,
    paper: state.paper,
    stopped: state.stopped,
    allowClosed: state.allowClosed,
    slippageCents: state.slippageCents,
    dailyLossPct: state.dailyLossPct,
    decision: state.decision,
    reconciledAt: state.reconciledAt,
    lastClientOrderId: state.lastClientOrderId,
  };
}

export function bootSession() {
  const state = readState();
  if (state.pid !== process.pid) {
    state.armed = false;
    state.pid = process.pid;
    state.decision = "Restarted. Orders are off until you arm them.";
    writeState(state);
    logLine("restarted, orders off");
  }
}

export function readSession(): SessionPublic {
  bootSession();
  return publish(readState());
}

export async function loadAlpacaBars(symbol: string, interval: Interval): Promise<{ ok: true; bars: Bar[] } | { ok: false; error: string }> {
  const session = localBroker();
  if ("error" in session) return { ok: false, error: session.error };
  const clean = cleanSymbol(symbol);
  const start = new Date(Date.now() - DAYS[interval] * 86_400_000).toISOString();
  const bars: Bar[] = [];
  let page = "";
  try {
    for (let i = 0; i < 6; i++) {
      const url = `${DATA}/v2/stocks/bars?symbols=${encodeURIComponent(clean)}&timeframe=${FRAME[interval]}&start=${encodeURIComponent(start)}&limit=10000&adjustment=raw&feed=iex&sort=asc${page ? `&page_token=${encodeURIComponent(page)}` : ""}`;
      const response = await call(session.broker, url);
      if (response.status >= 400) return { ok: false, error: message(response.status, response.body) };
      const body = response.body as { bars?: Record<string, unknown[]>; next_page_token?: string };
      const rows = body.bars?.[clean];
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (!row || typeof row !== "object") continue;
          const raw = row as Record<string, unknown>;
          const t = Date.parse(String(raw.t ?? ""));
          const c = asNumber(raw.c);
          if (!Number.isFinite(t) || !(c > 0)) continue;
          bars.push({
            t,
            o: asNumber(raw.o) || c,
            h: asNumber(raw.h) || c,
            l: asNumber(raw.l) || c,
            c,
            v: asNumber(raw.v),
          });
        }
      }
      page = typeof body.next_page_token === "string" ? body.next_page_token : "";
      if (!page) break;
    }
  } catch {
    return { ok: false, error: "The desk could not reach Alpaca bars." };
  }
  if (bars.length < 8) return { ok: false, error: "Alpaca returned too few bars." };
  return { ok: true, bars };
}

type Job = {
  symbol: string;
  interval: Interval;
  params: DeskParams;
  account: AccountSettings;
  slippageCents: number;
  dailyLossPct: number;
  allowClosed: boolean;
  liveArm: unknown;
  once: boolean;
};

function saveJob(state: SessionState, job: Job, paper: boolean, liveOk: boolean) {
  state.symbol = cleanSymbol(job.symbol);
  state.interval = job.interval;
  state.params = job.params;
  state.account = job.account;
  state.slippageCents = Math.min(500, Math.max(1, Math.round(job.slippageCents || 15)));
  state.dailyLossPct = Math.min(50, Math.max(0.5, job.dailyLossPct || 3));
  state.allowClosed = job.allowClosed === true;
  state.paper = paper;
  state.liveOk = liveOk;
}

export function requireSigned(): { ok: true } | { ok: false; error: string } {
  const signed = broker();
  return "error" in signed ? { ok: false, error: signed.error } : { ok: true };
}

export async function runSession(job: Job): Promise<{ ok: true; session: SessionPublic } | { ok: false; error: string }> {
  const signed = broker();
  if ("error" in signed) return { ok: false, error: signed.error };
  const state = readState();
  const liveOk = signed.broker.paper || readLiveArm(job.liveArm) != null;
  if (!signed.broker.paper && !liveOk) return { ok: false, error: "Live orders need the live key." };
  saveJob(state, job, signed.broker.paper, liveOk);
  if (!job.once) {
    state.armed = true;
    state.stopped = false;
    state.decision = "Armed. The next closed bar can send.";
    logLine(`armed ${state.symbol} ${state.paper ? "paper" : "live"}`);
  }
  writeState(state);
  ensureLoop();
  if (job.once) {
    const result = await tick(true);
    if (!result.ok) return result;
  }
  return { ok: true, session: publish(readState()) };
}

export function disarmSession(why = "Orders are off."): SessionPublic {
  const state = readState();
  state.armed = false;
  state.decision = why;
  writeState(state);
  logLine(why);
  return publish(state);
}

let ticking = false;

async function tick(once = false): Promise<{ ok: true } | { ok: false; error: string }> {
  if (ticking) return { ok: true };
  ticking = true;
  try {
    const state = readState();
    if (!once && !state.armed) return { ok: true };
    if (!state.params || !state.account || !state.symbol) {
      state.decision = "No book is loaded.";
      writeState(state);
      return { ok: false, error: state.decision };
    }
    const signed = localBroker();
    if ("error" in signed) {
      state.armed = false;
      state.decision = signed.error;
      writeState(state);
      return { ok: false, error: signed.error };
    }
    if (!signed.broker.paper && !state.liveOk) {
      return fail(state, "Live orders need the live key.");
    }
    const host = alpacaHost(signed.broker.paper);
    const [clock, account, open, position] = await Promise.all([
      call(signed.broker, `${host}/v2/clock`),
      call(signed.broker, `${host}/v2/account`),
      call(signed.broker, `${host}/v2/orders?status=open&limit=50&symbols=${encodeURIComponent(state.symbol)}`),
      call(signed.broker, `${host}/v2/positions/${encodeURIComponent(state.symbol)}`),
    ]);
    state.reconciledAt = new Date().toISOString();
    if (account.status >= 400) {
      state.decision = message(account.status, account.body);
      writeState(state);
      logLine(state.decision);
      return { ok: false, error: state.decision };
    }
    const clockBody = clock.status < 400 && clock.body && typeof clock.body === "object" ? (clock.body as { is_open?: unknown }) : null;
    const marketOpen = clockBody?.is_open === true;
    const equity = asNumber((account.body as { equity?: unknown }).equity);
    const cash = asNumber((account.body as { cash?: unknown }).cash);
    const day = sessionKey(Date.now());
    if (state.dayKey !== day) {
      state.dayKey = day;
      state.dayStartEquity = equity;
      state.stopped = false;
    }
    if (!(state.dayStartEquity > 0)) state.dayStartEquity = equity;
    const positionQty = position.status < 400 && position.body && typeof position.body === "object" ? asNumber((position.body as { qty?: unknown }).qty) : 0;
    const avgEntry = position.status < 400 && position.body && typeof position.body === "object" ? asNumber((position.body as { avg_entry_price?: unknown }).avg_entry_price) : 0;
    const working = Array.isArray(open.body) && open.body.some((row) => row && typeof row === "object" && isWorking(String((row as { status?: unknown }).status ?? "")));
    if (working) {
      state.decision = "An order is already working. Nothing new was sent.";
      writeState(state);
      logLine(state.decision);
      return { ok: true };
    }
    const stop = dailyStopHit(equity, state.dayStartEquity, state.dailyLossPct);
    if (stop && positionQty <= 0) return fail(state, "Daily loss stop. The account is flat, so orders are off.");
    const bars = await loadAlpacaBars(state.symbol, state.interval);
    if (!bars.ok) {
      state.decision = bars.error;
      writeState(state);
      logLine(bars.error);
      return { ok: false, error: bars.error };
    }
    const fills = await call(signed.broker, `${host}/v2/account/activities/FILL?page_size=100&direction=asc&after=${encodeURIComponent(new Date(bars.bars[0].t).toISOString())}`);
    const accountFills = fills.status < 400 ? readFills(fills.body, state.symbol) : [];
    const times = bars.bars.map((bar) => bar.t);
    const ledgerFills = accountFills.flatMap((fill) => {
      const index = barIndexAt(times, fill.time);
      if (index < 0) return [];
      return [{ index, side: fill.side, price: fill.price, qty: fill.qty }];
    });
    const opening = openingPosition(accountFills, positionQty, avgEntry);
    const ledger: BookLedger = { openingQty: opening.qty, openingPrice: opening.price, fills: ledgerFills };
    const book = simulate(bars.bars, state.interval, state.params, state.account, ledger);
    const index = closedBarIndex(times, barDuration(state.interval), Date.now());
    if (index < 0) {
      state.decision = "No closed bar yet.";
      writeState(state);
      return { ok: true };
    }
    const row = book.trace[index];
    let side: AlpacaSide | "none" = nextAccountSignal(positionQty, row?.signalBuy === true, row?.signalSell === true, row?.sellHold === true);
    if (stop && positionQty > 0) side = "sell";
    if (side === "none") {
      state.decision = stop ? "Daily loss stop." : `No order on the closed bar. ${positionQty > 0 ? "Long" : "Flat"}.`;
      if (stop) state.armed = false;
      state.stopped = stop;
      writeState(state);
      logLine(state.decision);
      return { ok: true };
    }
    if (!marketOpen && !state.allowClosed) {
      state.decision = "The market is closed. No order was sent.";
      writeState(state);
      logLine(state.decision);
      return { ok: true };
    }
    const barTime = bars.bars[index].t;
    if (state.lastBar === barTime) {
      state.decision = "That bar was already sent.";
      writeState(state);
      return { ok: true };
    }
    const plan = planOrder({
      paper: signed.broker.paper,
      liveArmed: state.liveOk,
      symbol: state.symbol,
      side,
      dollars: state.account.dollarsPerBuy > 0 ? state.account.dollarsPerBuy : cash,
      price: bars.bars[index].c,
      cash,
      positionQty,
      sample: false,
      barTime,
      working: false,
      marketOpen,
      allowClosed: state.allowClosed,
      slippageCents: state.slippageCents,
    });
    if (!plan.ok) {
      state.decision = plan.error;
      writeState(state);
      logLine(plan.error);
      return { ok: false, error: plan.error };
    }
    const sent = await call(signed.broker, `${host}/v2/orders`, "POST", plan.body);
    const reply = sent.body && typeof sent.body === "object" ? JSON.stringify(sent.body).slice(0, 400) : "";
    logLine(`alpaca ${sent.status} ${plan.body.client_order_id} ${reply}`);
    if (sent.status >= 400) {
      state.decision = message(sent.status, sent.body);
      writeState(state);
      logLine(state.decision);
      return { ok: false, error: state.decision };
    }
    state.lastBar = barTime;
    state.lastClientOrderId = plan.body.client_order_id;
    state.decision = `${side} limit ${plan.body.limit_price ?? ""} for ${plan.qty} shares.`;
    if (stop) {
      state.armed = false;
      state.stopped = true;
      state.decision = `Daily loss stop. ${state.decision} Orders are off.`;
    }
    writeState(state);
    logLine(state.decision);
    return { ok: true };
  } catch {
    try {
      const state = readState();
      state.decision = "The desk could not reach Alpaca.";
      writeState(state);
      logLine(state.decision);
    } catch {
      /* the log is best effort */
    }
    return { ok: false, error: "The desk could not reach Alpaca." };
  } finally {
    ticking = false;
  }
}

function fail(state: SessionState, error: string): { ok: false; error: string } {
  state.armed = false;
  state.stopped = true;
  state.decision = error;
  writeState(state);
  logLine(error);
  return { ok: false, error };
}

function ensureLoop() {
  const g = globalThis as { __deskTick?: ReturnType<typeof setInterval> };
  if (g.__deskTick) return;
  g.__deskTick = setInterval(() => {
    void tick(false);
  }, 20_000);
}

bootSession();
if (readState().armed) ensureLoop();
