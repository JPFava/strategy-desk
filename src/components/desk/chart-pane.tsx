import { useEffect, useRef, useState, type RefObject } from "react";
import type { Bar, DeskParams, Interval, WindowId } from "@/lib/desk/model";
import { deskColors, formatPx, formatQty, formatWhen, WINDOWS } from "@/lib/desk/model";
import type { Fill, Indicators, LogicDiagram, LogicLane, LogicLevel } from "@/lib/desk/engine";

type View = { start: number; end: number };

export type ChartMark = { index: number; side: "buy" | "sell" };

type Props = {
  bars: Bar[];
  ind: Indicators;
  fills: Fill[];
  missed?: ChartMark[];
  params: DeskParams;
  holdOn: boolean[];
  recover: (number | null)[];
  buyAt: (number | null)[];
  sellAt: (number | null)[];
  logic: LogicDiagram;
  view: View;
  onView: (view: View, manual: boolean) => void;
  windowId: WindowId | null;
  onWindow: (id: WindowId) => void;
  selected: number | null;
  onSelect: (index: number) => void;
  interval: Interval;
};

const PAD_L = 8;
const PAD_R = 68;

function shown(node: { buyOn: boolean; sellOn: boolean } | undefined): boolean {
  return Boolean(node && (node.buyOn || node.sellOn));
}

function emaLaneOn(params: DeskParams, lane: "fast" | "mid" | "slow"): boolean {
  const node = lane === "fast" ? params.ema20 : lane === "mid" ? params.ema50 : params.ema100;
  if (shown(node)) return true;
  return (["emaA", "emaB", "emaC"] as const).some((id) => {
    const slot = params[id];
    return Boolean(slot && (slot.buyOn || slot.sellOn) && slot.clause.members.includes(lane));
  });
}

function bandsOn(params: DeskParams): boolean {
  return shown(params.lower) || shown(params.upper) || shown(params.slope);
}

function vwapOn(params: DeskParams): boolean {
  return shown(params.vwap) || shown(params.vwapPx);
}

function trendOn(params: DeskParams): boolean {
  return shown(params.trend.slope) || shown(params.trend.line);
}

type SeriesId =
  | "bands"
  | "vwap"
  | "ema20"
  | "ema50"
  | "ema100"
  | "trend"
  | "stepSell"
  | "stepBuy"
  | "prior"
  | "recover"
  | "rsi"
  | "mfi"
  | "rti"
  | "rtiLine";

type Scale = "price" | "osc";

const SERIES: { id: SeriesId; scale: Scale; label: string; color: string; dash?: number[] }[] = [
  { id: "bands", scale: "price", label: "Bands", color: deskColors.paper },
  { id: "vwap", scale: "price", label: "VWAP", color: deskColors.bronze },
  { id: "ema20", scale: "price", label: "Fast EMA", color: deskColors.buy },
  { id: "ema50", scale: "price", label: "Mid EMA", color: deskColors.slate },
  { id: "ema100", scale: "price", label: "Slow EMA", color: "#d08c6a" },
  { id: "trend", scale: "price", label: "Trend", color: deskColors.sell, dash: [2, 3] },
  { id: "stepSell", scale: "price", label: "Above last buy", color: deskColors.sell, dash: [8, 4] },
  { id: "stepBuy", scale: "price", label: "Below last sell", color: deskColors.buy, dash: [8, 4] },
  { id: "prior", scale: "price", label: "Prior close", color: deskColors.muted, dash: [2, 3] },
  { id: "recover", scale: "price", label: "Recovery", color: "#f0d2a0", dash: [5, 4] },
  { id: "rsi", scale: "osc", label: "RSI", color: deskColors.paper },
  { id: "mfi", scale: "osc", label: "Money flow", color: deskColors.bronze },
  { id: "rti", scale: "osc", label: "RTI", color: deskColors.slate },
  { id: "rtiLine", scale: "osc", label: "RTI line", color: deskColors.sell, dash: [4, 3] },
];

const GRAPH_KEY = "strategy-desk-graph-v1";

function strategyDraws(id: SeriesId, params: DeskParams): boolean {
  switch (id) {
    case "bands":
      return bandsOn(params);
    case "vwap":
      return vwapOn(params);
    case "ema20":
      return emaLaneOn(params, "fast");
    case "ema50":
      return emaLaneOn(params, "mid");
    case "ema100":
      return emaLaneOn(params, "slow");
    case "trend":
      return trendOn(params);
    case "stepSell":
      return params.step.sellOn;
    case "stepBuy":
      return params.step.buyOn;
    case "prior":
    case "recover":
      return params.drop.sellOn;
    case "rsi":
      return shown(params.rsi);
    case "mfi":
      return shown(params.mfi);
    case "rti":
      return shown(params.rti.direction) || shown(params.rti.strength) || shown(params.rti.line) || shown(params.rti.negative) || shown(params.rti.reversal) || shown(params.rti.below);
    case "rtiLine":
      return shown(params.rti.line);
    default:
      return false;
  }
}

function seriesLabel(id: SeriesId, params: DeskParams): string {
  if (id === "ema20") return `${params.ema20.hours}-hour EMA`;
  if (id === "ema50") return `${params.ema50.hours}-hour EMA`;
  if (id === "ema100") return `${params.ema100.hours}-hour EMA`;
  if (id === "trend") {
    const hours = params.trend.hours;
    const label = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
    return `${label}-hour trend`;
  }
  return SERIES.find((item) => item.id === id)?.label ?? id;
}

function formatAxis(t: number, interval: Interval): string {
  if (interval === "1d") {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
    }).format(new Date(t));
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(t));
}

function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function zoomView(view: View, cursor: number, factor: number, n: number): View {
  const span = Math.max(1, view.end - view.start);
  let next = Math.round(span * factor);
  next = Math.max(Math.min(12, n), Math.min(n, next));
  const ratio = (cursor - view.start) / span;
  let start = Math.round(cursor - ratio * next);
  if (start < 0) start = 0;
  if (start + next > n) start = Math.max(0, n - next);
  return { start, end: Math.min(n, start + next) };
}

