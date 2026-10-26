import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import * as Switch from "@radix-ui/react-switch";
import * as Checkbox from "@radix-ui/react-checkbox";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { ChartPane } from "@/components/desk/chart-pane";
import { AlpacaPanel } from "@/components/desk/alpaca-panel";
import { explainAt, simulate, viewForWindow, type Explain, type Fill, type SimResult, type Stats, type StrategyRead } from "@/lib/desk/engine";
import { barIndexAt, bookCash, closedBarIndex, drawdownPct, equityOnBars, nextAccountSignal, openingPosition, roundTrips, seriesReturnPct, unfilledMarks } from "@/lib/desk/alpaca";
import { alpacaBars } from "@/lib/desk/session-api";
import type { AlpacaLook } from "@/lib/desk/alpaca-api";
import {
  DELAYS,
  EMA_RELS,
  INTERVALS,
  STRATEGY_ORDER,
  asJoin,
  barDuration,
  clauseProblem,
  cleanMatrix,
  dedupeMembers,
  defaultAccount,
  defaultParams,
  delayOf,
  deskColors,
  formatMoney,
  formatPct,
  formatPx,
  formatQty,
  formatSignedPx,
  formatWhen,
  hourKey,
  laneLabel,
  normalizeJoins,
  relationPhrase,
  ruleSideOn,
  sessionDate,
  sessionKey,
  strategyName,
  strategyShort,
  type AccountSettings,
  type DelayId,
  type DeskParams,
  type EmaClause,
  type EmaMember,
  type EmaOp,
  type EmaRelId,
  type EmaSlot,
  type EmaUnit,
  type Interval,
  type LevelRule,
  type MatrixGroup,
  type SideMatrix,
  type SideRule,
  type SlopeRule,
  type StrategyId,
  type VolumeRule,
  type WindowId,
} from "@/lib/desk/model";
import { buildSampleTape } from "@/lib/desk/sample";
import { fetchTape, type Tape } from "@/lib/desk/tape";
import { GUIDE_PATH, PRODUCT_VERSION, STRATEGIES_PATH } from "@/lib/desk/version";
import { applyUnlock, issueUnlock, readUnlock, strategiesOff, UNLOCK_KIND, type AllowId, type UnlockFile } from "@/lib/desk/unlock";
import { issueLiveArm, liveFileName } from "@/lib/desk/alpaca";
import { previewPathPrefix } from "@/lib/preview-path-prefix";

const STORE_KEY = "strategy-desk-settings-v4";
const BOOKS_KEY = "strategy-desk-books-v1";
const UNLOCK_KEY = "strategy-desk-unlock-v1";
/** This workspace is the master desk. A distributed copy has no VITE_DESK_EDITION, so it will not fire a strategy until an unlock file is loaded. */
const EDITION = import.meta.env.VITE_DESK_EDITION === "master" ? "master" : "desk";

type SavedBook = {
  id: string;
  name: string;
  params: unknown;
  account: unknown;
};

