import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import * as Switch from "@radix-ui/react-switch";
import * as Checkbox from "@radix-ui/react-checkbox";
import { Check, ChevronDown, ChevronUp, X } from "lucide-react";
import { ChartPane } from "@/components/desk/chart-pane";
import { explainAt, simulate, viewForWindow, type Explain, type Fill, type SimResult, type Stats, type StrategyRead } from "@/lib/desk/engine";
import {
  DELAYS,
  EMA_RELS,
  INTERVALS,
  STRATEGY_ORDER,
  asJoin,
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
  robustParams,
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
import { previewPathPrefix } from "@/lib/preview-path-prefix";

const STORE_KEY = "strategy-desk-settings-v4";
const BOOKS_KEY = "strategy-desk-books-v1";

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
const LIVE_FILLS: Fill[] = [];

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
    below: mergeSides(base.below, raw.below),
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

export function DeskApp() {
  const loadTape = useServerFn(fetchTape);
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
  const [windowId, setWindowId] = useState<WindowId | null>("5D");
  const [view, setView] = useState({ start: 0, end: 0 });
  const [selected, setSelected] = useState<number | null>(null);
  const [books, setBooks] = useState<SavedBook[]>([]);
  const [bookName, setBookName] = useState("");
  const [pickedBook, setPickedBook] = useState("");
  const [booksReady, setBooksReady] = useState(false);

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
    if (!ready) return;
    let cancel = false;
    setLoading(true);
    loadRef.current({ data: { symbol, interval } })
      .then((next) => {
        if (!cancel) setTape(next);
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

  const result = useMemo<SimResult | null>(
    () => (tape ? simulate(tape.bars, tape.interval, runParams, runAccount) : null),
    [tape, runParams, runAccount],
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
  const shownFills = book === "play" ? (result?.fills ?? []) : LIVE_FILLS;
  const explain =
    book === "play" && result && tape && selected != null && result.trace[selected]
      ? explainAt(selected, tape.bars, result.indicators, runParams, tape.interval, result.trace[selected])
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

  function loadRobust() {
    const nextParams = robustParams();
    const nextAccount = defaultAccount();
    setParams(nextParams);
    setRunParams(nextParams);
    setAccount(nextAccount);
    setRunAccount(nextAccount);
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
            <button type="button" className="desk-chip shrink-0" data-testid="robust-book" onClick={loadRobust}>
              Robust book
            </button>
          </form>
          <div className="flex items-center gap-3">
            <Switch.Root
              checked={false}
              onCheckedChange={() => undefined}
              aria-label="Live"
              data-testid="live-switch"
              className="relative h-8 w-14 shrink-0 rounded-full bg-line outline-none focus-visible:ring-2 focus-visible:ring-bronze"
            >
              <Switch.Thumb className="desk-thumb absolute top-1 left-0 block size-6 translate-x-1 rounded-full bg-paper" />
            </Switch.Root>
            <p className="max-w-xs text-sm text-pretty text-muted">
              <span className="font-medium text-paper">Live off. </span>
              Live orders stay off until a later session is armed.
            </p>
          </div>
        </div>
      </header>

      <aside className="order-3 border-line px-4 py-4 lg:order-none lg:col-start-1 lg:row-start-2 lg:overflow-y-auto lg:border-r">
        <div className="flex flex-col gap-4">
          <section className="desk-panel p-4">
            <h2 className="text-sm font-medium">Strategies</h2>
            <p className="mt-1 text-sm text-muted text-pretty">
              Each card is one test. Mark a side AND when it has to pass with the other AND rules, or OR when it can fire on its own. Together that is every AND, or any OR — [X and Y] or Z. This book starts as the SOXL 5-minute baseline, and every side that is on is AND. A buy needs the lower band within 2%, RSI at or under 30, a slope of at least −1% over 5 bars, volume of at least 1.5×, money flow at or under 50, and VWAP inside the candle. A sell needs the upper band within 2%, RSI at or over 60, and the close at or above VWAP. A session low 10% under the prior close blocks sells until price recovers halfway. A buy that session turns the hold off, including a drop that comes after the buy. Last fill, the hourly averages, and the trend tests start off. Robust book replaces that baseline with a slower money-flow dip: length 21, buy at or under 30, and only while the close is on or above the 4-hour line. It sells $2 above the last buy, or $1.25 under it, and leaves drop hold off so the stop can fire. The chart, blotter, and timing stay on the last calculation until you press Recalculate.
            </p>
            {tape && tape.interval !== "1d" && hoursOnTape > 0 && (
              <p className="mt-2 text-xs text-muted">This tape has {hoursOnTape} clock hours.</p>
            )}
            <div className="mt-4 flex flex-col gap-4">
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

              <article className="rounded-lg border border-line p-3">
                <h3 className="text-sm font-medium">Master matrix</h3>
                <p className="mt-2 text-sm text-muted text-pretty">
                  Use this when one AND group is not enough. A buy of A and B, or A and C, or B and D, is three buy rows. Drop hold stays off the table. It can still block a sale.
                </p>
                <MatrixEditor side="buy" params={params} onChange={(buy) => setParams((current) => ({ ...current, matrix: { ...current.matrix, buy } }))} />
                <MatrixEditor side="sell" params={params} onChange={(sell) => setParams((current) => ({ ...current, matrix: { ...current.matrix, sell } }))} />
              </article>

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

              <RuleCard
                title="Lower band"
                blurb="Buy within 2% when the buy percent is 102. The close passes at or under that percent of the lower band. The sell percent is its own number."
                rule={params.lower}
                onRule={(patch) => setParams((p) => ({ ...p, lower: { ...p.lower, ...patch } }))}
              >
                <NumField label="Buy percent" value={params.lower.buyPct} step={0.1} onChange={(buyPct) => setParams((p) => ({ ...p, lower: { ...p.lower, buyPct } }))} />
                <NumField label="Sell percent" value={params.lower.sellPct} step={0.1} onChange={(sellPct) => setParams((p) => ({ ...p, lower: { ...p.lower, sellPct } }))} />
              </RuleCard>

              <RuleCard
                title="Upper band"
                blurb="Sell within 2% when the sell percent is 98. The close passes at or over that percent of the upper band. The buy percent is its own number."
                rule={params.upper}
                onRule={(patch) => setParams((p) => ({ ...p, upper: { ...p.upper, ...patch } }))}
              >
                <NumField label="Buy percent" value={params.upper.buyPct} step={0.1} onChange={(buyPct) => setParams((p) => ({ ...p, upper: { ...p.upper, buyPct } }))} />
                <NumField label="Sell percent" value={params.upper.sellPct} step={0.1} onChange={(sellPct) => setParams((p) => ({ ...p, upper: { ...p.upper, sellPct } }))} />
              </RuleCard>

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
                <div className="mt-4 border-t border-line pt-3">
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
                <div className="mt-4 border-t border-line pt-3">
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
                <div className="mt-4 border-t border-line pt-3">
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
                    Buy when the reading is at or under this level. A level of 1 means the close is at or through the lower edge of its band. This test does not sell.
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
                <div className="mt-4 border-t border-line pt-3">
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
                    A slower average of this same reading. Sell while the reading is under that line. Buy while it is above the line. This is not the 4-hour price trend line. That line is in dollars, and this reading is not.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <NumField
                      label="Line length"
                      value={params.rti.line.length}
                      onChange={(length) => setParams((p) => ({ ...p, rti: { ...p.rti, line: { ...p.rti.line, length } } }))}
                    />
                  </div>
                </div>
              </article>

              <RuleCard
                title="VWAP in the candle"
                blurb="Passes when the candle's low-to-high range contains the session VWAP. That is the whole test."
                rule={params.vwap}
                onRule={(patch) => setParams((p) => ({ ...p, vwap: { ...p.vwap, ...patch } }))}
              />

              <RuleCard
                title="Close versus VWAP"
                blurb="Buy when the close is at or under session VWAP. Sell when the close is at or over it."
                rule={params.vwapPx}
                onRule={(patch) => setParams((p) => ({ ...p, vwapPx: { ...p.vwapPx, ...patch } }))}
              />

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
                );
              })}

              <article className="rounded-lg border border-line p-3">
                <h3 className="text-sm font-medium">EMA relations</h3>
                <p className="mt-2 text-sm text-muted text-pretty">
                  The three hourly averages are one family. A relation is a test you build from them, not a menu of every stack. Rank checks order. Touch checks whether 1, 2, or 3 lines coincide. Gap checks the distance between them. Each relation is its own voter. Mark it AND or OR the same way as the other cards.
                </p>
              </article>
              {EMA_RELS.map((id) => (
                <RelationCard key={id} id={id} slot={params[id]} params={params} onChange={(slot) => setParams((current) => ({ ...current, [id]: slot }))} />
              ))}

              <article className="rounded-lg border border-line p-3">
                <h3 className="text-sm font-medium">Trend line</h3>
                <p className="mt-2 text-sm text-muted text-pretty">
                  One straight-line fit. Slope and price are separate tests, so you can require either or both. Daily bars have no multi-bar hour window, so either test fails on a daily tape.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <NumField label="Hours" value={params.trend.hours} step={0.5} onChange={(hours) => setParams((p) => ({ ...p, trend: { ...p.trend, hours } }))} />
                </div>
              </article>

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

              <RuleCard
                title={strategyName("trendLine", params)}
                blurb="Buy when the close is on or above the fitted line. Sell when the close is on or under it."
                rule={params.trend.line}
                onRule={(patch) => setParams((p) => ({ ...p, trend: { ...p.trend, line: { ...p.trend.line, ...patch } } }))}
              />

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
            </div>
          </section>

          <section className="desk-panel p-4">
            <h2 className="text-sm font-medium">Play-money account</h2>
            <p className="mt-1 text-sm text-muted text-pretty">
              {account.useConfirmedSaleProceeds
                ? "Confirmed sale proceeds are on. A filled sell can fund the next buy immediately. That is still only this account's cash. No margin."
                : "After a sell, that cash is not buying power until the reconciliation delay passes. Shares leave the position as soon as the sell fills. No margin."}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <NumField label="Starting cash" value={account.startingCash} step={100} onChange={(startingCash) => setAccount((a) => ({ ...a, startingCash }))} />
              <NumField label="Flat fee" value={account.flatFee} step={0.01} onChange={(flatFee) => setAccount((a) => ({ ...a, flatFee }))} />
              <NumField label="Percent fee" value={account.percentFee} step={0.01} onChange={(percentFee) => setAccount((a) => ({ ...a, percentFee }))} />
              <NumField label="Dollars per buy" value={account.dollarsPerBuy} step={100} onChange={(dollarsPerBuy) => setAccount((a) => ({ ...a, dollarsPerBuy }))} />
            </div>
            <p className="mt-2 text-xs text-muted">0 dollars per buy uses the cash that is allowed.</p>
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
            {last && (
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
        {!tape || !result ? (
          <div className="desk-panel flex h-80 items-center px-4 text-sm text-muted">Pulling the {symbol} tape…</div>
        ) : (
          <ChartPane
            bars={tape.bars}
            ind={result.indicators}
            fills={book === "play" ? result.fills : LIVE_FILLS}
            params={runParams}
            holdOn={result.holdOn}
            recover={result.recover}
            buyAt={result.buyAt}
            sellAt={result.sellAt}
            logic={result.logic}
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
                <h2 className="text-sm font-medium">Play-money read</h2>
                <p className="mt-1 font-mono text-xs text-muted tabular-nums">
                  {formatWhen(tape.bars[explain.index].t, tape.interval)} · close {formatPx(tape.bars[explain.index].c)}
                </p>
                <p className="mt-2 text-sm">
                  {explain.book === "flat" ? "Book was flat." : `Book was long ${formatQty(explain.shares)} shares.`}{" "}
                  {explain.sellHold && !explain.holdCancelled
                    ? `Sell hold is on. The session low is ${explain.dropFromPriorPct.toFixed(1)}% under the prior close ${formatPx(explain.priorClose)}${explain.holdRecover != null ? `, recovery at ${formatPx(explain.holdRecover)}` : ""}.`
                    : explain.holdCancelled
                      ? "Sell hold is off. This buy cancelled it for the rest of the session."
                      : "Sell hold is off."}{" "}
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
              Live book
            </button>
          </div>
          {book === "live" || !playStats ? (
            <p className="text-sm text-muted text-pretty">Live book is empty. Live orders stay off until a later session is armed. Play-money fills stay in the other book.</p>
          ) : (
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
            <h2 className="text-sm font-medium">{book === "play" ? "Play-money blotter" : "Live blotter"}</h2>
            <p className="text-xs text-muted">{book === "play" ? `${shownFills.length} fills` : "Separate book"}</p>
          </div>
          {book === "live" ? (
            <p className="border-t border-line px-4 py-6 text-sm text-muted">No live fills. Live orders stay off until a later session is armed.</p>
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
                    <th className="px-2 py-2 font-medium" title="Portfolio value after the fill, including unsettled cash">
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
                        No play-money fills on this tape.
                      </td>
                    </tr>
                  )}
                  {shownFills.map((fill) => (
                    <tr
                      key={`${fill.side}-${fill.index}`}
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
                      <td className="px-2 py-2">{fill.strategies.map((id) => strategyName(id, runParams, fill.side)).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line px-4 py-2 text-xs text-muted">
            Every fill is listed. Play-money fills print at the bar close. Portfolio value includes unsettled cash. Click a row to jump the chart there.
          </p>
        </section>
      </main>
    </div>
  );
}
