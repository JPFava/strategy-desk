import { useEffect, useRef, useState, type RefObject } from "react";
import type { Bar, DeskParams, Interval, WindowId } from "@/lib/desk/model";
import { deskColors, formatPx, formatQty, formatWhen, WINDOWS } from "@/lib/desk/model";
import type { Fill, Indicators, LogicDiagram, LogicLane, LogicLevel } from "@/lib/desk/engine";

type View = { start: number; end: number };

type Props = {
  bars: Bar[];
  ind: Indicators;
  fills: Fill[];
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

export function ChartPane({
  bars,
  ind,
  fills,
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

  const hoverRef = useRef<number | null>(null);
  const selectedRef = useRef<number | null>(selected);
  selectedRef.current = selected;

  useEffect(() => {
    const hosts = [priceHost.current, indHost.current, buyHost.current, sellHost.current].filter((node): node is HTMLDivElement => Boolean(node));
    if (!hosts.length) return;
    const drag = { on: false, moved: false, x: 0, view: viewRef.current, width: 1 };

    const localX = (event: PointerEvent | WheelEvent) => {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      return { x: event.clientX - rect.left, width: rect.width };
    };
    const onDown = (event: PointerEvent) => {
      const point = localX(event);
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
      const point = localX(event);
      const current = viewRef.current;
      if (!drag.on) {
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
        const point = localX(event);
        onSelectRef.current(indexAt(point.x, point.width, viewRef.current));
      }
    };
    const onLeave = () => {
      if (!drag.on) {
        hoverRef.current = null;
        setHover(null);
      }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = localX(event);
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

    const vals: Array<number | null> = [];
    for (let i = view.start; i < view.end; i++) {
      vals.push(bars[i].h, bars[i].l);
      if (bandsOn(params)) vals.push(ind.bandUpper[i], ind.bandLower[i], ind.bandMid[i]);
      if (vwapOn(params)) vals.push(ind.vwap[i]);
      if (params.drop.sellOn) vals.push(ind.priorClose[i], recover[i]);
      if (shown(params.ema20) || emaLaneOn(params, "fast")) vals.push(ind.ema20[i]);
      if (shown(params.ema50) || emaLaneOn(params, "mid")) vals.push(ind.ema50[i]);
      if (shown(params.ema100) || emaLaneOn(params, "slow")) vals.push(ind.ema100[i]);
      if (trendOn(params)) vals.push(ind.trend[i]);
      if (params.step.buyOn) vals.push(buyAt[i]);
      if (params.step.sellOn) vals.push(sellAt[i]);
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

    if (bandsOn(params)) {
      strokeLine(ctx, ind.bandUpper, view, plotW, yOf, rgba(deskColors.paper, 0.45), 1);
      strokeLine(ctx, ind.bandLower, view, plotW, yOf, rgba(deskColors.paper, 0.45), 1);
      strokeLine(ctx, ind.bandMid, view, plotW, yOf, deskColors.paper, 1.25);
    }
    if (vwapOn(params)) strokeLine(ctx, ind.vwap, view, plotW, yOf, deskColors.bronze, 1.5);
    if (emaLaneOn(params, "fast")) strokeLine(ctx, ind.ema20, view, plotW, yOf, deskColors.buy, 1.6);
    if (emaLaneOn(params, "mid")) strokeLine(ctx, ind.ema50, view, plotW, yOf, deskColors.bronze, 1.6, [7, 3]);
    if (emaLaneOn(params, "slow")) strokeLine(ctx, ind.ema100, view, plotW, yOf, deskColors.paper, 2);
    if (trendOn(params)) strokeLine(ctx, ind.trend, view, plotW, yOf, deskColors.sell, 1.5, [2, 3]);
    if (params.step.sellOn) strokeLine(ctx, sellAt, view, plotW, yOf, deskColors.sell, 1.25, [8, 4]);
    if (params.step.buyOn) strokeLine(ctx, buyAt, view, plotW, yOf, deskColors.buy, 1.25, [8, 4]);
    if (params.drop.sellOn) {
      strokeLine(ctx, ind.priorClose, view, plotW, yOf, rgba(deskColors.muted, 0.9), 1, [2, 3]);
      strokeLine(ctx, recover, view, plotW, yOf, deskColors.sell, 1, [5, 4]);
    }

    for (const fill of fills) {
      if (fill.index < view.start || fill.index >= view.end) continue;
      const b = bars[fill.index];
      const x = xOf(fill.index, view, plotW);
      const buy = fill.side === "buy";
      const y = buy ? yOf(b.l) + 11 : yOf(b.h) - 11;
      ctx.beginPath();
      ctx.fillStyle = buy ? deskColors.buy : deskColors.sell;
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
      ctx.fill();
    }

    const mark = hover ?? selected;
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
  }, [bars, buyAt, fills, holdOn, hover, ind, interval, params, recover, selected, sellAt, size, view]);

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
    const yOf = (v: number) => plot.y + ((100 - v) / 100) * plot.h;
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
    if (shown(params.rsi)) {
      strokeLine(ctx, ind.rsi, view, plotW, yOf, deskColors.paper, 1.25);
      for (const level of [params.rsi.buyLevel, params.rsi.sellLevel]) {
        ctx.strokeStyle = rgba(deskColors.paper, 0.35);
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(plot.x, yOf(level));
        ctx.lineTo(plot.x + plot.w, yOf(level));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (shown(params.mfi)) {
      strokeLine(ctx, ind.mfi, view, plotW, yOf, deskColors.bronze, 1.25);
      for (const level of [params.mfi.buyLevel, params.mfi.sellLevel]) {
        ctx.strokeStyle = rgba(deskColors.bronze, 0.55);
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(plot.x, yOf(level));
        ctx.lineTo(plot.x + plot.w, yOf(level));
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    const rtiOn = shown(params.rti.direction) || shown(params.rti.strength) || shown(params.rti.line) || shown(params.rti.below);
    if (rtiOn) {
      strokeLine(ctx, ind.rti, view, plotW, yOf, deskColors.slate, 1.25);
      if (shown(params.rti.line)) strokeLine(ctx, ind.rtiLine, view, plotW, yOf, deskColors.sell, 1.25, [4, 3]);
      const levels = [50];
      if (shown(params.rti.direction)) levels.push(params.rti.direction.up, params.rti.direction.down);
      if (shown(params.rti.strength)) levels.push(50 + params.rti.strength.buyFloor, 50 - params.rti.strength.sellFloor);
      if (shown(params.rti.below)) levels.push(params.rti.below.level);
      ctx.strokeStyle = rgba(deskColors.slate, 0.55);
      ctx.setLineDash([3, 3]);
      for (const level of levels) {
        ctx.beginPath();
        ctx.moveTo(plot.x, yOf(level));
        ctx.lineTo(plot.x + plot.w, yOf(level));
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    const mark = hover ?? selected;
    if (mark != null && mark >= view.start && mark < view.end) {
      const x = xOf(mark, view, plotW);
      ctx.strokeStyle = mark === selected ? deskColors.bronze : rgba(deskColors.paper, 0.35);
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.h);
      ctx.stroke();
    }
    ctx.restore();
    if (!shown(params.rsi) && !shown(params.mfi) && !(shown(params.rti.direction) || shown(params.rti.strength) || shown(params.rti.line) || shown(params.rti.below))) {
      ctx.fillStyle = deskColors.muted;
      ctx.font = "12px IBM Plex Sans, ui-sans-serif, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText("Switch on RSI, Money flow, or Relative trend to plot them here.", plot.x + 8, plot.y + plot.h / 2);
    }
    ctx.font = "11px IBM Plex Mono, ui-monospace, monospace";
    ctx.fillStyle = deskColors.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (const level of [0, 50, 100]) ctx.fillText(String(level), plot.x + plot.w + 6, yOf(level));
  }, [bars.length, hover, ind, params, selected, size, view]);

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
        className="relative h-52 touch-none outline-none focus-visible:ring-2 focus-visible:ring-bronze"
        aria-label="Price chart. Drag to pan, scroll to zoom, click a candle to read the strategies."
      >
        <canvas ref={priceRef} className="absolute inset-0 h-full w-full" />
      </div>
      <div ref={indHost} tabIndex={0} className="relative h-16 touch-none border-t border-line outline-none focus-visible:ring-2 focus-visible:ring-bronze" aria-label="Indicator chart on the same time range">
        <canvas ref={indRef} className="absolute inset-0 h-full w-full" />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-1 text-xs text-muted">
        {bandsOn(params) && <span>Bands · paper</span>}
        {vwapOn(params) && <span className="text-bronze">VWAP · bronze</span>}
        {emaLaneOn(params, "fast") && <span className="text-buy">{params.ema20.hours}-hour EMA</span>}
        {emaLaneOn(params, "mid") && <span className="text-bronze">{params.ema50.hours}-hour EMA · dashed</span>}
        {emaLaneOn(params, "slow") && <span>{params.ema100.hours}-hour EMA · paper</span>}
        {trendOn(params) && (
          <span className="text-sell">
            {Number.isInteger(params.trend.hours) ? params.trend.hours : params.trend.hours.toFixed(1)}-hour trend
          </span>
        )}
        {params.step.sellOn && <span className="text-sell">Above last buy</span>}
        {params.step.buyOn && <span className="text-buy">Below last sell</span>}
        {params.drop.sellOn && <span>Prior close, recovery, sell-hold shade</span>}
        {shown(params.rsi) && <span>RSI · paper</span>}
        {shown(params.mfi) && <span className="text-bronze">Money flow · bronze</span>}
        {(shown(params.rti.direction) || shown(params.rti.strength) || shown(params.rti.line) || shown(params.rti.below)) && (
          <span style={{ color: deskColors.slate }}>Relative trend · slate</span>
        )}
        {shown(params.rti.line) && <span className="text-sell">RTI line · dashed</span>}
        <span className="text-buy">Buy marks</span>
        <span className="text-sell">Sell marks</span>
      </div>
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
