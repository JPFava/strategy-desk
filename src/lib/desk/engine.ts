import {
  type AccountSettings,
  type Bar,
  type DeskParams,
  type EmaClause,
  type EmaMember,
  type Interval,
  type Join,
  type StrategyId,
  type WindowId,
  EMA_RELS,
  STRATEGY_ORDER,
  asJoin,
  barDuration,
  clampNum,
  cleanMatrix,
  dedupeMembers,
  defaultParams,
  delayOf,
  hourKey,
  laneLabel,
  sessionKey,
  sessionDate,
  strategyName,
  strategyShort,
  type SideMatrix,
} from "./model.ts";

export type Check = { label: string; detail: string; pass: boolean; wait?: boolean };

export type Indicators = {
  session: string[];
  sessionHigh: number[];
  priorClose: (number | null)[];
  bandMid: (number | null)[];
  bandUpper: (number | null)[];
  bandLower: (number | null)[];
  bandSlope: (number | null)[];
  volAvg: (number | null)[];
  rsi: (number | null)[];
  mfi: (number | null)[];
  rti: (number | null)[];
  rtiLine: (number | null)[];
  vwap: (number | null)[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  ema100: (number | null)[];
  trend: (number | null)[];
  trendSlope: (number | null)[];
};

export type Trace = {
  index: number;
  book: "flat" | "long";
  shares: number;
  sellHold: boolean;
  sessionHigh: number;
  priorClose: number;
  holdAnchor: number | null;
  holdTrough: number | null;
  holdRecover: number | null;
  dropFromPriorPct: number;
  action: "buy" | "sell" | "none";
  signalBuy: boolean;
  signalSell: boolean;
  fired: StrategyId[];
  skipped: { id: StrategyId; side: "buy" | "sell"; reason: string }[];
  holdCancelled: boolean;
  holdLatched: boolean;
  holdDisarmed: boolean;
  lastBuy: number | null;
  lastSell: number | null;
  cashAfter: number;
  unsettledAfter: number;
  buyingPowerAfter: number;
  equityAfter: number;
  sharesAfter: number;
};

export type Fill = {
  index: number;
  time: number;
  side: "buy" | "sell";
  strategies: StrategyId[];
  shares: number;
  price: number;
  close: number;
  fee: number;
  equityAfter: number;
};

export type Stats = {
  strategyReturnPct: number;
  buyHoldReturnPct: number;
  differencePct: number;
  roundTrips: number;
  skipped: number;
  maxDrawdownPct: number;
  endingEquity: number;
  buyHoldEquity: number;
  skippedByReason: Record<string, number>;
};

export type SimResult = {
  indicators: Indicators;
  trace: Trace[];
  fills: Fill[];
  stats: Stats;
  holdOn: boolean[];
  recover: (number | null)[];
  buyAt: (number | null)[];
  sellAt: (number | null)[];
  holdEquity: number[];
  logic: LogicDiagram;
  rangeStart: number;
  rangeEnd: number;
};

export type StrategyRead = {
  id: StrategyId;
  name: string;
  wantBuy: boolean;
  wantSell: boolean;
  buyOn: boolean;
  sellOn: boolean;
  buyJoin?: Join;
  sellJoin?: Join;
  buyVoting?: boolean;
  sellVoting?: boolean;
  buy: Check[];
  sell: Check[];
};

export type Explain = {
  index: number;
  book: "flat" | "long";
  shares: number;
  sellHold: boolean;
  holdCancelled: boolean;
  sessionHigh: number;
  priorClose: number;
  holdRecover: number | null;
  dropFromPriorPct: number;
  action: Trace["action"];
  fired: StrategyId[];
  skipped: Trace["skipped"];
  strategies: StrategyRead[];
  buyReady: boolean;
  sellReady: boolean;
  buyMissing: StrategyId[];
  sellMissing: StrategyId[];
};

export const SKIP = {
  long: "book was already long",
  flat: "book was flat",
  hold: "sell hold is on",
  cash: "settled cash cannot buy a share",
} as const;

type SideWant = {
  buy: StrategyId[];
  sell: StrategyId[];
  buyVoters?: number;
  sellVoters?: number;
  buyTerms?: SideTerm[];
  sellTerms?: SideTerm[];
};

type SideTerm = { id: StrategyId; pass: boolean; join: Join; voting?: boolean };

export type LogicLevel = 0 | 1 | 2;

export type LogicLane = {
  id: string;
  name: string;
  join: Join;
  levels: LogicLevel[];
  kind?: "rule" | "group" | "hold";
};

export type LogicDiagram = {
  buy: LogicLane[];
  sell: LogicLane[];
  buyTick: boolean[];
  sellTick: boolean[];
};

type VoteBit = {
  id: StrategyId;
  buyOn: boolean;
  sellOn: boolean;
  buyPass: boolean;
  sellPass: boolean;
  buyJoin: Join;
  sellJoin: Join;
};

type Tuned = {
  params: DeskParams;
  account: AccountSettings;
};

function tuneSlot(slot: DeskParams["emaA"]): DeskParams["emaA"] {
  const clause = slot?.clause;
  const op = clause?.op === "touch" || clause?.op === "gap" || clause?.op === "rank" ? clause.op : "rank";
  const unit = (value: string | undefined, fallback: "pct" | "usd"): "pct" | "usd" => (value === "usd" || value === "pct" ? value : fallback);
  const tolUnit = unit(clause?.tolUnit, "pct");
  const gapUnit = unit(clause?.gapUnit, "pct");
  return {
    buyOn: Boolean(slot?.buyOn),
    sellOn: Boolean(slot?.sellOn),
    buyJoin: asJoin(slot?.buyJoin),
    sellJoin: asJoin(slot?.sellJoin),
    clause: {
      op,
      members: dedupeMembers(clause?.members ?? []),
      sellMirror: clause?.sellMirror !== false,
      tol: tolUnit === "usd" ? clampNum(clause?.tol ?? 0.25, 0, 1_000_000, 0.25) : clampNum(clause?.tol ?? 0.25, 0, 100, 0.25),
      tolUnit,
      gapMode: clause?.gapMode === "tight" ? "tight" : "wide",
      gap: gapUnit === "usd" ? clampNum(clause?.gap ?? 1, 0, 1_000_000, 1) : clampNum(clause?.gap ?? 1, 0, 100, 1),
      gapUnit,
    },
  };
}

function tune(params: DeskParams, account: AccountSettings): Tuned {
  const side = (node: { buyOn?: boolean; sellOn?: boolean; buyJoin?: Join; sellJoin?: Join }) => ({
    buyOn: Boolean(node.buyOn),
    sellOn: Boolean(node.sellOn),
    buyJoin: asJoin(node.buyJoin),
    sellJoin: asJoin(node.sellJoin),
  });
  const ema = (node: DeskParams["ema20"], fallback: number) => ({
    ...side(node),
    hours: Math.round(clampNum(node.hours, 2, 400, fallback)),
  });
  return {
    params: {
      bands: {
        length: Math.round(clampNum(params.bands.length, 2, 400, 20)),
        mult: clampNum(params.bands.mult, 0.1, 6, 2),
      },
      lower: {
        ...side(params.lower),
        buyPct: clampNum(params.lower.buyPct, 1, 300, 102),
        sellPct: clampNum(params.lower.sellPct, 1, 300, 102),
      },
      upper: {
        ...side(params.upper),
        buyPct: clampNum(params.upper.buyPct, 1, 300, 98),
        sellPct: clampNum(params.upper.sellPct, 1, 300, 98),
      },
      slope: {
        ...side(params.slope),
        buyFloor: clampNum(params.slope.buyFloor, -20, 20, -1),
        sellFloor: clampNum(params.slope.sellFloor, -20, 20, 1),
        bars: Math.round(clampNum(params.slope.bars, 1, 100, 3)),
      },
      volume: {
        ...side(params.volume),
        buyMult: clampNum(params.volume.buyMult, 0, 20, 1),
        sellMult: clampNum(params.volume.sellMult, 0, 20, 1),
        length: Math.round(clampNum(params.volume.length, 2, 400, 20)),
      },
      rsi: {
        ...side(params.rsi),
        length: Math.round(clampNum(params.rsi.length, 2, 100, 14)),
        buyLevel: clampNum(params.rsi.buyLevel, 0, 100, 30),
        sellLevel: clampNum(params.rsi.sellLevel, 0, 100, 70),
      },
      mfi: {
        ...side(params.mfi),
        length: Math.round(clampNum(params.mfi.length, 2, 100, 14)),
        buyLevel: clampNum(params.mfi.buyLevel, 0, 100, 50),
        sellLevel: clampNum(params.mfi.sellLevel, 0, 100, 80),
      },
      rti: {
        length: Math.round(clampNum(params.rti.length, 2, 400, 30)),
        mult: clampNum(params.rti.mult, 0.1, 6, 2),
        smooth: Math.round(clampNum(params.rti.smooth, 1, 50, 3)),
        direction: {
          ...side(params.rti.direction),
          up: clampNum(params.rti.direction.up, 0, 100, 50),
          down: clampNum(params.rti.direction.down, 0, 100, 50),
        },
        strength: {
          ...side(params.rti.strength),
          buyFloor: clampNum(params.rti.strength.buyFloor, 0, 50, 10),
          sellFloor: clampNum(params.rti.strength.sellFloor, 0, 50, 10),
        },
        line: {
          ...side(params.rti.line),
          length: Math.round(clampNum(params.rti.line.length, 2, 200, 10)),
          versus: params.rti.line.versus !== false,
          trend: params.rti.line.trend === true,
          levelOn: params.rti.line.levelOn === true,
          buyLevel: clampNum(params.rti.line.buyLevel, -200, 200, 50),
          sellLevel: clampNum(params.rti.line.sellLevel, -200, 200, 50),
        },
        negative: side(params.rti.negative),
        reversal: {
          ...side(params.rti.reversal),
          bars: Math.round(clampNum(params.rti.reversal.bars, 3, 80, 6)),
        },
        below: {
          ...side(params.rti.below),
          sellOn: false,
          level: clampNum(params.rti.below.level, -200, 200, 1),
        },
      },
      vwap: side(params.vwap),
      vwapPx: side(params.vwapPx),
      ema20: ema(params.ema20, 20),
      ema50: ema(params.ema50, 50),
      ema100: ema(params.ema100, 100),
      emaA: tuneSlot(params.emaA),
      emaB: tuneSlot(params.emaB),
      emaC: tuneSlot(params.emaC),
      trend: {
        hours: clampNum(params.trend.hours, 0.5, 48, 4),
        slope: {
          ...side(params.trend.slope),
          buyFloor: clampNum(params.trend.slope.buyFloor, -20, 20, 0),
          sellFloor: clampNum(params.trend.slope.sellFloor, -20, 20, 0),
        },
        line: side(params.trend.line),
      },
      step: {
        ...side(params.step),
        aboveBuy: clampNum(params.step.aboveBuy, 0, 1_000_000, 1),
        belowSell: clampNum(params.step.belowSell, 0, 1_000_000, 1),
        stopOn: Boolean(params.step.stopOn),
        stopBy: clampNum(params.step.stopBy ?? 0, 0, 1_000_000, 0),
        flatOn: Boolean(params.step.flatOn),
      },
      drop: {
        sellOn: Boolean(params.drop.sellOn),
        dropPct: clampNum(params.drop.dropPct, 0.1, 80, 10),
        recoverPct: clampNum(params.drop.recoverPct, 0, 100, 50),
      },
      matrix: {
        buy: cleanMatrix(params.matrix?.buy),
        sell: cleanMatrix(params.matrix?.sell),
      },
    },
    account: {
      ...account,
      startingCash: clampNum(account.startingCash, 0, 1_000_000_000, 10_000),
      flatFee: clampNum(account.flatFee, 0, 10_000, 0),
      percentFee: clampNum(account.percentFee, 0, 20, 0),
      dollarsPerBuy: clampNum(account.dollarsPerBuy, 0, 1_000_000_000, 0),
      delay: account.delay,
      useConfirmedSaleProceeds: Boolean(account.useConfirmedSaleProceeds),
      fromDate: sessionDate(account.fromDate),
      toDate: sessionDate(account.toDate),
    },
  };
}

function emptySeries(n: number): (number | null)[] {
  return Array.from({ length: n }, () => null);
}

function smaAt(values: number[], i: number, length: number): number | null {
  if (i < length - 1) return null;
  let s = 0;
  for (let k = i - length + 1; k <= i; k++) s += values[k];
  return s / length;
}

function stdevAt(values: number[], i: number, length: number, mean: number): number {
  if (length < 2) return 0;
  let s = 0;
  for (let k = i - length + 1; k <= i; k++) {
    const d = values[k] - mean;
    s += d * d;
  }
  return Math.sqrt(s / (length - 1));
}

function rsiSeries(closes: number[], length: number): (number | null)[] {
  const n = closes.length;
  const out = emptySeries(n);
  if (n <= length) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= length; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / length;
  let avgLoss = loss / length;
  const toRsi = (g: number, l: number) => {
    if (g === 0 && l === 0) return 50;
    if (l === 0) return 100;
    const rs = g / l;
    return 100 - 100 / (1 + rs);
  };
  out[length] = toRsi(avgGain, avgLoss);
  for (let i = length + 1; i < n; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (length - 1) + g) / length;
    avgLoss = (avgLoss * (length - 1) + l) / length;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

function mfiSeries(bars: Bar[], length: number): (number | null)[] {
  const n = bars.length;
  const out = emptySeries(n);
  const tp = bars.map((b) => (b.h + b.l + b.c) / 3);
  for (let i = length; i < n; i++) {
    let pos = 0;
    let neg = 0;
    for (let j = i - length + 1; j <= i; j++) {
      if (j === 0) continue;
      const raw = tp[j] * Math.max(0, bars[j].v);
      if (tp[j] > tp[j - 1]) pos += raw;
      else if (tp[j] < tp[j - 1]) neg += raw;
    }
    if (pos === 0 && neg === 0) out[i] = 50;
    else if (neg === 0) out[i] = 100;
    else out[i] = 100 - 100 / (1 + pos / neg);
  }
  return out;
}

function rtiSeries(closes: number[], length: number, mult: number, smooth: number): (number | null)[] {
  const n = closes.length;
  const raw = emptySeries(n);
  for (let i = length - 1; i < n; i++) {
    const mid = smaAt(closes, i, length);
    if (mid == null) continue;
    const half = mult * stdevAt(closes, i, length, mid);
    raw[i] = half <= 1e-12 ? 50 : (100 * (closes[i] - (mid - half))) / (2 * half);
  }
  const out = emptySeries(n);
  const alpha = 2 / (Math.max(1, smooth) + 1);
  let prev: number | null = null;
  for (let i = 0; i < n; i++) {
    const value = raw[i];
    if (value == null) continue;
    prev = prev == null ? value : alpha * value + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function emaOf(values: (number | null)[], length: number): (number | null)[] {
  const out = emptySeries(values.length);
  const alpha = 2 / (Math.max(1, length) + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value == null) continue;
    prev = prev == null ? value : alpha * value + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function dailyEma(bars: Bar[], session: string[], period: number): (number | null)[] {
  const n = bars.length;
  const out = emptySeries(n);
  if (period < 2 || n === 0) return out;
  const k = 2 / (period + 1);
  const completed: number[] = [];
  let key = session[0];
  let close = bars[0].c;
  let seeded = false;
  let ema = 0;
  const commit = (value: number) => {
    completed.push(value);
    if (seeded) {
      ema = value * k + ema * (1 - k);
      return;
    }
    if (completed.length === period) {
      let sum = 0;
      for (const point of completed) sum += point;
      ema = sum / period;
      seeded = true;
    }
  };
  for (let i = 0; i < n; i++) {
    if (session[i] !== key) {
      commit(close);
      key = session[i];
    }
    close = bars[i].c;
    const points = completed.length + 1;
    if (points < period) out[i] = null;
    else if (!seeded) {
      let sum = close;
      for (const point of completed) sum += point;
      out[i] = sum / period;
    } else out[i] = close * k + ema * (1 - k);
  }
  return out;
}

function hourlyEma(bars: Bar[], interval: Interval, period: number): (number | null)[] {
  if (interval === "1d" || period < 2) return emptySeries(bars.length);
  return dailyEma(
    bars,
    bars.map((bar) => hourKey(bar.t)),
    period,
  );
}

function trendSeries(
  bars: Bar[],
  interval: Interval,
  hours: number,
): { value: (number | null)[]; slopePct: (number | null)[] } {
  const n = bars.length;
  const value = emptySeries(n);
  const slopePct = emptySeries(n);
  const count = Math.round((hours * 3_600_000) / barDuration(interval));
  if (count < 3) return { value, slopePct };
  for (let i = count - 1; i < n; i++) {
    const start = i - count + 1;
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    for (let k = 0; k < count; k++) {
      const y = bars[start + k].c;
      sumX += k;
      sumY += y;
      sumXX += k * k;
      sumXY += k * y;
    }
    const denom = count * sumXX - sumX * sumX;
    if (denom === 0) continue;
    const slope = (count * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / count;
    const fitted = intercept + slope * (count - 1);
    value[i] = fitted;
    slopePct[i] = intercept !== 0 ? ((fitted - intercept) / Math.abs(intercept)) * 100 : 0;
  }
  return { value, slopePct };
}

export function computeIndicators(bars: Bar[], params: DeskParams, interval: Interval = "5m"): Indicators {
  const tuned = tune(params, {
    startingCash: 0,
    flatFee: 0,
    percentFee: 0,
    dollarsPerBuy: 0,
    delay: "instant",
    useConfirmedSaleProceeds: false,
    fromDate: "",
    toDate: "",
  }).params;
  const n = bars.length;
  const closes = bars.map((b) => b.c);
  const vols = bars.map((b) => b.v);
  const session: string[] = new Array(n);
  const sessionHigh: number[] = new Array(n);
  const priorClose: (number | null)[] = new Array(n).fill(null);
  let key = "";
  let high = 0;
  let prior = 0;
  let closed = 0;
  for (let i = 0; i < n; i++) {
    const k = sessionKey(bars[i].t);
    if (k !== key) {
      prior = closed;
      key = k;
      high = bars[i].h;
    } else high = Math.max(high, bars[i].h);
    session[i] = k;
    sessionHigh[i] = high;
    priorClose[i] = prior > 0 ? prior : null;
    closed = bars[i].c;
  }

  const bandMid = emptySeries(n);
  const bandUpper = emptySeries(n);
  const bandLower = emptySeries(n);
  const bandSlope = emptySeries(n);
  const volAvg = emptySeries(n);
  const len = tuned.bands.length;
  const mult = tuned.bands.mult;
  for (let i = 0; i < n; i++) {
    const mid = smaAt(closes, i, len);
    bandMid[i] = mid;
    if (mid != null) {
      const sd = stdevAt(closes, i, len, mid);
      bandUpper[i] = mid + mult * sd;
      bandLower[i] = mid - mult * sd;
    }
    const vol = smaAt(vols, i, tuned.volume.length);
    volAvg[i] = vol;
    const back = i - tuned.slope.bars;
    if (mid != null && back >= 0 && bandMid[back] != null && bandMid[back] !== 0) {
      bandSlope[i] = ((mid - (bandMid[back] as number)) / (bandMid[back] as number)) * 100;
    }
  }

  const vwap = emptySeries(n);
  let cumPV = 0;
  let cumV = 0;
  let vKey = "";
  for (let i = 0; i < n; i++) {
    if (session[i] !== vKey) {
      vKey = session[i];
      cumPV = 0;
      cumV = 0;
    }
    const tp = (bars[i].h + bars[i].l + bars[i].c) / 3;
    const vol = Math.max(0, bars[i].v);
    cumPV += tp * vol;
    cumV += vol;
    vwap[i] = cumV > 0 ? cumPV / cumV : tp;
  }

  const trend = trendSeries(bars, interval, tuned.trend.hours);
  const rti = rtiSeries(closes, tuned.rti.length, tuned.rti.mult, tuned.rti.smooth);

  return {
    session,
    sessionHigh,
    priorClose,
    bandMid,
    bandUpper,
    bandLower,
    bandSlope,
    volAvg,
    rsi: rsiSeries(closes, tuned.rsi.length),
    mfi: mfiSeries(bars, tuned.mfi.length),
    rti,
    rtiLine: emaOf(rti, tuned.rti.line.length),
    vwap,
    ema20: hourlyEma(bars, interval, tuned.ema20.hours),
    ema50: hourlyEma(bars, interval, tuned.ema50.hours),
    ema100: hourlyEma(bars, interval, tuned.ema100.hours),
    trend: trend.value,
    trendSlope: trend.slopePct,
  };
}

function num(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n);
}

function bandLevel(band: number, pct: number): number {
  return band * (pct / 100);
}

export function lowerFacts(
  i: number,
  bars: Bar[],
  ind: Indicators,
  params: DeskParams,
): { lower: number | null; buyLevel: number | null; sellLevel: number | null; buy: boolean; sell: boolean } {
  const lower = ind.bandLower[i];
  const buyLevel = num(lower) ? bandLevel(lower, params.lower.buyPct) : null;
  const sellLevel = num(lower) ? bandLevel(lower, params.lower.sellPct) : null;
  return {
    lower,
    buyLevel,
    sellLevel,
    buy: num(buyLevel) && bars[i].c <= (buyLevel as number) + 1e-9,
    sell: num(sellLevel) && bars[i].c <= (sellLevel as number) + 1e-9,
  };
}

export function upperFacts(
  i: number,
  bars: Bar[],
  ind: Indicators,
  params: DeskParams,
): { upper: number | null; buyLevel: number | null; sellLevel: number | null; buy: boolean; sell: boolean } {
  const upper = ind.bandUpper[i];
  const buyLevel = num(upper) ? bandLevel(upper, params.upper.buyPct) : null;
  const sellLevel = num(upper) ? bandLevel(upper, params.upper.sellPct) : null;
  return {
    upper,
    buyLevel,
    sellLevel,
    buy: num(buyLevel) && bars[i].c >= (buyLevel as number) - 1e-9,
    sell: num(sellLevel) && bars[i].c >= (sellLevel as number) - 1e-9,
  };
}

export function slopeFacts(
  i: number,
  ind: Indicators,
  params: DeskParams,
): { slope: number | null; buy: boolean; sell: boolean } {
  const slope = ind.bandSlope[i];
  const buy = num(slope) && slope >= params.slope.buyFloor - 1e-9;
  const sell = num(slope) && slope <= params.slope.sellFloor + 1e-9;
  return { slope, buy, sell };
}

export function volumeFacts(
  i: number,
  bars: Bar[],
  ind: Indicators,
  params: DeskParams,
): { ratio: number | null; buy: boolean; sell: boolean } {
  const avg = ind.volAvg[i];
  const ratio = num(avg) && avg > 0 ? bars[i].v / avg : null;
  return {
    ratio,
    buy: num(ratio) && ratio >= params.volume.buyMult - 1e-9,
    sell: num(ratio) && ratio >= params.volume.sellMult - 1e-9,
  };
}

export function rsiFacts(
  i: number,
  ind: Indicators,
  params: DeskParams,
): { rsi: number | null; buy: boolean; sell: boolean } {
  const rsi = ind.rsi[i];
  return {
    rsi,
    buy: num(rsi) && rsi <= params.rsi.buyLevel + 1e-9,
    sell: num(rsi) && rsi >= params.rsi.sellLevel - 1e-9,
  };
}

export function mfiFacts(i: number, ind: Indicators, params: DeskParams): { mfi: number | null; buy: boolean; sell: boolean } {
  const mfi = ind.mfi[i];
  const buy = num(mfi) && mfi <= params.mfi.buyLevel + 1e-9;
  const sell = num(mfi) && mfi >= params.mfi.sellLevel - 1e-9;
  return { mfi, buy, sell };
}

export function rtiSwing(series: readonly (number | null)[], i: number, bars: number): { valley: boolean; peak: boolean } {
  const width = Math.max(3, Math.round(bars));
  const start = i - width + 1;
  if (start < 0) return { valley: false, peak: false };
  let low = Infinity;
  let high = -Infinity;
  let lowAt = -1;
  let highAt = -1;
  for (let j = start; j <= i; j++) {
    const value = series[j];
    if (value == null || !Number.isFinite(value)) return { valley: false, peak: false };
    if (value < low) {
      low = value;
      lowAt = j;
    }
    if (value > high) {
      high = value;
      highAt = j;
    }
  }
  return {
    valley: lowAt !== start && lowAt !== i && (series[i] as number) > low,
    peak: highAt !== start && highAt !== i && (series[i] as number) < high,
  };
}

export function rtiFacts(
  i: number,
  ind: Indicators,
  params: DeskParams,
): {
  rti: number | null;
  line: number | null;
  dirBuy: boolean;
  dirSell: boolean;
  strBuy: boolean;
  strSell: boolean;
  lineBuy: boolean;
  lineSell: boolean;
  negBuy: boolean;
  negSell: boolean;
  revBuy: boolean;
  revSell: boolean;
  lowBuy: boolean;
} {
  const rti = ind.rti[i];
  const line = ind.rtiLine[i];
  const prev = i > 0 ? ind.rtiLine[i - 1] : null;
  const ready = num(rti);
  const lined = ready && num(line);
  const buyFloor = params.rti.strength.buyFloor;
  const sellFloor = params.rti.strength.sellFloor;
  const negative = ready && (rti as number) < -1e-9;
  const swing = rtiSwing(ind.rti, i, params.rti.reversal.bars);
  const setup = params.rti.line;
  const versus = setup.versus !== false;
  const trend = setup.trend === true;
  const levelOn = setup.levelOn === true;
  const versusBuy = lined && (rti as number) > (line as number) + 1e-9;
  const versusSell = lined && (rti as number) < (line as number) - 1e-9;
  const trendBuy = num(line) && num(prev) && (line as number) > (prev as number) + 1e-9;
  const trendSell = num(line) && num(prev) && (line as number) < (prev as number) - 1e-9;
  const levelBuy = ready && (rti as number) >= (setup.buyLevel ?? 50) - 1e-9;
  const levelSell = ready && (rti as number) <= (setup.sellLevel ?? 50) + 1e-9;
  const buyVotes = [versus && versusBuy, trend && trendBuy, levelOn && levelBuy];
  const sellVotes = [versus && versusSell, trend && trendSell, levelOn && levelSell];
  return {
    rti,
    line,
    dirBuy: ready && (rti as number) >= params.rti.direction.up - 1e-9,
    dirSell: ready && (rti as number) <= params.rti.direction.down + 1e-9,
    strBuy: ready && (rti as number) >= 50 + buyFloor - 1e-9,
    strSell: ready && (rti as number) <= 50 - sellFloor + 1e-9,
    lineBuy: buyVotes.some(Boolean),
    lineSell: sellVotes.some(Boolean),
    negBuy: negative,
    negSell: negative,
    revBuy: swing.valley,
    revSell: swing.peak,
    lowBuy: ready && (rti as number) <= params.rti.below.level + 1e-9,
  };
}

export function vwapFacts(
  i: number,
  bars: Bar[],
  ind: Indicators,
): { vwap: number | null; contains: boolean } {
  const vwap = ind.vwap[i];
  const bar = bars[i];
  const contains = num(vwap) && bar.l <= vwap + 1e-9 && bar.h >= vwap - 1e-9;
  return { vwap, contains };
}

export function vwapPxFacts(
  i: number,
  bars: Bar[],
  ind: Indicators,
): { vwap: number | null; below: boolean; above: boolean } {
  const vwap = ind.vwap[i];
  const close = bars[i].c;
  return {
    vwap,
    below: num(vwap) && close <= vwap + 1e-9,
    above: num(vwap) && close >= vwap - 1e-9,
  };
}

export function emaFacts(
  i: number,
  bars: Bar[],
  series: (number | null)[],
): { ema: number | null; ready: boolean; buy: boolean; sell: boolean } {
  const ema = series[i];
  const ready = num(ema);
  const close = bars[i].c;
  const buy = ready && close >= (ema as number) - 1e-9;
  const sell = ready && close <= (ema as number) + 1e-9;
  return { ema, ready, buy, sell };
}

export function trendFacts(
  i: number,
  bars: Bar[],
  ind: Indicators,
  params: DeskParams,
  interval: Interval,
): {
  count: number;
  applicable: boolean;
  value: number | null;
  slope: number | null;
  ready: boolean;
  above: boolean;
  below: boolean;
  buySlope: boolean;
  sellSlope: boolean;
} {
  const count = Math.round((params.trend.hours * 3_600_000) / barDuration(interval));
  const applicable = count >= 3;
  const value = ind.trend[i];
  const slope = ind.trendSlope[i];
  const ready = num(value) && num(slope);
  const floorBuy = params.trend.slope.buyFloor;
  const floorSell = params.trend.slope.sellFloor;
  const above = ready && bars[i].c >= (value as number) - 1e-9;
  const below = ready && bars[i].c <= (value as number) + 1e-9;
  const buySlope = ready && (slope as number) >= floorBuy - 1e-9;
  const sellSlope = ready && (slope as number) <= floorSell + 1e-9;
  return { count, applicable, value, slope, ready, above, below, buySlope, sellSlope };
}

function px(n: number | null, digits = 2): string {
  if (!num(n)) return "not ready";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function oneCheck(label: string, pass: boolean, detail: string): Check[] {
  return [{ label, pass, detail }];
}

const LANE_SERIES = {
  fast: "ema20",
  mid: "ema50",
  slow: "ema100",
} as const;

function memberValue(
  member: EmaMember,
  i: number,
  bars: Bar[],
  ind: Pick<Indicators, "ema20" | "ema50" | "ema100">,
): number | null {
  if (member === "close") return bars[i].c;
  const value = ind[LANE_SERIES[member]][i];
  return num(value) ? value : null;
}

function spreadLimit(amount: number, unit: "pct" | "usd", close: number): number {
  if (unit === "usd") return amount;
  return (Math.abs(close) * amount) / 100;
}

export function relationFacts(
  i: number,
  bars: Bar[],
  ind: Pick<Indicators, "ema20" | "ema50" | "ema100">,
  clauseIn: EmaClause,
  side: "buy" | "sell",
  params?: DeskParams,
): { ready: boolean; pass: boolean; detail: string } {
  const clause = tuneSlot({ buyOn: false, sellOn: false, clause: clauseIn }).clause;
  const raw = clause.members;
  const ordered = clause.op === "rank" && side === "sell" && clause.sellMirror ? [...raw].reverse() : raw;
  const emas = raw.filter((member) => member !== "close");
  const name = (member: EmaMember) => laneLabel(member, params);
  if (clause.op === "rank" && ordered.length < 2) {
    return { ready: false, pass: false, detail: "Rank needs two lines, listed from highest to lowest." };
  }
  if (clause.op !== "rank" && emas.length < 1) {
    return { ready: false, pass: false, detail: "This test needs at least one hourly average." };
  }
  const compared: EmaMember[] = clause.op !== "rank" && emas.length === 1 && !raw.includes("close") ? [emas[0], "close"] : ordered;
  const rows: { member: EmaMember; value: number }[] = [];
  for (const member of compared) {
    const value = memberValue(member, i, bars, ind);
    if (value == null) {
      return {
        ready: false,
        pass: false,
        detail: `${name(member)} is not ready on this bar, so the relation fails.`,
      };
    }
    rows.push({ member, value });
  }
  const described = rows.map((row) => `${name(row.member)} ${px(row.value)}`).join(", ");
  if (clause.op === "rank") {
    let pass = true;
    let broke = "";
    for (let k = 0; k < rows.length - 1; k++) {
      if (!(rows[k].value > rows[k + 1].value + 1e-9)) {
        pass = false;
        broke = `${name(rows[k].member)} ${px(rows[k].value)} is not above ${name(rows[k + 1].member)} ${px(rows[k + 1].value)}.`;
        break;
      }
    }
    const order = rows.map((row) => name(row.member)).join(" above ");
    return {
      ready: true,
      pass,
      detail: pass ? `${order}. ${described}.` : `${side === "sell" && clause.sellMirror ? "Sell reads the reverse order. " : ""}${broke}`,
    };
  }
  const values = rows.map((row) => row.value);
  const spread = Math.max(...values) - Math.min(...values);
  if (clause.op === "touch") {
    const limit = spreadLimit(clause.tol, clause.tolUnit, bars[i].c);
    const pass = spread <= limit + 1e-9;
    const tol = clause.tolUnit === "usd" ? `$${px(clause.tol)}` : `${px(clause.tol)}%`;
    return {
      ready: true,
      pass,
      detail: `Spread ${px(spread)} versus a touch tolerance of ${tol}. ${described}.`,
    };
  }
  const limit = spreadLimit(clause.gap, clause.gapUnit, bars[i].c);
  const pass = clause.gapMode === "wide" ? spread >= limit - 1e-9 : spread <= limit + 1e-9;
  const gap = clause.gapUnit === "usd" ? `$${px(clause.gap)}` : `${px(clause.gap)}%`;
  const word = clause.gapMode === "wide" ? "at least" : "at most";
  return {
    ready: true,
    pass,
    detail: `Spread ${px(spread)} needs to be ${word} ${gap}. ${described}.`,
  };
}

export function explainStrategies(
  i: number,
  bars: Bar[],
  ind: Indicators,
  params: DeskParams,
  interval: Interval,
): StrategyRead[] {
  const close = bars[i].c;
  const reads: StrategyRead[] = [];
  const lower = lowerFacts(i, bars, ind, params);
  reads.push({
    id: "lower",
    name: strategyName("lower", params),
    wantBuy: lower.buy,
    wantSell: lower.sell,
    buyOn: params.lower.buyOn,
    sellOn: params.lower.sellOn,
    buy: oneCheck(
      "Close versus the lower band",
      lower.buy,
      num(lower.buyLevel)
        ? `Close ${px(close)} is ${lower.buy ? "at or under" : "above"} ${px(lower.buyLevel)}, which is ${px(params.lower.buyPct)}% of the lower band ${px(lower.lower)}.`
        : "The lower band is not ready.",
    ),
    sell: oneCheck(
      "Close versus the lower band",
      lower.sell,
      num(lower.sellLevel)
        ? `Close ${px(close)} is ${lower.sell ? "at or under" : "above"} ${px(lower.sellLevel)}, which is ${px(params.lower.sellPct)}% of the lower band ${px(lower.lower)}.`
        : "The lower band is not ready.",
    ),
  });

  const upper = upperFacts(i, bars, ind, params);
  reads.push({
    id: "upper",
    name: strategyName("upper", params),
    wantBuy: upper.buy,
    wantSell: upper.sell,
    buyOn: params.upper.buyOn,
    sellOn: params.upper.sellOn,
    buy: oneCheck(
      "Close versus the upper band",
      upper.buy,
      num(upper.buyLevel)
        ? `Close ${px(close)} is ${upper.buy ? "at or over" : "under"} ${px(upper.buyLevel)}, which is ${px(params.upper.buyPct)}% of the upper band ${px(upper.upper)}.`
        : "The upper band is not ready.",
    ),
    sell: oneCheck(
      "Close versus the upper band",
      upper.sell,
      num(upper.sellLevel)
        ? `Close ${px(close)} is ${upper.sell ? "at or over" : "under"} ${px(upper.sellLevel)}, which is ${px(params.upper.sellPct)}% of the upper band ${px(upper.upper)}.`
        : "The upper band is not ready.",
    ),
  });

  const slope = slopeFacts(i, ind, params);
  reads.push({
    id: "slope",
    name: strategyName("slope", params),
    wantBuy: slope.buy,
    wantSell: slope.sell,
    buyOn: params.slope.buyOn,
    sellOn: params.slope.sellOn,
    buy: oneCheck(
      "Middle-band slope",
      slope.buy,
      num(slope.slope)
        ? `Slope is ${px(slope.slope)}% over ${params.slope.bars} bars. Buy needs at least ${px(params.slope.buyFloor)}%.`
        : "The middle-band slope is not ready.",
    ),
    sell: oneCheck(
      "Middle-band slope",
      slope.sell,
      num(slope.slope)
        ? `Slope is ${px(slope.slope)}%. Sell needs at or under ${px(params.slope.sellFloor)}%.`
        : "The middle-band slope is not ready.",
    ),
  });

  const volume = volumeFacts(i, bars, ind, params);
  const volumeDetail = (mult: number, pass: boolean) =>
    num(volume.ratio)
      ? `Volume is ${volume.ratio.toFixed(2)}× its ${params.volume.length}-bar average. This side needs ${mult.toFixed(2)}×, and it ${pass ? "passes" : "fails"}.`
      : "The volume average is not ready.";
  reads.push({
    id: "volume",
    name: strategyName("volume", params),
    wantBuy: volume.buy,
    wantSell: volume.sell,
    buyOn: params.volume.buyOn,
    sellOn: params.volume.sellOn,
    buy: oneCheck("Volume", volume.buy, volumeDetail(params.volume.buyMult, volume.buy)),
    sell: oneCheck("Volume", volume.sell, volumeDetail(params.volume.sellMult, volume.sell)),
  });

  const rsi = rsiFacts(i, ind, params);
  reads.push({
    id: "rsi",
    name: strategyName("rsi", params),
    wantBuy: rsi.buy,
    wantSell: rsi.sell,
    buyOn: params.rsi.buyOn,
    sellOn: params.rsi.sellOn,
    buy: oneCheck(
      "RSI",
      rsi.buy,
      num(rsi.rsi) ? `RSI ${px(rsi.rsi)} versus a buy level of ${px(params.rsi.buyLevel)}. Buy only at or under that level.` : "RSI is not ready.",
    ),
    sell: oneCheck(
      "RSI",
      rsi.sell,
      num(rsi.rsi) ? `RSI ${px(rsi.rsi)} versus a sell level of ${px(params.rsi.sellLevel)}. Sell at or over that level.` : "RSI is not ready.",
    ),
  });

  const flow = mfiFacts(i, ind, params);
  reads.push({
    id: "mfi",
    name: strategyName("mfi", params),
    wantBuy: flow.buy,
    wantSell: flow.sell,
    buyOn: params.mfi.buyOn,
    sellOn: params.mfi.sellOn,
    buy: oneCheck(
      "Money flow",
      flow.buy,
      num(flow.mfi)
        ? `Money Flow Index ${px(flow.mfi)} versus buy level ${px(params.mfi.buyLevel)}. Buy only at or under that level.`
        : "Money Flow Index is not ready.",
    ),
    sell: oneCheck(
      "Money flow",
      flow.sell,
      num(flow.mfi)
        ? `Money Flow Index ${px(flow.mfi)} versus sell level ${px(params.mfi.sellLevel)}. Sell at or over that level.`
        : "Money Flow Index is not ready.",
    ),
  });

  const rti = rtiFacts(i, ind, params);
  const rtiText = num(rti.rti)
    ? `Relative trend ${px(rti.rti)}. Above 50 is up, below 50 is down, and the distance from 50 is the strength.`
    : "Relative trend is not ready.";
  reads.push({
    id: "rtiDir",
    name: strategyName("rtiDir", params),
    wantBuy: rti.dirBuy,
    wantSell: rti.dirSell,
    buyOn: params.rti.direction.buyOn,
    sellOn: params.rti.direction.sellOn,
    buy: oneCheck(
      "Direction",
      rti.dirBuy,
      num(rti.rti) ? `${rtiText} Buy needs at or above ${px(params.rti.direction.up)}.` : rtiText,
    ),
    sell: oneCheck(
      "Direction",
      rti.dirSell,
      num(rti.rti) ? `${rtiText} Sell needs at or below ${px(params.rti.direction.down)}.` : rtiText,
    ),
  });
  reads.push({
    id: "rtiStr",
    name: strategyName("rtiStr", params),
    wantBuy: rti.strBuy,
    wantSell: rti.strSell,
    buyOn: params.rti.strength.buyOn,
    sellOn: params.rti.strength.sellOn,
    buy: oneCheck(
      "Strength",
      rti.strBuy,
      num(rti.rti) ? `${rtiText} Buy needs at least ${px(params.rti.strength.buyFloor)} points above 50.` : rtiText,
    ),
    sell: oneCheck(
      "Strength",
      rti.strSell,
      num(rti.rti) ? `${rtiText} Sell needs at least ${px(params.rti.strength.sellFloor)} points below 50.` : rtiText,
    ),
  });
  const lineSetup = params.rti.line;
  const lineParts = [
    lineSetup.versus !== false ? "above its line on a buy and under it on a sell" : "",
    lineSetup.trend ? "a rising line on a buy and a falling line on a sell" : "",
    lineSetup.levelOn ? `at or above ${px(lineSetup.buyLevel)} on a buy and at or under ${px(lineSetup.sellLevel)} on a sell` : "",
  ].filter(Boolean);
  const lineText =
    num(rti.rti) && num(rti.line)
      ? `Relative trend ${px(rti.rti)}, line ${px(rti.line)}. A side passes when any checked test passes: ${lineParts.join("; ") || "none"}.`
      : "The relative-trend line is not ready.";
  reads.push({
    id: "rtiLine",
    name: strategyName("rtiLine", params),
    wantBuy: rti.lineBuy,
    wantSell: rti.lineSell,
    buyOn: params.rti.line.buyOn,
    sellOn: params.rti.line.sellOn,
    buy: oneCheck("Its own line", rti.lineBuy, lineText),
    sell: oneCheck("Its own line", rti.lineSell, lineText),
  });
  const negText = num(rti.rti)
    ? `Relative trend ${px(rti.rti)}. Below zero means the close is through the lower edge of its band. The test stays true while the reading remains negative.`
    : "Relative trend is not ready.";
  reads.push({
    id: "rtiNeg",
    name: strategyName("rtiNeg", params),
    wantBuy: rti.negBuy,
    wantSell: rti.negSell,
    buyOn: params.rti.negative.buyOn,
    sellOn: params.rti.negative.sellOn,
    buy: oneCheck("Below zero", rti.negBuy, negText),
    sell: oneCheck("Below zero", rti.negSell, negText),
  });
  const revText = num(rti.rti)
    ? `Relative trend ${px(rti.rti)} over ${params.rti.reversal.bars} bars. A valley is a low inside that window with the newest reading back above it. A peak is a high inside that window with the newest reading back under it.`
    : "Relative trend is not ready.";
  reads.push({
    id: "rtiRev",
    name: strategyName("rtiRev", params),
    wantBuy: rti.revBuy,
    wantSell: rti.revSell,
    buyOn: params.rti.reversal.buyOn,
    sellOn: params.rti.reversal.sellOn,
    buy: oneCheck("Valley", rti.revBuy, revText),
    sell: oneCheck("Peak", rti.revSell, revText),
  });
  const lowText = num(rti.rti)
    ? `Relative trend ${px(rti.rti)} versus a buy level of ${px(params.rti.below.level)}. Buy only at or under that level. This test does not sell.`
    : "Relative trend is not ready.";
  reads.push({
    id: "rtiBelow",
    name: strategyName("rtiBelow", params),
    wantBuy: rti.lowBuy,
    wantSell: false,
    buyOn: params.rti.below.buyOn,
    sellOn: false,
    buy: oneCheck("At or under", rti.lowBuy, lowText),
    sell: oneCheck("Sell", false, "Buy below never sells."),
  });

  const inside = vwapFacts(i, bars, ind);
  const insideDetail = num(inside.vwap)
    ? `Range ${px(bars[i].l)}–${px(bars[i].h)} ${inside.contains ? "contains" : "does not contain"} session VWAP ${px(inside.vwap)}.`
    : "Session VWAP is not ready.";
  reads.push({
    id: "vwap",
    name: strategyName("vwap", params),
    wantBuy: inside.contains,
    wantSell: inside.contains,
    buyOn: params.vwap.buyOn,
    sellOn: params.vwap.sellOn,
    buy: oneCheck("VWAP inside the candle", inside.contains, insideDetail),
    sell: oneCheck("VWAP inside the candle", inside.contains, insideDetail),
  });

  const side = vwapPxFacts(i, bars, ind);
  reads.push({
    id: "vwapPx",
    name: strategyName("vwapPx", params),
    wantBuy: side.below,
    wantSell: side.above,
    buyOn: params.vwapPx.buyOn,
    sellOn: params.vwapPx.sellOn,
    buy: oneCheck(
      "Close versus VWAP",
      side.below,
      num(side.vwap) ? `Close ${px(close)} is ${side.below ? "at or under" : "above"} session VWAP ${px(side.vwap)}.` : "Session VWAP is not ready.",
    ),
    sell: oneCheck(
      "Close versus VWAP",
      side.above,
      num(side.vwap) ? `Close ${px(close)} is ${side.above ? "at or over" : "under"} session VWAP ${px(side.vwap)}.` : "Session VWAP is not ready.",
    ),
  });

  const emaRead = (id: "ema20" | "ema50" | "ema100", hours: number, series: (number | null)[]): StrategyRead => {
    const fact = emaFacts(i, bars, series);
    const node = params[id];
    const line = `${hours}-hour EMA`;
    const daily = interval === "1d";
    const missing = daily
      ? `${line} uses one close per clock hour. A daily bar has no hourly close, so this test does not pass.`
      : `${line} needs ${hours} hours. This bar does not have them yet.`;
    return {
      id,
      name: strategyName(id, params),
      wantBuy: fact.buy,
      wantSell: fact.sell,
      buyOn: node.buyOn,
      sellOn: node.sellOn,
      buy: oneCheck(
        "Close on or above",
        fact.buy,
        fact.ready ? `Close ${px(close)} is ${fact.buy ? "on or above" : "under"} ${line} ${px(fact.ema)}.` : missing,
      ),
      sell: oneCheck(
        "Close on or under",
        fact.sell,
        fact.ready ? `Close ${px(close)} is ${fact.sell ? "on or under" : "above"} ${line} ${px(fact.ema)}.` : missing,
      ),
    };
  };
  reads.push(emaRead("ema20", params.ema20.hours, ind.ema20));
  reads.push(emaRead("ema50", params.ema50.hours, ind.ema50));
  reads.push(emaRead("ema100", params.ema100.hours, ind.ema100));

  for (const id of EMA_RELS) {
    const slot = params[id];
    const buy = relationFacts(i, bars, ind, slot.clause, "buy", params);
    const sell = relationFacts(i, bars, ind, slot.clause, "sell", params);
    reads.push({
      id,
      name: strategyName(id, params),
      wantBuy: buy.pass,
      wantSell: sell.pass,
      buyOn: slot.buyOn,
      sellOn: slot.sellOn,
      buy: oneCheck("Relation", buy.pass, buy.detail),
      sell: oneCheck("Relation", sell.pass, sell.detail),
    });
  }

  const trend = trendFacts(i, bars, ind, params, interval);
  const windowDetail = trend.applicable
    ? `The fit uses the last ${trend.count} bars, about ${params.trend.hours} hours of this bar size.`
    : `A ${params.trend.hours}-hour line needs at least 3 bars. This bar size only fits ${trend.count}. Daily bars do not pass.`;
  reads.push({
    id: "trendSlope",
    name: strategyName("trendSlope", params),
    wantBuy: trend.applicable && trend.buySlope,
    wantSell: trend.applicable && trend.sellSlope,
    buyOn: params.trend.slope.buyOn,
    sellOn: params.trend.slope.sellOn,
    buy: oneCheck(
      "Rising",
      trend.applicable && trend.buySlope,
      !trend.applicable ? windowDetail : num(trend.slope) ? `Slope ${px(trend.slope)}% versus a buy floor of ${px(params.trend.slope.buyFloor)}%.` : "Slope is not ready.",
    ),
    sell: oneCheck(
      "Falling",
      trend.applicable && trend.sellSlope,
      !trend.applicable
        ? windowDetail
        : num(trend.slope)
          ? `Slope ${px(trend.slope)}% versus a sell ceiling of ${px(params.trend.slope.sellFloor)}%.`
          : "Slope is not ready.",
    ),
  });
  reads.push({
    id: "trendLine",
    name: strategyName("trendLine", params),
    wantBuy: trend.applicable && trend.above,
    wantSell: trend.applicable && trend.below,
    buyOn: params.trend.line.buyOn,
    sellOn: params.trend.line.sellOn,
    buy: oneCheck(
      "Close on or above the line",
      trend.applicable && trend.above,
      !trend.applicable ? windowDetail : num(trend.value) ? `Close ${px(close)} is ${trend.above ? "on or above" : "under"} the line ${px(trend.value)}.` : "The trend line is not ready.",
    ),
    sell: oneCheck(
      "Close on or under the line",
      trend.applicable && trend.below,
      !trend.applicable ? windowDetail : num(trend.value) ? `Close ${px(close)} is ${trend.below ? "on or under" : "above"} the line ${px(trend.value)}.` : "The trend line is not ready.",
    ),
  });

  reads.push({
    id: "drop",
    name: strategyName("drop", params),
    wantBuy: false,
    wantSell: false,
    buyOn: false,
    sellOn: params.drop.sellOn,
    buyJoin: "and",
    sellJoin: "and",
    buy: oneCheck("Buy", false, "Drop hold never buys."),
    sell: oneCheck("Sell", false, "Drop hold never sells. It only blocks sells."),
  });

  const joins = barVotes(i, bars, ind, params, interval);
  for (const read of reads) {
    if (read.id === "drop") continue;
    const bit = joins.find((item) => item.id === read.id);
    if (!bit) continue;
    read.buyJoin = bit.buyJoin;
    read.sellJoin = bit.sellJoin;
  }
  return reads;
}

function barVotes(i: number, bars: Bar[], ind: Indicators, params: DeskParams, interval: Interval): VoteBit[] {
  const bits: VoteBit[] = [];
  const add = (
    id: StrategyId,
    buyOn: boolean,
    sellOn: boolean,
    buyPass: boolean,
    sellPass: boolean,
    buyJoin: Join,
    sellJoin: Join,
  ) => {
    bits.push({ id, buyOn, sellOn, buyPass, sellPass, buyJoin, sellJoin });
  };
  const lower = lowerFacts(i, bars, ind, params);
  add("lower", params.lower.buyOn, params.lower.sellOn, lower.buy, lower.sell, asJoin(params.lower.buyJoin), asJoin(params.lower.sellJoin));
  const upper = upperFacts(i, bars, ind, params);
  add("upper", params.upper.buyOn, params.upper.sellOn, upper.buy, upper.sell, asJoin(params.upper.buyJoin), asJoin(params.upper.sellJoin));
  const slope = slopeFacts(i, ind, params);
  add("slope", params.slope.buyOn, params.slope.sellOn, slope.buy, slope.sell, asJoin(params.slope.buyJoin), asJoin(params.slope.sellJoin));
  const volume = volumeFacts(i, bars, ind, params);
  add("volume", params.volume.buyOn, params.volume.sellOn, volume.buy, volume.sell, asJoin(params.volume.buyJoin), asJoin(params.volume.sellJoin));
  const rsi = rsiFacts(i, ind, params);
  add("rsi", params.rsi.buyOn, params.rsi.sellOn, rsi.buy, rsi.sell, asJoin(params.rsi.buyJoin), asJoin(params.rsi.sellJoin));
  const flow = mfiFacts(i, ind, params);
  add("mfi", params.mfi.buyOn, params.mfi.sellOn, flow.buy, flow.sell, asJoin(params.mfi.buyJoin), asJoin(params.mfi.sellJoin));
  const rti = rtiFacts(i, ind, params);
  add(
    "rtiDir",
    params.rti.direction.buyOn,
    params.rti.direction.sellOn,
    rti.dirBuy,
    rti.dirSell,
    asJoin(params.rti.direction.buyJoin),
    asJoin(params.rti.direction.sellJoin),
  );
  add(
    "rtiStr",
    params.rti.strength.buyOn,
    params.rti.strength.sellOn,
    rti.strBuy,
    rti.strSell,
    asJoin(params.rti.strength.buyJoin),
    asJoin(params.rti.strength.sellJoin),
  );
  add(
    "rtiLine",
    params.rti.line.buyOn,
    params.rti.line.sellOn,
    rti.lineBuy,
    rti.lineSell,
    asJoin(params.rti.line.buyJoin),
    asJoin(params.rti.line.sellJoin),
  );
  add(
    "rtiNeg",
    params.rti.negative.buyOn,
    params.rti.negative.sellOn,
    rti.negBuy,
    rti.negSell,
    asJoin(params.rti.negative.buyJoin),
    asJoin(params.rti.negative.sellJoin),
  );
  add(
    "rtiRev",
    params.rti.reversal.buyOn,
    params.rti.reversal.sellOn,
    rti.revBuy,
    rti.revSell,
    asJoin(params.rti.reversal.buyJoin),
    asJoin(params.rti.reversal.sellJoin),
  );
  add("rtiBelow", params.rti.below.buyOn, false, rti.lowBuy, false, asJoin(params.rti.below.buyJoin), "and");
  const inside = vwapFacts(i, bars, ind);
  add("vwap", params.vwap.buyOn, params.vwap.sellOn, inside.contains, inside.contains, asJoin(params.vwap.buyJoin), asJoin(params.vwap.sellJoin));
  const side = vwapPxFacts(i, bars, ind);
  add("vwapPx", params.vwapPx.buyOn, params.vwapPx.sellOn, side.below, side.above, asJoin(params.vwapPx.buyJoin), asJoin(params.vwapPx.sellJoin));
  const e20 = emaFacts(i, bars, ind.ema20);
  add("ema20", params.ema20.buyOn, params.ema20.sellOn, e20.buy, e20.sell, asJoin(params.ema20.buyJoin), asJoin(params.ema20.sellJoin));
  const e50 = emaFacts(i, bars, ind.ema50);
  add("ema50", params.ema50.buyOn, params.ema50.sellOn, e50.buy, e50.sell, asJoin(params.ema50.buyJoin), asJoin(params.ema50.sellJoin));
  const e100 = emaFacts(i, bars, ind.ema100);
  add("ema100", params.ema100.buyOn, params.ema100.sellOn, e100.buy, e100.sell, asJoin(params.ema100.buyJoin), asJoin(params.ema100.sellJoin));
  for (const id of EMA_RELS) {
    const slot = params[id];
    const buy = relationFacts(i, bars, ind, slot.clause, "buy", params);
    const sell = relationFacts(i, bars, ind, slot.clause, "sell", params);
    add(id, slot.buyOn, slot.sellOn, buy.pass, sell.pass, asJoin(slot.buyJoin), asJoin(slot.sellJoin));
  }
  const trend = trendFacts(i, bars, ind, params, interval);
  add(
    "trendSlope",
    params.trend.slope.buyOn,
    params.trend.slope.sellOn,
    trend.applicable && trend.buySlope,
    trend.applicable && trend.sellSlope,
    asJoin(params.trend.slope.buyJoin),
    asJoin(params.trend.slope.sellJoin),
  );
  add(
    "trendLine",
    params.trend.line.buyOn,
    params.trend.line.sellOn,
    trend.applicable && trend.above,
    trend.applicable && trend.below,
    asJoin(params.trend.line.buyJoin),
    asJoin(params.trend.line.sellJoin),
  );
  return bits;
}

export function expressionFired(terms: SideTerm[]): StrategyId[] {
  const voting = terms.filter((term) => term.voting !== false);
  if (!voting.length) return [];
  const ands = voting.filter((term) => term.join !== "or");
  const ors = voting.filter((term) => term.join === "or");
  const andOk = ands.length > 0 && ands.every((term) => term.pass);
  const orOk = ors.some((term) => term.pass);
  const pass = ands.length > 0 && ors.length > 0 ? andOk || orOk : ors.length > 0 ? orOk : andOk;
  if (!pass) return [];
  const fired: StrategyId[] = [];
  if (andOk) for (const term of ands) fired.push(term.id);
  if (orOk) for (const term of ors) if (term.pass) fired.push(term.id);
  return fired;
}

export function matrixFired(groups: { members: StrategyId[] }[], terms: SideTerm[]): StrategyId[] {
  const byId = new Map(terms.map((term) => [term.id, term]));
  const fired: StrategyId[] = [];
  for (const group of groups) {
    if (!group.members.length) continue;
    const members = group.members.map((id) => byId.get(id));
    if (members.some((term) => !term || term.voting === false || !term.pass)) continue;
    for (const term of members) if (term) fired.push(term.id);
  }
  return [...new Set(fired)];
}

export function sideFired(matrix: SideMatrix | undefined, terms: SideTerm[]): StrategyId[] {
  if (matrix?.on) return matrixFired(matrix.groups, terms);
  return expressionFired(terms);
}

function wantsFromFacts(i: number, bars: Bar[], ind: Indicators, params: DeskParams, interval: Interval): SideWant {
  const buyTerms: SideTerm[] = [];
  const sellTerms: SideTerm[] = [];
  for (const bit of barVotes(i, bars, ind, params, interval)) {
    if (bit.buyOn) buyTerms.push({ id: bit.id, pass: bit.buyPass, join: bit.buyJoin });
    if (bit.sellOn) sellTerms.push({ id: bit.id, pass: bit.sellPass, join: bit.sellJoin });
  }
  const buy = sideFired(params.matrix?.buy, buyTerms);
  const sell = sideFired(params.matrix?.sell, sellTerms);
  return {
    buy,
    sell,
    buyVoters: buyTerms.length,
    sellVoters: sellTerms.length,
    buyTerms,
    sellTerms,
  };
}

export function sizeBuy(
  budget: number,
  price: number,
  flatFee: number,
  percentFee: number,
): { shares: number; fee: number; cost: number } {
  if (!(price > 0) || !(budget > 0)) return { shares: 0, fee: 0, cost: 0 };
  const pct = Math.max(0, percentFee) / 100;
  const flat = Math.max(0, flatFee);
  if (budget <= flat) return { shares: 0, fee: 0, cost: 0 };
  const shares = Math.floor((budget - flat) / (price * (1 + pct)));
  if (shares < 1) return { shares: 0, fee: 0, cost: 0 };
  const gross = shares * price;
  const fee = flat + gross * pct;
  return { shares, fee, cost: gross + fee };
}

export function sizeSell(
  shares: number,
  price: number,
  flatFee: number,
  percentFee: number,
): { fee: number; net: number } {
  const gross = Math.max(0, shares) * Math.max(0, price);
  const fee = Math.max(0, flatFee) + gross * (Math.max(0, percentFee) / 100);
  return { fee, net: gross - fee };
}

export type BookResult = {
  trace: Trace[];
  fills: Fill[];
  stats: Stats;
  holdOn: boolean[];
  recover: (number | null)[];
  buyAt: (number | null)[];
  sellAt: (number | null)[];
  holdEquity: number[];
  rangeStart: number;
  rangeEnd: number;
};

export function applySignals(
  bars: Bar[],
  wants: SideWant[],
  accountIn: AccountSettings,
  dropIn: DeskParams["drop"],
  sessionHigh?: number[],
  stepIn?: DeskParams["step"] | null,
  matrixIn?: { buy: SideMatrix; sell: SideMatrix } | null,
): BookResult {
  const tuned = tune(defaultParams(), accountIn);
  const account = tuned.account;
  const drop = tune({ ...tuned.params, drop: dropIn }, account).params.drop;
  const matrix = matrixIn ?? { buy: { on: false, groups: [] }, sell: { on: false, groups: [] } };

  const n = bars.length;
  const highs =
    sessionHigh ??
    (() => {
      const out: number[] = [];
      let key = "";
      let high = 0;
      for (let i = 0; i < n; i++) {
        const k = sessionKey(bars[i].t);
        if (k !== key) {
          key = k;
          high = bars[i].h;
        } else high = Math.max(high, bars[i].h);
        out.push(high);
      }
      return out;
    })();

  let cash = account.startingCash;
  let shares = 0;
  const lots: { amount: number; availableAt: number }[] = [];
  let hold = false;
  let breached = false;
  let disarmed = false;
  let anchor = 0;
  let trough = 0;
  let prior = 0;
  let lastSessionClose = 0;
  let sessionLow = Infinity;
  let prevSession = "";
  let lastBuy: number | null = null;
  let lastSell: number | null = null;

  const trace: Trace[] = [];
  const fills: Fill[] = [];
  const holdOn: boolean[] = [];
  const recover: (number | null)[] = [];
  const buyAt: (number | null)[] = [];
  const sellAt: (number | null)[] = [];
  const skippedByReason: Record<string, number> = {};
  let skipped = 0;
  let roundTrips = 0;
  let peak = account.startingCash;
  let maxDd = 0;
  let windowStart = -1;
  let windowEnd = -1;
  let fromDay = account.fromDate;
  let toDay = account.toDate;
  if (fromDay && toDay && fromDay > toDay) {
    const swap = fromDay;
    fromDay = toDay;
    toDay = swap;
  }

  const unsettledTotal = () => lots.reduce((s, lot) => s + lot.amount, 0);

  for (let i = 0; i < n; i++) {
    const bar = bars[i];
    const key = sessionKey(bar.t);
    if (key !== prevSession) {
      prior = lastSessionClose;
      prevSession = key;
      hold = false;
      breached = false;
      disarmed = false;
      anchor = 0;
      trough = 0;
      sessionLow = Infinity;
    }
    sessionLow = Math.min(sessionLow, bar.l);
    lastSessionClose = bar.c;

    if (lots.length) {
      const keep: typeof lots = [];
      for (const lot of lots) {
        if (lot.availableAt <= bar.t) cash += lot.amount;
        else keep.push(lot);
      }
      lots.length = 0;
      lots.push(...keep);
    }

    const sessionHi = highs[i] ?? bar.h;
    let holdRecover: number | null = null;
    if (!drop.sellOn || !(prior > 0)) {
      hold = false;
    } else {
      const line = prior * (1 - drop.dropPct / 100);
      if (!breached && bar.l <= line + 1e-9) {
        breached = true;
        if (!disarmed) {
          hold = true;
          anchor = prior;
          trough = bar.l;
        }
      }
      if (hold) {
        trough = Math.min(trough, bar.l);
        const span = Math.max(0, anchor - trough);
        holdRecover = trough + (drop.recoverPct / 100) * span;
        if (bar.c >= holdRecover - 1e-9) hold = false;
      }
    }

    const sellHold = Boolean(drop.sellOn && hold);
    const book: "flat" | "long" = shares > 0 ? "long" : "flat";
    const want = wants[i] ?? { buy: [], sell: [] };
    const step = stepIn;
    const above = clampNum(step?.aboveBuy ?? 1, 0, 1_000_000, 1);
    const below = clampNum(step?.belowSell ?? 1, 0, 1_000_000, 1);
    const stopBy = clampNum(step?.stopBy ?? 0, 0, 1_000_000, 0);
    const sellLevel = step?.sellOn && lastBuy != null ? lastBuy + above : null;
    const flatBuy = Boolean(step?.buyOn && step.flatOn);
    const buyLevel = step?.buyOn && !flatBuy && lastSell != null ? lastSell - below : null;
    sellAt.push(sellLevel);
    buyAt.push(flatBuy ? null : buyLevel);
    const stepSells = sellLevel != null;
    const stepBuys = flatBuy || buyLevel != null;
    const profit = stepSells && bar.c >= (sellLevel as number) - 1e-9;
    const stopped = Boolean(step?.sellOn && step.stopOn && lastBuy != null && bar.c < lastBuy - stopBy - 1e-9);
    const stepSellPass = profit || stopped;
    const stepBuyPass = flatBuy || (buyLevel != null && bar.c <= (buyLevel as number) + 1e-9);
    const useStep = Boolean(step && (step.buyOn || step.sellOn));
    let buyers: StrategyId[];
    let sellers: StrategyId[];
    if (want.buyTerms || want.sellTerms) {
      const buyTerms = [...(want.buyTerms ?? [])];
      const sellTerms = [...(want.sellTerms ?? [])];
      if (step?.buyOn) buyTerms.push({ id: "step", pass: stepBuyPass, join: asJoin(step.buyJoin), voting: stepBuys });
      if (step?.sellOn) sellTerms.push({ id: "step", pass: stepSellPass, join: asJoin(step.sellJoin), voting: stepSells });
      buyers = sideFired(matrix.buy, buyTerms);
      sellers = sideFired(matrix.sell, sellTerms);
    } else if (!useStep) {
      buyers = want.buy.filter((id) => id !== "drop" && id !== "step");
      sellers = want.sell.filter((id) => id !== "drop" && id !== "step");
    } else {
      const buyVoterCount = want.buyVoters ?? want.buy.length;
      const sellVoterCount = want.sellVoters ?? want.sell.length;
      const othersBuyOk = buyVoterCount === 0 || want.buy.length === buyVoterCount;
      const othersSellOk = sellVoterCount === 0 || want.sell.length === sellVoterCount;
      buyers = [];
      sellers = [];
      if ((buyVoterCount > 0 || stepBuys) && othersBuyOk && (!stepBuys || stepBuyPass)) {
        buyers = want.buy.filter((id) => id !== "drop" && id !== "step");
        if (stepBuyPass) buyers.push("step");
      }
      if ((sellVoterCount > 0 || stepSells) && othersSellOk && (!stepSells || stepSellPass)) {
        sellers = want.sell.filter((id) => id !== "drop" && id !== "step");
        if (stepSellPass) sellers.push("step");
      }
    }
    const trading = (!fromDay || key >= fromDay) && (!toDay || key <= toDay);
    if (!trading) {
      buyers = [];
      sellers = [];
    }
    const skippedHere: Trace["skipped"] = [];
    let action: Trace["action"] = "none";
    let fired: StrategyId[] = [];
    let holdCancelled = false;
    let fee = 0;
    let fillShares = 0;

    const pushSkip = (id: StrategyId, side: "buy" | "sell", reason: string) => {
      skippedHere.push({ id, side, reason });
      skipped += 1;
      skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
    };

    if (book === "flat") {
      for (const id of sellers) pushSkip(id, "sell", SKIP.flat);
      if (buyers.length) {
        const power = Math.max(0, cash);
        const budget = account.dollarsPerBuy > 0 ? Math.min(account.dollarsPerBuy, power) : power;
        const order = sizeBuy(budget, bar.c, account.flatFee, account.percentFee);
        if (order.shares >= 1 && order.cost <= power + 1e-9) {
          cash -= order.cost;
          shares = order.shares;
          fillShares = order.shares;
          fee = order.fee;
          action = "buy";
          fired = buyers.slice();
          if (hold) holdCancelled = true;
          hold = false;
          disarmed = true;
        } else {
          for (const id of buyers) pushSkip(id, "buy", SKIP.cash);
        }
      }
    } else {
      for (const id of buyers) pushSkip(id, "buy", SKIP.long);
      if (sellers.length) {
        if (sellHold) {
          for (const id of sellers) pushSkip(id, "sell", SKIP.hold);
        } else {
          const soldShares = shares;
          const sold = sizeSell(soldShares, bar.c, account.flatFee, account.percentFee);
          fee = sold.fee;
          shares = 0;
          fillShares = soldShares;
          const delay = delayOf(account.delay).ms;
          if (sold.net >= 0 && (account.useConfirmedSaleProceeds || delay === 0)) cash += sold.net;
          else if (sold.net >= 0) lots.push({ amount: sold.net, availableAt: bar.t + delay });
          else cash = Math.max(0, cash + sold.net);
          action = "sell";
          fired = sellers.slice();
          roundTrips += 1;
        }
      }
    }

    const unsettledAfter = unsettledTotal();
    const buyingPowerAfter = Math.max(0, cash);
    const equityAfter = cash + unsettledAfter + shares * bar.c;
    if (action !== "none") {
      fills.push({
        index: i,
        time: bar.t,
        side: action,
        strategies: fired,
        shares: fillShares,
        price: bar.c,
        close: bar.c,
        fee,
        equityAfter,
      });
    }

    if (trading) {
      if (windowStart < 0) windowStart = i;
      windowEnd = i;
      peak = Math.max(peak, equityAfter);
      if (peak > 0) maxDd = Math.max(maxDd, ((peak - equityAfter) / peak) * 100);
    }

    const dropFromPriorPct = prior > 0 && Number.isFinite(sessionLow) ? ((prior - sessionLow) / prior) * 100 : 0;
    holdOn.push(sellHold && !holdCancelled);
    recover.push(sellHold && !holdCancelled ? holdRecover : null);

    trace.push({
      index: i,
      book,
      shares: 0,
      sellHold,
      sessionHigh: sessionHi,
      priorClose: prior,
      holdAnchor: sellHold ? anchor : null,
      holdTrough: sellHold ? trough : null,
      holdRecover: sellHold ? holdRecover : null,
      dropFromPriorPct,
      action,
      signalBuy: buyers.length > 0,
      signalSell: sellers.length > 0,
      fired,
      skipped: skippedHere,
      holdCancelled,
      holdLatched: breached,
      holdDisarmed: disarmed,
      lastBuy,
      lastSell,
      cashAfter: cash,
      unsettledAfter,
      buyingPowerAfter,
      equityAfter,
      sharesAfter: shares,
    });
    if (action === "buy") lastBuy = bar.c;
    else if (action === "sell") lastSell = bar.c;
  }

  // Fix shares recorded on the trace for the pre-trade position.
  // The helper above is awkward for sells; recompute cleanly.
  let running = 0;
  for (let i = 0; i < n; i++) {
    trace[i].shares = running;
    trace[i].book = running > 0 ? "long" : "flat";
    if (trace[i].action === "buy") running = trace[i].sharesAfter;
    else if (trace[i].action === "sell") running = 0;
    else running = trace[i].sharesAfter;
  }

  const endingEquity = windowEnd >= 0 ? trace[windowEnd].equityAfter : account.startingCash;
  const windowBars = windowStart >= 0 ? bars.slice(windowStart, windowEnd + 1) : [];
  const bh = buyAndHold(windowBars, account);
  const holdEquity = bars.map(() => account.startingCash);
  if (windowStart >= 0) {
    for (let k = 0; k < bh.series.length; k++) holdEquity[windowStart + k] = bh.series[k];
  }
  const strategyReturnPct =
    account.startingCash > 0 ? (endingEquity / account.startingCash - 1) * 100 : 0;
  const rangeStart = windowStart >= 0 ? windowStart : 0;
  const rangeEnd = windowEnd >= 0 ? windowEnd + 1 : 0;

  return {
    trace,
    fills,
    stats: {
      strategyReturnPct,
      buyHoldReturnPct: bh.returnPct,
      differencePct: strategyReturnPct - bh.returnPct,
      roundTrips,
      skipped,
      maxDrawdownPct: maxDd,
      endingEquity,
      buyHoldEquity: bh.equity,
      skippedByReason,
    },
    holdOn,
    recover,
    buyAt,
    sellAt,
    holdEquity,
    rangeStart,
    rangeEnd,
  };
}

function buyAndHold(bars: Bar[], account: AccountSettings): { equity: number; returnPct: number; series: number[] } {
  const series = buyHoldSeries(bars, account);
  const equity = series.length ? series[series.length - 1] : account.startingCash;
  const returnPct = account.startingCash > 0 ? (equity / account.startingCash - 1) * 100 : 0;
  return { equity, returnPct, series };
}

export function buyHoldSeries(bars: Bar[], account: AccountSettings): number[] {
  if (!bars.length || !(account.startingCash > 0) || !(bars[0].c > 0)) {
    return bars.map(() => account.startingCash);
  }
  const order = sizeBuy(account.startingCash, bars[0].c, account.flatFee, account.percentFee);
  const cash = account.startingCash - order.cost;
  return bars.map((bar) => cash + order.shares * bar.c);
}

function stepLevel(side: "buy" | "sell", params: DeskParams, lastBuy: number | null, lastSell: number | null, close: number): LogicLevel | null {
  const rule = params.step;
  if (side === "buy" && !rule.buyOn) return null;
  if (side === "sell" && !rule.sellOn) return null;
  if (side === "buy") {
    if (rule.flatOn) return 1;
    if (lastSell == null) return 2;
    const level = lastSell - clampNum(rule.belowSell, 0, 1_000_000, 1);
    return close <= level + 1e-9 ? 1 : 0;
  }
  if (lastBuy == null) return 2;
  const above = clampNum(rule.aboveBuy, 0, 1_000_000, 1);
  const stopBy = clampNum(rule.stopBy ?? 0, 0, 1_000_000, 0);
  const profit = close >= lastBuy + above - 1e-9;
  const stopped = Boolean(rule.stopOn) && close < lastBuy - stopBy - 1e-9;
  return profit || stopped ? 1 : 0;
}

function groupLabel(members: StrategyId[], index: number, params: DeskParams): string {
  const body = members.length ? members.map((id) => strategyShort(id, params)).join("&") : "empty";
  return `G${index + 1} ${body}`.slice(0, 28);
}

function productLevel(
  members: StrategyId[],
  side: "buy" | "sell",
  byId: Map<StrategyId, VoteBit>,
  params: DeskParams,
  row: Trace | undefined,
  close: number,
): LogicLevel {
  if (!members.length) return 0;
  for (const id of members) {
    if (id === "step") {
      const level = stepLevel(side, params, row?.lastBuy ?? null, row?.lastSell ?? null, close);
      if (level !== 1) return 0;
      continue;
    }
    const bit = byId.get(id);
    const on = side === "buy" ? bit?.buyOn : bit?.sellOn;
    const pass = side === "buy" ? bit?.buyPass : bit?.sellPass;
    if (!bit || !on || !pass) return 0;
  }
  return 1;
}

export function buildLogic(
  bars: Bar[],
  ind: Indicators,
  params: DeskParams,
  interval: Interval,
  trace: Trace[],
): LogicDiagram {
  const n = bars.length;
  const buyMatrix = Boolean(params.matrix?.buy.on);
  const sellMatrix = Boolean(params.matrix?.sell.on);
  const buyIds = STRATEGY_ORDER.filter((id) => {
    if (id === "drop") return false;
    if (id === "step") return params.step.buyOn;
    return false;
  });
  const sellIds = STRATEGY_ORDER.filter((id) => {
    if (id === "drop") return false;
    if (id === "step") return params.step.sellOn;
    return false;
  });
  const sample = n > 0 ? barVotes(0, bars, ind, params, interval) : [];
  if (n > 0) {
    for (const bit of sample) {
      if (bit.buyOn) buyIds.push(bit.id);
      if (bit.sellOn) sellIds.push(bit.id);
    }
  }
  const order = (ids: StrategyId[]) => STRATEGY_ORDER.filter((id) => ids.includes(id));
  const joinOf = (id: StrategyId, side: "buy" | "sell"): Join => {
    if (id === "step") return asJoin(side === "buy" ? params.step.buyJoin : params.step.sellJoin);
    const bit = sample.find((item) => item.id === id);
    return side === "buy" ? (bit?.buyJoin ?? "and") : (bit?.sellJoin ?? "and");
  };
  const ruleLanes = (ids: StrategyId[], side: "buy" | "sell"): LogicLane[] =>
    order(ids).map((id) => ({
      id,
      name: strategyShort(id, params),
      join: joinOf(id, side),
      kind: "rule" as const,
      levels: Array.from({ length: n }, () => 0 as LogicLevel),
    }));
  const groupLanes = (side: "buy" | "sell"): LogicLane[] =>
    (side === "buy" ? params.matrix.buy.groups : params.matrix.sell.groups).map((group, index) => ({
      id: group.id,
      name: groupLabel(group.members, index, params),
      join: "and" as const,
      kind: "group" as const,
      levels: Array.from({ length: n }, () => 0 as LogicLevel),
    }));
  const buy = buyMatrix ? groupLanes("buy") : ruleLanes(buyIds, "buy");
  const sell = sellMatrix ? groupLanes("sell") : ruleLanes(sellIds, "sell");
  if (params.drop.sellOn) {
    sell.push({
      id: "drop",
      name: "Not Held",
      join: "and",
      kind: "hold",
      levels: Array.from({ length: n }, (_, i) => (trace[i]?.sellHold && !trace[i]?.holdCancelled ? 0 : 1)),
    });
  }
  const buyTick = Array.from({ length: n }, () => false);
  const sellTick = Array.from({ length: n }, () => false);
  for (let i = 0; i < n; i++) {
    const byId = new Map(barVotes(i, bars, ind, params, interval).map((bit) => [bit.id, bit]));
    const row = trace[i];
    const close = bars[i].c;
    if (buyMatrix) {
      params.matrix.buy.groups.forEach((group, index) => {
        buy[index].levels[i] = productLevel(group.members, "buy", byId, params, row, close);
      });
      buyTick[i] = buy.some((lane) => lane.levels[i] === 1);
    } else {
      for (const lane of buy) {
        if (lane.id === "step") lane.levels[i] = stepLevel("buy", params, row?.lastBuy ?? null, row?.lastSell ?? null, close) ?? 0;
        else lane.levels[i] = byId.get(lane.id as StrategyId)?.buyPass ? 1 : 0;
      }
      buyTick[i] =
        expressionFired(buy.map((lane) => ({ id: lane.id as StrategyId, pass: lane.levels[i] === 1, join: lane.join, voting: lane.levels[i] !== 2 }))).length > 0;
    }
    if (sellMatrix) {
      params.matrix.sell.groups.forEach((group, index) => {
        sell[index].levels[i] = productLevel(group.members, "sell", byId, params, row, close);
      });
      sellTick[i] = sell.some((lane) => lane.kind === "group" && lane.levels[i] === 1);
    } else {
      for (const lane of sell) {
        if (lane.id === "drop") continue;
        if (lane.id === "step") lane.levels[i] = stepLevel("sell", params, row?.lastBuy ?? null, row?.lastSell ?? null, close) ?? 0;
        else lane.levels[i] = byId.get(lane.id as StrategyId)?.sellPass ? 1 : 0;
      }
      sellTick[i] =
        expressionFired(
          sell
            .filter((lane) => lane.id !== "drop")
            .map((lane) => ({ id: lane.id as StrategyId, pass: lane.levels[i] === 1, join: lane.join, voting: lane.levels[i] !== 2 })),
        ).length > 0;
    }
  }
  return { buy, sell, buyTick, sellTick };
}

export function simulate(
  bars: Bar[],
  interval: Interval,
  paramsIn: DeskParams,
  accountIn: AccountSettings,
): SimResult {
  const { params, account } = tune(paramsIn, accountIn);
  const indicators = computeIndicators(bars, params, interval);
  const wants: SideWant[] = bars.map((_, i) => wantsFromFacts(i, bars, indicators, params, interval));
  const book = applySignals(bars, wants, account, params.drop, indicators.sessionHigh, params.step, params.matrix);
  const logic = buildLogic(bars, indicators, params, interval, book.trace);
  return { indicators, ...book, logic };
}

export function explainAt(
  i: number,
  bars: Bar[],
  ind: Indicators,
  params: DeskParams,
  interval: Interval,
  trace: Trace,
): Explain {
  const step = stepRead(i, bars, params, trace);
  const strategies = explainStrategies(i, bars, ind, params, interval)
    .concat(step ? [step] : [])
    .filter((item) => item.buyOn || item.sellOn);
  const voting = (item: StrategyRead, side: "buy" | "sell") => {
    if (item.id === "drop") return false;
    if (side === "buy") return item.buyOn && item.buyVoting !== false;
    return item.sellOn && item.sellVoting !== false;
  };
  const buyVoters = strategies.filter((item) => voting(item, "buy"));
  const sellVoters = strategies.filter((item) => voting(item, "sell"));
  const buyFired = sideFired(
    params.matrix?.buy,
    buyVoters.map((item) => ({ id: item.id, pass: item.wantBuy, join: asJoin(item.buyJoin), voting: item.buyVoting !== false })),
  );
  const sellFired = sideFired(
    params.matrix?.sell,
    sellVoters.map((item) => ({ id: item.id, pass: item.wantSell, join: asJoin(item.sellJoin), voting: item.sellVoting !== false })),
  );
  const buyMissing = buyVoters.filter((item) => item.buyJoin !== "or" && !item.wantBuy).map((item) => item.id);
  const sellMissing = sellVoters.filter((item) => item.sellJoin !== "or" && !item.wantSell).map((item) => item.id);
  const dropRead = strategies.find((item) => item.id === "drop");
  if (dropRead) {
    const on = trace.sellHold && !trace.holdCancelled;
    const prior = trace.priorClose;
    const px = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const drop = params.drop.dropPct;
    const pct = trace.dropFromPriorPct;
    const distance = `${Math.abs(pct).toFixed(1)}% ${pct >= 0 ? "under" : "above"}`;
    let detail: string;
    if (!(prior > 0)) detail = "No prior session close yet, so the drop cannot block a sell.";
    else if (on)
      detail = `Session low is ${distance} the prior close ${px(prior)}. A sell stays blocked until the close reaches ${trace.holdRecover != null ? px(trace.holdRecover) : "the recovery"}.`;
    else if (trace.holdCancelled) detail = "This buy cancelled the hold. It stays off for the rest of the session even if price drops further.";
    else if (trace.holdDisarmed) detail = "A buy already filled this session, so a later drop does not start a new hold.";
    else if (trace.holdLatched)
      detail = `The session low already went ${drop}% under the prior close ${px(prior)}. The hold is off because a buy cancelled it or the close recovered halfway.`;
    else detail = `Session low is ${distance} the prior close ${px(prior)}. That is short of the ${drop}% line.`;
    dropRead.sell = [{ label: on ? "Held" : "Not held", pass: !on, detail }];
  }
  return {
    index: i,
    book: trace.book,
    shares: trace.shares,
    sellHold: trace.sellHold,
    holdCancelled: trace.holdCancelled,
    sessionHigh: trace.sessionHigh,
    priorClose: trace.priorClose,
    holdRecover: trace.holdRecover,
    dropFromPriorPct: trace.dropFromPriorPct,
    action: trace.action,
    fired: trace.fired,
    skipped: trace.skipped,
    strategies,
    buyReady: buyFired.length > 0,
    sellReady: sellFired.length > 0,
    buyMissing,
    sellMissing,
  };
}

function stepRead(i: number, bars: Bar[], params: DeskParams, trace: Trace): StrategyRead | null {
  const rule = params.step;
  if (!rule || (!rule.buyOn && !rule.sellOn)) return null;
  const close = bars[i]?.c;
  const above = clampNum(rule.aboveBuy, 0, 1_000_000, 1);
  const below = clampNum(rule.belowSell, 0, 1_000_000, 1);
  const stopBy = clampNum(rule.stopBy ?? 0, 0, 1_000_000, 0);
  const sellLevel = trace.lastBuy == null ? null : trace.lastBuy + above;
  const flatBuy = Boolean(rule.buyOn && rule.flatOn);
  const buyLevel = flatBuy || trace.lastSell == null ? null : trace.lastSell - below;
  const sellVoting = rule.sellOn && sellLevel != null;
  const buyVoting = flatBuy || (rule.buyOn && buyLevel != null);
  const profit = sellVoting && close >= (sellLevel as number) - 1e-9;
  const stopped = Boolean(rule.stopOn && rule.sellOn && trace.lastBuy != null && close < (trace.lastBuy as number) - stopBy - 1e-9);
  const wantSell = profit || stopped;
  const wantBuy = flatBuy || (buyVoting && close <= (buyLevel as number) + 1e-9);
  const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    id: "step",
    name: strategyName("step", params),
    wantBuy,
    wantSell,
    buyOn: rule.buyOn,
    sellOn: rule.sellOn,
    buyJoin: asJoin(rule.buyJoin),
    sellJoin: asJoin(rule.sellJoin),
    buyVoting,
    sellVoting,
    buy: !rule.buyOn
      ? []
      : flatBuy
        ? [
            {
              label: "Book is flat",
              pass: true,
              detail: "This buy passes on any bar. The book still buys only when it is flat, so a position has to be sold before the next entry. The dollar step under the last sell is not used.",
            },
          ]
        : [
          {
            label: "Last sell",
            pass: buyVoting,
            wait: !buyVoting,
            detail:
              trace.lastSell == null
                ? "No play-money sell yet, so this buy stays out of the test. The first entry can come from the other buy rules."
                : `Last sell was ${money(trace.lastSell)}.`,
          },
          {
            label: "Below that sell",
            pass: wantBuy,
            wait: !buyVoting,
            detail:
              buyLevel == null
                ? `After a sell, the buy line is that fill minus ${money(below)}.`
                : `Close ${money(close)} is ${wantBuy ? "at or under" : "above"} ${money(buyLevel)} (${money(below)} under the last sell).`,
          },
        ],
    sell: rule.sellOn
      ? [
          {
            label: "Last buy",
            pass: sellVoting,
            wait: !sellVoting,
            detail:
              trace.lastBuy == null
                ? "No play-money buy yet, so this sell stays out of the test."
                : `Last buy was ${money(trace.lastBuy)}.`,
          },
          {
            label: "Above that buy",
            pass: profit,
            wait: !sellVoting,
            detail:
              sellLevel == null
                ? `After a buy, the sell line is that fill plus ${money(above)}.`
                : `Close ${money(close)} is ${profit ? "at or above" : "under"} ${money(sellLevel)} (${money(above)} above the last buy).`,
          },
          ...(rule.stopOn
            ? [
                {
                  label: "Under that buy",
                  pass: stopped,
                  wait: !sellVoting,
                  detail:
                    trace.lastBuy == null
                      ? `After a buy, a close under that fill by ${money(stopBy)} sells. Zero means any close under the fill.`
                      : `Close ${money(close)} is ${stopped ? "under" : "not under"} ${money((trace.lastBuy as number) - stopBy)} (${money(stopBy)} under the last buy).`,
                },
              ]
            : []),
        ]
      : [],
  };
}

export function viewForWindow(session: string[], preset: WindowId): { start: number; end: number } {
  const n = session.length;
  if (n === 0) return { start: 0, end: 0 };
  if (preset === "All") return { start: 0, end: n };
  const count = preset === "1D" ? 1 : preset === "5D" ? 5 : 21;
  return { start: lastSessionsStart(session, count), end: n };
}

export function lastSessionsStart(keys: string[], count: number): number {
  const n = keys.length;
  if (!n) return 0;
  let seen = 0;
  let current = keys[n - 1];
  let start = n - 1;
  for (let i = n - 1; i >= 0; i--) {
    if (keys[i] !== current) {
      seen += 1;
      if (seen >= count) return i + 1;
      current = keys[i];
    }
    start = i;
  }
  return start;
}

export function emptyStats(startingCash: number): Stats {
  return {
    strategyReturnPct: 0,
    buyHoldReturnPct: 0,
    differencePct: 0,
    roundTrips: 0,
    skipped: 0,
    maxDrawdownPct: 0,
    endingEquity: startingCash,
    buyHoldEquity: startingCash,
    skippedByReason: {},
  };
}
