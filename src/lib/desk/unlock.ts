import { type DeskParams, type StrategyId, STRATEGY_ORDER } from "./model";

export const UNLOCK_KIND = "strategy-desk-unlock";

/** A strategy the master can leave open for one tester. Matrix is included so a file can allow or lock the combination table. */
export type AllowId = StrategyId | "matrix";

export type UnlockFile = {
  kind: typeof UNLOCK_KIND;
  tester: string;
  /** Calendar date the master wrote the file, YYYY-MM-DD. */
  issued: string;
  /** Strategies this tester may change. Every other setting stays on the master's book. */
  allow: AllowId[];
  params: DeskParams;
};

const ALLOW_IDS: readonly AllowId[] = [...STRATEGY_ORDER, "matrix"];

export function isAllowId(value: string): value is AllowId {
  return (ALLOW_IDS as readonly string[]).includes(value);
}

export function issueUnlock(tester: string, allow: readonly AllowId[], params: DeskParams, issued?: string): UnlockFile {
  const seen = new Set<AllowId>();
  const list: AllowId[] = [];
  for (const id of allow) {
    if (!isAllowId(id) || seen.has(id)) continue;
    seen.add(id);
    list.push(id);
  }
  return {
    kind: UNLOCK_KIND,
    tester: tester.trim().slice(0, 40),
    issued: issued ?? new Date().toISOString().slice(0, 10),
    allow: list,
    params,
  };
}

/** Shape check only. The caller normalizes `params`. */
export function readUnlock(value: unknown): { tester: string; issued: string; allow: AllowId[]; params: unknown } | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== UNLOCK_KIND) return null;
  if (typeof raw.tester !== "string" || !raw.tester.trim()) return null;
  if (!Array.isArray(raw.allow)) return null;
  const allow: AllowId[] = [];
  for (const id of raw.allow) {
    if (typeof id === "string" && isAllowId(id) && !allow.includes(id)) allow.push(id);
  }
  return {
    tester: raw.tester.trim().slice(0, 40),
    issued: typeof raw.issued === "string" ? raw.issued.slice(0, 40) : "",
    allow,
    params: raw.params,
  };
}

/** Every strategy off. Shared indicator settings are left in place so a chart can still draw. */
export function strategiesOff(params: DeskParams): DeskParams {
  const next = structuredClone(params);
  const side = (node: { buyOn: boolean; sellOn: boolean }) => {
    node.buyOn = false;
    node.sellOn = false;
  };
  side(next.lower);
  side(next.upper);
  side(next.slope);
  side(next.volume);
  side(next.rsi);
  side(next.mfi);
  side(next.rti.direction);
  side(next.rti.strength);
  side(next.rti.line);
  side(next.rti.negative);
  side(next.rti.reversal);
  side(next.rti.below);
  side(next.rti.above);
  side(next.vwap);
  side(next.vwapPx);
  side(next.ema20);
  side(next.ema50);
  side(next.ema100);
  side(next.emaA);
  side(next.emaB);
  side(next.emaC);
  side(next.trend.slope);
  side(next.trend.line);
  side(next.step);
  next.step.flatOn = false;
  next.step.stopOn = false;
  next.drop.sellOn = false;
  next.matrix.buy.on = false;
  next.matrix.sell.on = false;
  return next;
}

/**
 * Master's book, with only the allowed strategies taken from the tester's edits.
 * Indicator setup that is not itself a strategy (band length, relative-trend length, trend hours) stays sealed.
 */
export function applyUnlock(edited: DeskParams, file: UnlockFile): DeskParams {
  const next = structuredClone(file.params);
  const allow = new Set(file.allow);
  const take = (id: AllowId, copy: () => void) => {
    if (allow.has(id)) copy();
  };
  take("lower", () => {
    next.lower = structuredClone(edited.lower);
  });
  take("upper", () => {
    next.upper = structuredClone(edited.upper);
  });
  take("slope", () => {
    next.slope = structuredClone(edited.slope);
  });
  take("volume", () => {
    next.volume = structuredClone(edited.volume);
  });
  take("rsi", () => {
    next.rsi = structuredClone(edited.rsi);
  });
  take("mfi", () => {
    next.mfi = structuredClone(edited.mfi);
  });
  take("rtiDir", () => {
    next.rti.direction = structuredClone(edited.rti.direction);
  });
  take("rtiStr", () => {
    next.rti.strength = structuredClone(edited.rti.strength);
  });
  take("rtiLine", () => {
    next.rti.line = structuredClone(edited.rti.line);
  });
  take("rtiNeg", () => {
    next.rti.negative = structuredClone(edited.rti.negative);
  });
  take("rtiRev", () => {
    next.rti.reversal = structuredClone(edited.rti.reversal);
  });
  take("rtiBelow", () => {
    next.rti.below = structuredClone(edited.rti.below);
  });
  take("rtiAbove", () => {
    next.rti.above = structuredClone(edited.rti.above);
  });
  take("vwap", () => {
    next.vwap = structuredClone(edited.vwap);
  });
  take("vwapPx", () => {
    next.vwapPx = structuredClone(edited.vwapPx);
  });
  take("ema20", () => {
    next.ema20 = structuredClone(edited.ema20);
  });
  take("ema50", () => {
    next.ema50 = structuredClone(edited.ema50);
  });
  take("ema100", () => {
    next.ema100 = structuredClone(edited.ema100);
  });
  take("emaA", () => {
    next.emaA = structuredClone(edited.emaA);
  });
  take("emaB", () => {
    next.emaB = structuredClone(edited.emaB);
  });
  take("emaC", () => {
    next.emaC = structuredClone(edited.emaC);
  });
  take("trendSlope", () => {
    next.trend.slope = structuredClone(edited.trend.slope);
  });
  take("trendLine", () => {
    next.trend.line = structuredClone(edited.trend.line);
  });
  take("step", () => {
    next.step = structuredClone(edited.step);
  });
  take("drop", () => {
    next.drop = structuredClone(edited.drop);
  });
  take("matrix", () => {
    next.matrix = structuredClone(edited.matrix);
  });
  return next;
}
