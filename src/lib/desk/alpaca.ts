/** Alpaca order planning and account reads. No network, no keys. */

export const LIVE_KIND = "strategy-desk-live";
export const ALPACA_PAPER = "https://paper-api.alpaca.markets";
export const ALPACA_LIVE = "https://api.alpaca.markets";

export type LiveArm = {
  kind: typeof LIVE_KIND;
  tester: string;
  issued: string;
};

export type AlpacaSide = "buy" | "sell";

export function alpacaHost(paper: boolean): string {
  return paper ? ALPACA_PAPER : ALPACA_LIVE;
}

export function issueLiveArm(tester: string, issued?: string): LiveArm {
  return {
    kind: LIVE_KIND,
    tester: tester.trim().slice(0, 40),
    issued: issued ?? new Date().toISOString().slice(0, 10),
  };
}

export function readLiveArm(value: unknown): LiveArm | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== LIVE_KIND) return null;
  if (typeof raw.tester !== "string" || !raw.tester.trim()) return null;
  return {
    kind: LIVE_KIND,
    tester: raw.tester.trim().slice(0, 40),
    issued: typeof raw.issued === "string" ? raw.issued.slice(0, 40) : "",
  };
}

export function liveFileName(tester: string): string {
  const slug = tester.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tester";
  return `live-${slug}.json`;
}

export function clientOrderId(symbol: string, side: AlpacaSide, barTime: number): string {
  const seconds = Math.floor(Math.max(0, barTime) / 1000);
  const id = `d-${symbol}-${side}-${seconds}`;
  return id.slice(0, 48);
}

export function cleanSymbol(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-]/g, "")
    .slice(0, 12);
}

export type OrderPlan =
  | {
      ok: true;
      qty: number;
      body: {
        symbol: string;
        qty: string;
        side: AlpacaSide;
        type: "market" | "limit";
        time_in_force: "day";
        client_order_id: string;
        limit_price?: string;
      };
    }
  | { ok: false; error: string };

export function planOrder(input: {
  paper: boolean;
  liveArmed: boolean;
  symbol: string;
  side: AlpacaSide;
  dollars: number;
  price: number;
  cash: number;
  positionQty: number;
  sample: boolean;
  barTime: number;
  working: boolean;
  marketOpen?: boolean;
  allowClosed?: boolean;
  slippageCents?: number;
}): OrderPlan {
  if (input.sample) return { ok: false, error: "This tape is a sample. Load a market tape before sending an order." };
  if (input.marketOpen === false && !input.allowClosed) return { ok: false, error: "The market is closed. No order was sent." };
  if (!input.paper && !input.liveArmed) {
    return { ok: false, error: "Live orders need the live key. Paper orders do not." };
  }
  const symbol = cleanSymbol(input.symbol);
  if (!symbol) return { ok: false, error: "Enter a symbol." };
  if (input.working) return { ok: false, error: "An order for this symbol is already working at Alpaca." };
  if (input.positionQty < 0) return { ok: false, error: "Alpaca is short this symbol. This desk will not trade a short." };
  if (!(input.price > 0)) return { ok: false, error: "The last bar has no price." };

  if (input.side === "sell") {
    const qty = Math.floor(input.positionQty);
    if (qty < 1) return { ok: false, error: "Alpaca is flat, so there is nothing to sell." };
    return { ok: true, qty, body: orderBody(symbol, "sell", qty, input.barTime, input.price, input.slippageCents) };
  }

  if (input.positionQty > 0) return { ok: false, error: "Alpaca is already long this symbol. The desk holds one position." };
  const budget = Math.min(Math.max(0, input.dollars), Math.max(0, input.cash));
  const qty = Math.floor(budget / input.price);
  if (qty < 1) return { ok: false, error: "Alpaca cash cannot buy one share at the last close." };
  return { ok: true, qty, body: orderBody(symbol, "buy", qty, input.barTime, input.price, input.slippageCents) };
}

function orderBody(symbol: string, side: AlpacaSide, qty: number, barTime: number, price: number, slippageCents?: number) {
  const limit = typeof slippageCents === "number";
  return {
    symbol,
    qty: String(qty),
    side,
    type: limit ? ("limit" as const) : ("market" as const),
    time_in_force: "day" as const,
    client_order_id: clientOrderId(symbol, side, barTime),
    ...(limit ? { limit_price: limitPrice(side, price, slippageCents).toFixed(2) } : {}),
  };
}

const WORKING = new Set(["new", "accepted", "pending_new", "accepted_for_bidding", "partially_filled", "pending_replace", "stopped", "calculated"]);

export function isWorking(status: string): boolean {
  return WORKING.has(status);
}

