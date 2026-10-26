import { createServerFn } from "@tanstack/react-start";
import { alpacaHost, asNumber, cleanSymbol, historyPath, isWorking, planOrder, readFills, readHistory, readLiveArm, type AccountFill, type AlpacaSide, type EquityPoint } from "./alpaca.ts";
import { getCookie } from "@tanstack/react-start/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unseal } from "./vault.ts";

type BrokerRecord = { id: string; paper: boolean; fields: Record<string, string> };
type Vault = { owner: { email: string }; broker: BrokerRecord; sessions: Record<string, { email: string; exp: number }> };

function readSealedVault(): Vault | null {
  try {
    const dir = join(process.cwd(), ".desk");
    const key = readFileSync(join(dir, "key"));
    if (key.length !== 32) return null;
    return unseal<Vault>(key, readFileSync(join(dir, "vault"), "utf8"));
  } catch {
    return null;
  }
}

function signedIn(): { broker: BrokerRecord } | { error: string } {
  const token = getCookie("desk_session");
  const vault = readSealedVault();
  if (!token || !vault) return { error: "Sign in again." };
  const session = vault.sessions[token];
  if (!session || session.exp <= Date.now() || session.email !== vault.owner.email) return { error: "Sign in again." };
  if (vault.broker.id !== "alpaca") return { error: "Choose Alpaca under Change brokerage. This desk sends orders only there." };
  const keyId = vault.broker.fields.keyId?.trim();
  const secret = vault.broker.fields.secret?.trim();
  if (!keyId || !secret) return { error: "Paste an Alpaca key and secret." };
  return { broker: vault.broker };
}

