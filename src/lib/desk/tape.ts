import { createServerFn } from "@tanstack/react-start";
import { buildSampleTape } from "./sample";
import { type Bar, type Interval, INTERVALS } from "./model";

export type Tape = {
  symbol: string;
  interval: Interval;
  source: "market" | "sample";
  notice: string | null;
  bars: Bar[];
};

const SAMPLE_NOTICE = "Sample tape — market data unavailable";

const RANGE: Record<Interval, { interval: string; range: string }> = {
  "1m": { interval: "1m", range: "5d" },
  "5m": { interval: "5m", range: "60d" },
  "15m": { interval: "15m", range: "60d" },
  "1h": { interval: "1h", range: "2y" },
  "1d": { interval: "1d", range: "5y" },
};

function isInterval(value: string): value is Interval {
  return INTERVALS.some((item) => item.id === value);
}

function cleanSymbol(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-]/g, "")
    .slice(0, 12);
}

function sampleTape(symbol: string, interval: Interval): Tape {
  return {
    symbol,
    interval,
    source: "sample",
    notice: SAMPLE_NOTICE,
    bars: buildSampleTape(symbol, interval),
  };
}

function readBars(payload: unknown): Bar[] {
  const root = payload as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
            close?: Array<number | null>;
            volume?: Array<number | null>;
          }>;
        };
      } | null>;
    };
  };
  const result = root.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const stamps = result?.timestamp;
  if (!result || !quote || !stamps) return [];
  const bars: Bar[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    const volume = quote.volume?.[i];
    if (open == null || high == null || low == null || close == null) continue;
    if (![open, high, low, close].every((n) => Number.isFinite(n) && n > 0)) continue;
    const stamp = stamps[i] < 1e12 ? stamps[i] * 1000 : stamps[i];
    bars.push({
      t: stamp,
      o: open,
      h: Math.max(high, open, close),
      l: Math.min(low, open, close),
      c: close,
      v: volume != null && Number.isFinite(volume) ? Math.max(0, volume) : 0,
    });
  }
  bars.sort((a, b) => a.t - b.t);
  const deduped: Bar[] = [];
  for (const bar of bars) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.t === bar.t) deduped[deduped.length - 1] = bar;
    else deduped.push(bar);
  }
  return deduped.slice(-20_000);
}

async function fetchYahoo(symbol: string, interval: Interval): Promise<Bar[]> {
  const spec = RANGE[interval];
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  let last = "";
  for (const host of hosts) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${spec.interval}&range=${spec.range}&includePrePost=false&events=div%7Csplit`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const response = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          accept: "application/json",
          "user-agent": "Mozilla/5.0",
        },
      });
      if (!response.ok) {
        last = `${response.status}`;
        continue;
      }
      const bars = readBars(await response.json());
      if (bars.length >= 8) return bars;
      last = "short tape";
    } catch (error) {
      last = error instanceof Error ? error.message : "fetch failed";
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(last || "market data unavailable");
}

export const fetchTape = createServerFn({ method: "GET" })
  .validator((input: { symbol?: string; interval?: string }) => {
    const symbol = cleanSymbol(input?.symbol);
    if (!symbol) throw new Error("Enter a symbol");
    const interval = input?.interval && isInterval(input.interval) ? input.interval : "5m";
    return { symbol, interval };
  })
  .handler(async ({ data }): Promise<Tape> => {
    try {
      const bars = await fetchYahoo(data.symbol, data.interval);
      return { symbol: data.symbol, interval: data.interval, source: "market", notice: null, bars };
    } catch {
      return sampleTape(data.symbol, data.interval);
    }
  });