export function asNumber(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

export type AccountFill = {
  id: string;
  time: number;
  side: AlpacaSide;
  qty: number;
  price: number;
  symbol: string;
};

export type EquityPoint = { time: number; equity: number };

const DAY = 86_400_000;

export function historyPath(startMs: number, endMs: number): string {
  const span = Math.max(0, endMs - startMs);
  const timeframe = span <= 7 * DAY ? "5Min" : span <= 30 * DAY ? "15Min" : "1D";
  const start = new Date(startMs).toISOString();
  const end = new Date(Math.max(startMs, endMs)).toISOString();
  return `/v2/account/portfolio/history?timeframe=${timeframe}&date_start=${encodeURIComponent(start)}&date_end=${encodeURIComponent(end)}&intraday_reporting=market_hours`;
}

export function readHistory(body: unknown): EquityPoint[] {
  if (!body || typeof body !== "object") return [];
  const raw = body as { timestamp?: unknown; equity?: unknown };
  if (!Array.isArray(raw.timestamp) || !Array.isArray(raw.equity)) return [];
  const out: EquityPoint[] = [];
  for (let i = 0; i < raw.timestamp.length; i++) {
    const time = asNumber(raw.timestamp[i]) * 1000;
    const equity = asNumber(raw.equity[i]);
    if (time > 0 && equity > 0) out.push({ time, equity });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

export function readFills(body: unknown, symbol: string): AccountFill[] {
  if (!Array.isArray(body)) return [];
  const want = symbol.toUpperCase();
  const out: AccountFill[] = [];
  for (const row of body) {
    if (!row || typeof row !== "object") continue;
    const raw = row as Record<string, unknown>;
    const sym = String(raw.symbol ?? "").toUpperCase();
    if (want && sym !== want) continue;
    const side = raw.side === "buy" || raw.side === "sell" ? raw.side : null;
    if (!side) continue;
    const time = Date.parse(String(raw.transaction_time ?? ""));
    const price = asNumber(raw.price);
    const qty = asNumber(raw.qty);
    if (!Number.isFinite(time) || !(price > 0) || !(qty > 0)) continue;
    out.push({ id: String(raw.id ?? `${time}-${side}-${qty}`), time, side, qty, price, symbol: sym });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

export function equityOnBars(times: readonly number[], points: readonly EquityPoint[]): number[] {
  if (points.length === 0) return times.map(() => 0);
  const sorted = [...points].sort((a, b) => a.time - b.time);
  let cursor = 0;
  let last = sorted[0].equity;
  return times.map((time) => {
    while (cursor < sorted.length && sorted[cursor].time <= time) {
      last = sorted[cursor].equity;
      cursor += 1;
    }
    return last;
  });
}

export function seriesReturnPct(series: readonly number[]): number {
  const values = series.filter((value) => value > 0);
  if (values.length < 2) return 0;
  return ((values[values.length - 1] - values[0]) / values[0]) * 100;
}

export function drawdownPct(series: readonly number[]): number {
  let peak = 0;
  let worst = 0;
  for (const value of series) {
    if (!(value > 0)) continue;
    peak = Math.max(peak, value);
    if (peak > 0) worst = Math.max(worst, ((peak - value) / peak) * 100);
  }
  return worst;
}

export function roundTrips(fills: readonly { side: AlpacaSide }[]): number {
  let buys = 0;
  let sells = 0;
  for (const fill of fills) {
    if (fill.side === "buy") buys += 1;
    else sells += 1;
  }
  return Math.min(buys, sells);
}

export function nextAccountSignal(
  positionQty: number,
  signalBuy: boolean,
  signalSell: boolean,
  sellHold: boolean,
): "buy" | "sell" | "none" {
  if (positionQty < 0) return "none";
  if (positionQty > 0) return signalSell && !sellHold ? "sell" : "none";
  return signalBuy ? "buy" : "none";
}

export function missedSignals(
  rows: readonly { signalBuy: boolean; signalSell: boolean; sellHold: boolean }[],
  fills: readonly { index: number; side: AlpacaSide }[],
  positionQty: number,
): { index: number; side: AlpacaSide }[] {
  const bought = new Set<number>();
  const sold = new Set<number>();
  for (const fill of fills) {
    if (fill.side === "buy") bought.add(fill.index);
    else sold.add(fill.index);
  }
  let long = positionQty > 0;
  const missed: { index: number; side: AlpacaSide }[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const didBuy = bought.has(i);
    const didSell = sold.has(i);
    if (didBuy && !didSell) long = false;
    else if (didSell && !didBuy) long = true;
    const row = rows[i];
    if (!long && row?.signalBuy && !didBuy) missed.push({ index: i, side: "buy" });
    if (long && row?.signalSell && !row.sellHold && !didSell) missed.push({ index: i, side: "sell" });
  }
  missed.reverse();
  return missed;
}

export function limitPrice(side: AlpacaSide, price: number, slippageCents: number): number {
  const slip = Math.max(0, slippageCents) / 100;
  const raw = side === "buy" ? price + slip : price - slip;
  return Math.max(0.01, Math.round(raw * 100) / 100);
}

export function dailyStopHit(equity: number, dayStart: number, lossPct: number): boolean {
  if (!(equity > 0) || !(dayStart > 0) || !(lossPct > 0)) return false;
  return ((dayStart - equity) / dayStart) * 100 >= lossPct - 1e-9;
}

export function closedBarIndex(times: readonly number[], durationMs: number, now: number): number {
  let index = -1;
  for (let i = 0; i < times.length; i++) {
    if (times[i] + durationMs <= now) index = i;
  }
  return index;
}

export function openingPosition(
  fills: readonly { side: AlpacaSide; qty: number }[],
  positionQty: number,
  avgEntry: number,
): { qty: number; price: number } {
  let qty = 0;
  for (const fill of fills) {
    if (fill.side === "buy") qty += fill.qty;
    else qty = Math.max(0, qty - fill.qty);
  }
  if (positionQty > 0 && qty < 1 && avgEntry > 0) return { qty: positionQty, price: avgEntry };
  return { qty: 0, price: 0 };
}

export function barIndexAt(times: readonly number[], time: number): number {
  let index = -1;
  for (let i = 0; i < times.length; i++) {
    if (times[i] <= time) index = i;
    else break;
  }
  return index;
}
