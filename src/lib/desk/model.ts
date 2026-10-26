export type Bar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type Interval = "1m" | "5m" | "15m" | "1h" | "1d";

export const INTERVALS: { id: Interval; label: string }[] = [
  { id: "1m", label: "1 minute" },
  { id: "5m", label: "5 minute" },
  { id: "15m", label: "15 minute" },
  { id: "1h", label: "1 hour" },
  { id: "1d", label: "1 day" },
];

export type DelayId = "instant" | "15m" | "1h" | "1d" | "2d";

export const DELAYS: { id: DelayId; label: string; ms: number }[] = [
  { id: "instant", label: "Instant", ms: 0 },
  { id: "15m", label: "15 minutes", ms: 15 * 60 * 1000 },
  { id: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { id: "1d", label: "1 day", ms: 24 * 60 * 60 * 1000 },
  { id: "2d", label: "2 days", ms: 2 * 24 * 60 * 60 * 1000 },
];

export type StrategyId =
  | "lower"
  | "upper"
  | "slope"
  | "volume"
  | "rsi"
  | "mfi"
  | "rtiDir"
  | "rtiStr"
  | "rtiLine"
  | "rtiNeg"
  | "rtiRev"
  | "rtiBelow"
  | "rtiAbove"
  | "vwap"
  | "vwapPx"
  | "ema20"
  | "ema50"
  | "ema100"
  | "emaA"
  | "emaB"
  | "emaC"
  | "trendSlope"
  | "trendLine"
  | "step"
  | "drop";

export const EMA_RELS = ["emaA", "emaB", "emaC"] as const;

export type EmaRelId = (typeof EMA_RELS)[number];

export type EmaMember = "close" | "fast" | "mid" | "slow";

export type EmaOp = "rank" | "touch" | "gap";

export type EmaUnit = "pct" | "usd";

export type EmaClause = {
  op: EmaOp;
  members: EmaMember[];
  sellMirror: boolean;
  tol: number;
  tolUnit: EmaUnit;
  gapMode: "wide" | "tight";
  gap: number;
  gapUnit: EmaUnit;
};

export type EmaSlot = SideRule & {
  clause: EmaClause;
};

export const STRATEGY_ORDER: StrategyId[] = [
  "lower",
  "upper",
  "slope",
  "volume",
  "rsi",
  "mfi",
  "rtiDir",
  "rtiStr",
  "rtiLine",
  "rtiNeg",
  "rtiRev",
  "rtiBelow",
  "rtiAbove",
  "vwap",
  "vwapPx",
  "ema20",
  "ema50",
  "ema100",
  "emaA",
  "emaB",
  "emaC",
  "trendSlope",
  "trendLine",
  "step",
  "drop",
];

const STRATEGY_LABEL: Record<StrategyId, string> = {
  lower: "Lower band",
  upper: "Upper band",
  slope: "Band slope",
  volume: "Volume",
  rsi: "RSI",
  mfi: "Money flow",
  rtiDir: "RTI direction",
  rtiStr: "RTI strength",
  rtiLine: "RTI line",
  rtiNeg: "RTI negative",
  rtiRev: "RTI reversal",
  rtiBelow: "RTI below",
  rtiAbove: "RTI above",
  vwap: "VWAP in the candle",
  vwapPx: "Close versus VWAP",
  ema20: "20-hour EMA",
  ema50: "50-hour EMA",
  ema100: "100-hour EMA",
  emaA: "EMA relation A",
  emaB: "EMA relation B",
  emaC: "EMA relation C",
  trendSlope: "Trend slope",
  trendLine: "Trend line",
  step: "Last fill",
  drop: "Drop hold",
};

export function strategyName(id: StrategyId, params?: DeskParams, side?: "buy" | "sell"): string {
  if (id === "emaA" || id === "emaB" || id === "emaC") {
    if (!params) return STRATEGY_LABEL[id];
    const clause = params[id].clause;
    if (!side && clause.op === "rank" && clause.sellMirror) {
      return `${relationPhrase(clause, params, "buy")} · sell reverses`;
    }
    return relationPhrase(clause, params, side ?? "buy");
  }
  if (!params) return STRATEGY_LABEL[id];
  if (id === "ema20") return `${Math.round(params.ema20.hours)}-hour EMA`;
  if (id === "ema50") return `${Math.round(params.ema50.hours)}-hour EMA`;
  if (id === "ema100") return `${Math.round(params.ema100.hours)}-hour EMA`;
  if (id === "trendSlope" || id === "trendLine") {
    const hours = params.trend.hours;
    const label = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
    return id === "trendSlope" ? `${label}-hour trend slope` : `${label}-hour trend line`;
  }
  return STRATEGY_LABEL[id];
}

export function strategyShort(id: StrategyId, params?: DeskParams): string {
  if (id === "emaA" || id === "emaB" || id === "emaC") {
    const letter = id === "emaA" ? "A" : id === "emaB" ? "B" : "C";
    const op = params?.[id].clause.op ?? "rank";
    const word = op === "rank" ? "Rank" : op === "touch" ? "Touch" : "Gap";
    return `${word} ${letter}`;
  }
  if (id === "lower") return "Lower";
  if (id === "upper") return "Upper";
  if (id === "slope") return "Slope";
  if (id === "volume") return "Volume";
  if (id === "rsi") return "RSI";
  if (id === "mfi") return "MFI";
  if (id === "rtiDir") return "RTI dir";
  if (id === "rtiStr") return "RTI str";
  if (id === "rtiLine") return "RTI line";
  if (id === "rtiNeg") return "RTI < 0";
  if (id === "rtiRev") return "RTI turn";
  if (id === "rtiBelow") return "RTI low";
  if (id === "rtiAbove") return "RTI high";
  if (id === "vwap") return "VWAP";
  if (id === "vwapPx") return "vs VWAP";
  if (id === "ema20") return params ? `${Math.round(params.ema20.hours)}h` : "Fast";
  if (id === "ema50") return params ? `${Math.round(params.ema50.hours)}h` : "Mid";
  if (id === "ema100") return params ? `${Math.round(params.ema100.hours)}h` : "Slow";
  if (id === "trendSlope") return "T-slope";
  if (id === "trendLine") return "T-line";
  if (id === "step") return "Last fill";
  return "Not Held";
}

export function defaultClause(op: EmaOp, members: EmaMember[]): EmaClause {
  return {
    op,
    members,
    sellMirror: true,
    tol: 0.25,
    tolUnit: "pct",
    gapMode: "wide",
    gap: 1,
    gapUnit: "pct",
  };
}

export function laneLabel(member: EmaMember, params?: DeskParams): string {
  if (member === "close") return "Close";
  if (!params) return member === "fast" ? "Fast" : member === "mid" ? "Mid" : "Slow";
  const hours = member === "fast" ? params.ema20.hours : member === "mid" ? params.ema50.hours : params.ema100.hours;
  return `${Math.round(hours)}h`;
}

function amountLabel(n: number, unit: EmaUnit): string {
  const rounded = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  return unit === "usd" ? `$${rounded}` : `${rounded}%`;
}

export function dedupeMembers(members: EmaMember[]): EmaMember[] {
  const out: EmaMember[] = [];
  for (const member of members) {
    if ((member === "close" || member === "fast" || member === "mid" || member === "slow") && !out.includes(member)) out.push(member);
  }
  return out;
}

export function relationPhrase(clause: EmaClause, params?: DeskParams, side: "buy" | "sell" = "buy"): string {
  const raw = dedupeMembers(clause.members);
  const ordered = clause.op === "rank" && side === "sell" && clause.sellMirror ? [...raw].reverse() : raw;
  const names = ordered.map((member) => laneLabel(member, params));
  const emaNames = raw.filter((member) => member !== "close").map((member) => laneLabel(member, params));
  if (clause.op === "rank") {
    if (names.length < 2) return "Rank needs two lines";
    return names.join(" above ");
  }
  if (clause.op === "touch") {
    const tol = amountLabel(clause.tol, clause.tolUnit);
    if (emaNames.length === 0) return "Touch needs an average";
    if (emaNames.length === 1 && !raw.includes("close")) return `Close within ${tol} of ${emaNames[0]}`;
    return `${names.join(", ")} within ${tol}`;
  }
  const gap = amountLabel(clause.gap, clause.gapUnit);
  const word = clause.gapMode === "wide" ? "at least" : "at most";
  if (emaNames.length === 0) return "Gap needs an average";
  if (emaNames.length === 1 && !raw.includes("close")) return `Close versus ${emaNames[0]} ${word} ${gap}`;
  return `${names.join("–")} spread ${word} ${gap}`;
}

export function clauseProblem(clause: EmaClause): string | null {
  const members = dedupeMembers(clause.members);
  const emas = members.filter((member) => member !== "close");
  if (clause.op === "rank" && members.length < 2) return "Rank needs two lines, top to bottom. Until then this slot fails and blocks that side.";
  if (clause.op !== "rank" && emas.length < 1) return "Touch and gap need at least one average. Until then this slot fails and blocks that side.";
  return null;
}

export type Join = "and" | "or";

export function asJoin(value: unknown): Join {
  return value === "or" ? "or" : "and";
}

export type SideRule = {
  buyOn: boolean;
  sellOn: boolean;
  buyJoin?: Join;
  sellJoin?: Join;
};

export type BandSetup = {
  length: number;
  mult: number;
};

export type LevelRule = SideRule & {
  buyPct: number;
  sellPct: number;
};

export type SlopeRule = SideRule & {
  buyFloor: number;
  sellFloor: number;
  bars: number;
};

export type VolumeRule = SideRule & {
  buyMult: number;
  sellMult: number;
  length: number;
};

export type OscRule = SideRule & {
  length: number;
  buyLevel: number;
  sellLevel: number;
};

export type RtiLevel = SideRule & {
  up: number;
  down: number;
};

export type RtiStrength = SideRule & {
  buyFloor: number;
  sellFloor: number;
};

export type RtiLine = SideRule & {
  length: number;
  /** Reading above the line buys. Reading under it sells. */
  versus: boolean;
  /** A rising line buys. A falling line sells. */
  trend: boolean;
  /** Reading at or above the buy level buys. At or under the sell level sells. */
  levelOn: boolean;
  buyLevel: number;
  sellLevel: number;
};

export type RtiReversal = SideRule & {
  bars: number;
};

export type RtiBelow = SideRule & {
  level: number;
};

export type RtiSetup = {
  length: number;
  mult: number;
  smooth: number;
  direction: RtiLevel;
  strength: RtiStrength;
  line: RtiLine;
  negative: SideRule;
  reversal: RtiReversal;
  below: RtiBelow;
  above: RtiBelow;
};

export type EmaRule = SideRule & {
  hours: number;
};

export type TrendRule = SideRule & {
  buyFloor: number;
  sellFloor: number;
};

export type TrendSetup = {
  hours: number;
  slope: TrendRule;
  line: SideRule;
};

export type StepParams = SideRule & {
  aboveBuy: number;
  belowSell: number;
  /** Sell when the close is under the last buy by this many dollars. Off unless stopOn. */
  stopOn?: boolean;
  stopBy?: number;
  /** Buy on any bar this book is flat. The dollar step under the last sell stays out. */
  flatOn?: boolean;
};

export type DropParams = {
  sellOn: boolean;
  dropPct: number;
  recoverPct: number;
};

export type MatrixGroup = {
  id: string;
  members: StrategyId[];
};

export type SideMatrix = {
  on: boolean;
  groups: MatrixGroup[];
};

export type DeskParams = {
  bands: BandSetup;
  lower: LevelRule;
  upper: LevelRule;
  slope: SlopeRule;
  volume: VolumeRule;
  rsi: OscRule;
  mfi: OscRule;
  rti: RtiSetup;
  vwap: SideRule;
  vwapPx: SideRule;
  ema20: EmaRule;
  ema50: EmaRule;
  ema100: EmaRule;
  emaA: EmaSlot;
  emaB: EmaSlot;
  emaC: EmaSlot;
  trend: TrendSetup;
  step: StepParams;
  drop: DropParams;
  matrix: { buy: SideMatrix; sell: SideMatrix };
};

export type AccountSettings = {
  startingCash: number;
  flatFee: number;
  percentFee: number;
  dollarsPerBuy: number;
  delay: DelayId;
  useConfirmedSaleProceeds: boolean;
  /** Inclusive session date, YYYY-MM-DD in America/New_York. Empty runs from the first bar. */
  fromDate: string;
  /** Inclusive session date. Empty runs through the last bar. */
  toDate: string;
};

export function defaultParams(): DeskParams {
  return normalizeJoins({
    bands: { length: 30, mult: 2 },
    lower: { buyOn: true, sellOn: false, buyPct: 102, sellPct: 102 },
    upper: { buyOn: false, sellOn: true, buyPct: 98, sellPct: 98 },
    slope: { buyOn: true, sellOn: false, buyFloor: -1, sellFloor: 1, bars: 5 },
    volume: { buyOn: true, sellOn: false, buyMult: 1.5, sellMult: 1.5, length: 20 },
    rsi: { buyOn: true, sellOn: true, length: 7, buyLevel: 30, sellLevel: 60 },
    mfi: { buyOn: true, sellOn: false, length: 7, buyLevel: 50, sellLevel: 80 },
    rti: {
      length: 30,
      mult: 2,
      smooth: 3,
      direction: { buyOn: false, sellOn: false, up: 50, down: 50 },
      strength: { buyOn: false, sellOn: false, buyFloor: 10, sellFloor: 10 },
      line: { buyOn: false, sellOn: false, length: 10, versus: true, trend: false, levelOn: false, buyLevel: 50, sellLevel: 50 },
      negative: { buyOn: false, sellOn: false },
      reversal: { buyOn: false, sellOn: false, bars: 6 },
      below: { buyOn: false, sellOn: false, level: 1 },
      above: { buyOn: false, sellOn: false, level: 50 },
    },
    vwap: { buyOn: true, sellOn: false },
    vwapPx: { buyOn: false, sellOn: true },
    ema20: { buyOn: false, sellOn: false, hours: 20 },
    ema50: { buyOn: false, sellOn: false, hours: 50 },
    ema100: { buyOn: false, sellOn: false, hours: 100 },
    emaA: { buyOn: false, sellOn: false, clause: defaultClause("rank", ["fast", "mid", "slow"]) },
    emaB: { buyOn: false, sellOn: false, clause: defaultClause("touch", ["fast", "mid", "slow"]) },
    emaC: { buyOn: false, sellOn: false, clause: defaultClause("gap", ["fast", "slow"]) },
    trend: {
      hours: 4,
      slope: { buyOn: false, sellOn: false, buyFloor: 0, sellFloor: 0 },
      line: { buyOn: false, sellOn: false },
    },
    step: { buyOn: false, sellOn: false, aboveBuy: 1, belowSell: 1, stopOn: false, stopBy: 0, flatOn: false },
    drop: { sellOn: true, dropPct: 10, recoverPct: 50 },
    matrix: {
      buy: { on: false, groups: [] },
      sell: { on: false, groups: [] },
    },
  });
}

/** Longer money-flow dip, gated by the 4-hour line, with a wide target and a stop. */
export function robustParams(): DeskParams {
  const params = defaultParams();
  const off = <T extends SideRule>(node: T): T => ({ ...node, buyOn: false, sellOn: false });
  params.lower = off(params.lower);
  params.upper = off(params.upper);
  params.slope = off(params.slope);
  params.volume = off(params.volume);
  params.rsi = off(params.rsi);
  params.vwap = off(params.vwap);
  params.vwapPx = off(params.vwapPx);
  params.ema20 = off(params.ema20);
  params.ema50 = off(params.ema50);
  params.ema100 = off(params.ema100);
  params.emaA = off(params.emaA);
  params.emaB = off(params.emaB);
  params.emaC = off(params.emaC);
  params.mfi = { ...params.mfi, buyOn: true, sellOn: false, length: 21, buyLevel: 30, sellLevel: 75 };
  params.trend = {
    hours: 4,
    slope: { ...params.trend.slope, buyOn: false, sellOn: false, buyFloor: 0, sellFloor: 0 },
    line: { ...params.trend.line, buyOn: true, sellOn: false },
  };
  params.step = {
    ...params.step,
    buyOn: false,
    sellOn: true,
    aboveBuy: 2,
    belowSell: 1,
    stopOn: true,
    stopBy: 1.25,
    flatOn: false,
  };
  params.drop = { sellOn: false, dropPct: 10, recoverPct: 50 };
  return normalizeJoins(params);
}

export function normalizeJoins(params: DeskParams): DeskParams {
  const stamp = <T extends SideRule>(node: T): T => ({ ...node, buyJoin: asJoin(node.buyJoin), sellJoin: asJoin(node.sellJoin) });
  return {
    ...params,
    lower: stamp(params.lower),
    upper: stamp(params.upper),
    slope: stamp(params.slope),
    volume: stamp(params.volume),
    rsi: stamp(params.rsi),
    mfi: stamp(params.mfi),
    rti: {
      ...params.rti,
      direction: stamp(params.rti.direction),
      strength: stamp(params.rti.strength),
      line: stamp(params.rti.line),
      negative: stamp(params.rti.negative),
      reversal: stamp(params.rti.reversal),
      below: stamp(params.rti.below),
      above: stamp(params.rti.above),
    },
    vwap: stamp(params.vwap),
    vwapPx: stamp(params.vwapPx),
    ema20: stamp(params.ema20),
    ema50: stamp(params.ema50),
    ema100: stamp(params.ema100),
    emaA: stamp(params.emaA),
    emaB: stamp(params.emaB),
    emaC: stamp(params.emaC),
    trend: { ...params.trend, slope: stamp(params.trend.slope), line: stamp(params.trend.line) },
    step: stamp(params.step),
    matrix: {
      buy: cleanMatrix(params.matrix?.buy),
      sell: cleanMatrix(params.matrix?.sell),
    },
  };
}

export function cleanMatrix(matrix: SideMatrix | undefined): SideMatrix {
  const allowed = new Set<StrategyId>(STRATEGY_ORDER.filter((id) => id !== "drop"));
  const groups = Array.isArray(matrix?.groups) ? matrix.groups : [];
  return {
    on: Boolean(matrix?.on),
    groups: groups.slice(0, 8).map((group, index) => {
      const members: StrategyId[] = [];
      for (const id of group?.members ?? []) {
        if (allowed.has(id) && !members.includes(id)) members.push(id);
      }
      const id = typeof group?.id === "string" && /^[A-Za-z0-9_-]{1,16}$/.test(group.id) ? group.id : `g${index + 1}`;
      return { id, members };
    }),
  };
}

export function ruleSideOn(params: DeskParams, id: StrategyId, side: "buy" | "sell"): boolean {
  const on = (node: { buyOn: boolean; sellOn: boolean }) => (side === "buy" ? node.buyOn : node.sellOn);
  switch (id) {
    case "drop":
      return side === "sell" && params.drop.sellOn;
    case "lower":
      return on(params.lower);
    case "upper":
      return on(params.upper);
    case "slope":
      return on(params.slope);
    case "volume":
      return on(params.volume);
    case "rsi":
      return on(params.rsi);
    case "mfi":
      return on(params.mfi);
    case "rtiDir":
      return on(params.rti.direction);
    case "rtiStr":
      return on(params.rti.strength);
    case "rtiLine":
      return on(params.rti.line);
    case "rtiNeg":
      return on(params.rti.negative);
    case "rtiRev":
      return on(params.rti.reversal);
    case "rtiBelow":
      return side === "buy" && params.rti.below.buyOn;
    case "rtiAbove":
      return side === "sell" && params.rti.above.sellOn;
    case "vwap":
      return on(params.vwap);
    case "vwapPx":
      return on(params.vwapPx);
    case "ema20":
      return on(params.ema20);
    case "ema50":
      return on(params.ema50);
    case "ema100":
      return on(params.ema100);
    case "emaA":
      return on(params.emaA);
    case "emaB":
      return on(params.emaB);
    case "emaC":
      return on(params.emaC);
    case "trendSlope":
      return on(params.trend.slope);
    case "trendLine":
      return on(params.trend.line);
    case "step":
      return on(params.step);
    default:
      return false;
  }
}

export function defaultAccount(): AccountSettings {
  return {
    startingCash: 25_000,
    flatFee: 0,
    percentFee: 0,
    dollarsPerBuy: 0,
    delay: "1d",
    useConfirmedSaleProceeds: true,
    fromDate: "",
    toDate: "",
  };
}

export const deskColors = {
  ink: "#101416",
  surface: "#182023",
  paper: "#f3ecdf",
  bronze: "#e0b56a",
  buy: "#3cba7a",
  sell: "#e36d5c",
  line: "#2a363a",
  muted: "#a39888",
  slate: "#9bb8c9",
} as const;

export type WindowId = "1D" | "5D" | "1M" | "All";

export const WINDOWS: WindowId[] = ["1D", "5D", "1M", "All"];

const ET = "America/New_York";

const hourFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

export function sessionKey(t: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(t));
}

export function sessionDate(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export function hourKey(t: number): string {
  const parts = hourFormat.formatToParts(new Date(t));
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour").padStart(2, "0")}`;
}

export function formatWhen(t: number, interval: Interval): string {
  if (interval === "1d") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: ET,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(t));
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(t));
}

export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPx(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs > 0 && abs < 1 ? 4 : 2;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  });
}

export function formatSignedPx(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n > 0) return `+${formatPx(n)}`;
  return formatPx(n);
}

export function formatPct(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function formatQty(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function delayOf(id: DelayId): { id: DelayId; label: string; ms: number } {
  return DELAYS.find((d) => d.id === id) ?? DELAYS[0];
}

export function isIntraday(interval: Interval): boolean {
  return interval !== "1d";
}

export function barDuration(interval: Interval): number {
  if (interval === "1m") return 60_000;
  if (interval === "5m") return 5 * 60_000;
  if (interval === "15m") return 15 * 60_000;
  if (interval === "1h") return 60 * 60_000;
  return 24 * 60 * 60_000;
}

export function clampNum(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}