function panView(view: View, delta: number, n: number): View {
  const span = Math.max(1, view.end - view.start);
  let start = view.start + delta;
  if (start < 0) start = 0;
  if (start + span > n) start = Math.max(0, n - span);
  return { start, end: Math.min(n, start + span) };
}

function indexAt(x: number, width: number, view: View): number {
  const plotW = Math.max(1, width - PAD_L - PAD_R);
  const span = Math.max(1, view.end - view.start);
  const rel = (x - PAD_L) / plotW;
  return Math.min(view.end - 1, Math.max(view.start, view.start + Math.floor(rel * span)));
}

function xOf(i: number, view: View, plotW: number): number {
  const span = Math.max(1, view.end - view.start);
  return PAD_L + ((i - view.start + 0.5) / span) * plotW;
}

function setup(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function rangeOf(values: Array<number | null | undefined>): { lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (lo === hi) return { lo: lo - 1, hi: hi + 1 };
  const pad = (hi - lo) * 0.06;
  return { lo: lo - pad, hi: hi + pad };
}

function strokeLine(
  ctx: CanvasRenderingContext2D,
  series: (number | null)[],
  view: View,
  plotW: number,
  yOf: (v: number) => number,
  color: string,
  width: number,
  dash: number[] = [],
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  let pen = false;
  for (let i = view.start; i < view.end; i++) {
    const value = series[i];
    if (value == null || !Number.isFinite(value)) {
      pen = false;
      continue;
    }
    const x = xOf(i, view, plotW);
    const y = yOf(value);
    if (!pen) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    pen = true;
  }
  ctx.stroke();
  ctx.restore();
}

const LOGIC_HEAD = 16;
const LOGIC_ROW = 18;

function stripPx(count: number): number {
  return count === 0 ? 36 : LOGIC_HEAD + count * LOGIC_ROW + 2;
}

function bitLabel(level: LogicLevel): string {
  if (level === 1) return "1";
  if (level === 0) return "0";
  return "Z";
}

function drawTiming(
  canvas: HTMLCanvasElement | null,
  width: number,
  height: number,
  view: View,
  lanes: LogicLane[],
  ticks: boolean[],
  side: "buy" | "sell",
  hover: number | null,
  selected: number | null,
) {
  if (!canvas || width < 2 || height < 2) return;
  const ctx = setup(canvas, width, height);
  if (!ctx) return;
  const plotW = Math.max(1, width - PAD_L - PAD_R);
  const span = Math.max(1, view.end - view.start);
  const slot = plotW / span;
  const color = side === "buy" ? deskColors.buy : deskColors.sell;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = deskColors.ink;
  ctx.fillRect(0, 0, width, height);
  ctx.font = "10px IBM Plex Sans, ui-sans-serif, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillStyle = deskColors.muted;
  ctx.textAlign = "left";
  ctx.fillText("ALL", PAD_L + plotW + 6, 9);

  for (let i = view.start; i < view.end; i++) {
    if (!ticks[i]) continue;
    const x = xOf(i, view, plotW);
    ctx.fillStyle = color;
    if (slot < 3) {
      ctx.fillRect(x, 2, 1, 10);
    } else {
      const half = Math.min(3.5, slot * 0.32);
      ctx.beginPath();
      ctx.moveTo(x, 2);
      ctx.lineTo(x - half, 12);
      ctx.lineTo(x + half, 12);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (lanes.length === 0) {
    ctx.fillStyle = deskColors.muted;
    ctx.font = "12px IBM Plex Sans, ui-sans-serif, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(side === "buy" ? "No buy rules are on." : "No sell rules are on.", PAD_L, LOGIC_HEAD + 10);
  }

  lanes.forEach((lane, row) => {
    const top = LOGIC_HEAD + row * LOGIC_ROW;
    const hi = top + 3;
    const lo = top + LOGIC_ROW - 3;
    const mid = (hi + lo) / 2;
    ctx.fillStyle = row % 2 === 0 ? rgba(deskColors.paper, 0.035) : "transparent";
    ctx.fillRect(PAD_L, top, plotW, LOGIC_ROW);
    ctx.strokeStyle = rgba(deskColors.paper, 0.08);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_L, top);
    ctx.lineTo(PAD_L + plotW, top);
    ctx.stroke();

    const yOf = (level: LogicLevel) => (level === 1 ? hi : level === 0 ? lo : mid);
    if (slot < 1.4) {
      for (let i = view.start; i < view.end; i++) {
        const level = lane.levels[i] ?? 0;
        const x = xOf(i, view, plotW);
        if (level === 1) {
          ctx.fillStyle = color;
          ctx.fillRect(x, hi, 1, Math.max(1, lo - hi));
        } else if (level === 2) {
          ctx.fillStyle = deskColors.muted;
          ctx.fillRect(x, mid, 1, 1);
        }
      }
    } else {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.35;
      let drawing = false;
      const flush = () => {
        if (!drawing) return;
        ctx.stroke();
        ctx.beginPath();
        drawing = false;
      };
      for (let i = view.start; i < view.end; i++) {
        const level = lane.levels[i] ?? 0;
        const xL = xOf(i, view, plotW) - slot / 2;
        const xR = xOf(i, view, plotW) + slot / 2;
        if (level === 2) {
          flush();
          ctx.save();
          ctx.strokeStyle = deskColors.muted;
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(Math.max(PAD_L, xL), mid);
          ctx.lineTo(Math.min(PAD_L + plotW, xR), mid);
          ctx.stroke();
          ctx.restore();
          ctx.strokeStyle = color;
          ctx.setLineDash([]);
          continue;
        }
        const y = yOf(level);
        const prev = i > view.start ? (lane.levels[i - 1] ?? 0) : level;
        if (!drawing) {
          ctx.beginPath();
          ctx.moveTo(Math.max(PAD_L, xL), y);
          drawing = true;
        } else if (prev !== level && prev !== 2) {
          ctx.lineTo(Math.max(PAD_L, xL), yOf(prev));
          ctx.lineTo(Math.max(PAD_L, xL), y);
        } else if (prev === 2) {
          ctx.moveTo(Math.max(PAD_L, xL), y);
        }
        ctx.lineTo(Math.min(PAD_L + plotW, xR), y);
      }
      flush();
    }

    ctx.fillStyle = deskColors.paper;
    ctx.font = "10px IBM Plex Sans, ui-sans-serif, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(lane.name, PAD_L + plotW + 6, (hi + lo) / 2);
  });

  const mark = hover ?? selected;
  if (mark != null && mark >= view.start && mark < view.end) {
    const x = xOf(mark, view, plotW);
    ctx.strokeStyle = mark === selected ? deskColors.bronze : rgba(deskColors.paper, 0.35);
    ctx.lineWidth = 1;
    ctx.setLineDash(mark === selected ? [] : [3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function TimingStrip({
  host,
  canvas,
  title,
  height,
  lanes,
  ticks,
  focus,
}: {
  host: RefObject<HTMLDivElement | null>;
  canvas: RefObject<HTMLCanvasElement | null>;
  title: string;
  height: number;
  lanes: LogicLane[];
  ticks: boolean[];
  focus: number | null;
}) {
  const probe =
    focus == null
      ? ""
      : lanes.length === 0
        ? "No rules on this side."
        : `${lanes.map((lane) => (lane.kind === "group" || lane.kind === "hold" || lane.id === "drop" ? `${lane.name} ${bitLabel(lane.levels[focus] ?? 0)}` : `${lane.name} ${bitLabel(lane.levels[focus] ?? 0)} ${lane.join === "or" ? "OR" : "AND"}`)).join("   ")}   ALL ${ticks[focus] ? "1" : "0"}`;
  return (
    <div className="border-t border-line">
      <p className="px-4 pt-2 text-xs font-medium">{title}</p>
      <div
        ref={host}
        tabIndex={0}
        style={{ height }}
        className="relative touch-none outline-none focus-visible:ring-2 focus-visible:ring-bronze"
        aria-label={`${title}. High is true, low is false, lined up with the candles.`}
      >
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      </div>
      <p className="px-4 py-1 font-mono text-xs text-muted tabular-nums text-pretty">{probe}</p>
    </div>
  );
}

function GraphLegend({
  title,
  items,
  params,
  drawn,
  hot,
  onHot,
  onToggle,
  accountMarks,
}: {
  title: string;
  items: typeof SERIES;
  params: DeskParams;
  drawn: (id: SeriesId) => boolean;
  hot: SeriesId | null;
  onHot: (id: SeriesId | null) => void;
  onToggle: (id: SeriesId) => void;
  accountMarks?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 px-3 py-1" data-testid={title === "Dollars" ? "legend-price" : "legend-osc"}>
      <span className="px-1 text-xs font-medium text-muted">{title}</span>
      {items.map((item) => {
        const on = drawn(item.id);
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={on}
            aria-label={`${on ? "Hide" : "Show"} ${seriesLabel(item.id, params)}`}
            className="flex h-11 cursor-pointer items-center gap-2 rounded-sm border px-2"
            style={{ borderColor: hot === item.id ? item.color : "transparent", opacity: on ? 1 : 0.55 }}
            onClick={() => onToggle(item.id)}
            onPointerEnter={() => onHot(item.id)}
            onPointerLeave={() => onHot(null)}
          >
            <span className="relative h-5 w-9 shrink-0 rounded-full" style={{ background: on ? item.color : deskColors.line }} aria-hidden>
              <span
                className="absolute top-0.5 size-4 rounded-full"
                style={{ left: on ? "1.05rem" : "0.125rem", background: on ? deskColors.ink : deskColors.paper }}
              />
            </span>
            <span className="size-3 shrink-0 rounded-sm" style={{ background: item.color }} aria-hidden />
            <span className="text-xs" style={{ color: on ? item.color : deskColors.muted }}>
              {seriesLabel(item.id, params)}
            </span>
          </button>
        );
      })}
      {title === "Dollars" && (
        <>
          <span className="flex h-11 items-center gap-2 px-2 text-xs text-buy">
            <span className="size-3 rounded-sm bg-buy" aria-hidden />
            Up candle and buy
          </span>
          <span className="flex h-11 items-center gap-2 px-2 text-xs text-sell">
            <span className="size-3 rounded-sm bg-sell" aria-hidden />
            Down candle and sell
          </span>
          {accountMarks && (
            <span className="flex h-11 items-center gap-2 px-2 text-xs text-muted">Open triangle: signal, no trade. Solid triangle: Alpaca fill.</span>
          )}
        </>
      )}
    </div>
  );
}

function ResizeBar({ label, height, onDrag }: { label: string; height: number; onDrag: (next: number) => void }) {
  const startY = useRef(0);
  const startH = useRef(height);
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      className="flex h-11 cursor-row-resize touch-none items-center justify-center border-t border-line"
      onPointerDown={(event) => {
        startY.current = event.clientY;
        startH.current = height;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onDrag(startH.current + (event.clientY - startY.current));
      }}
    >
      <span className="h-1 w-12 rounded-full" style={{ background: deskColors.line }} />
    </div>
  );
}

function markTriangle(ctx: CanvasRenderingContext2D, x: number, y: number, buy: boolean, open: boolean) {
  ctx.beginPath();
  if (buy) {
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x - 5, y - 4);
    ctx.lineTo(x + 5, y - 4);
  } else {
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x - 5, y + 4);
    ctx.lineTo(x + 5, y + 4);
  }
  ctx.closePath();
  if (open) {
    ctx.fillStyle = deskColors.ink;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = buy ? deskColors.buy : deskColors.sell;
    ctx.stroke();
  } else {
    ctx.fillStyle = buy ? deskColors.buy : deskColors.sell;
    ctx.fill();
  }
}

export function ChartPane({
  bars,
  ind,
  fills,
  missed,
  params,
  holdOn,
  recover,
  buyAt,
  sellAt,
  logic,
  view,
  onView,
  windowId,
  onWindow,
  selected,
  onSelect,
  interval,
}: Props) {
  const priceHost = useRef<HTMLDivElement>(null);
  const indHost = useRef<HTMLDivElement>(null);
  const buyHost = useRef<HTMLDivElement>(null);
  const sellHost = useRef<HTMLDivElement>(null);
  const priceRef = useRef<HTMLCanvasElement>(null);
  const indRef = useRef<HTMLCanvasElement>(null);
  const buyRef = useRef<HTMLCanvasElement>(null);
  const sellRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef(view);
  const onViewRef = useRef(onView);
  const onSelectRef = useRef(onSelect);
  viewRef.current = view;
  onViewRef.current = onView;
  onSelectRef.current = onSelect;
  const [hover, setHover] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ pane: "price" | "osc"; y: number } | null>(null);
  const [hot, setHot] = useState<SeriesId | null>(null);
  const [graph, setGraph] = useState<Partial<Record<SeriesId, boolean>>>({});
  const [priceH, setPriceH] = useState(208);
  const [oscH, setOscH] = useState(112);
  const [graphReady, setGraphReady] = useState(false);
  const [size, setSize] = useState({ w: 0, ph: 0, ih: 0, bh: 0, sh: 0 });

  useEffect(() => {
    const price = priceHost.current;
    const lower = indHost.current;
    const buy = buyHost.current;
    const sell = sellHost.current;
    if (!price || !lower || !buy || !sell) return;
    const measure = () => {
      const pr = price.getBoundingClientRect();
      setSize({
        w: pr.width,
        ph: pr.height,
        ih: lower.getBoundingClientRect().height,
        bh: buy.getBoundingClientRect().height,
        sh: sell.getBoundingClientRect().height,
      });
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(price);
    obs.observe(lower);
    obs.observe(buy);
    obs.observe(sell);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(GRAPH_KEY) || "{}") as {
        on?: Partial<Record<SeriesId, boolean>>;
        priceH?: number;
        oscH?: number;
      };
      if (raw.on && typeof raw.on === "object") setGraph(raw.on);
      if (typeof raw.priceH === "number") setPriceH(Math.min(560, Math.max(96, raw.priceH)));
      if (typeof raw.oscH === "number") setOscH(Math.min(360, Math.max(72, raw.oscH)));
      setGraphReady(true);
    } catch {
      setGraphReady(true);
    }
  }, []);

  useEffect(() => {
    if (!graphReady) return;
    localStorage.setItem(GRAPH_KEY, JSON.stringify({ on: graph, priceH, oscH }));
  }, [graph, graphReady, priceH, oscH]);

  const drawn = (id: SeriesId) => (typeof graph[id] === "boolean" ? Boolean(graph[id]) : strategyDraws(id, params));
  const toggleGraph = (id: SeriesId) => setGraph((prev) => ({ ...prev, [id]: !drawn(id) }));

  const hoverRef = useRef<number | null>(null);
  const selectedRef = useRef<number | null>(selected);
  selectedRef.current = selected;

  useEffect(() => {
    const hosts = [priceHost.current, indHost.current, buyHost.current, sellHost.current].filter((node): node is HTMLDivElement => Boolean(node));
    if (!hosts.length) return;
    const drag = { on: false, moved: false, x: 0, view: viewRef.current, width: 1 };

    const localPoint = (event: PointerEvent | WheelEvent) => {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const pane = event.currentTarget === priceHost.current ? "price" : event.currentTarget === indHost.current ? "osc" : "time";
      return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, pane };
    };
    const onDown = (event: PointerEvent) => {
      const point = localPoint(event);
      drag.on = true;
      drag.moved = false;
      drag.x = event.clientX;
      drag.width = point.width;
      drag.view = viewRef.current;
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        /* pointer capture is unavailable for this event */
      }
    };
    const onMove = (event: PointerEvent) => {
      const point = localPoint(event);
      const current = viewRef.current;
      if (!drag.on) {
        if (point.pane === "price" || point.pane === "osc") setCursor({ pane: point.pane, y: point.y });
        else setCursor(null);
        if (point.x >= PAD_L && point.x <= point.width - PAD_R) {
          const next = indexAt(point.x, point.width, current);
          hoverRef.current = next;
          setHover(next);
        }
        return;
      }
      const dx = event.clientX - drag.x;
      if (Math.abs(dx) > 4) drag.moved = true;
      if (!drag.moved) return;
      const span = Math.max(1, drag.view.end - drag.view.start);
      const plotW = Math.max(1, drag.width - PAD_L - PAD_R);
      const delta = Math.round(-dx / (plotW / span));
      onViewRef.current(panView(drag.view, delta, bars.length), true);
    };
    const onUp = (event: PointerEvent) => {
      if (!drag.on) return;
      drag.on = false;
      if (!drag.moved) {
        const point = localPoint(event);
        onSelectRef.current(indexAt(point.x, point.width, viewRef.current));
      }
    };
    const onLeave = (event: PointerEvent) => {
      if (!drag.on) {
        hoverRef.current = null;
        setHover(null);
        const pane = event.currentTarget === priceHost.current ? "price" : event.currentTarget === indHost.current ? "osc" : "time";
        if (pane === "price" || pane === "osc") setCursor((prev) => (prev?.pane === pane ? null : prev));
      }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = localPoint(event);
      const current = viewRef.current;
      const cursor = indexAt(point.x, point.width, current);
      const factor = event.deltaY > 0 ? 1.18 : 1 / 1.18;
      onViewRef.current(zoomView(current, cursor, factor, bars.length), true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const current = viewRef.current;
      const base = hoverRef.current ?? selectedRef.current ?? current.end - 1;
      const next = event.key === "ArrowLeft" ? Math.max(current.start, base - 1) : Math.min(current.end - 1, base + 1);
      hoverRef.current = next;
      setHover(next);
      onSelectRef.current(next);
    };
    for (const host of hosts) {
      host.addEventListener("pointerdown", onDown);
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerup", onUp);
      host.addEventListener("pointercancel", onUp);
      host.addEventListener("pointerleave", onLeave);
      host.addEventListener("wheel", onWheel, { passive: false });
      host.addEventListener("keydown", onKey);
    }
    return () => {
      for (const host of hosts) {
        host.removeEventListener("pointerdown", onDown);
        host.removeEventListener("pointermove", onMove);
        host.removeEventListener("pointerup", onUp);
        host.removeEventListener("pointercancel", onUp);
        host.removeEventListener("pointerleave", onLeave);
        host.removeEventListener("wheel", onWheel);
        host.removeEventListener("keydown", onKey);
      }
    };
  }, [bars.length]);

  useEffect(() => {
    const canvas = priceRef.current;
    if (!canvas || size.w < 2 || size.ph < 2 || bars.length === 0) return;
    const ctx = setup(canvas, size.w, size.ph);
    if (!ctx) return;
    const width = size.w;
    const height = size.ph;
    const plotW = Math.max(1, width - PAD_L - PAD_R);
    const plot = { x: PAD_L, y: 12, w: plotW, h: Math.max(1, height - 12 - 22) };
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = deskColors.surface;
    ctx.fillRect(0, 0, width, height);

    const on = (id: SeriesId) => (typeof graph[id] === "boolean" ? Boolean(graph[id]) : strategyDraws(id, params));
    const look = (id: SeriesId, near: SeriesId | null) => {
      if (hot && hot !== id) return { alpha: 0.18, width: 1.15 };
      if (hot === id || near === id) return { alpha: 1, width: 2.8 };
      return { alpha: 1, width: 1.45 };
    };
    const paint = (id: SeriesId, series: (number | null)[], near: SeriesId | null, color?: string) => {
      const item = SERIES.find((entry) => entry.id === id);
      if (!item) return;
      const style = look(id, near);
      ctx.save();
      ctx.globalAlpha = style.alpha;
      strokeLine(ctx, series, view, plotW, yOf, color ?? item.color, style.width, item.dash ?? []);
      ctx.restore();
    };

    const vals: Array<number | null> = [];
    for (let i = view.start; i < view.end; i++) {
      vals.push(bars[i].h, bars[i].l);
      if (on("bands")) vals.push(ind.bandUpper[i], ind.bandLower[i], ind.bandMid[i]);
      if (on("vwap")) vals.push(ind.vwap[i]);
      if (on("prior")) vals.push(ind.priorClose[i]);
      if (on("recover")) vals.push(recover[i]);
      if (on("ema20")) vals.push(ind.ema20[i]);
      if (on("ema50")) vals.push(ind.ema50[i]);
      if (on("ema100")) vals.push(ind.ema100[i]);
      if (on("trend")) vals.push(ind.trend[i]);
      if (on("stepBuy")) vals.push(buyAt[i]);
      if (on("stepSell")) vals.push(sellAt[i]);
    }
    const span = rangeOf(vals) ?? { lo: 0, hi: 1 };
    const yOf = (v: number) => plot.y + ((span.hi - v) / (span.hi - span.lo)) * plot.h;

    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.w, plot.h);
    ctx.clip();

    let shadeStart = -1;
    for (let i = view.start; i <= view.end; i++) {
      const on = i < view.end && holdOn[i];
      if (on && shadeStart < 0) shadeStart = i;
      if (!on && shadeStart >= 0) {
        const x0 = xOf(shadeStart, view, plotW) - plotW / Math.max(1, view.end - view.start) / 2;
        const x1 = xOf(i - 1, view, plotW) + plotW / Math.max(1, view.end - view.start) / 2;
        ctx.fillStyle = rgba(deskColors.sell, 0.14);
        ctx.fillRect(x0, plot.y, Math.max(1, x1 - x0), plot.h);
        shadeStart = -1;
      }
    }

    const slot = plotW / Math.max(1, view.end - view.start);
    if (slot >= 1.6) {
      for (let i = view.start; i < view.end; i++) {
        const b = bars[i];
        const x = xOf(i, view, plotW);
        const up = b.c >= b.o;
        ctx.strokeStyle = up ? deskColors.buy : deskColors.sell;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(x, yOf(b.h));
        ctx.lineTo(x, yOf(b.l));
        ctx.stroke();
        const y1 = yOf(Math.max(b.o, b.c));
        const y2 = yOf(Math.min(b.o, b.c));
        const body = Math.max(1, y2 - y1);
        ctx.fillRect(x - Math.max(1, slot * 0.32), y1, Math.max(1.5, slot * 0.64), body);
      }
    } else {
      const buckets = new Map<number, { o: number; h: number; l: number; c: number; x: number }>();
      for (let i = view.start; i < view.end; i++) {
        const x = Math.floor(((i - view.start) / Math.max(1, view.end - view.start)) * plotW);
        const b = bars[i];
        const prev = buckets.get(x);
        if (!prev) buckets.set(x, { o: b.o, h: b.h, l: b.l, c: b.c, x: plot.x + x });
        else {
          prev.h = Math.max(prev.h, b.h);
          prev.l = Math.min(prev.l, b.l);
          prev.c = b.c;
        }
      }
      for (const bucket of buckets.values()) {
        const up = bucket.c >= bucket.o;
        ctx.strokeStyle = up ? deskColors.buy : deskColors.sell;
        ctx.beginPath();
        ctx.moveTo(bucket.x, yOf(bucket.h));
        ctx.lineTo(bucket.x, yOf(bucket.l));
        ctx.stroke();
      }
    }

    const mark = hover ?? selected;
    let near: SeriesId | null = null;
    if (cursor?.pane === "price" && mark != null && mark >= view.start && mark < view.end) {
      const cands: { id: SeriesId; y: number }[] = [];
      const add = (id: SeriesId, value: number | null | undefined) => {
        if (!on(id) || value == null || !Number.isFinite(value)) return;
        cands.push({ id, y: yOf(value) });
      };
      add("bands", ind.bandMid[mark]);
      add("bands", ind.bandUpper[mark]);
      add("bands", ind.bandLower[mark]);
      add("vwap", ind.vwap[mark]);
      add("ema20", ind.ema20[mark]);
      add("ema50", ind.ema50[mark]);
      add("ema100", ind.ema100[mark]);
      add("trend", ind.trend[mark]);
      add("stepSell", sellAt[mark]);
      add("stepBuy", buyAt[mark]);
      add("prior", ind.priorClose[mark]);
      add("recover", recover[mark]);
      let best = 12;
      for (const cand of cands) {
        const distance = Math.abs(cand.y - cursor.y);
        if (distance < best) {
          best = distance;
          near = cand.id;
        }
      }
    }

    if (on("bands")) {
      paint("bands", ind.bandUpper, near, rgba(deskColors.paper, 0.45));
      paint("bands", ind.bandLower, near, rgba(deskColors.paper, 0.45));
      paint("bands", ind.bandMid, near);
    }
    if (on("vwap")) paint("vwap", ind.vwap, near);
    if (on("ema20")) paint("ema20", ind.ema20, near);
    if (on("ema50")) paint("ema50", ind.ema50, near);
    if (on("ema100")) paint("ema100", ind.ema100, near);
    if (on("trend")) paint("trend", ind.trend, near);
    if (on("stepSell")) paint("stepSell", sellAt, near);
    if (on("stepBuy")) paint("stepBuy", buyAt, near);
    if (on("prior")) paint("prior", ind.priorClose, near);
    if (on("recover")) paint("recover", recover, near);

    for (const fill of fills) {
      if (fill.index < view.start || fill.index >= view.end) continue;
      const b = bars[fill.index];
      const x = xOf(fill.index, view, plotW);
      const buy = fill.side === "buy";
      const y = buy ? yOf(b.l) + 11 : yOf(b.h) - 11;
      markTriangle(ctx, x, Math.min(plot.y + plot.h - 8, Math.max(plot.y + 8, y)), buy, false);
    }
    for (const mark of missed ?? []) {
      if (mark.index < view.start || mark.index >= view.end) continue;
      const b = bars[mark.index];
      if (!b) continue;
      const x = xOf(mark.index, view, plotW);
      const buy = mark.side === "buy";
      const y = buy ? yOf(b.l) + 22 : yOf(b.h) - 22;
      markTriangle(ctx, x, Math.min(plot.y + plot.h - 8, Math.max(plot.y + 8, y)), buy, true);
    }

    if (mark != null && mark >= view.start && mark < view.end) {
      const x = xOf(mark, view, plotW);
      ctx.strokeStyle = mark === selected ? deskColors.bronze : rgba(deskColors.paper, 0.35);
      ctx.setLineDash(mark === selected ? [] : [3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    ctx.font = "11px IBM Plex Mono, ui-monospace, monospace";
    ctx.fillStyle = deskColors.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let tick = 0; tick <= 3; tick++) {
      const value = span.hi - ((span.hi - span.lo) * tick) / 3;
      const y = yOf(value);
      ctx.fillStyle = rgba(deskColors.paper, 0.08);
      ctx.fillRect(plot.x, y, plot.w, 1);
      ctx.fillStyle = deskColors.muted;
      ctx.fillText(formatPx(value), plot.x + plot.w + 6, y);
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const ticks = 4;
    for (let tick = 0; tick < ticks; tick++) {
      const i = Math.min(view.end - 1, view.start + Math.round(((view.end - view.start - 1) * tick) / (ticks - 1)));
      ctx.fillText(formatAxis(bars[i].t, interval), xOf(i, view, plotW), plot.y + plot.h + 6);
    }
    if (cursor?.pane === "price" && cursor.y >= plot.y && cursor.y <= plot.y + plot.h) {
      const price = span.hi - ((cursor.y - plot.y) / plot.h) * (span.hi - span.lo);
      ctx.save();
      ctx.strokeStyle = deskColors.bronze;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(plot.x, cursor.y);
      ctx.lineTo(plot.x + plot.w, cursor.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const label = formatPx(price);
      ctx.font = "11px IBM Plex Mono, ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const tx = plot.x + plot.w + 4;
      const tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = deskColors.bronze;
      ctx.fillRect(tx, cursor.y - 9, tw, 18);
      ctx.fillStyle = deskColors.ink;
      ctx.fillText(label, tx + 4, cursor.y);
      ctx.restore();
    }
  }, [bars, buyAt, cursor, fills, graph, holdOn, hot, hover, ind, interval, missed, params, recover, selected, sellAt, size, view]);

  useEffect(() => {
    const canvas = indRef.current;
    if (!canvas || size.w < 2 || size.ih < 2 || bars.length === 0) return;
    const ctx = setup(canvas, size.w, size.ih);
    if (!ctx) return;
    const width = size.w;
    const height = size.ih;
    const plotW = Math.max(1, width - PAD_L - PAD_R);
    const plot = { x: PAD_L, y: 8, w: plotW, h: Math.max(1, height - 16) };
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = deskColors.ink;
    ctx.fillRect(0, 0, width, height);
    const on = (id: SeriesId) => (typeof graph[id] === "boolean" ? Boolean(graph[id]) : strategyDraws(id, params));
    const oscAt = (id: SeriesId, index: number): number | null => {
      if (id === "rsi") return ind.rsi[index] ?? null;
      if (id === "mfi") return ind.mfi[index] ?? null;
      if (id === "rti") return ind.rti[index] ?? null;
      if (id === "rtiLine") return ind.rtiLine[index] ?? null;
      return null;
    };
    let oscLo = 0;
    let oscHi = 100;
    for (let i = view.start; i < view.end; i++) {
      for (const id of ["rsi", "mfi", "rti", "rtiLine"] as const) {
        if (!on(id)) continue;
        const value = oscAt(id, i);
        if (value == null || !Number.isFinite(value)) continue;
        oscLo = Math.min(oscLo, value);
        oscHi = Math.max(oscHi, value);
      }
    }
    if (oscLo < 0 || oscHi > 100) {
      const pad = Math.max(1, (oscHi - oscLo) * 0.06);
      if (oscLo < 0) oscLo -= pad;
      if (oscHi > 100) oscHi += pad;
    }
    const yOf = (v: number) => plot.y + ((oscHi - v) / (oscHi - oscLo)) * plot.h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.x, plot.y, plot.w, plot.h);
    ctx.clip();
    ctx.strokeStyle = rgba(deskColors.paper, 0.08);
    ctx.beginPath();
    for (const level of [20, 50, 80]) {
      const y = yOf(level);
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.w, y);
    }
    ctx.stroke();
    const look = (id: SeriesId, near: SeriesId | null) => {
      if (hot && hot !== id) return { alpha: 0.18, width: 1.15 };
      if (hot === id || near === id) return { alpha: 1, width: 2.8 };
      return { alpha: 1, width: 1.45 };
    };
    const paint = (id: SeriesId, series: (number | null)[], near: SeriesId | null) => {
      const item = SERIES.find((entry) => entry.id === id);
      if (!item) return;
      const style = look(id, near);
      ctx.save();
      ctx.globalAlpha = style.alpha;
      strokeLine(ctx, series, view, plotW, yOf, item.color, style.width, item.dash ?? []);
      ctx.restore();
    };
    const mark = hover ?? selected;
    let near: SeriesId | null = null;
    if (cursor?.pane === "osc" && mark != null && mark >= view.start && mark < view.end) {
      const cands: { id: SeriesId; y: number }[] = [];
      const add = (id: SeriesId, value: number | null | undefined) => {
        if (!on(id) || value == null || !Number.isFinite(value)) return;
        cands.push({ id, y: yOf(value) });
      };
      add("rsi", ind.rsi[mark]);
      add("mfi", ind.mfi[mark]);
      add("rti", ind.rti[mark]);
      add("rtiLine", ind.rtiLine[mark]);
      let best = 12;
      for (const cand of cands) {
        const distance = Math.abs(cand.y - cursor.y);
        if (distance < best) {
          best = distance;
          near = cand.id;
        }
      }
    }
    if (on("rsi")) paint("rsi", ind.rsi, near);
    if (on("mfi")) paint("mfi", ind.mfi, near);
    if (on("rti")) paint("rti", ind.rti, near);
    if (on("rtiLine")) paint("rtiLine", ind.rtiLine, near);
    const guides: { y: number; color: string }[] = [];
    if (on("rsi")) for (const level of [params.rsi.buyLevel, params.rsi.sellLevel]) guides.push({ y: yOf(level), color: rgba(deskColors.paper, 0.35) });
    if (on("mfi")) for (const level of [params.mfi.buyLevel, params.mfi.sellLevel]) guides.push({ y: yOf(level), color: rgba(deskColors.bronze, 0.45) });
    if (on("rti")) {
      const levels = [50];
      if (shown(params.rti.direction)) levels.push(params.rti.direction.up, params.rti.direction.down);
      if (shown(params.rti.strength)) levels.push(50 + params.rti.strength.buyFloor, 50 - params.rti.strength.sellFloor);
      if (shown(params.rti.below)) levels.push(params.rti.below.level);
      for (const level of levels) guides.push({ y: yOf(level), color: rgba(deskColors.slate, 0.4) });
    }
    ctx.setLineDash([3, 3]);
    for (const guide of guides) {
      ctx.strokeStyle = guide.color;
      ctx.beginPath();
      ctx.moveTo(plot.x, guide.y);
      ctx.lineTo(plot.x + plot.w, guide.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const zeroY = Math.min(plot.y + plot.h - 1, Math.max(plot.y + 1, yOf(0)));
    ctx.save();
    ctx.strokeStyle = deskColors.bronze;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(plot.x, zeroY);
    ctx.lineTo(plot.x + plot.w, zeroY);
    ctx.stroke();
    ctx.restore();
    if (mark != null && mark >= view.start && mark < view.end) {
      const x = xOf(mark, view, plotW);
      ctx.strokeStyle = mark === selected ? deskColors.bronze : rgba(deskColors.paper, 0.35);
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.h);
      ctx.stroke();
    }
    ctx.restore();
    const anyOsc = on("rsi") || on("mfi") || on("rti") || on("rtiLine");
    if (!anyOsc) {
      ctx.fillStyle = deskColors.muted;
      ctx.font = "12px IBM Plex Sans, ui-sans-serif, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("Turn a 0–100 series on in the legend.", plot.x + 8, plot.y + plot.h / 2);
    }
    ctx.font = "11px IBM Plex Mono, ui-monospace, monospace";
    ctx.fillStyle = deskColors.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const oscLabels = [0, 50, 100];
    if (oscLo < -0.5) oscLabels.push(oscLo);
    if (oscHi > 100.5) oscLabels.push(oscHi);
    const placed: number[] = [];
    for (const level of oscLabels.sort((a, b) => yOf(a) - yOf(b))) {
      const y = yOf(level);
      const anchor = level === 0 || level === 50 || level === 100;
      if (!anchor && placed.some((at) => Math.abs(at - y) < 12)) continue;
      placed.push(y);
      const text = Math.abs(level - Math.round(level)) < 0.05 ? String(Math.round(level)) : level.toFixed(1);
      ctx.fillText(text, plot.x + plot.w + 6, y);
    }
    if (mark != null && mark >= view.start && mark < view.end) {
      const tags = (
        [
          ["rsi", ind.rsi[mark], "RSI"],
          ["mfi", ind.mfi[mark], "MFI"],
          ["rti", ind.rti[mark], "RTI"],
          ["rtiLine", ind.rtiLine[mark], "Line"],
        ] as const
      ).flatMap(([id, value, name]) => {
        if (!on(id) || value == null || !Number.isFinite(value)) return [];
        return [{ id, y: yOf(value), text: `${name} ${value.toFixed(1)}`, color: SERIES.find((entry) => entry.id === id)?.color ?? deskColors.paper }];
      });
      tags.sort((a, b) => a.y - b.y);
      const x = xOf(mark, view, plotW);
      let last = -999;
      for (const tag of tags) {
        let y = tag.y;
        if (y - last < 13) y = last + 13;
        last = y;
        const strong = hot === tag.id || near === tag.id;
        ctx.globalAlpha = hot && hot !== tag.id ? 0.25 : 1;
        ctx.fillStyle = tag.color;
        ctx.font = strong ? "12px IBM Plex Mono, ui-monospace, monospace" : "11px IBM Plex Mono, ui-monospace, monospace";
        const width = ctx.measureText(tag.text).width;
        const right = x + 8 + width <= plot.x + plot.w - 4;
        ctx.textAlign = right ? "left" : "right";
        ctx.fillText(tag.text, right ? x + 8 : x - 8, y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    }
  }, [bars.length, cursor, graph, hot, hover, ind, params, selected, size, view]);

  useEffect(() => {
    drawTiming(buyRef.current, size.w, size.bh, view, logic.buy, logic.buyTick, "buy", hover, selected);
    drawTiming(sellRef.current, size.w, size.sh, view, logic.sell, logic.sellTick, "sell", hover, selected);
  }, [hover, logic, selected, size, view]);

  const focus = hover ?? selected ?? (bars.length ? bars.length - 1 : null);
  const bar = focus != null ? bars[focus] : null;
  const centerZoom = (factor: number) => {
    const cursor = Math.floor((view.start + view.end) / 2);
    onView(zoomView(view, cursor, factor, bars.length), true);
  };

  return (
    <div className="desk-panel shrink-0 overflow-hidden">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 overflow-x-auto">
          {WINDOWS.map((id) => (
            <button key={id} type="button" className="desk-chip shrink-0" data-on={windowId === id} onClick={() => onWindow(id)}>
              {id === "All" ? "All" : id}
            </button>
          ))}
          <button type="button" className="desk-chip shrink-0" onClick={() => centerZoom(1 / 1.4)} aria-label="Zoom in">
            Zoom in
          </button>
          <button type="button" className="desk-chip shrink-0" onClick={() => centerZoom(1.4)} aria-label="Zoom out">
            Zoom out
          </button>
        </div>
        <p className="font-mono text-xs text-muted tabular-nums">
          {bar
            ? `${formatWhen(bar.t, interval)}  O ${formatPx(bar.o)}  H ${formatPx(bar.h)}  L ${formatPx(bar.l)}  C ${formatPx(bar.c)}  V ${formatQty(bar.v)}`
            : "Waiting for bars"}
        </p>
      </div>
      <div
        ref={priceHost}
        data-testid="chart"
        data-range={`${view.start}:${view.end}:${bars.length}`}
        tabIndex={0}
        style={{ height: priceH }}
        className="relative touch-none outline-none focus-visible:ring-2 focus-visible:ring-bronze"
        aria-label="Dollar chart. Drag to pan, scroll to zoom, click a candle to read the strategies."
      >
        <canvas ref={priceRef} className="absolute inset-0 h-full w-full" />
      </div>
      <GraphLegend
        title="Dollars"
        items={SERIES.filter((item) => item.scale === "price")}
        params={params}
        drawn={drawn}
        hot={hot}
        onHot={setHot}
        onToggle={toggleGraph}
        accountMarks={missed != null}
      />
      <ResizeBar
        label="Resize the dollar chart"
        onDrag={(next) => setPriceH(Math.min(560, Math.max(96, next)))}
        height={priceH}
      />
      <div
        ref={indHost}
        tabIndex={0}
        style={{ height: oscH }}
        className="relative touch-none border-t border-line outline-none focus-visible:ring-2 focus-visible:ring-bronze"
        aria-label="Zero to one hundred chart on the same time range"
      >
        <canvas ref={indRef} className="absolute inset-0 h-full w-full" />
      </div>
      <GraphLegend
        title="0–100"
        items={SERIES.filter((item) => item.scale === "osc")}
        params={params}
        drawn={drawn}
        hot={hot}
        onHot={setHot}
        onToggle={toggleGraph}
      />
      <ResizeBar label="Resize the 0 to 100 chart" onDrag={(next) => setOscH(Math.min(360, Math.max(72, next)))} height={oscH} />
      <div data-testid="timing" className="border-t border-line">
        <p className="px-4 pt-2 text-xs text-muted text-pretty">
          Same candles. High is true, low is false. A dashed mid-line is waiting and stays out of the test. An ALL tick means that side's combination is true: every AND rule, or any OR rule. Not Held is status only. High means the sale is free, the same sense as the other sell traces. It is not part of ALL.
        </p>
        <TimingStrip host={buyHost} canvas={buyRef} title="Buy strategies" height={stripPx(logic.buy.length)} lanes={logic.buy} ticks={logic.buyTick} focus={focus} />
        <TimingStrip host={sellHost} canvas={sellRef} title="Sell strategies" height={stripPx(logic.sell.length)} lanes={logic.sell} ticks={logic.sellTick} focus={focus} />
      </div>
    </div>
  );
}
