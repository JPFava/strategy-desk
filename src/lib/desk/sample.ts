import type { Bar, Interval } from "./model.ts";

const ET = "America/New_York";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = Math.max(1e-9, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function tzOffsetMs(date: Date): number {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName");
  const match = /GMT([+-])(\d+)(?::(\d+))?/.exec(part?.value ?? "GMT-5");
  if (!match) return -5 * 3600000;
  const sign = match[1] === "+" ? 1 : -1;
  return sign * ((Number(match[2]) * 60 + Number(match[3] ?? 0)) * 60000);
}

export function atEastern(y: number, m: number, d: number, h: number, min: number): number {
  const localAsUtc = Date.UTC(y, m - 1, d, h, min, 0);
  let utc = localAsUtc;
  for (let i = 0; i < 2; i++) utc = localAsUtc - tzOffsetMs(new Date(utc));
  return utc;
}

function weekdaySessions(count: number): { y: number; m: number; d: number }[] {
  const out: { y: number; m: number; d: number }[] = [];
  const cursor = new Date(Date.UTC(2026, 0, 5));
  while (out.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      out.push({ y: cursor.getUTCFullYear(), m: cursor.getUTCMonth() + 1, d: cursor.getUTCDate() });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function stampsFor(interval: Interval, y: number, m: number, d: number): number[] {
  if (interval === "1d") return [atEastern(y, m, d, 16, 0)];
  const step = interval === "1m" ? 1 : interval === "5m" ? 5 : interval === "15m" ? 15 : 60;
  const start = 9 * 60 + 30;
  const end = 16 * 60;
  const stamps: number[] = [];
  for (let minute = start; minute < end; minute += step) {
    stamps.push(atEastern(y, m, d, Math.floor(minute / 60), minute % 60));
  }
  return stamps;
}

function sessionCount(interval: Interval): number {
  if (interval === "1m") return 4;
  if (interval === "5m") return 24;
  if (interval === "15m") return 40;
  if (interval === "1h") return 80;
  return 260;
}

export function buildSampleTape(symbol: string, interval: Interval): Bar[] {
  const seed = [...symbol].reduce((s, ch) => s + ch.charCodeAt(0) * 17, 1000);
  const rng = mulberry32(seed);
  const days = weekdaySessions(sessionCount(interval));
  const bars: Bar[] = [];
  let price = 28 + rng() * 12;

  days.forEach((day, sessionIndex) => {
    const times = stampsFor(interval, day.y, day.m, day.d);
    const crash = sessionIndex === Math.min(8, days.length - 1) && interval !== "1d";
    const grind = sessionIndex === Math.min(14, days.length - 1) && interval !== "1d";
    times.forEach((t, i) => {
      const open = price;
      let ret = gauss(rng) * (interval === "1d" ? 0.028 : interval === "1h" ? 0.012 : 0.006);
      ret += ((38 - price) / 38) * 0.002;
      if (crash) {
        const n = times.length;
        const up = Math.max(2, Math.round(n * 0.12));
        const down = Math.max(up + 2, Math.round(n * 0.38));
        const back = Math.max(down + 2, Math.round(n * 0.7));
        if (i < up) ret = 0.0015;
        else if (i < down) ret = -0.008;
        else if (i < back) ret = 0.004;
        else ret = gauss(rng) * 0.003;
      } else if (grind && i % 7 === 0) {
        ret = -0.012;
      }
      let close = Math.max(1.5, open * (1 + ret));
      const wick = Math.abs(gauss(rng)) * open * (interval === "1d" ? 0.008 : 0.0015);
      let high = Math.max(open, close) + wick;
      let low = Math.min(open, close) - wick * (0.6 + rng());
      if (low < 0.5) low = 0.5;
      if (high < low) high = low;
      if (close > high) close = high;
      if (close < low) close = low;
      const impulse = Math.abs(close - open) / Math.max(open, 0.01);
      const volume = Math.round((40_000 + rng() * 80_000) * (interval === "1d" ? 80 : interval === "1h" ? 8 : 1) * (0.7 + impulse * 40));
      bars.push({ t, o: open, h: high, l: low, c: close, v: Math.max(1, volume) });
      price = close;
    });
    if (interval !== "1d") price = Math.max(1.5, price * (1 + gauss(rng) * 0.01));
  });

  return bars;
}