async function alpacaFetch(broker: BrokerRecord, path: string, method = "GET", body?: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${alpacaHost(broker.paper)}${path}`, {
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

function alpacaError(status: number, body: unknown): string {
  const message = body && typeof body === "object" && "message" in body ? String((body as { message: unknown }).message) : "";
  if (status === 401) return "Alpaca refused the key. Paper and live keys are different pairs.";
  return message || `Alpaca returned ${status}.`;
}

export type AlpacaOrderView = {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: string;
  status: string;
  qty: number;
  filledQty: number;
  filledAvgPrice: number | null;
  submittedAt: string;
};

export type AlpacaLook = {
  ok: true;
  paper: boolean;
  marketOpen: boolean;
  nextOpen: string;
  nextClose: string;
  status: string;
  cash: number;
  equity: number;
  positionQty: number;
  avgEntry: number | null;
  buyingPower: number;
  history: EquityPoint[];
  fills: AccountFill[];
  orders: AlpacaOrderView[];
};

function viewOrder(value: unknown): AlpacaOrderView | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.symbol !== "string") return null;
  const filled = asNumber(raw.filled_avg_price);
  return {
    id: raw.id,
    clientOrderId: typeof raw.client_order_id === "string" ? raw.client_order_id : "",
    symbol: raw.symbol,
    side: typeof raw.side === "string" ? raw.side : "",
    status: typeof raw.status === "string" ? raw.status : "",
    qty: asNumber(raw.qty),
    filledQty: asNumber(raw.filled_qty),
    filledAvgPrice: filled > 0 ? filled : null,
    submittedAt: typeof raw.submitted_at === "string" ? raw.submitted_at : "",
  };
}

export const alpacaLook = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }): Promise<{ ok: false; error: string } | AlpacaLook> => {
    const session = signedIn();
    if ("error" in session) return { ok: false, error: session.error };
    const raw = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const symbol = cleanSymbol(raw.symbol);
    const from = asNumber(raw.from);
    const to = asNumber(raw.to) || Date.now();
    const broker = session.broker;
    try {
      const [clock, account, orders, history, fills] = await Promise.all([
        alpacaFetch(broker, "/v2/clock"),
        alpacaFetch(broker, "/v2/account"),
        alpacaFetch(broker, `/v2/orders?status=all&limit=100&direction=desc${symbol ? `&symbols=${encodeURIComponent(symbol)}` : ""}`),
        alpacaFetch(broker, from > 0 ? historyPath(from, to) : "/v2/account/portfolio/history?period=1M&timeframe=1D"),
        alpacaFetch(
          broker,
          `/v2/account/activities/FILL?page_size=100&direction=asc${from > 0 ? `&after=${encodeURIComponent(new Date(from).toISOString())}` : ""}`,
        ),
      ]);
      if (account.status === 401 || clock.status === 401) return { ok: false, error: alpacaError(401, account.body) };
      if (account.status >= 400) return { ok: false, error: alpacaError(account.status, account.body) };
      const acct = account.body as Record<string, unknown>;
      const clk = clock.status < 400 && clock.body && typeof clock.body === "object" ? (clock.body as Record<string, unknown>) : {};
      let positionQty = 0;
      let avgEntry: number | null = null;
      if (symbol) {
        const position = await alpacaFetch(broker, `/v2/positions/${encodeURIComponent(symbol)}`);
        if (position.status === 401) return { ok: false, error: alpacaError(401, position.body) };
        if (position.status < 400 && position.body && typeof position.body === "object") {
          const row = position.body as Record<string, unknown>;
          positionQty = asNumber(row.qty);
          const entry = asNumber(row.avg_entry_price);
          avgEntry = entry > 0 ? entry : null;
        }
      }
      const list = Array.isArray(orders.body) ? orders.body.map(viewOrder).filter((row): row is AlpacaOrderView => row != null) : [];
      return {
        ok: true,
        paper: broker.paper,
        marketOpen: clk.is_open === true,
        nextOpen: typeof clk.next_open === "string" ? clk.next_open : "",
        nextClose: typeof clk.next_close === "string" ? clk.next_close : "",
        status: typeof acct.status === "string" ? acct.status : "",
        cash: asNumber(acct.cash),
        equity: asNumber(acct.equity),
        positionQty,
        avgEntry,
        buyingPower: asNumber(acct.buying_power),
        history: history.status < 400 ? readHistory(history.body) : [],
        fills: fills.status < 400 ? readFills(fills.body, symbol) : [],
        orders: list,
      };
    } catch {
      return { ok: false, error: "The desk could not reach Alpaca." };
    }
  });

export const alpacaSend = createServerFn({ method: "POST" })
  .validator((input: unknown) => input)
  .handler(async ({ data }): Promise<{ ok: false; error: string } | { ok: true; order: AlpacaOrderView }> => {
    const session = signedIn();
    if ("error" in session) return { ok: false, error: session.error };
    const raw = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const side: AlpacaSide | null = raw.side === "buy" || raw.side === "sell" ? raw.side : null;
    if (!side) return { ok: false, error: "The book has no buy or sell to send." };
    const symbol = cleanSymbol(raw.symbol);
    const broker = session.broker;
    const liveArmed = !broker.paper && readLiveArm(raw.liveArm) != null;
    try {
      const look = await alpacaFetch(broker, `/v2/orders?status=open&limit=50&symbols=${encodeURIComponent(symbol)}`);
      if (look.status === 401) return { ok: false, error: alpacaError(401, look.body) };
      const open = Array.isArray(look.body) ? look.body.map(viewOrder).filter((row): row is AlpacaOrderView => row != null) : [];
      const account = await alpacaFetch(broker, "/v2/account");
      if (account.status >= 400) return { ok: false, error: alpacaError(account.status, account.body) };
      const position = await alpacaFetch(broker, `/v2/positions/${encodeURIComponent(symbol)}`);
      if (position.status === 401) return { ok: false, error: alpacaError(401, position.body) };
      const positionQty = position.status < 400 && position.body && typeof position.body === "object" ? asNumber((position.body as { qty?: unknown }).qty) : 0;
      const cash = asNumber((account.body as { cash?: unknown }).cash);
      const plan = planOrder({
        paper: broker.paper,
        liveArmed,
        symbol,
        side,
        dollars: asNumber(raw.dollars),
        price: asNumber(raw.price),
        cash,
        positionQty,
        sample: raw.sample === true,
        barTime: asNumber(raw.barTime),
        working: open.some((row) => row.symbol === symbol && isWorking(row.status)),
      });
      if (!plan.ok) return plan;
      const sent = await alpacaFetch(broker, "/v2/orders", "POST", plan.body);
      if (sent.status >= 400) return { ok: false, error: alpacaError(sent.status, sent.body) };
      const order = viewOrder(sent.body);
      if (!order) return { ok: false, error: "Alpaca accepted the order but the desk could not read it." };
      return { ok: true, order };
    } catch {
      return { ok: false, error: "The desk could not reach Alpaca." };
    }
  });
