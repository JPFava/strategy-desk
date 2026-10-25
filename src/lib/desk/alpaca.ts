/** Alpaca order planning. No network, no keys. */

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
        type: "market";
        time_in_force: "day";
        client_order_id: string;
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
}): OrderPlan {
  if (input.sample) return { ok: false, error: "This tape is a sample. Load a market tape before sending an order." };
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
    return { ok: true, qty, body: orderBody(symbol, "sell", qty, input.barTime) };
  }

  if (input.positionQty > 0) return { ok: false, error: "Alpaca is already long this symbol. The desk holds one position." };
  const budget = Math.min(Math.max(0, input.dollars), Math.max(0, input.cash));
  const qty = Math.floor(budget / input.price);
  if (qty < 1) return { ok: false, error: "Alpaca cash cannot buy one share at the last close." };
  return { ok: true, qty, body: orderBody(symbol, "buy", qty, input.barTime) };
}

function orderBody(symbol: string, side: AlpacaSide, qty: number, barTime: number) {
  return {
    symbol,
    qty: String(qty),
    side,
    type: "market" as const,
    time_in_force: "day" as const,
    client_order_id: clientOrderId(symbol, side, barTime),
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