function readBooks(): SavedBook[] {
  try {
    const raw = JSON.parse(localStorage.getItem(BOOKS_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    const out: SavedBook[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const name = typeof row.name === "string" ? row.name.trim().slice(0, 40) : "";
      const id = typeof row.id === "string" && /^[A-Za-z0-9_-]{1,16}$/.test(row.id) ? row.id : "";
      if (!name || !id) continue;
      if (out.some((book) => book.id === id || book.name.toLowerCase() === name.toLowerCase())) continue;
      out.push({ id, name, params: row.params, account: row.account });
      if (out.length >= 24) break;
    }
    return out;
  } catch {
    return [];
  }
}
const BASELINE_ID = "soxl-5m-band-v2";
const bootId = `${BASELINE_ID}:${Math.random()}`;

function sampleSeries(values: number[], max = 480): number[] {
  if (values.length <= max) return values;
  const out: number[] = [];
  const step = (values.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(values[Math.round(i * step)]);
  return out;
}

function linePath(values: number[], lo: number, hi: number, width: number, height: number): string {
  const span = hi - lo || 1;
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
      const y = height - ((value - lo) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join("");
}

function EquityCurve({ strategy, hold }: { strategy: number[]; hold: number[] }) {
  const n = Math.min(strategy.length, hold.length);
  if (n < 2) return null;
  const cash = sampleSeries(strategy.slice(0, n));
  const gray = sampleSeries(hold.slice(0, n));
  let lo = Infinity;
  let hi = -Infinity;
  for (const value of cash) {
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
  }
  for (const value of gray) {
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
  }
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad;
  hi += pad;
  const width = 640;
  const height = 112;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-28 w-full" role="img" aria-label="Cash account versus buy and hold">
      <path d={linePath(gray, lo, hi, width, height)} fill="none" stroke="#b7b1a8" strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
      <path d={linePath(cash, lo, hi, width, height)} fill="none" stroke={deskColors.bronze} strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function tone(n: number): string {
  if (n > 0.0005) return "text-buy";
  if (n < -0.0005) return "text-sell";
  return "text-paper";
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNum(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mergeClause(base: EmaClause, saved: unknown): EmaClause {
  if (!saved || typeof saved !== "object") return base;
  const raw = saved as Record<string, unknown>;
  const allowed = new Set<EmaMember>(["close", "fast", "mid", "slow"]);
  let members = base.members;
  if (Array.isArray(raw.members)) {
    const next: EmaMember[] = [];
    for (const item of raw.members) {
      if (typeof item === "string" && allowed.has(item as EmaMember) && !next.includes(item as EmaMember)) next.push(item as EmaMember);
    }
    members = next;
  }
  const op: EmaOp = raw.op === "touch" || raw.op === "gap" || raw.op === "rank" ? raw.op : base.op;
  const unit = (value: unknown, fallback: EmaUnit): EmaUnit => (value === "usd" || value === "pct" ? value : fallback);
  return {
    op,
    members,
    sellMirror: asBool(raw.sellMirror, base.sellMirror),
    tol: asNum(raw.tol, base.tol),
    tolUnit: unit(raw.tolUnit, base.tolUnit),
    gapMode: raw.gapMode === "tight" || raw.gapMode === "wide" ? raw.gapMode : base.gapMode,
    gap: asNum(raw.gap, base.gap),
    gapUnit: unit(raw.gapUnit, base.gapUnit),
  };
}

function mergeSlot(base: EmaSlot, saved: unknown): EmaSlot {
  const sides = mergeSides(base, saved);
  const clause = mergeClause(base.clause, saved && typeof saved === "object" ? (saved as { clause?: unknown }).clause : undefined);
  return { ...sides, clause };
}

function mergeLevel(base: LevelRule, saved: unknown): LevelRule {
  const merged = mergeSides(base, saved);
  const raw = saved && typeof saved === "object" ? (saved as Record<string, unknown>) : {};
  const legacy = typeof raw.pct === "number" ? raw.pct : null;
  return {
    ...merged,
    buyPct: typeof raw.buyPct === "number" ? raw.buyPct : (legacy ?? base.buyPct),
    sellPct: typeof raw.sellPct === "number" ? raw.sellPct : (legacy ?? base.sellPct),
  };
}

function mergeSlope(base: SlopeRule, saved: unknown): SlopeRule {
  const merged = mergeSides(base, saved);
  const raw = saved && typeof saved === "object" ? (saved as Record<string, unknown>) : {};
  const legacy = typeof raw.floor === "number" ? raw.floor : null;
  return {
    ...merged,
    bars: typeof raw.bars === "number" ? raw.bars : base.bars,
    buyFloor: typeof raw.buyFloor === "number" ? raw.buyFloor : (legacy ?? base.buyFloor),
    sellFloor: typeof raw.sellFloor === "number" ? raw.sellFloor : legacy == null ? base.sellFloor : -legacy,
  };
}

function mergeVolume(base: VolumeRule, saved: unknown): VolumeRule {
  const merged = mergeSides(base, saved);
  const raw = saved && typeof saved === "object" ? (saved as Record<string, unknown>) : {};
  const legacy = typeof raw.mult === "number" ? raw.mult : null;
  return {
    ...merged,
    length: typeof raw.length === "number" ? raw.length : base.length,
    buyMult: typeof raw.buyMult === "number" ? raw.buyMult : (legacy ?? base.buyMult),
    sellMult: typeof raw.sellMult === "number" ? raw.sellMult : (legacy ?? base.sellMult),
  };
}

function mergeMatrix(base: SideMatrix, saved: unknown): SideMatrix {
  if (!saved || typeof saved !== "object") return cleanMatrix(base);
  const raw = saved as { on?: unknown; groups?: unknown };
  const groups = Array.isArray(raw.groups)
    ? raw.groups.map((group, index) => {
        const item = (group ?? {}) as { id?: unknown; members?: unknown };
        const members = Array.isArray(item.members) ? item.members.filter((id): id is StrategyId => typeof id === "string") : [];
        return { id: typeof item.id === "string" ? item.id : `g${index + 1}`, members };
      })
    : base.groups;
  return cleanMatrix({ on: typeof raw.on === "boolean" ? raw.on : base.on, groups });
}

function mergeSides<T extends SideRule>(base: T, saved: unknown): T {
  if (!saved || typeof saved !== "object") return base;
  const raw = saved as Record<string, unknown>;
  const next = { ...base };
  for (const key of Object.keys(base) as (keyof T)[]) {
    if (key === "buyOn" || key === "sellOn") continue;
    const incoming = raw[key as string];
    if (typeof incoming === typeof base[key]) next[key] = incoming as T[keyof T];
  }
  if (typeof raw.buyOn === "boolean") next.buyOn = raw.buyOn;
  if (typeof raw.sellOn === "boolean") next.sellOn = raw.sellOn;
  else if (typeof raw.buyOn !== "boolean" && typeof raw.enabled === "boolean") {
    next.buyOn = raw.enabled;
    next.sellOn = raw.enabled;
  }
  return next;
}

function mergeRti(base: DeskParams["rti"], saved: unknown): DeskParams["rti"] {
  if (!saved || typeof saved !== "object") return base;
  const raw = saved as Record<string, unknown>;
  return {
    length: asNum(raw.length, base.length),
    mult: asNum(raw.mult, base.mult),
    smooth: asNum(raw.smooth, base.smooth),
    direction: mergeSides(base.direction, raw.direction),
    strength: (() => {
      const merged = mergeSides(base.strength, raw.strength);
      const node = raw.strength && typeof raw.strength === "object" ? (raw.strength as Record<string, unknown>) : {};
      const legacy = typeof node.floor === "number" ? node.floor : null;
      return {
        ...merged,
        buyFloor: typeof node.buyFloor === "number" ? node.buyFloor : (legacy ?? base.strength.buyFloor),
        sellFloor: typeof node.sellFloor === "number" ? node.sellFloor : (legacy ?? base.strength.sellFloor),
      };
    })(),
    line: mergeSides(base.line, raw.line),
    negative: mergeSides(base.negative, raw.negative),
    reversal: (() => {
      const merged = mergeSides(base.reversal, raw.reversal);
      const node = raw.reversal && typeof raw.reversal === "object" ? (raw.reversal as Record<string, unknown>) : {};
      return { ...merged, bars: typeof node.bars === "number" ? node.bars : base.reversal.bars };
    })(),
    below: mergeSides(base.below, raw.below),
    above: mergeSides(base.above, raw.above),
  };
}

function migrateLegacy(saved: Record<string, unknown>, base: DeskParams): DeskParams {
  const band = (saved.band ?? {}) as Record<string, unknown>;
  const flow = (saved.mfi ?? {}) as Record<string, unknown>;
  const trend = (saved.trend ?? {}) as Record<string, unknown>;
  const through = asNum(band.throughPct, 0);
  const dropRaw = (saved.drop ?? {}) as Record<string, unknown>;
  return normalizeJoins({
    ...base,
    bands: {
      length: asNum(band.length, base.bands.length),
      mult: asNum(band.mult, base.bands.mult),
    },
    lower: { ...base.lower, buyPct: 100 - through, sellPct: 100 - through },
    upper: { ...base.upper, buyPct: 100 + through, sellPct: 100 + through },
    slope: {
      ...base.slope,
      buyFloor: asNum(band.slopeFloor, base.slope.buyFloor),
      sellFloor: -asNum(band.slopeFloor, -base.slope.sellFloor),
      bars: asNum(band.slopeBars, base.slope.bars),
    },
    volume: {
      ...base.volume,
      buyMult: asNum(band.volMult, base.volume.buyMult),
      sellMult: asNum(band.volMult, base.volume.sellMult),
      length: asNum(band.volLength, base.volume.length),
    },
    rsi: {
      ...base.rsi,
      length: asNum(band.rsiLength, base.rsi.length),
      buyLevel: asNum(band.rsiBuy, base.rsi.buyLevel),
      sellLevel: asNum(band.rsiSell, base.rsi.sellLevel),
    },
    mfi: {
      ...base.mfi,
      length: asNum(flow.length, base.mfi.length),
      buyLevel: asNum(flow.buyLevel, base.mfi.buyLevel),
      sellLevel: asNum(flow.sellLevel, base.mfi.sellLevel),
    },
    trend: {
      ...base.trend,
      hours: asNum(trend.hours, base.trend.hours),
      slope: {
        ...base.trend.slope,
        buyFloor: asNum(trend.slopeFloor, base.trend.slope.buyFloor),
        sellFloor: -asNum(trend.slopeFloor, -base.trend.slope.sellFloor),
      },
    },
    step: mergeSides(base.step, saved.step),
    drop: {
      ...base.drop,
      sellOn: asBool(dropRaw.sellOn, asBool(dropRaw.enabled, base.drop.sellOn)),
      dropPct: asNum(dropRaw.dropPct, base.drop.dropPct),
      recoverPct: asNum(dropRaw.recoverPct, base.drop.recoverPct),
    },
  });
}

function mergeParams(value: unknown): DeskParams {
  const base = defaultParams();
  if (!value || typeof value !== "object") return base;
  const saved = value as Record<string, unknown>;
  if (saved.band && typeof saved.band === "object" && !saved.lower) return migrateLegacy(saved, base);
  const trendSaved = saved.trend;
  let trend = base.trend;
  if (trendSaved && typeof trendSaved === "object") {
    const raw = trendSaved as Record<string, unknown>;
    trend = {
      hours: asNum(raw.hours, base.trend.hours),
      slope: (() => {
        const merged = mergeSides(base.trend.slope, raw.slope);
        const node = raw.slope && typeof raw.slope === "object" ? (raw.slope as Record<string, unknown>) : {};
        const legacy = typeof node.floor === "number" ? node.floor : null;
        return {
          ...merged,
          buyFloor: typeof node.buyFloor === "number" ? node.buyFloor : (legacy ?? base.trend.slope.buyFloor),
          sellFloor: typeof node.sellFloor === "number" ? node.sellFloor : legacy == null ? base.trend.slope.sellFloor : -legacy,
        };
      })(),
      line: mergeSides(base.trend.line, raw.line),
    };
  }
  const dropSaved = saved.drop;
  let drop = base.drop;
  if (dropSaved && typeof dropSaved === "object") {
    const raw = dropSaved as Record<string, unknown>;
    drop = {
      dropPct: asNum(raw.dropPct, base.drop.dropPct),
      recoverPct: asNum(raw.recoverPct, base.drop.recoverPct),
      sellOn: asBool(raw.sellOn, asBool(raw.enabled, base.drop.sellOn)),
    };
  }
  return normalizeJoins({
    bands: {
      length: asNum((saved.bands as { length?: number } | undefined)?.length, base.bands.length),
      mult: asNum((saved.bands as { mult?: number } | undefined)?.mult, base.bands.mult),
    },
    lower: mergeLevel(base.lower, saved.lower),
    upper: mergeLevel(base.upper, saved.upper),
    slope: mergeSlope(base.slope, saved.slope),
    volume: mergeVolume(base.volume, saved.volume),
    rsi: mergeSides(base.rsi, saved.rsi),
    mfi: mergeSides(base.mfi, saved.mfi),
    rti: mergeRti(base.rti, saved.rti),
    vwap: mergeSides(base.vwap, saved.vwap),
    vwapPx: mergeSides(base.vwapPx, saved.vwapPx),
    ema20: mergeSides(base.ema20, saved.ema20),
    ema50: mergeSides(base.ema50, saved.ema50),
    ema100: mergeSides(base.ema100, saved.ema100),
    emaA: mergeSlot(base.emaA, saved.emaA),
    emaB: mergeSlot(base.emaB, saved.emaB),
    emaC: mergeSlot(base.emaC, saved.emaC),
    trend,
    step: mergeSides(base.step, saved.step),
    drop,
    matrix: {
      buy: mergeMatrix(base.matrix.buy, (saved.matrix as { buy?: unknown } | undefined)?.buy),
      sell: mergeMatrix(base.matrix.sell, (saved.matrix as { sell?: unknown } | undefined)?.sell),
    },
  });
}

function mergeAccount(value: unknown): AccountSettings {
  const base = defaultAccount();
  if (!value || typeof value !== "object") return base;
  const saved = value as Partial<AccountSettings>;
  const delay = DELAYS.some((item) => item.id === saved.delay) ? (saved.delay as DelayId) : base.delay;
  return { ...base, ...saved, delay, fromDate: sessionDate(saved.fromDate), toDate: sessionDate(saved.toDate) };
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <input
        className="desk-input"
        type="number"
        inputMode="decimal"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => {
          const next = event.target.value === "" ? 0 : Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

function RuleSwitch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
      className="relative h-8 w-14 shrink-0 rounded-full bg-line outline-none focus-visible:ring-2 focus-visible:ring-bronze data-[state=checked]:bg-bronze"
    >
      <Switch.Thumb className="desk-thumb absolute top-1 left-0 block size-6 translate-x-1 rounded-full bg-paper transition-transform duration-150 data-[state=checked]:translate-x-7" />
    </Switch.Root>
  );
}

function SideSwitch({
  side,
  checked,
  label,
  join,
  onChange,
  onJoin,
}: {
  side: "buy" | "sell";
  checked: boolean;
  label: string;
  join?: "and" | "or";
  onChange: (on: boolean) => void;
  onJoin?: (join: "and" | "or") => void;
}) {
  const word = side === "buy" ? "Buy" : "Sell";
  return (
    <div className="flex items-center gap-2">
      <span className={`w-8 text-xs font-medium ${side === "buy" ? "text-buy" : "text-sell"}`}>{word}</span>
      {onJoin && (
        <div className="flex h-8 overflow-hidden rounded-sm border border-line" role="group" aria-label={`${label} combination`}>
          {(["and", "or"] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={join === id}
              title={id === "and" ? `${word} must pass with the other AND rules` : `${word} can pass on its own`}
              className={`px-1.5 text-[11px] font-medium tracking-wide ${join === id ? "bg-bronze text-ink" : "text-muted"}`}
              onClick={() => onJoin(id)}
            >
              {id === "and" ? "AND" : "OR"}
            </button>
          ))}
        </div>
      )}
      <RuleSwitch checked={checked} label={label} onChange={onChange} />
    </div>
  );
}

function RuleCard({
  title,
  blurb,
  rule,
  onRule,
  note,
  children,
}: {
  title: string;
  blurb: string;
  rule: SideRule;
  onRule: (patch: Partial<Pick<SideRule, "buyOn" | "sellOn" | "buyJoin" | "sellJoin">>) => void;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <article className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="min-w-0 flex-1 text-sm font-medium text-pretty">{title}</h3>
        <div className="flex shrink-0 flex-col gap-2">
          <SideSwitch
            side="buy"
            checked={rule.buyOn}
            join={asJoin(rule.buyJoin)}
            label={`${title} buy`}
            onChange={(buyOn) => onRule({ buyOn })}
            onJoin={(buyJoin) => onRule({ buyJoin })}
          />
          <SideSwitch
            side="sell"
            checked={rule.sellOn}
            join={asJoin(rule.sellJoin)}
            label={`${title} sell`}
            onChange={(sellOn) => onRule({ sellOn })}
            onJoin={(sellJoin) => onRule({ sellJoin })}
          />
        </div>
      </div>
      <p className="mt-2 text-sm text-muted text-pretty">{blurb}</p>
      {note && <p className="mt-2 text-xs text-bronze">{note}</p>}
      {children && <div className="mt-3 grid grid-cols-2 gap-3">{children}</div>}
    </article>
  );
}

const MEMBERS: EmaMember[] = ["close", "fast", "mid", "slow"];

function moveMember(members: EmaMember[], index: number, dir: -1 | 1): EmaMember[] {
  const next = members.slice();
  const to = index + dir;
  if (to < 0 || to >= next.length) return members;
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item);
  return next;
}

function RelationCard({
  id,
  slot,
  params,
  onChange,
}: {
  id: EmaRelId;
  slot: EmaSlot;
  params: DeskParams;
  onChange: (slot: EmaSlot) => void;
}) {
  const letter = id === "emaA" ? "A" : id === "emaB" ? "B" : "C";
  const clause = slot.clause;
  const members = dedupeMembers(clause.members);
  const problem = clauseProblem(clause);
  const setClause = (patch: Partial<EmaClause>) => onChange({ ...slot, clause: { ...clause, ...patch } });
  const label = (member: EmaMember) => laneLabel(member, params);
  return (
    <article className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-widest text-bronze">RELATION {letter}</p>
          <h3 className="mt-1 text-sm font-medium text-pretty">{relationPhrase(clause, params, "buy")}</h3>
          {clause.op === "rank" && clause.sellMirror && (
            <p className="mt-1 text-xs text-muted text-pretty">Sell: {relationPhrase(clause, params, "sell")}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <SideSwitch
            side="buy"
            checked={slot.buyOn}
            join={asJoin(slot.buyJoin)}
            label={`Relation ${letter} buy`}
            onChange={(buyOn) => onChange({ ...slot, buyOn })}
            onJoin={(buyJoin) => onChange({ ...slot, buyJoin })}
          />
          <SideSwitch
            side="sell"
            checked={slot.sellOn}
            join={asJoin(slot.sellJoin)}
            label={`Relation ${letter} sell`}
            onChange={(sellOn) => onChange({ ...slot, sellOn })}
            onJoin={(sellJoin) => onChange({ ...slot, sellJoin })}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(
          [
            ["rank", "Rank"],
            ["touch", "Touch"],
            ["gap", "Gap"],
          ] as const
        ).map(([op, name]) => (
          <button key={op} type="button" className="desk-chip" data-on={clause.op === op} onClick={() => setClause({ op })}>
            {name}
          </button>
        ))}
      </div>
      {clause.op === "rank" ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs text-muted">Order from highest to lowest.</p>
          {members.map((member, index) => (
            <div key={member} className="flex items-center gap-2">
              <span className="min-w-16 font-mono text-sm">{label(member)}</span>
              {index < members.length - 1 && <span className="text-xs text-muted">above</span>}
              <span className="ml-auto flex gap-1">
                <button
                  type="button"
                  className="flex size-11 items-center justify-center rounded-sm border border-line"
                  aria-label={`Move ${label(member)} up`}
                  onClick={() => setClause({ members: moveMember(members, index, -1) })}
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  className="flex size-11 items-center justify-center rounded-sm border border-line"
                  aria-label={`Move ${label(member)} down`}
                  onClick={() => setClause({ members: moveMember(members, index, 1) })}
                >
                  <ChevronDown className="size-4" />
                </button>
                <button
                  type="button"
                  className="flex size-11 items-center justify-center rounded-sm border border-line"
                  aria-label={`Remove ${label(member)}`}
                  onClick={() => setClause({ members: members.filter((item) => item !== member) })}
                >
                  <X className="size-4" />
                </button>
              </span>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {MEMBERS.filter((member) => !members.includes(member)).map((member) => (
              <button key={member} type="button" className="desk-chip" onClick={() => setClause({ members: [...members, member] })}>
                Add {label(member)}
              </button>
            ))}
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <Checkbox.Root
              checked={clause.sellMirror}
              onCheckedChange={(value) => setClause({ sellMirror: value === true })}
              className="flex size-6 items-center justify-center rounded-sm border border-line bg-ink text-ink outline-none focus-visible:ring-2 focus-visible:ring-bronze data-[state=checked]:border-bronze data-[state=checked]:bg-bronze"
              aria-label={`Relation ${letter} sell uses the reverse order`}
            >
              <Checkbox.Indicator>
                <Check className="size-4" strokeWidth={2.5} />
              </Checkbox.Indicator>
            </Checkbox.Root>
            Sell uses the reverse order
          </label>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-muted">
            {clause.op === "touch"
              ? "One average means the close is within the tolerance of that line. Two or three means those lines sit inside the tolerance of each other."
              : "One average measures close versus that line. Two or three measure the spread from the highest selected line to the lowest."}
          </p>
          <div className="flex flex-wrap gap-2">
            {MEMBERS.map((member) => (
              <button
                key={member}
                type="button"
                className="desk-chip"
                data-on={members.includes(member)}
                onClick={() => setClause({ members: members.includes(member) ? members.filter((item) => item !== member) : [...members, member] })}
              >
                {label(member)}
              </button>
            ))}
          </div>
          {clause.op === "gap" && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="desk-chip" data-on={clause.gapMode === "wide"} onClick={() => setClause({ gapMode: "wide" })}>
                Wider than
              </button>
              <button type="button" className="desk-chip" data-on={clause.gapMode === "tight"} onClick={() => setClause({ gapMode: "tight" })}>
                Tighter than
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <NumField
              label={clause.op === "touch" ? "Tolerance" : "Gap"}
              value={clause.op === "touch" ? clause.tol : clause.gap}
              step={clause.op === "touch" ? (clause.tolUnit === "usd" ? 0.01 : 0.05) : clause.gapUnit === "usd" ? 0.01 : 0.05}
              onChange={(value) => (clause.op === "touch" ? setClause({ tol: value }) : setClause({ gap: value }))}
            />
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-xs text-muted">Unit</span>
              <select
                className="desk-input"
                aria-label={clause.op === "touch" ? "Tolerance unit" : "Gap unit"}
                value={clause.op === "touch" ? clause.tolUnit : clause.gapUnit}
                onChange={(event) => {
                  const unit = event.target.value === "usd" ? "usd" : "pct";
                  if (clause.op === "touch") setClause({ tolUnit: unit });
                  else setClause({ gapUnit: unit });
                }}
              >
                <option value="pct">Percent</option>
                <option value="usd">Dollars</option>
              </select>
            </label>
          </div>
        </div>
      )}
      {problem && (slot.buyOn || slot.sellOn) && <p className="mt-2 text-xs text-bronze">{problem}</p>}
    </article>
  );
}

function canonical(value: unknown): string {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const src = node as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(src).sort()) out[key] = walk(src[key]);
      return out;
    }
    return node;
  };
  return JSON.stringify(walk(value));
}

function MatrixEditor({
  side,
  params,
  onChange,
}: {
  side: "buy" | "sell";
  params: DeskParams;
  onChange: (next: SideMatrix) => void;
}) {
  const matrix = side === "buy" ? params.matrix.buy : params.matrix.sell;
  const columns = STRATEGY_ORDER.filter((id) => id !== "drop" && ruleSideOn(params, id, side));
  const setGroups = (groups: MatrixGroup[]) => onChange({ ...matrix, groups });
  const addRow = (members: StrategyId[]) => {
    if (matrix.groups.length >= 8) return;
    const id = `g${Math.random().toString(36).slice(2, 7)}`;
    setGroups([...matrix.groups, { id, members }]);
  };
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-sm font-medium">{side === "buy" ? "Buy rows" : "Sell rows"}</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Use rows</span>
          <RuleSwitch checked={matrix.on} label={`${side === "buy" ? "Buy" : "Sell"} matrix`} onChange={(on) => onChange({ ...matrix, on })} />
        </div>
      </div>
      <p className="mt-2 text-sm text-muted text-pretty">
        Each row is an AND of the marked rules. A blank cell is ignored. Any high row fires this side. While this is on, the AND/OR switches on the cards are ignored. No rows means nothing fills.
      </p>
      {columns.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Turn a {side} switch on to give this table a column.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="border-collapse text-left text-xs">
            <thead>
              <tr>
                <th className="px-1 py-1 font-medium text-muted">Row</th>
                {columns.map((id) => (
                  <th key={id} className="px-1 py-1 font-medium text-muted">
                    <span className="block max-w-16 truncate">{strategyShort(id, params)}</span>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {matrix.groups.map((group, index) => (
                <tr key={group.id}>
                  <th className="px-1 py-1 text-left font-mono font-medium">G{index + 1}</th>
                  {columns.map((id) => {
                    const marked = group.members.includes(id);
                    return (
                      <td key={id} className="px-1 py-1">
                        <button
                          type="button"
                          className="flex size-11 items-center justify-center rounded-sm border border-line"
                          data-on={marked}
                          aria-pressed={marked}
                          aria-label={`${strategyShort(id, params)} in ${side} row ${index + 1}`}
                          onClick={() =>
                            setGroups(
                              matrix.groups.map((item) =>
                                item.id === group.id
                                  ? { ...item, members: marked ? item.members.filter((member) => member !== id) : [...item.members, id] }
                                  : item,
                              ),
                            )
                          }
                        >
                          {marked ? <Check className="size-4" strokeWidth={2.5} /> : null}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      className="flex size-11 items-center justify-center rounded-sm border border-line"
                      aria-label={`Remove ${side} row ${index + 1}`}
                      onClick={() => setGroups(matrix.groups.filter((item) => item.id !== group.id))}
                    >
                      <X className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="desk-chip" disabled={matrix.groups.length >= 8} onClick={() => addRow([])}>
          Add row
        </button>
        <button type="button" className="desk-chip" disabled={matrix.groups.length >= 8 || columns.length === 0} onClick={() => addRow(columns)}>
          Add every rule that is on
        </button>
      </div>
    </div>
  );
}

function combinationCopy(side: "buy" | "sell", explain: Explain, params: DeskParams): string {
  const label = side === "buy" ? "Buy" : "Sell";
  const matrix = side === "buy" ? params.matrix.buy : params.matrix.sell;
  if (matrix.on) {
    if (!matrix.groups.length) return `${label} matrix is on and has no rows, so nothing fills.`;
    const byId = new Map(explain.strategies.map((item) => [item.id, item]));
    const rows = matrix.groups.map((group, index) => {
      const reads = group.members.map((id) => byId.get(id));
      const names = group.members.map((id) => strategyShort(id, params));
      const pass =
        group.members.length > 0 &&
        reads.every((item) => item && (side === "buy" ? item.buyOn && item.buyVoting !== false && item.wantBuy : item.sellOn && item.sellVoting !== false && item.wantSell));
      return `G${index + 1} ${names.length ? names.join(" and ") : "empty"} ${pass ? "high" : "low"}`;
    });
    const high = rows.filter((row) => row.endsWith("high"));
    return high.length ? `${label} matrix: ${high.join("; ")}. Any high row fires.` : `${label} matrix: ${rows.join("; ")}. No row fired.`;
  }
  const on = explain.strategies.filter((item) => item.id !== "drop" && (side === "buy" ? item.buyOn : item.sellOn));
  if (!on.length) return `No ${side} rules are on.`;
  const waiting = on.filter((item) => (side === "buy" ? item.buyVoting === false : item.sellVoting === false));
  const voting = on.filter((item) => (side === "buy" ? item.buyVoting !== false : item.sellVoting !== false));
  const joinOf = (item: StrategyRead) => asJoin(side === "buy" ? item.buyJoin : item.sellJoin);
  const passed = (item: StrategyRead) => (side === "buy" ? item.wantBuy : item.wantSell);
  const ands = voting.filter((item) => joinOf(item) !== "or");
  const ors = voting.filter((item) => joinOf(item) === "or");
  const andFailed = ands.filter((item) => !passed(item));
  const orPassed = ors.filter((item) => passed(item));
  const ready = side === "buy" ? explain.buyReady : explain.sellReady;
  const parts: string[] = [];
  if (!voting.length) {
    parts.push(`${label} rules are waiting and not in the test.`);
  } else if (ready && ands.length > 0 && andFailed.length === 0) {
    const extra = orPassed.length ? ` ${orPassed.map((item) => item.name).join(", ")} also passed as OR.` : "";
    parts.push(`${label} combination passed. Every AND rule agreed.${extra}`);
  } else if (ready) {
    parts.push(`${label} combination passed because ${orPassed.map((item) => item.name).join(", ")} passed as OR.`);
  } else {
    if (andFailed.length) parts.push(`${label} AND still needed: ${andFailed.map((item) => item.name).join(", ")}.`);
    if (ors.length > 0) parts.push("No OR rule passed.");
  }
  if (waiting.length && voting.length) parts.push(`Waiting, not in the test: ${waiting.map((item) => item.name).join(", ")}.`);
  return parts.join(" ");
}

function acceptUnlock(value: unknown): UnlockFile | null {
  const read = readUnlock(value);
  if (!read) return null;
  return { kind: UNLOCK_KIND, tester: read.tester, issued: read.issued, allow: read.allow, params: mergeParams(read.params) };
}

export function DeskApp() {
  const loadTape = useServerFn(fetchTape);
  const loadBars = useServerFn(alpacaBars);
  const loadRef = useRef(loadTape);
  loadRef.current = loadTape;
  const [ready, setReady] = useState(false);
  const [symbol, setSymbol] = useState("SOXL");
  const [draft, setDraft] = useState("SOXL");
  const [interval, setInterval] = useState<Interval>("5m");
  const [reload, setReload] = useState(0);
  const [params, setParams] = useState<DeskParams>(defaultParams);
  const [runParams, setRunParams] = useState<DeskParams>(defaultParams);
  const [account, setAccount] = useState<AccountSettings>(defaultAccount);
  const [runAccount, setRunAccount] = useState<AccountSettings>(defaultAccount);
  const [tape, setTape] = useState<Tape | null>(null);
  const [loading, setLoading] = useState(true);
  const [book, setBook] = useState<"play" | "live">("play");
  const [accountView, setAccountView] = useState<AlpacaLook | null>(null);
  const accountKind = accountView ? (accountView.paper ? "paper" : "live-host") : "off";
  const [windowId, setWindowId] = useState<WindowId | null>("5D");
  const [view, setView] = useState({ start: 0, end: 0 });
  const [selected, setSelected] = useState<number | null>(null);
  const [books, setBooks] = useState<SavedBook[]>([]);
  const [bookName, setBookName] = useState("");
  const [pickedBook, setPickedBook] = useState("");
  const [booksReady, setBooksReady] = useState(false);
  const [unlock, setUnlock] = useState<UnlockFile | null>(null);
  const [testerName, setTesterName] = useState("");
  const [allow, setAllow] = useState<AllowId[]>([]);
  const [unlockError, setUnlockError] = useState("");

  useEffect(() => {
    if (accountKind !== "off") setBook("live");
  }, [accountKind]);

  useEffect(() => {
    const applyBaseline = () => {
      const nextParams = defaultParams();
      const nextAccount = defaultAccount();
      setSymbol("SOXL");
      setDraft("SOXL");
      setInterval("5m");
      setParams(nextParams);
      setRunParams(nextParams);
      setAccount(nextAccount);
      setRunAccount(nextAccount);
    };
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          baseline?: string;
          symbol?: string;
          interval?: Interval;
          params?: unknown;
          account?: unknown;
        };
        if (saved.baseline === BASELINE_ID) {
          if (!ready) {
            if (saved.symbol) {
              setSymbol(saved.symbol);
              setDraft(saved.symbol);
            }
            if (saved.interval && INTERVALS.some((item) => item.id === saved.interval)) setInterval(saved.interval);
            const nextParams = mergeParams(saved.params);
            const nextAccount = mergeAccount(saved.account);
            setParams(nextParams);
            setRunParams(nextParams);
            setAccount(nextAccount);
            setRunAccount(nextAccount);
          }
          setReady(true);
          return;
        }
      }
    } catch {
      /* replace with the baseline */
    }
    applyBaseline();
    setReady(true);
  }, [bootId]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORE_KEY, JSON.stringify({ baseline: BASELINE_ID, symbol, interval, params, account }));
  }, [ready, symbol, interval, params, account]);

  useEffect(() => {
    const next = readBooks();
    setBooks(next);
    setPickedBook(next[0]?.id ?? "");
    setBooksReady(true);
  }, []);

  useEffect(() => {
    if (!booksReady) return;
    localStorage.setItem(BOOKS_KEY, JSON.stringify(books));
  }, [books, booksReady]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(UNLOCK_KEY);
      if (!raw) return;
      const next = acceptUnlock(JSON.parse(raw));
      if (next) setUnlock(next);
    } catch {
      /* a bad saved file is the same as no file */
    }
  }, []);

  useEffect(() => {
    if (unlock) localStorage.setItem(UNLOCK_KEY, JSON.stringify(unlock));
    else localStorage.removeItem(UNLOCK_KEY);
  }, [unlock]);

  useEffect(() => {
    if (EDITION !== "desk" || !unlock) return;
    const sealed = applyUnlock(params, unlock);
    if (canonical(sealed) !== canonical(params)) setParams(sealed);
  }, [params, unlock]);

  useEffect(() => {
    if (!ready) return;
    let cancel = false;
    setLoading(true);
    loadRef.current({ data: { symbol, interval } })
      .then((next) => {
        if (cancel) return;
        setTape((current) => (current?.source === "alpaca" && current.symbol === next.symbol && current.interval === next.interval ? current : next));
      })
      .catch(() => {
        if (cancel) return;
        setTape({
          symbol,
          interval,
          source: "sample",
          notice: "Sample tape — market data unavailable",
          bars: buildSampleTape(symbol, interval),
        });
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [ready, symbol, interval, reload]);

  useEffect(() => {
    if (accountKind === "off") return;
    let cancel = false;
    loadBars({ data: { symbol, interval } })
      .then((next) => {
        if (!cancel && next.ok) setTape(next.tape);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [accountKind, symbol, interval, reload, loadBars]);

  const liveParams = useMemo(() => {
    if (EDITION === "master") return runParams;
    if (!unlock) return strategiesOff(runParams);
    return applyUnlock(runParams, unlock);
  }, [runParams, unlock]);
  const result = useMemo<SimResult | null>(
    () => (tape ? simulate(tape.bars, tape.interval, liveParams, runAccount) : null),
    [tape, liveParams, runAccount],
  );
  const dirty = canonical(params) !== canonical(runParams) || canonical(account) !== canonical(runAccount);

  const tapeKey = tape ? `${tape.symbol}|${tape.interval}|${tape.source}|${tape.bars.length}|${tape.bars[0]?.t ?? 0}` : "";
  const [viewTape, setViewTape] = useState("");
  if (tape && tapeKey !== viewTape) {
    setViewTape(tapeKey);
    setWindowId("1D");
    setView(viewForWindow(tape.bars.map((bar) => sessionKey(bar.t)), "1D"));
    setSelected(null);
  }

  const playStats: Stats | null = result?.stats ?? null;
  const last = result && result.rangeEnd > result.rangeStart ? result.trace[result.rangeEnd - 1] : null;
  const accountName = accountView?.paper === false ? "Live account" : "Paper account";
  const showingAccount = book === "live" && accountView != null;
  const accountFills = useMemo(() => {
    if (!tape || !accountView) return [] as (Fill & { id: string })[];
    const times = tape.bars.map((bar) => bar.t);
    const equity = equityOnBars(times, accountView.history);
    return accountView.fills.flatMap((fill) => {
      const index = barIndexAt(times, fill.time);
      if (index < 0) return [];
      const row: Fill & { id: string } = {
        id: fill.id,
        index,
        time: fill.time,
        side: fill.side,
        strategies: [],
        shares: fill.qty,
        price: fill.price,
        close: tape.bars[index].c,
        fee: 0,
        equityAfter: equity[index] > 0 ? equity[index] : accountView.equity,
      };
      return [row];
    });
  }, [tape, accountView]);
  const accountCurve = useMemo(() => {
    if (!tape || !result || !accountView) return [] as number[];
    return equityOnBars(
      tape.bars.slice(result.rangeStart, result.rangeEnd).map((bar) => bar.t),
      accountView.history,
    );
  }, [tape, result, accountView]);
  const shownFills = showingAccount ? accountFills : (result?.fills ?? []);
  const ledgerBook = useMemo(() => {
    if (!tape || !accountView || tape.source === "sample") return null;
    const times = tape.bars.map((bar) => bar.t);
    const fills = accountView.fills.flatMap((fill) => {
      const index = barIndexAt(times, fill.time);
      if (index < 0) return [];
      return [{ index, side: fill.side, price: fill.price, qty: fill.qty }];
    });
    const opening = openingPosition(accountView.fills, accountView.positionQty, accountView.avgEntry ?? 0);
    return simulate(tape.bars, tape.interval, liveParams, account, { openingQty: opening.qty, openingPrice: opening.price, fills });
  }, [tape, accountView, liveParams, account]);
  const closedIndex =
    tape && tape.source !== "sample" ? closedBarIndex(tape.bars.map((bar) => bar.t), barDuration(tape.interval), Date.now()) : -1;
  const signalRow = ledgerBook && closedIndex >= 0 ? ledgerBook.trace[closedIndex] : null;
  const accountSignal = accountView
    ? signalRow
      ? nextAccountSignal(accountView.positionQty, signalRow.signalBuy === true, signalRow.signalSell === true, signalRow.sellHold === true)
      : "none"
    : (last?.action ?? "none");
  const missed = useMemo(() => {
    if (!showingAccount || !tape || !accountView) return undefined;
    return unfilledMarks(accountView.orders, tape.bars.map((bar) => bar.t), accountFills);
  }, [showingAccount, tape, accountView, accountFills]);
  const readBook = showingAccount && ledgerBook ? ledgerBook : result;
  const since = accountView?.fills[0]?.time ?? accountView?.history[0]?.time ?? 0;

  useEffect(() => {
    if (!tape || tape.source === "sample" || !(since > 0)) return;
    const start = barIndexAt(
      tape.bars.map((bar) => bar.t),
      since,
    );
    if (start < 0) return;
    setWindowId(null);
    setView({ start, end: tape.bars.length });
  }, [accountKind, tapeKey, since, tape]);
  const explain =
    readBook && tape && selected != null && readBook.trace[selected]
      ? explainAt(selected, tape.bars, readBook.indicators, liveParams, tape.interval, readBook.trace[selected])
      : null;

  function submitSymbol(event: FormEvent) {
    event.preventDefault();
    const next = draft
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9.\-]/g, "")
      .slice(0, 12);
    if (!next) return;
    setDraft(next);
    setSymbol(next);
    setReload((n) => n + 1);
  }

  function recalculate() {
    setRunParams(params);
    setRunAccount(account);
  }

  function saveBook() {
    const name = bookName.trim().slice(0, 40);
    if (!name) return;
    const existing = books.find((book) => book.name.toLowerCase() === name.toLowerCase());
    const id = existing?.id ?? `b${Math.random().toString(36).slice(2, 8)}`;
    const next = { id, name, params, account };
    setBooks((prev) => [next, ...prev.filter((book) => book.id !== id)].slice(0, 24));
    setPickedBook(id);
    setBookName(name);
  }

  function recallBook() {
    const found = books.find((book) => book.id === pickedBook);
    if (!found) return;
    const nextParams = mergeParams(found.params);
    const nextAccount = mergeAccount(found.account);
    setParams(nextParams);
    setRunParams(nextParams);
    setAccount(nextAccount);
    setRunAccount(nextAccount);
    setBookName(found.name);
  }

  function removeBook() {
    const next = books.filter((book) => book.id !== pickedBook);
    setBooks(next);
    setPickedBook(next[0]?.id ?? "");
  }

  function jump(index: number) {
    if (!result) return;
    setBook("play");
    setSelected(index);
    setWindowId(null);
    const span = Math.max(40, view.end - view.start || 80);
    const n = result.indicators.session.length;
    let start = index - Math.floor(span / 2);
    if (start < 0) start = 0;
    if (start + span > n) start = Math.max(0, n - span);
    setView({ start, end: Math.min(n, start + span) });
    document.querySelector("[data-testid='chart']")?.scrollIntoView({ block: "nearest" });
  }

  const hoursOnTape = useMemo(() => {
    if (!tape || tape.interval === "1d") return 0;
    return new Set(tape.bars.map((bar) => hourKey(bar.t))).size;
  }, [tape]);
  const blocks: string[] = [];
  const relationLanes = (slot: DeskParams["emaA"]) =>
    (slot.buyOn || slot.sellOn ? dedupeMembers(slot.clause.members) : []).filter((member) => member !== "close");
  if (tape?.interval === "1d") {
    for (const node of [params.ema20, params.ema50, params.ema100]) {
      if (node.buyOn || node.sellOn) {
        blocks.push("Hourly moving averages are on, and a daily bar has no hourly close, so they block every fill.");
        break;
      }
    }
    if (EMA_RELS.some((id) => relationLanes(params[id]).length > 0)) {
      blocks.push("An EMA relation is on, and a daily bar has no hourly close, so it blocks every fill.");
    }
  } else if (hoursOnTape > 0) {
    for (const node of [params.ema20, params.ema50, params.ema100]) {
      if ((node.buyOn || node.sellOn) && hoursOnTape < node.hours) {
        blocks.push(`${Math.round(node.hours)}-hour EMA needs ${Math.round(node.hours)} hours and this tape has ${hoursOnTape}, so it blocks every fill.`);
      }
    }
    const laneHours = { fast: params.ema20.hours, mid: params.ema50.hours, slow: params.ema100.hours } as const;
    for (const id of EMA_RELS) {
      for (const member of relationLanes(params[id])) {
        const hours = laneHours[member];
        if (hoursOnTape < hours) {
          blocks.push(`${strategyName(id, params)} uses the ${Math.round(hours)}-hour EMA and this tape has ${hoursOnTape} hours, so it blocks every fill.`);
        }
      }
    }
  }
  if (tape?.interval === "1d" && (params.trend.slope.buyOn || params.trend.slope.sellOn || params.trend.line.buyOn || params.trend.line.sellOn)) {
    blocks.push("A trend test is on, and daily bars have no 4-hour window, so it blocks every fill.");
  }

  const openCards: ReactNode[] = [];
  const lockedCards: ReactNode[] = [];
  let holdCount = 0;
  const hold = (ids: AllowId[], node: ReactNode) => {
    const allowed = EDITION === "master" || (unlock != null && ids.some((id) => unlock.allow.includes(id)));
    (allowed ? openCards : lockedCards).push(
      <fieldset key={`${ids.join("-") || "sealed"}-${holdCount++}`} disabled={!allowed} className="m-0 min-w-0 border-0 p-0">
        {node}
      </fieldset>,
    );
    return null;
  };

  function loadUnlock(next: UnlockFile) {
    const sealed = applyUnlock(next.params, next);
    setUnlock(next);
    setUnlockError("");
    setParams(sealed);
    setRunParams(sealed);
  }

  function writeUnlockFile() {
    const name = testerName.trim();
    if (!name) return;
    const file = issueUnlock(name, allow, params);
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tester";
    link.download = `unlock-${slug}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function writeLiveFile() {
    const name = testerName.trim();
    if (!name) return;
    const file = issueLiveArm(name);
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = liveFileName(name);
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div data-testid="desk" className="flex min-h-dvh flex-col bg-ink text-paper lg:grid lg:h-dvh lg:grid-cols-[24rem_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
      <header className="order-1 border-b border-line px-4 py-4 lg:col-span-2 lg:order-none">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-balance">
              Strategy Desk{" "}
              <a
                href={GUIDE_PATH}
                target="_blank"
                rel="noopener"
                className="font-mono text-sm font-medium text-bronze"
                onClick={(event) => {
                  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname);
                  if (!prefix) return;
                  event.preventDefault();
                  window.open(`${prefix}${GUIDE_PATH}`, "_blank", "noopener");
                }}
              >
                {PRODUCT_VERSION}
              </a>
            </h1>
            <p className="text-sm text-muted text-pretty">
              One tape. One cash account. Play money is the only thing that can fill.{" "}
              <a
                href={STRATEGIES_PATH}
                target="_blank"
                rel="noopener"
                className="text-bronze"
                onClick={(event) => {
                  const prefix = previewPathPrefix(window.location.hostname, window.location.pathname);
                  if (!prefix) return;
                  event.preventDefault();
                  window.open(`${prefix}${STRATEGIES_PATH}`, "_blank", "noopener");
                }}
              >
                How the strategies work
              </a>
            </p>
          </div>
          <form onSubmit={submitSymbol} className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
            <label className="sr-only" htmlFor="symbol">
              Symbol
            </label>
            <input
              id="symbol"
              className="desk-input sm:w-36"
              value={draft}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value.toUpperCase())}
            />
            <label className="sr-only" htmlFor="interval">
              Bar size
            </label>
            <select
              id="interval"
              className="desk-input sm:w-40"
              value={interval}
              onChange={(event) => setInterval(event.target.value as Interval)}
            >
              {INTERVALS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <button type="submit" className="desk-chip shrink-0" data-on="true">
              {loading ? "Loading" : "Load"}
            </button>
            <button type="button" className="desk-chip shrink-0" data-testid="recalculate" data-on={dirty} onClick={recalculate}>
              Recalculate
            </button>
          </form>
        </div>
      </header>

      <aside className="order-3 border-line px-4 py-4 lg:order-none lg:col-start-1 lg:row-start-2 lg:overflow-y-auto lg:border-r">
        <div className="flex flex-col gap-4">
          <section className="desk-panel p-4">
            <h2 className="text-sm font-medium">Strategies</h2>
            <p className="mt-1 text-sm text-muted text-pretty">
              Each card is one test. Mark a side AND when it has to pass with the other AND rules, or OR when it can fire on its own. Together that is every AND, or any OR — [X and Y] or Z. This book starts as the SOXL 5-minute baseline, and every side that is on is AND. A buy needs the lower band within 2%, RSI at or under 30, a slope of at least −1% over 5 bars, volume of at least 1.5×, money flow at or under 50, and VWAP inside the candle. A sell needs the upper band within 2%, RSI at or over 60, and the close at or above VWAP. A session low 10% under the prior close blocks sells until price recovers halfway. A buy that session turns the hold off, including a drop that comes after the buy. The chart, blotter, and timing stay on the last calculation until you press Recalculate.
            </p>
            {tape && tape.interval !== "1d" && hoursOnTape > 0 && (
              <p className="mt-2 text-xs text-muted">This tape has {hoursOnTape} clock hours.</p>
            )}
            <div className="mt-4 flex flex-col gap-4">
              <article className="rounded-lg border border-line p-3" data-testid="unlock-file">
                {EDITION === "master" ? (
                  <>
                    <h3 className="text-sm font-medium">Unlock file</h3>
                    <p className="mt-2 text-sm text-muted text-pretty">
                      Write one file per tester. Check the strategies that tester may change. Every other setting is taken from this book and stays locked. Send the file. Their desk fires nothing until they load it. Write a live key only when that tester may send real Alpaca orders. Paper orders do not need it.
                    </p>
                    <label className="mt-3 block text-xs text-muted">
                      Tester
                      <input
                        className="desk-input mt-1"
                        value={testerName}
                        maxLength={40}
                        data-testid="unlock-tester"
                        onChange={(event) => setTesterName(event.target.value)}
                      />
                    </label>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {[...STRATEGY_ORDER, "matrix" as const].map((id) => (
                        <label key={id} className="flex min-h-8 items-center gap-2 text-xs">
                          <Checkbox.Root
                            checked={allow.includes(id)}
                            onCheckedChange={() => setAllow((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))}
                            className="flex size-5 shrink-0 items-center justify-center rounded-sm border border-line bg-ink text-ink outline-none focus-visible:ring-2 focus-visible:ring-bronze data-[state=checked]:border-bronze data-[state=checked]:bg-bronze"
                            aria-label={`Allow ${id === "matrix" ? "Master matrix" : strategyName(id)}`}
                          >
                            <Checkbox.Indicator>
                              <Check className="size-3" strokeWidth={2.5} />
                            </Checkbox.Indicator>
                          </Checkbox.Root>
                          {id === "matrix" ? "Master matrix" : strategyName(id, params)}
                        </label>
                      ))}
                    </div>
                    <button type="button" className="desk-chip mt-3 disabled:opacity-40" data-testid="write-unlock" disabled={!testerName.trim()} onClick={writeUnlockFile}>
                      Write unlock
                    </button>
                    <button type="button" className="desk-chip mt-3 ml-2 disabled:opacity-40" data-testid="write-live" disabled={!testerName.trim()} onClick={writeLiveFile}>
                      Write live key
                    </button>
                  </>
                ) : (
                  <>
                    <h3 className="text-sm font-medium">Unlock file</h3>
                    <p className="mt-2 text-sm text-muted text-pretty">
                      {unlock
                        ? `Loaded for ${unlock.tester}. You can change ${unlock.allow.length ? unlock.allow.map((id) => (id === "matrix" ? "Master matrix" : strategyName(id, params))).join(", ") : "nothing"}. Every other strategy stays on the book that was sent, and you cannot switch it.`
                        : "Load the unlock file you were sent. Until you do, no strategy fires."}
                    </p>
                    <label className="mt-3 block text-xs text-muted">
                      File
                      <input
                        className="desk-input mt-1"
                        type="file"
                        accept="application/json,.json"
                        data-testid="load-unlock"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (!file) return;
                          void file.text().then((text) => {
                            try {
                              const next = acceptUnlock(JSON.parse(text));
                              if (!next) {
                                setUnlockError("That file is not an unlock file.");
                                return;
                              }
                              loadUnlock(next);
                            } catch {
                              setUnlockError("That file is not an unlock file.");
                            }
                          });
                        }}
                      />
                    </label>
                    {unlock && (
                      <button
                        type="button"
                        className="desk-chip mt-3"
                        onClick={() => {
                          setUnlock(null);
                          setUnlockError("");
                        }}
                      >
                        Remove unlock
                      </button>
                    )}
                    {unlockError && <p className="mt-2 text-sm text-sell">{unlockError}</p>}
                  </>
                )}
              </article>
              <article className="rounded-lg border border-line p-3" data-testid="saved-books">
                <h3 className="text-sm font-medium">Saved books</h3>
                <p className="mt-2 text-sm text-muted text-pretty">
                  Name the strategies and the play-money account, then recall them later. Recall recalculates. The symbol stays on whatever tape is loaded. Saving the same name replaces that book. Up to 24.
                </p>
                <label className="mt-3 block text-xs text-muted">
                  Name
                  <input
                    className="desk-input mt-1"
                    value={bookName}
                    maxLength={40}
                    data-testid="book-name"
                    onChange={(event) => setBookName(event.target.value)}
                  />
                </label>
                <button type="button" className="desk-chip mt-3 disabled:opacity-40" data-testid="save-book" disabled={!bookName.trim()} onClick={saveBook}>
                  Save
                </button>
                <label className="mt-3 block text-xs text-muted">
                  Saved
                  <select
                    className="desk-input mt-1"
                    value={pickedBook}
                    data-testid="book-list"
                    onChange={(event) => setPickedBook(event.target.value)}
                  >
                    {books.length === 0 ? <option value="">No saved books</option> : null}
                    {books.map((book) => (
                      <option key={book.id} value={book.id}>
                        {book.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="desk-chip disabled:opacity-40" data-testid="recall-book" disabled={!pickedBook} onClick={recallBook}>
                    Recall
                  </button>
                  <button type="button" className="desk-chip disabled:opacity-40" data-testid="remove-book" disabled={!pickedBook} onClick={removeBook}>
                    Remove
                  </button>
                </div>
              </article>

{hold([], (
              <article className="rounded-lg border border-line p-3">
                <h3 className="text-sm font-medium">Bollinger bands</h3>
                <p className="mt-2 text-sm text-muted text-pretty">
                  One indicator, used by the lower-band, upper-band, and slope tests. Length and width are not themselves a buy or a sell.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <NumField label="Length" value={params.bands.length} onChange={(length) => setParams((p) => ({ ...p, bands: { ...p.bands, length } }))} />
                  <NumField label="Width" value={params.bands.mult} step={0.1} onChange={(mult) => setParams((p) => ({ ...p, bands: { ...p.bands, mult } }))} />
                </div>
              </article>
))}

{hold(["lower"], (
              <RuleCard
                title="Lower band"
                blurb="Buy within 2% when the buy percent is 102. The close passes at or under that percent of the lower band. The sell percent is its own number."
                rule={params.lower}
                onRule={(patch) => setParams((p) => ({ ...p, lower: { ...p.lower, ...patch } }))}
              >
                <NumField label="Buy percent" value={params.lower.buyPct} step={0.1} onChange={(buyPct) => setParams((p) => ({ ...p, lower: { ...p.lower, buyPct } }))} />
                <NumField label="Sell percent" value={params.lower.sellPct} step={0.1} onChange={(sellPct) => setParams((p) => ({ ...p, lower: { ...p.lower, sellPct } }))} />
              </RuleCard>
))}

{hold(["upper"], (
              <RuleCard
                title="Upper band"
                blurb="Sell within 2% when the sell percent is 98. The close passes at or over that percent of the upper band. The buy percent is its own number."
                rule={params.upper}
                onRule={(patch) => setParams((p) => ({ ...p, upper: { ...p.upper, ...patch } }))}
              >
                <NumField label="Buy percent" value={params.upper.buyPct} step={0.1} onChange={(buyPct) => setParams((p) => ({ ...p, upper: { ...p.upper, buyPct } }))} />
                <NumField label="Sell percent" value={params.upper.sellPct} step={0.1} onChange={(sellPct) => setParams((p) => ({ ...p, upper: { ...p.upper, sellPct } }))} />
              </RuleCard>
))}

{hold(["slope"], (
              <RuleCard
                title="Band slope"
                blurb="Uses the middle band. Buy when the slope is at least the buy floor. Sell when the slope is at or under the sell floor. The two floors are not mirrors of each other."
                rule={params.slope}
                onRule={(patch) => setParams((p) => ({ ...p, slope: { ...p.slope, ...patch } }))}
              >
                <NumField label="Buy floor %" value={params.slope.buyFloor} step={0.05} onChange={(buyFloor) => setParams((p) => ({ ...p, slope: { ...p.slope, buyFloor } }))} />
                <NumField label="Sell floor %" value={params.slope.sellFloor} step={0.05} onChange={(sellFloor) => setParams((p) => ({ ...p, slope: { ...p.slope, sellFloor } }))} />
                <NumField label="Slope bars" value={params.slope.bars} onChange={(bars) => setParams((p) => ({ ...p, slope: { ...p.slope, bars } }))} />
              </RuleCard>
))}

{hold(["volume"], (
              <RuleCard
                title="Volume"
                blurb="Buy when volume is at least the buy multiple of its average. Sell uses its own multiple. Length is the shared average."
                rule={params.volume}
                onRule={(patch) => setParams((p) => ({ ...p, volume: { ...p.volume, ...patch } }))}
              >
                <NumField label="Buy multiple" value={params.volume.buyMult} step={0.1} onChange={(buyMult) => setParams((p) => ({ ...p, volume: { ...p.volume, buyMult } }))} />
                <NumField label="Sell multiple" value={params.volume.sellMult} step={0.1} onChange={(sellMult) => setParams((p) => ({ ...p, volume: { ...p.volume, sellMult } }))} />
                <NumField label="Average length" value={params.volume.length} onChange={(length) => setParams((p) => ({ ...p, volume: { ...p.volume, length } }))} />
              </RuleCard>
))}

{hold(["rsi"], (
              <RuleCard
                title="RSI"
                blurb="Buy only when RSI is at or under the buy level. Sell when it is at or over the sell level."
                rule={params.rsi}
                onRule={(patch) => setParams((p) => ({ ...p, rsi: { ...p.rsi, ...patch } }))}
              >
                <NumField label="RSI length" value={params.rsi.length} onChange={(length) => setParams((p) => ({ ...p, rsi: { ...p.rsi, length } }))} />
                <NumField label="Buy at or under" value={params.rsi.buyLevel} onChange={(buyLevel) => setParams((p) => ({ ...p, rsi: { ...p.rsi, buyLevel } }))} />
                <NumField label="Sell at or over" value={params.rsi.sellLevel} onChange={(sellLevel) => setParams((p) => ({ ...p, rsi: { ...p.rsi, sellLevel } }))} />
              </RuleCard>
))}

{hold(["mfi"], (
              <RuleCard
                title="Money flow"
                blurb="Buy only when the Money Flow Index is at or under the buy level. Sell when it is at or over the sell level."
                rule={params.mfi}
                onRule={(patch) => setParams((p) => ({ ...p, mfi: { ...p.mfi, ...patch } }))}
              >
                <NumField label="MFI length" value={params.mfi.length} onChange={(length) => setParams((p) => ({ ...p, mfi: { ...p.mfi, length } }))} />
                <NumField label="Buy at or under" value={params.mfi.buyLevel} onChange={(buyLevel) => setParams((p) => ({ ...p, mfi: { ...p.mfi, buyLevel } }))} />
                <NumField label="Sell at or over" value={params.mfi.sellLevel} onChange={(sellLevel) => setParams((p) => ({ ...p, mfi: { ...p.mfi, sellLevel } }))} />
              </RuleCard>
))}

{hold([], (
              <article className="rounded-lg border border-line p-3">
                <h3 className="text-sm font-medium">Relative trend</h3>
                <p className="mt-2 text-sm text-muted text-pretty">
                  Where the close sits inside a band around its average. 50 is the middle. Above 50 is up, below 50 is down, and the distance from 50 is the strength. A close outside the band can print past 0 or 100. Direction and strength are separate tests, so you can require both.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <NumField label="Length" value={params.rti.length} onChange={(length) => setParams((p) => ({ ...p, rti: { ...p.rti, length } }))} />
                  <NumField label="Band width" value={params.rti.mult} step={0.1} onChange={(mult) => setParams((p) => ({ ...p, rti: { ...p.rti, mult } }))} />
                  <NumField label="Smooth" value={params.rti.smooth} onChange={(smooth) => setParams((p) => ({ ...p, rti: { ...p.rti, smooth } }))} />
                </div>
              </article>
))}

{hold(["rtiDir"], (
              <article className="rounded-lg border border-line p-3">
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h4 className="text-sm font-medium">Direction</h4>
                    <div className="flex shrink-0 flex-col gap-2">
                      <SideSwitch
                        side="buy"
                        checked={params.rti.direction.buyOn}
                        join={asJoin(params.rti.direction.buyJoin)}
                        label="RTI direction buy"
                        onChange={(buyOn) => setParams((p) => ({ ...p, rti: { ...p.rti, direction: { ...p.rti.direction, buyOn } } }))}
                        onJoin={(buyJoin) => setParams((p) => ({ ...p, rti: { ...p.rti, direction: { ...p.rti.direction, buyJoin } } }))}
                      />
                      <SideSwitch
                        side="sell"
                        checked={params.rti.direction.sellOn}
                        join={asJoin(params.rti.direction.sellJoin)}
                        label="RTI direction sell"
                        onChange={(sellOn) => setParams((p) => ({ ...p, rti: { ...p.rti, direction: { ...p.rti.direction, sellOn } } }))}
                        onJoin={(sellJoin) => setParams((p) => ({ ...p, rti: { ...p.rti, direction: { ...p.rti.direction, sellJoin } } }))}
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-muted text-pretty">Buy when the reading is at or above the up line. Sell when it is at or below the down line.</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <NumField label="Up line" value={params.rti.direction.up} onChange={(up) => setParams((p) => ({ ...p, rti: { ...p.rti, direction: { ...p.rti.direction, up } } }))} />
                    <NumField label="Down line" value={params.rti.direction.down} onChange={(down) => setParams((p) => ({ ...p, rti: { ...p.rti, direction: { ...p.rti.direction, down } } }))} />
                  </div>
                </div>
              </article>
))}

{hold(["rtiStr"], (
              <article className="rounded-lg border border-line p-3">
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h4 className="text-sm font-medium">Strength</h4>
                    <div className="flex shrink-0 flex-col gap-2">
                      <SideSwitch
                        side="buy"
                        checked={params.rti.strength.buyOn}
                        join={asJoin(params.rti.strength.buyJoin)}
                        label="RTI strength buy"
                        onChange={(buyOn) => setParams((p) => ({ ...p, rti: { ...p.rti, strength: { ...p.rti.strength, buyOn } } }))}
                        onJoin={(buyJoin) => setParams((p) => ({ ...p, rti: { ...p.rti, strength: { ...p.rti.strength, buyJoin } } }))}
                      />
                      <SideSwitch
                        side="sell"
                        checked={params.rti.strength.sellOn}
                        join={asJoin(params.rti.strength.sellJoin)}
                        label="RTI strength sell"
                        onChange={(sellOn) => setParams((p) => ({ ...p, rti: { ...p.rti, strength: { ...p.rti.strength, sellOn } } }))}
                        onJoin={(sellJoin) => setParams((p) => ({ ...p, rti: { ...p.rti, strength: { ...p.rti.strength, sellJoin } } }))}
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-muted text-pretty">
                    Buy only when the reading is at least the buy floor above 50. Sell only when it is at least the sell floor below 50. A floor of 0 is the same as the 50 line.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <NumField
                      label="Buy points above 50"
                      value={params.rti.strength.buyFloor}
                      onChange={(buyFloor) => setParams((p) => ({ ...p, rti: { ...p.rti, strength: { ...p.rti.strength, buyFloor } } }))}
                    />
                    <NumField
                      label="Sell points below 50"
                      value={params.rti.strength.sellFloor}
                      onChange={(sellFloor) => setParams((p) => ({ ...p, rti: { ...p.rti, strength: { ...p.rti.strength, sellFloor } } }))}
                    />
                  </div>
                </div>
              </article>
))}

{hold(["rtiLine"], (
              <article className="rounded-lg border border-line p-3">
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h4 className="text-sm font-medium">Its own line</h4>
                    <div className="flex shrink-0 flex-col gap-2">
                      <SideSwitch
                        side="buy"
                        checked={params.rti.line.buyOn}
                        join={asJoin(params.rti.line.buyJoin)}
                        label="RTI line buy"
                        onChange={(buyOn) => setParams((p) => ({ ...p, rti: { ...p.rti, line: { ...p.rti.line, buyOn } } }))}
                        onJoin={(buyJoin) => setParams((p) => ({ ...p, rti: { ...p.rti, line: { ...p.rti.line, buyJoin } } }))}
                      />
                      <SideSwitch
                        side="sell"
                        checked={params.rti.line.sellOn}
                        join={asJoin(params.rti.line.sellJoin)}
                        label="RTI line sell"
                        onChange={(sellOn) => setParams((p) => ({ ...p, rti: { ...p.rti, line: { ...p.rti.line, sellOn } } }))}
                        onJoin={(sellJoin) => setParams((p) => ({ ...p, rti: { ...p.rti, line: { ...p.rti.line, sellJoin } } }))}
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-muted text-pretty">
                    A buy or a sell passes when any checked test passes. Versus the line compares the reading with its average. Trend buys while that line is rising and sells while it is falling. Level buys at or above its value and sells at or under its own value. The vote stays true while the test remains true. This is the RTI line, not the 4-hour price trend.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <NumField
                      label="Line length"
                      value={params.rti.line.length}
                      onChange={(length) => setParams((p) => ({ ...p, rti: { ...p.rti, line: { ...p.rti.line, length } } }))}
                    />
                    <label className="col-span-2 flex min-h-11 items-center gap-3 text-sm">
                      <Checkbox.Root
                        checked={params.rti.line.versus !== false}
                        onCheckedChange={(value) => setParams((p) => ({ ...p, rti: { ...p.rti, line: { ...p.rti.line, versus: value === true } } }))}
                        className="flex size-6 items-center justify-center rounded-sm border border-line bg-ink text-ink outline-none focus-visible:ring-2 focus-visible:ring-bronze data-[state=checked]:border-bronze data-[state=checked]:bg-bronze"
                        aria-label="Compare the reading with its line"
                      >
                        <Checkbox.Indicator>
                          <Check className="size-4" strokeWidth={2.5} />
                        </Checkbox.Indicator>
                      </Checkbox.Root>
                      Versus the line
                    </label>
                    <label className="col-span-2 flex min-h-11 items-center gap-3 text-sm">
                      <Checkbox.Root
                        checked={params.rti.line.trend === true}
                        onCheckedChange={(value) => setParams((p) => ({ ...p, rti: { ...p.rti, line: { ...p.rti.line, trend: value === true } } }))}
                        className="flex size-6 items-center justify-center rounded-sm border border-line bg-ink text-ink outline-none focus-visible:ring-2 focus-visible:ring-bronze data-[state=checked]:border-bronze data-[state=checked]:bg-bronze"
                        aria-label="Use the line trend"
                      >
                        <Checkbox.Indicator>
                          <Check className="size-4" strokeWidth={2.5} />
                        </Checkbox.Indicator>
                      </Checkbox.Root>
                      Trend is positive on a buy, negative on a sell
                    </label>
                    <label className="col-span-2 flex min-h-11 items-center gap-3 text-sm">
                      <Checkbox.Root
                        checked={params.rti.line.levelOn === true}
                        onCheckedChange={(value) => setParams((p) => ({ ...p, rti: { ...p.rti, line: { ...p.rti.line, levelOn: value === true } } }))}
                        className="flex size-6 items-center justify-center rounded-sm border border-line bg-ink text-ink outline-none focus-visible:ring-2 focus-visible:ring-bronze data-[state=checked]:border-bronze data-[state=checked]:bg-bronze"
                        aria-label="Use a level"
                      >
                        <Checkbox.Indicator>
                          <Check className="size-4" strokeWidth={2.5} />
                        </Checkbox.Indicator>
                      </Checkbox.Root>
                      Above or below a value
                    </label>
                    <NumField
                      label="Buy at or above"
                      value={params.rti.line.buyLevel}
                      step={0.1}
                      onChange={(buyLevel) => setParams((p) => ({ ...p, rti: { ...p.rti, line: { ...p.rti.line, buyLevel } } }))}
                    />
                    <NumField
                      label="Sell at or under"
                      value={params.rti.line.sellLevel}
                      step={0.1}
                      onChange={(sellLevel) => setParams((p) => ({ ...p, rti: { ...p.rti, line: { ...p.rti.line, sellLevel } } }))}
                    />
                  </div>
                </div>
              </article>
))}

{hold(["rtiNeg"], (
              <article className="rounded-lg border border-line p-3">
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h4 className="text-sm font-medium">Negative</h4>
                    <div className="flex shrink-0 flex-col gap-2">
                      <SideSwitch
                        side="buy"
                        checked={params.rti.negative.buyOn}
                        join={asJoin(params.rti.negative.buyJoin)}
                        label="RTI negative buy"
                        onChange={(buyOn) => setParams((p) => ({ ...p, rti: { ...p.rti, negative: { ...p.rti.negative, buyOn } } }))}
                        onJoin={(buyJoin) => setParams((p) => ({ ...p, rti: { ...p.rti, negative: { ...p.rti.negative, buyJoin } } }))}
                      />
                      <SideSwitch
                        side="sell"
                        checked={params.rti.negative.sellOn}
                        join={asJoin(params.rti.negative.sellJoin)}
                        label="RTI negative sell"
                        onChange={(sellOn) => setParams((p) => ({ ...p, rti: { ...p.rti, negative: { ...p.rti.negative, sellOn } } }))}
                        onJoin={(sellJoin) => setParams((p) => ({ ...p, rti: { ...p.rti, negative: { ...p.rti.negative, sellJoin } } }))}
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-muted text-pretty">
                    Passes while the reading is below zero. Zero is the lower edge of the band, so this is a close through that edge. It stays true on every negative bar, not only the bar it crosses. A reading of exactly zero does not pass.
                  </p>
                </div>
              </article>
))}

{hold(["rtiRev"], (
              <article className="rounded-lg border border-line p-3">
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h4 className="text-sm font-medium">Reversal</h4>
                    <div className="flex shrink-0 flex-col gap-2">
                      <SideSwitch
                        side="buy"
                        checked={params.rti.reversal.buyOn}
                        join={asJoin(params.rti.reversal.buyJoin)}
                        label="RTI valley"
                        onChange={(buyOn) => setParams((p) => ({ ...p, rti: { ...p.rti, reversal: { ...p.rti.reversal, buyOn } } }))}
                        onJoin={(buyJoin) => setParams((p) => ({ ...p, rti: { ...p.rti, reversal: { ...p.rti.reversal, buyJoin } } }))}
                      />
                      <SideSwitch
                        side="sell"
                        checked={params.rti.reversal.sellOn}
                        join={asJoin(params.rti.reversal.sellJoin)}
                        label="RTI peak"
                        onChange={(sellOn) => setParams((p) => ({ ...p, rti: { ...p.rti, reversal: { ...p.rti.reversal, sellOn } } }))}
                        onJoin={(sellJoin) => setParams((p) => ({ ...p, rti: { ...p.rti, reversal: { ...p.rti.reversal, sellJoin } } }))}
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-muted text-pretty">
                    Buy on a valley and sell on a peak. Over this many readings, the low or the high has to sit inside the window, not on the newest bar and not only on the oldest. A valley passes while the newest reading is back above that low. A peak passes while it is back under that high. A longer window skips the small turns.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <NumField
                      label="Periods"
                      value={params.rti.reversal.bars}
                      onChange={(bars) => setParams((p) => ({ ...p, rti: { ...p.rti, reversal: { ...p.rti.reversal, bars } } }))}
                    />
                  </div>
                </div>
              </article>
))}

{hold(["rtiBelow"], (
              <article className="rounded-lg border border-line p-3">
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h4 className="text-sm font-medium">Buy below</h4>
                    <SideSwitch
                      side="buy"
                      checked={params.rti.below.buyOn}
                      join={asJoin(params.rti.below.buyJoin)}
                      label="RTI buy below"
                      onChange={(buyOn) => setParams((p) => ({ ...p, rti: { ...p.rti, below: { ...p.rti.below, buyOn } } }))}
                      onJoin={(buyJoin) => setParams((p) => ({ ...p, rti: { ...p.rti, below: { ...p.rti.below, buyJoin } } }))}
                    />
                  </div>
                  <p className="mt-2 text-sm text-muted text-pretty">
                    Buy when the reading is at or under this level. The level can be negative. A level of 0 passes on zero and on every negative reading. A level of 1 also passes a reading that is only at the lower edge of the band. This test does not sell.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <NumField
                      label="At or under"
                      value={params.rti.below.level}
                      step={0.1}
                      onChange={(level) => setParams((p) => ({ ...p, rti: { ...p.rti, below: { ...p.rti.below, level } } }))}
                    />
                  </div>
                </div>
              </article>
))}

{hold(["rtiAbove"], (
              <article className="rounded-lg border border-line p-3">
                <div>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h4 className="text-sm font-medium">Sell above</h4>
                    <SideSwitch
                      side="sell"
                      checked={params.rti.above.sellOn}
                      join={asJoin(params.rti.above.sellJoin)}
                      label="RTI sell above"
                      onChange={(sellOn) => setParams((p) => ({ ...p, rti: { ...p.rti, above: { ...p.rti.above, sellOn } } }))}
                      onJoin={(sellJoin) => setParams((p) => ({ ...p, rti: { ...p.rti, above: { ...p.rti.above, sellJoin } } }))}
                    />
                  </div>
                  <p className="mt-2 text-sm text-muted text-pretty">
                    Sell when the reading is at or over this level. The level can be negative. A level of 50 passes on 50 and on every higher reading. This test does not buy.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <NumField
                      label="At or over"
                      value={params.rti.above.level}
                      step={0.1}
                      onChange={(level) => setParams((p) => ({ ...p, rti: { ...p.rti, above: { ...p.rti.above, level } } }))}
                    />
                  </div>
                </div>
              </article>
))}

{hold(["vwap"], (
              <RuleCard
                title="VWAP in the candle"
                blurb="Passes when the candle's low-to-high range contains the session VWAP. That is the whole test."
                rule={params.vwap}
                onRule={(patch) => setParams((p) => ({ ...p, vwap: { ...p.vwap, ...patch } }))}
              />
))}

{hold(["vwapPx"], (
              <RuleCard
                title="Close versus VWAP"
                blurb="Buy when the close is at or under session VWAP. Sell when the close is at or over it."
                rule={params.vwapPx}
                onRule={(patch) => setParams((p) => ({ ...p, vwapPx: { ...p.vwapPx, ...patch } }))}
              />
))}

              {(["ema20", "ema50", "ema100"] as const).map((id) => {
                const node = params[id];
                const short = tape?.interval === "1d" ? false : hoursOnTape > 0 && hoursOnTape < node.hours;
                const note =
                  (node.buyOn || node.sellOn) && tape?.interval === "1d"
                    ? "Daily bars have no hourly close, so this test blocks every fill."
                    : short
                      ? `This tape has ${hoursOnTape} hours, so this average is not ready and it blocks every fill.`
                      : undefined;
                return (
                  hold([id], (
                  <RuleCard
                    key={id}
                    title={strategyName(id, params)}
                    blurb="One close per clock hour, Eastern time, including the hour still forming. Buy when the close is on or above the average. Sell when it is on or under. Leave a side off if it fights another test you already require."
                    rule={node}
                    note={note}
                    onRule={(patch) => setParams((p) => ({ ...p, [id]: { ...p[id], ...patch } }))}
                  >
                    <NumField label="Hours" value={node.hours} onChange={(hours) => setParams((p) => ({ ...p, [id]: { ...p[id], hours } }))} />
                  </RuleCard>
                  ))
                );
              })}

{hold([], (
              <article className="rounded-lg border border-line p-3">
                <h3 className="text-sm font-medium">EMA relations</h3>
                <p className="mt-2 text-sm text-muted text-pretty">
                  The three hourly averages are one family. A relation is a test you build from them, not a menu of every stack. Rank checks order. Touch checks whether 1, 2, or 3 lines coincide. Gap checks the distance between them. Each relation is its own voter. Mark it AND or OR the same way as the other cards.
                </p>
              </article>
))}
              {EMA_RELS.map((id) =>
                hold([id], (
                <RelationCard key={id} id={id} slot={params[id]} params={params} onChange={(slot) => setParams((current) => ({ ...current, [id]: slot }))} />
                ))
              )}

{hold([], (
              <article className="rounded-lg border border-line p-3">
                <h3 className="text-sm font-medium">Trend line</h3>
                <p className="mt-2 text-sm text-muted text-pretty">
                  One straight-line fit. Slope and price are separate tests, so you can require either or both. Daily bars have no multi-bar hour window, so either test fails on a daily tape.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <NumField label="Hours" value={params.trend.hours} step={0.5} onChange={(hours) => setParams((p) => ({ ...p, trend: { ...p.trend, hours } }))} />
                </div>
              </article>
))}

{hold(["trendSlope"], (
              <RuleCard
                title={strategyName("trendSlope", params)}
                blurb="Buy when the fitted line is rising at least the buy floor. Sell when the slope is at or under the sell floor."
                rule={params.trend.slope}
                onRule={(patch) => setParams((p) => ({ ...p, trend: { ...p.trend, slope: { ...p.trend.slope, ...patch } } }))}
              >
                <NumField
                  label="Buy floor %"
                  value={params.trend.slope.buyFloor}
                  step={0.05}
                  onChange={(buyFloor) => setParams((p) => ({ ...p, trend: { ...p.trend, slope: { ...p.trend.slope, buyFloor } } }))}
                />
                <NumField
                  label="Sell floor %"
                  value={params.trend.slope.sellFloor}
                  step={0.05}
                  onChange={(sellFloor) => setParams((p) => ({ ...p, trend: { ...p.trend, slope: { ...p.trend.slope, sellFloor } } }))}
                />
              </RuleCard>
))}

{hold(["trendLine"], (
              <RuleCard
                title={strategyName("trendLine", params)}
                blurb="Buy when the close is on or above the fitted line. Sell when the close is on or under it."
                rule={params.trend.line}
                onRule={(patch) => setParams((p) => ({ ...p, trend: { ...p.trend, line: { ...p.trend.line, ...patch } } }))}
              />
))}

{hold(["step"], (
              <RuleCard
                title="Last fill"
                blurb="Sell when the close is at least this many dollars above the last play-money buy. Buy when the close is at least this many dollars below the last play-money sell. Turn on the flat buy to enter whenever this book is flat, and the stop to sell a close under the last buy. Until the book has sold once, the dollar buy stays out so the first entry can come from the flat buy or the other buy tests. If this side is AND, a failed step blocks that side unless an OR rule passes. If it is OR, a passing step can fire on its own."
                rule={params.step}
                onRule={(patch) => setParams((p) => ({ ...p, step: { ...p.step, ...patch } }))}
              >
                <NumField label="Dollars above last buy" value={params.step.aboveBuy} step={0.01} onChange={(aboveBuy) => setParams((p) => ({ ...p, step: { ...p.step, aboveBuy } }))} />
                <NumField label="Dollars below last sell" value={params.step.belowSell} step={0.01} onChange={(belowSell) => setParams((p) => ({ ...p, step: { ...p.step, belowSell } }))} />
                <label className="col-span-2 flex min-h-11 items-center gap-3 text-sm">
                  <Checkbox.Root
                    checked={Boolean(params.step.flatOn)}
                    onCheckedChange={(value) => setParams((p) => ({ ...p, step: { ...p.step, flatOn: value === true } }))}
                    className="flex size-6 items-center justify-center rounded-sm border border-line bg-ink text-ink outline-none focus-visible:ring-2 focus-visible:ring-bronze data-[state=checked]:border-bronze data-[state=checked]:bg-bronze"
                    aria-label="Buy whenever the book is flat"
                  >
                    <Checkbox.Indicator>
                      <Check className="size-4" strokeWidth={2.5} />
                    </Checkbox.Indicator>
                  </Checkbox.Root>
                  Buy whenever the book is flat
                </label>
                <label className="col-span-2 flex min-h-11 items-center gap-3 text-sm">
                  <Checkbox.Root
                    checked={Boolean(params.step.stopOn)}
                    onCheckedChange={(value) => setParams((p) => ({ ...p, step: { ...p.step, stopOn: value === true } }))}
                    className="flex size-6 items-center justify-center rounded-sm border border-line bg-ink text-ink outline-none focus-visible:ring-2 focus-visible:ring-bronze data-[state=checked]:border-bronze data-[state=checked]:bg-bronze"
                    aria-label="Sell under the last buy"
                  >
                    <Checkbox.Indicator>
                      <Check className="size-4" strokeWidth={2.5} />
                    </Checkbox.Indicator>
                  </Checkbox.Root>
                  Sell when the close is under the last buy
                </label>
                <NumField
                  label="Dollars under the last buy"
                  value={params.step.stopBy ?? 0}
                  step={0.01}
                  onChange={(stopBy) => setParams((p) => ({ ...p, step: { ...p.step, stopBy } }))}
                />
              </RuleCard>
))}

{hold(["drop"], (
              <article className="rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-medium">Drop hold</h3>
                  <SideSwitch side="sell" checked={params.drop.sellOn} label="Drop hold" onChange={(sellOn) => setParams((p) => ({ ...p, drop: { ...p.drop, sellOn } }))} />
                </div>
                <p className="mt-2 text-sm text-muted text-pretty">
                  A session low this far under the prior session close blocks sells until the close has recovered part of the way back to that prior close. It does not block a buy. Any buy that session turns the hold off, including a drop that prints after the buy. This rule never votes to sell. On the sell timing strip the row is Not Held: high means the sale is free.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <NumField label="Drop from prior close %" value={params.drop.dropPct} step={0.5} onChange={(dropPct) => setParams((p) => ({ ...p, drop: { ...p.drop, dropPct } }))} />
                  <NumField label="Recover back %" value={params.drop.recoverPct} step={1} onChange={(recoverPct) => setParams((p) => ({ ...p, drop: { ...p.drop, recoverPct } }))} />
                </div>
              </article>
))}

{hold(["matrix"], (
              <article className="rounded-lg border border-line p-3">
                <h3 className="text-sm font-medium">Master matrix</h3>
                <p className="mt-2 text-sm text-muted text-pretty">
                  Use this when one AND group is not enough. A buy of A and B, or A and C, or B and D, is three buy rows. Drop hold stays off the table. It can still block a sale.
                </p>
                <MatrixEditor side="buy" params={params} onChange={(buy) => setParams((current) => ({ ...current, matrix: { ...current.matrix, buy } }))} />
                <MatrixEditor side="sell" params={params} onChange={(sell) => setParams((current) => ({ ...current, matrix: { ...current.matrix, sell } }))} />
              </article>
))}
              {openCards}
              {lockedCards.length > 0 && (
                <details className="rounded-lg border border-line" data-testid="locked-strategies">
                  <summary className="cursor-pointer px-3 py-3 text-sm font-medium">
                    Locked · {lockedCards.length}
                    {EDITION === "desk" && !unlock ? " · not running" : ""}
                  </summary>
                  <div className="flex flex-col gap-4 px-3 pb-3">{lockedCards}</div>
                </details>
              )}
            </div>
          </section>

          <section className="desk-panel p-4">
            <h2 className="text-sm font-medium">{accountView ? accountName : "Play-money account"}</h2>
            <p className="mt-1 text-sm text-muted text-pretty">
              {accountView
                ? `These figures are the ${accountName.toLowerCase()}. Dollars per buy still sizes the next order sent to Alpaca. Play money stays on its own tab.`
                : account.useConfirmedSaleProceeds
                  ? "Confirmed sale proceeds are on. A filled sell can fund the next buy immediately. That is still only this account's cash. No margin."
                  : "After a sell, that cash is not buying power until the reconciliation delay passes. Shares leave the position as soon as the sell fills. No margin."}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <NumField label="Starting cash" value={account.startingCash} step={100} onChange={(startingCash) => setAccount((a) => ({ ...a, startingCash }))} />
              <NumField label="Flat fee" value={account.flatFee} step={0.01} onChange={(flatFee) => setAccount((a) => ({ ...a, flatFee }))} />
              <NumField label="Percent fee" value={account.percentFee} step={0.01} onChange={(percentFee) => setAccount((a) => ({ ...a, percentFee }))} />
              <NumField label="Dollars per buy" value={account.dollarsPerBuy} step={100} onChange={(dollarsPerBuy) => setAccount((a) => ({ ...a, dollarsPerBuy }))} />
            </div>
            <p className="mt-2 text-xs text-muted">
              0 spends book cash. That starts at Starting cash. A later sale of this symbol puts the proceeds back, so a sale larger than the buy raises the next buy. It does not spend the rest of the Alpaca balance. A number above 0 is a fixed cap on that book cash.
            </p>
            {accountView && (
              <p className="mt-1 text-xs text-muted">
                Book cash {formatMoney(bookCash(account.startingCash, accountView.fills, accountView.positionQty, accountView.avgEntry ?? 0))}. Alpaca cash {formatMoney(accountView.cash)}.
                {accountView.positionQty > 0
                  ? " While this symbol is long, book cash is only the part not in the shares. The sale puts the proceeds back."
                  : ""}
              </p>
            )}
            <label className="mt-3 flex flex-col gap-1">
              <span className="text-xs text-muted">Reconciliation delay</span>
              <select
                className="desk-input"
                value={account.delay}
                onChange={(event) => setAccount((a) => ({ ...a, delay: event.target.value as DelayId }))}
              >
                {DELAYS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
              <Checkbox.Root
                checked={account.useConfirmedSaleProceeds}
                onCheckedChange={(value) => setAccount((a) => ({ ...a, useConfirmedSaleProceeds: value === true }))}
                className="flex size-6 items-center justify-center rounded-sm border border-line bg-ink text-ink outline-none focus-visible:ring-2 focus-visible:ring-bronze data-[state=checked]:border-bronze data-[state=checked]:bg-bronze"
                aria-label="Use confirmed sale proceeds"
              >
                <Checkbox.Indicator>
                  <Check className="size-4" strokeWidth={2.5} />
                </Checkbox.Indicator>
              </Checkbox.Root>
              Use confirmed sale proceeds
            </label>
            <div className="mt-4 border-t border-line pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-medium">Date range</h3>
                {(account.fromDate || account.toDate) && (
                  <button
                    type="button"
                    className="text-xs text-bronze"
                    onClick={() => setAccount((a) => ({ ...a, fromDate: "", toDate: "" }))}
                  >
                    Whole tape
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm text-muted text-pretty">
                From is the first session that can fill. Leave To empty and the book runs through the newest candle, including bars added the next time you press Load. Set To only when you want a fixed last session. Press Recalculate after you change either date.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs text-muted">From</span>
                  <input
                    type="date"
                    className="desk-input"
                    aria-label="From session"
                    min={tape ? sessionKey(tape.bars[0].t) : undefined}
                    max={tape ? sessionKey(tape.bars[tape.bars.length - 1].t) : undefined}
                    value={account.fromDate}
                    onChange={(event) => setAccount((a) => ({ ...a, fromDate: sessionDate(event.target.value) }))}
                  />
                </label>
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs text-muted">To</span>
                  <input
                    type="date"
                    className="desk-input"
                    aria-label="To session"
                    min={tape ? sessionKey(tape.bars[0].t) : undefined}
                    max={tape ? sessionKey(tape.bars[tape.bars.length - 1].t) : undefined}
                    value={account.toDate}
                    onChange={(event) => setAccount((a) => ({ ...a, toDate: sessionDate(event.target.value) }))}
                  />
                </label>
              </div>
            </div>
            {accountView ? (
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 font-mono text-sm tabular-nums">
                <div>
                  <dt className="text-xs text-muted">Cash</dt>
                  <dd>{formatMoney(accountView.cash)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Equity</dt>
                  <dd>{formatMoney(accountView.equity)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Buying power</dt>
                  <dd>{formatMoney(accountView.buyingPower)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{symbol}</dt>
                  <dd>{accountView.positionQty > 0 ? `Long ${formatQty(accountView.positionQty)}` : accountView.positionQty < 0 ? `Short ${formatQty(Math.abs(accountView.positionQty))}` : "Flat"}</dd>
                </div>
              </dl>
            ) : last && (
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 font-mono text-sm tabular-nums">
                <div>
                  <dt className="text-xs text-muted">Settled</dt>
                  <dd>{formatMoney(last.cashAfter)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Unsettled</dt>
                  <dd>{formatMoney(last.unsettledAfter)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Buying power</dt>
                  <dd>{formatMoney(last.buyingPowerAfter)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Position</dt>
                  <dd>{last.sharesAfter > 0 ? `Long ${formatQty(last.sharesAfter)}` : "Flat"}</dd>
                </div>
              </dl>
            )}
          </section>
        </div>
      </aside>

      <main className="order-2 flex min-w-0 flex-col gap-4 px-4 py-4 lg:order-none lg:col-start-2 lg:row-start-2 lg:overflow-y-auto">
        {tape?.notice && (
          <p data-testid="sample-banner" className="rounded-lg bg-bronze px-4 py-3 text-sm font-medium text-ink" role="status">
            {tape.notice}. These bars are simulated so the desk can still run. They are not market prints.
          </p>
        )}
        <AlpacaPanel
          symbol={symbol}
          signal={accountSignal}
          sample={tape?.source === "sample"}
          from={tape?.bars[0]?.t ?? 0}
          to={tape?.bars[tape.bars.length - 1]?.t ?? 0}
          onAccount={setAccountView}
          onRefresh={() => setReload((value) => value + 1)}
          params={liveParams}
          account={runAccount}
          interval={tape?.interval ?? interval}
        />
        {!tape || !result ? (
          <div className="desk-panel flex h-80 items-center px-4 text-sm text-muted">Pulling the {symbol} tape…</div>
        ) : (
          <ChartPane
            bars={tape.bars}
            ind={(readBook ?? result).indicators}
            fills={showingAccount ? accountFills : result.fills}
            missed={showingAccount ? missed : undefined}
            params={liveParams}
            holdOn={(readBook ?? result).holdOn}
            recover={(readBook ?? result).recover}
            buyAt={(readBook ?? result).buyAt}
            sellAt={(readBook ?? result).sellAt}
            logic={(readBook ?? result).logic}
            view={view.end > view.start ? view : { start: 0, end: tape.bars.length }}
            onView={(next, manual) => {
              setView(next);
              if (manual) setWindowId(null);
            }}
            windowId={windowId}
            onWindow={(id) => {
              setWindowId(id);
              setView(viewForWindow(result.indicators.session, id));
            }}
            selected={selected}
            onSelect={setSelected}
            interval={tape.interval}
          />
        )}

        <section data-testid="explain" className="desk-panel shrink-0 p-4">
          {!explain || !tape ? (
            <p className="text-sm text-muted text-pretty">
              {book === "live"
                ? "The live book has no orders. Switch to play money and select a candle to read each switched-on rule."
                : "Select a candle to see why each switched-on buy or sell rule passed or failed, and whether the book was flat or already long."}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-sm font-medium">{showingAccount ? "Strategy read" : "Play-money read"}</h2>
                <p className="mt-1 font-mono text-xs text-muted tabular-nums">
                  {formatWhen(tape.bars[explain.index].t, tape.interval)} · close {formatPx(tape.bars[explain.index].c)}
                </p>
                <p className="mt-2 text-sm">
                  {showingAccount && accountView
                    ? `${accountName} is ${accountView.positionQty > 0 ? `long ${formatQty(accountView.positionQty)}` : "flat"}. ${
                        missed?.some((mark) => mark.index === explain.index)
                          ? "This bar was sent and Alpaca did not fill it."
                          : accountFills.some((fill) => fill.index === explain.index)
                            ? "Alpaca filled this bar."
                            : "This bar was not sent."
                      } The next order follows that position, not the play-money book.`
                    : <>
                        {explain.book === "flat" ? "Book was flat." : `Book was long ${formatQty(explain.shares)} shares.`}{" "}
                        {explain.sellHold && !explain.holdCancelled
                          ? `Sell hold is on. The session low is ${explain.dropFromPriorPct.toFixed(1)}% under the prior close ${formatPx(explain.priorClose)}${explain.holdRecover != null ? `, recovery at ${formatPx(explain.holdRecover)}` : ""}.`
                          : explain.holdCancelled
                            ? "Sell hold is off. This buy cancelled it for the rest of the session."
                            : "Sell hold is off."}{" "}
                      </>}
                </p>
                <p className="mt-1 text-sm">
                  {combinationCopy("buy", explain, runParams)} {combinationCopy("sell", explain, runParams)}
                </p>
                <p className="mt-1 text-sm">
                  {explain.action === "none"
                    ? "No fill."
                    : `${explain.action === "buy" ? "Filled a buy" : "Filled a sell"}. Fired: ${
                        explain.fired.map((id) => strategyName(id, runParams)).join(", ") || "none"
                      }.`}
                </p>
                {explain.skipped.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
                    {explain.skipped.map((skip, index) => (
                      <li key={`${skip.id}-${skip.side}-${index}`}>
                        {strategyName(skip.id, runParams, skip.side)} agreed to {skip.side} — {skip.reason}.
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {explain.strategies.map((strategy) => (
                  <article key={strategy.id} className="rounded-lg border border-line p-3">
                    <h3 className="text-sm font-medium">{strategy.name}</h3>
                    <p className="mt-1 text-sm">
                      {strategy.id === "drop" ? (
                        <span className="text-muted">Never buys. Blocks sells only while the hold is on.</span>
                      ) : (
                        <>
                          <span className={strategy.buyOn ? (strategy.buyVoting === false ? "text-muted" : strategy.wantBuy ? "text-buy" : "text-sell") : "text-muted"}>
                            {strategy.buyOn
                              ? `${strategy.buyVoting === false ? "Buy waiting" : strategy.wantBuy ? "Buy passes" : "Buy fails"} · ${asJoin(strategy.buyJoin) === "or" ? "OR" : "AND"}`
                              : "Buy off"}
                          </span>
                          <span className="text-muted"> · </span>
                          <span className={strategy.sellOn ? (strategy.sellVoting === false ? "text-muted" : strategy.wantSell ? "text-sell" : "text-muted") : "text-muted"}>
                            {strategy.sellOn
                              ? `${strategy.sellVoting === false ? "Sell waiting" : strategy.wantSell ? "Sell passes" : "Sell fails"} · ${asJoin(strategy.sellJoin) === "or" ? "OR" : "AND"}`
                              : "Sell off"}
                          </span>
                        </>
                      )}
                    </p>
                    <div className="mt-2 grid gap-2">
                      {(["buy", "sell"] as const).map((side) => {
                        const on = side === "buy" ? strategy.buyOn : strategy.sellOn;
                        if (strategy.id === "drop" && side === "buy") return null;
                        if (!on) {
                          return (
                            <p key={side} className="text-sm text-muted">
                              {side === "buy" ? "Buy" : "Sell"} side is off, so it is not in the test.
                            </p>
                          );
                        }
                        return (
                          <div key={side}>
                            <p className="text-xs uppercase tracking-widest text-muted">{side}</p>
                            <ul className="mt-1 flex flex-col gap-1">
                              {strategy[side].map((check) => (
                                <li key={check.label} className="text-sm">
                                  <span className={check.wait ? "text-muted" : check.pass ? "text-buy" : "text-sell"}>
                                    {check.wait ? "Wait" : check.pass ? "Pass" : "Fail"}
                                  </span>
                                  <span className="text-muted"> · {check.label}. </span>
                                  {check.detail}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>

        <section data-testid="stats">
          <div className="mb-2 flex gap-2" role="tablist" aria-label="Books">
            <button type="button" role="tab" aria-selected={book === "play"} className="desk-chip" data-on={book === "play"} onClick={() => setBook("play")}>
              Play money
            </button>
            <button type="button" role="tab" aria-selected={book === "live"} className="desk-chip" data-on={book === "live"} onClick={() => setBook("live")}>
              {accountView ? accountName : "Alpaca"}
            </button>
          </div>
          {book === "live" && !accountView ? (
            <p className="text-sm text-muted text-pretty">Alpaca is not connected. The curve and the blotter stay on play money until the paper or live account answers.</p>
          ) : book === "live" && accountView ? (
            <>
              <figure className="mb-3">
                <figcaption className="text-sm text-muted text-pretty">
                  Bronze is the {accountName.toLowerCase()}. Gray is buy and hold of {symbol} on this tape. The account line is Alpaca's equity, not the play-money book.
                </figcaption>
                <EquityCurve
                  strategy={accountCurve.some((value) => value > 0) ? accountCurve : [accountView.equity, accountView.equity]}
                  hold={(result?.holdEquity ?? []).slice(result?.rangeStart ?? 0, result?.rangeEnd ?? 0)}
                />
              </figure>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-line py-3 sm:grid-cols-3 xl:grid-cols-6">
                <div>
                  <dt className="text-xs text-muted">Account return</dt>
                  <dd className={`font-mono text-lg tabular-nums ${tone(seriesReturnPct(accountCurve))}`}>{formatPct(seriesReturnPct(accountCurve))}</dd>
                  <dd className="font-mono text-xs text-muted tabular-nums">{formatMoney(accountView.equity)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Buy and hold</dt>
                  <dd className={`font-mono text-lg tabular-nums ${tone(playStats?.buyHoldReturnPct ?? 0)}`}>{formatPct(playStats?.buyHoldReturnPct ?? 0)}</dd>
                  <dd className="font-mono text-xs text-muted tabular-nums">{formatMoney(playStats?.buyHoldEquity ?? 0)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Difference</dt>
                  <dd className={`font-mono text-lg tabular-nums ${tone(seriesReturnPct(accountCurve) - (playStats?.buyHoldReturnPct ?? 0))}`}>
                    {formatPct(seriesReturnPct(accountCurve) - (playStats?.buyHoldReturnPct ?? 0))}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Round trips</dt>
                  <dd className="font-mono text-lg tabular-nums">{roundTrips(accountView.fills)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Open orders</dt>
                  <dd className="font-mono text-lg tabular-nums">{accountView.orders.filter((order) => order.status !== "filled" && order.status !== "canceled" && order.status !== "expired" && order.status !== "rejected").length}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Max drawdown</dt>
                  <dd className={`font-mono text-lg tabular-nums ${drawdownPct(accountCurve) > 0 ? "text-sell" : "text-paper"}`}>
                    {drawdownPct(accountCurve).toFixed(2)}%
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-sm text-muted text-pretty">
                Return and drawdown use Alpaca's equity over this tape. Fills are Alpaca's prices. Buy and hold is still this symbol on the tape, so the difference is the account against the symbol.
              </p>
            </>
          ) : !playStats ? null : (
            <>
              <figure className="mb-3">
                <figcaption className="text-sm text-muted text-pretty">
                  Bronze is the cash account. Gray is buy and hold. Both include fees. The delay applies only to the cash account, because buy and hold never sells.
                  {runAccount.fromDate || runAccount.toDate
                    ? ` Sessions ${runAccount.fromDate || "the first bar"} through ${runAccount.toDate || "the last bar"}.`
                    : ""}
                </figcaption>
                <EquityCurve
                  strategy={(result?.trace ?? []).slice(result?.rangeStart ?? 0, result?.rangeEnd ?? 0).map((row) => row.equityAfter)}
                  hold={(result?.holdEquity ?? []).slice(result?.rangeStart ?? 0, result?.rangeEnd ?? 0)}
                />
              </figure>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-line py-3 sm:grid-cols-3 xl:grid-cols-6">
                <div>
                  <dt className="text-xs text-muted">Strategy return</dt>
                  <dd className={`font-mono text-lg tabular-nums ${tone(playStats.strategyReturnPct)}`}>{formatPct(playStats.strategyReturnPct)}</dd>
                  <dd className="font-mono text-xs text-muted tabular-nums">{formatMoney(playStats.endingEquity)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Buy and hold</dt>
                  <dd className={`font-mono text-lg tabular-nums ${tone(playStats.buyHoldReturnPct)}`}>{formatPct(playStats.buyHoldReturnPct)}</dd>
                  <dd className="font-mono text-xs text-muted tabular-nums">{formatMoney(playStats.buyHoldEquity)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Difference</dt>
                  <dd className={`font-mono text-lg tabular-nums ${tone(playStats.differencePct)}`}>{formatPct(playStats.differencePct)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Round trips</dt>
                  <dd className="font-mono text-lg tabular-nums">{playStats.roundTrips}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Skipped orders</dt>
                  <dd className="font-mono text-lg tabular-nums">{playStats.skipped}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Max drawdown</dt>
                  <dd className={`font-mono text-lg tabular-nums ${playStats.maxDrawdownPct > 0 ? "text-sell" : "text-paper"}`}>
                    {playStats.maxDrawdownPct.toFixed(2)}%
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-sm text-muted text-pretty">
                Fees and the reconciliation delay ({delayOf(account.delay).label}) are included. Buy and hold deploys the full starting cash once, with the same fees.
                {account.useConfirmedSaleProceeds ? " Confirmed sale proceeds are on." : ""}
              </p>
              {blocks.map((note) => (
                <p key={note} className="mt-2 text-sm text-bronze text-pretty">
                  {note} Turn that side off to leave it out of the test.
                </p>
              ))}
              {playStats.skipped > 0 && (
                <p className="mt-1 text-xs text-muted">
                  {Object.entries(playStats.skippedByReason)
                    .map(([reason, count]) => `${count} ${reason}`)
                    .join(" · ")}
                </p>
              )}
            </>
          )}
        </section>

        <section data-testid="blotter" className="desk-panel shrink-0 overflow-hidden">
          <div className="flex items-baseline justify-between gap-3 px-4 py-3">
            <h2 className="text-sm font-medium">{showingAccount ? `${accountName} blotter` : "Play-money blotter"}</h2>
            <p className="text-xs text-muted">{shownFills.length} fills</p>
          </div>
          {book === "live" && !accountView ? (
            <p className="border-t border-line px-4 py-6 text-sm text-muted">Alpaca is not connected, so this blotter has no fills yet.</p>
          ) : (
            <div className="max-h-[32rem] overflow-auto border-t border-line">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-surface text-muted">
                  <tr>
                    <th className="px-2 py-2 font-medium">Time</th>
                    <th className="px-2 py-2 font-medium">Side</th>
                    <th className="px-2 py-2 font-medium">Shares</th>
                    <th className="px-2 py-2 font-medium">Fill</th>
                    <th className="px-2 py-2 font-medium" title="Fill price minus the bar close">
                      vs close
                    </th>
                    <th className="px-2 py-2 font-medium" title="Account equity at this bar">
                      Portfolio
                    </th>
                    <th className="px-2 py-2 font-medium">Fee</th>
                    <th className="px-2 py-2 font-medium">Strategies</th>
                  </tr>
                </thead>
                <tbody>
                  {shownFills.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-2 py-6 text-muted">
                        {showingAccount ? `No ${symbol} fills in this window.` : "No play-money fills on this tape."}
                      </td>
                    </tr>
                  )}
                  {shownFills.map((fill) => (
                    <tr
                      key={"id" in fill ? String(fill.id) : `${fill.side}-${fill.index}`}
                      data-fill-index={fill.index}
                      tabIndex={0}
                      className={`blotter-row cursor-pointer border-t border-line ${selected === fill.index ? "bg-ink" : ""}`}
                      onClick={() => jump(fill.index)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          jump(fill.index);
                        }
                      }}
                    >
                      <td className="px-2 py-2 font-mono tabular-nums">{tape ? formatWhen(fill.time, tape.interval) : ""}</td>
                      <td className={`px-2 py-2 ${fill.side === "buy" ? "text-buy" : "text-sell"}`}>{fill.side === "buy" ? "Buy" : "Sell"}</td>
                      <td className="px-2 py-2 font-mono tabular-nums">{formatQty(fill.shares)}</td>
                      <td className="px-2 py-2 font-mono tabular-nums">{formatPx(fill.price)}</td>
                      <td className="px-2 py-2 font-mono tabular-nums">{formatSignedPx(fill.price - fill.close)}</td>
                      <td className="px-2 py-2 font-mono tabular-nums">{formatMoney(fill.equityAfter)}</td>
                      <td className="px-2 py-2 font-mono tabular-nums">{formatMoney(fill.fee)}</td>
                      <td className="px-2 py-2">{showingAccount ? accountName : fill.strategies.map((id) => strategyName(id, runParams, fill.side)).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line px-4 py-2 text-xs text-muted">
            {showingAccount
              ? `Fills are from the ${accountName.toLowerCase()}. The price is Alpaca's fill, not the bar close. Click a row to jump the chart there.`
              : "Every fill is listed. Play-money fills print at the bar close. Portfolio value includes unsettled cash. Click a row to jump the chart there."}
          </p>
        </section>
      </main>
    </div>
  );
}
