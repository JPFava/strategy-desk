import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applySignals,
  buildLogic,
  computeIndicators,
  emaFacts,
  lowerFacts,
  matrixFired,
  mfiFacts,
  rtiFacts,
  rtiSwing,
  relationFacts,
  simulate,
  sizeBuy,
  slopeFacts,
  trendFacts,
  upperFacts,
  viewForWindow,
  volumeFacts,
  vwapFacts,
  vwapPxFacts,
} from "./engine.ts";
import { buildSampleTape, atEastern } from "./sample.ts";
import {
  defaultAccount,
  defaultParams,
  robustParams,
  sessionKey,
  type AccountSettings,
  type Bar,
  type DeskParams,
  type StrategyId,
} from "./model.ts";

function bar(t: number, c: number, extra?: Partial<Bar>): Bar {
  return {
    t,
    o: extra?.o ?? c,
    h: extra?.h ?? c,
    l: extra?.l ?? c,
    c,
    v: extra?.v ?? 1_000,
  };
}

function account(over: Partial<AccountSettings> = {}): AccountSettings {
  return { ...defaultAccount(), ...over };
}

function flatWant(n: number, buy: StrategyId[] = [], sell: StrategyId[] = []) {
  return Array.from({ length: n }, () => ({ buy: buy.slice(), sell: sell.slice() }));
}

test("sizeBuy never spends more than the budget", () => {
  const order = sizeBuy(1000, 10, 0, 1);
  assert.equal(order.shares, 99);
  assert.ok(order.cost <= 1000);
  assert.ok(order.fee > 0);
  assert.equal(sizeBuy(10, 10, 1, 0).shares, 0);
  assert.equal(sizeBuy(10_000, 40, 0, 0).shares, 250);
});

test("long-only book: one position, buy only when flat, sell only when long", () => {
  const t0 = atEastern(2026, 3, 2, 10, 0);
  const bars = [0, 1, 2, 3].map((i) => bar(t0 + i * 60_000, 10));
  const wants = [
    { buy: ["mfi" as const], sell: ["mfi" as const] },
    { buy: ["mfi" as const], sell: [] },
    { buy: [], sell: ["lower" as const] },
    { buy: [], sell: ["lower" as const] },
  ];
  const book = applySignals(bars, wants, account({ startingCash: 1_000 }), { ...defaultParams().drop, sellOn: false });
  assert.equal(book.fills.map((f) => f.side).join(","), "buy,sell");
  assert.equal(book.trace[0].book, "flat");
  assert.equal(book.trace[0].action, "buy");
  assert.deepEqual(book.trace[0].fired, ["mfi"]);
  assert.equal(book.trace[1].book, "long");
  assert.equal(book.trace[1].action, "none");
  assert.equal(book.trace[1].skipped[0]?.reason, "book was already long");
  assert.equal(book.trace[2].action, "sell");
  assert.equal(book.trace[2].sharesAfter, 0);
  assert.equal(book.trace[3].book, "flat");
  assert.equal(book.trace[3].skipped[0]?.reason, "book was flat");
  assert.equal(book.stats.roundTrips, 1);
  assert.ok(book.fills.every((f) => f.price - f.close === 0));
});

test("dollars per buy uses only allowed cash, and 0 means all of it", () => {
  const t0 = atEastern(2026, 3, 2, 10, 0);
  const bars = [bar(t0, 10)];
  const capped = applySignals(bars, [{ buy: ["mfi"], sell: [] }], account({ startingCash: 10_000, dollarsPerBuy: 2_500 }), {
    ...defaultParams().drop,
    sellOn: false,
  });
  assert.equal(capped.fills[0].shares, 250);
  assert.equal(capped.trace[0].cashAfter, 7_500);
  assert.ok(capped.trace[0].buyingPowerAfter <= 10_000);

  const all = applySignals(bars, [{ buy: ["mfi"], sell: [] }], account({ startingCash: 10_000, dollarsPerBuy: 0 }), {
    ...defaultParams().drop,
    sellOn: false,
  });
  assert.equal(all.fills[0].shares, 1_000);
  assert.equal(all.trace[0].cashAfter, 0);
});

test("sale proceeds stay unsettled until the delay, and shares leave immediately", () => {
  const t0 = atEastern(2026, 3, 2, 10, 0);
  const step = 5 * 60 * 1000;
  const bars = [0, 1, 2, 3, 4].map((i) => bar(t0 + i * step, 10));
  const wants = flatWant(5);
  wants[0] = { buy: ["mfi"], sell: [] };
  wants[1] = { buy: [], sell: ["mfi"] };
  wants[2] = { buy: ["lower"], sell: [] };
  wants[3] = { buy: ["lower"], sell: [] };
  wants[4] = { buy: ["lower"], sell: [] };
  const book = applySignals(
    bars,
    wants,
    account({ startingCash: 1_000, dollarsPerBuy: 0, delay: "15m", useConfirmedSaleProceeds: false }),
    { ...defaultParams().drop, sellOn: false },
  );
  assert.equal(book.trace[1].action, "sell");
  assert.equal(book.trace[1].sharesAfter, 0);
  assert.ok(book.trace[1].unsettledAfter > 900);
  assert.equal(book.trace[1].buyingPowerAfter, 0);
  assert.equal(book.trace[2].action, "none");
  assert.equal(book.trace[2].skipped.some((s) => s.reason === "settled cash cannot buy a share"), true);
  assert.equal(book.trace[3].action, "none");
  assert.equal(book.trace[4].action, "buy");
  assert.ok(book.trace[4].cashAfter < 1);
  assert.equal(book.fills.length, 3);
});

test("confirmed sale proceeds fund the next buy and never add margin", () => {
  const t0 = atEastern(2026, 3, 2, 10, 0);
  const step = 5 * 60 * 1000;
  const bars = [0, 1, 2].map((i) => bar(t0 + i * step, 10));
  const wants = [
    { buy: ["mfi" as const], sell: [] },
    { buy: [], sell: ["mfi" as const] },
    { buy: ["vwap" as const], sell: [] },
  ];
  const book = applySignals(
    bars,
    wants,
    account({ startingCash: 1_000, delay: "1d", useConfirmedSaleProceeds: true }),
    { ...defaultParams().drop, sellOn: false },
  );
  assert.equal(book.trace[1].sharesAfter, 0);
  assert.equal(book.trace[1].unsettledAfter, 0);
  assert.ok(Math.abs(book.trace[1].cashAfter - 1_000) < 1e-6);
  assert.equal(book.trace[2].action, "buy");
  assert.equal(book.trace[2].sharesAfter, 100);
  assert.ok(book.trace[2].buyingPowerAfter <= 1_000);
  for (const row of book.trace) {
    assert.ok(row.cashAfter >= -1e-6);
    assert.ok(row.buyingPowerAfter <= row.cashAfter + 1e-6);
    assert.ok(row.sharesAfter >= 0);
  }
});

test("leftover settled cash can buy during the delay; sale proceeds cannot", () => {
  const t0 = atEastern(2026, 3, 2, 10, 0);
  const bars = [0, 1, 2].map((i) => bar(t0 + i * 5 * 60 * 1000, 10));
  const wants = [
    { buy: ["mfi" as const], sell: [] },
    { buy: [], sell: ["mfi" as const] },
    { buy: ["mfi" as const], sell: [] },
  ];
  const book = applySignals(
    bars,
    wants,
    account({ startingCash: 10_000, dollarsPerBuy: 1_000, delay: "1h", useConfirmedSaleProceeds: false }),
    { ...defaultParams().drop, sellOn: false },
  );
  assert.equal(book.trace[0].cashAfter, 9_000);
  assert.equal(book.trace[1].sharesAfter, 0);
  assert.ok(book.trace[1].unsettledAfter > 900);
  assert.equal(book.trace[1].buyingPowerAfter, 9_000);
  assert.equal(book.trace[2].action, "buy");
  assert.equal(book.trace[2].sharesAfter, 100);
  assert.equal(book.trace[2].cashAfter, 8_000);
  assert.ok(book.trace[2].unsettledAfter > 900);
});

test("drop hold uses the prior close, and a buy disarms it for the session", () => {
  const priorDay = atEastern(2026, 3, 2, 15, 55);
  const t0 = atEastern(2026, 3, 3, 10, 0);
  const bars = [
    bar(priorDay, 100),
    bar(t0, 88, { h: 90, l: 87 }),
    bar(t0 + 60_000, 89, { h: 90, l: 88 }),
    bar(t0 + 120_000, 97, { h: 98, l: 89 }),
  ];
  const blocked = applySignals(
    bars,
    [
      { buy: ["mfi"], sell: [] },
      { buy: [], sell: ["mfi"] },
      { buy: [], sell: ["mfi"] },
      { buy: [], sell: ["mfi"] },
    ],
    account({ startingCash: 10_000 }),
    { sellOn: true, dropPct: 10, recoverPct: 50 },
  );
  assert.equal(blocked.trace[0].action, "buy");
  assert.equal(blocked.trace[1].sellHold, true);
  assert.equal(blocked.trace[1].action, "none");
  assert.equal(blocked.trace[1].sharesAfter, blocked.trace[0].sharesAfter);
  assert.equal(blocked.trace[1].skipped[0]?.reason, "sell hold is on");
  assert.equal(blocked.trace[1].priorClose, 100);
  assert.ok(Math.abs((blocked.trace[1].holdRecover ?? 0) - 93.5) < 1e-9);
  assert.equal(blocked.trace[2].action, "none");
  assert.equal(blocked.trace[3].sellHold, false);
  assert.equal(blocked.trace[3].action, "sell");
  assert.equal(blocked.trace[3].sharesAfter, 0);

  const disarmed = applySignals(
    [bar(priorDay, 100), bar(t0, 96, { h: 97, l: 96 }), bar(t0 + 60_000, 88, { h: 90, l: 87 })],
    [
      { buy: [], sell: [] },
      { buy: ["mfi"], sell: [] },
      { buy: [], sell: ["mfi"] },
    ],
    account({ startingCash: 10_000 }),
    { sellOn: true, dropPct: 10, recoverPct: 50 },
  );
  assert.equal(disarmed.trace[1].action, "buy");
  assert.equal(disarmed.trace[1].sellHold, false);
  assert.equal(disarmed.trace[2].holdLatched, true);
  assert.equal(disarmed.trace[2].holdDisarmed, true);
  assert.equal(disarmed.trace[2].sellHold, false);
  assert.equal(disarmed.trace[2].action, "sell");

  const highOnly = applySignals(
    [bar(priorDay, 100), bar(t0, 110, { h: 110, l: 108 }), bar(t0 + 60_000, 112, { h: 130, l: 110 })],
    [
      { buy: [], sell: [] },
      { buy: ["mfi"], sell: [] },
      { buy: [], sell: ["mfi"] },
    ],
    account({ startingCash: 10_000 }),
    { sellOn: true, dropPct: 10, recoverPct: 50 },
  );
  assert.equal(highOnly.trace[2].sellHold, false);
  assert.equal(highOnly.trace[2].holdLatched, false);
  assert.equal(highOnly.trace[2].action, "sell");

  const cancelled = applySignals(
    [bar(priorDay, 100), bar(t0, 88, { h: 90, l: 87 }), bar(t0 + 60_000, 89, { h: 90, l: 88 }), bar(t0 + 120_000, 89, { h: 90, l: 88 })],
    [
      { buy: [], sell: [] },
      { buy: [], sell: ["mfi"] },
      { buy: ["lower"], sell: ["mfi"] },
      { buy: [], sell: ["mfi"] },
    ],
    account({ startingCash: 10_000 }),
    { sellOn: true, dropPct: 10, recoverPct: 50 },
  );
  assert.equal(cancelled.trace[1].book, "flat");
  assert.equal(cancelled.trace[1].sellHold, true);
  assert.equal(cancelled.trace[1].action, "none");
  assert.equal(cancelled.trace[1].skipped[0]?.reason, "book was flat");
  assert.equal(cancelled.trace[2].action, "buy");
  assert.equal(cancelled.trace[2].holdCancelled, true);
  assert.equal(cancelled.trace[3].sellHold, false);
  assert.equal(cancelled.trace[3].holdLatched, true);
  assert.equal(cancelled.trace[3].action, "sell");
  const holdBars = [bar(priorDay, 100), bar(t0, 88, { h: 90, l: 87 }), bar(t0 + 60_000, 89, { h: 90, l: 88 }), bar(t0 + 120_000, 89, { h: 90, l: 88 })];
  const logic = buildLogic(holdBars, computeIndicators(holdBars, defaultParams(), "5m"), defaultParams(), "5m", cancelled.trace);
  const holdLane = logic.sell.find((lane) => lane.id === "drop");
  assert.equal(holdLane?.name, "Not Held");
  assert.deepEqual(holdLane?.levels, [1, 0, 1, 1]);
  const voters = logic.sell.filter((lane) => lane.id !== "drop");
  assert.equal(
    logic.sellTick[1],
    voters.length > 0 && voters.every((lane) => lane.levels[1] === 1),
  );
});

test("several strategies on one bar are all named when they fire", () => {
  const t0 = atEastern(2026, 3, 2, 10, 0);
  const book = applySignals(
    [bar(t0, 10)],
    [{ buy: ["lower", "mfi", "vwap"], sell: [] }],
    account(),
    { ...defaultParams().drop, sellOn: false },
  );
  assert.deepEqual(book.fills[0].strategies, ["lower", "mfi", "vwap"]);
  assert.equal(book.fills[0].strategies.includes("drop"), false);
});

test("money flow buys at or under 50 and sells at or over 80", () => {
  const rising: Bar[] = [];
  const falling: Bar[] = [];
  const t0 = atEastern(2026, 3, 2, 10, 0);
  for (let i = 0; i < 30; i++) {
    const up = 50 + i;
    const down = 80 - i;
    rising.push(bar(t0 + i * 60_000, up, { o: up - 0.4, h: up + 0.2, l: up - 0.5 }));
    falling.push(bar(t0 + i * 60_000, down, { o: down + 0.4, h: down + 0.5, l: down - 0.2 }));
  }
  const params = defaultParams();
  const upInd = computeIndicators(rising, params);
  const downInd = computeIndicators(falling, params);
  const up = mfiFacts(29, upInd, params);
  const down = mfiFacts(29, downInd, params);
  assert.ok((up.mfi ?? 0) >= 80);
  assert.equal(up.sell, true);
  assert.equal(up.buy, false);
  assert.ok((down.mfi ?? 100) <= 50);
  assert.equal(down.buy, true);
  assert.equal(down.sell, false);
});

function quiet(params: DeskParams): DeskParams {
  const off = <T extends { buyOn: boolean; sellOn: boolean }>(node: T): T => ({ ...node, buyOn: false, sellOn: false });
  return {
    ...params,
    lower: off(params.lower),
    upper: off(params.upper),
    slope: off(params.slope),
    volume: off(params.volume),
    rsi: off(params.rsi),
    mfi: off(params.mfi),
    rti: {
      ...params.rti,
      direction: off(params.rti.direction),
      strength: off(params.rti.strength),
      line: off(params.rti.line),
      negative: off(params.rti.negative),
      reversal: off(params.rti.reversal),
      below: off(params.rti.below),
    },
    vwap: off(params.vwap),
    vwapPx: off(params.vwapPx),
    ema20: off(params.ema20),
    ema50: off(params.ema50),
    ema100: off(params.ema100),
    emaA: off(params.emaA),
    emaB: off(params.emaB),
    emaC: off(params.emaC),
    trend: { ...params.trend, slope: off(params.trend.slope), line: off(params.trend.line) },
    step: off(params.step),
    drop: { ...params.drop, sellOn: false },
  };
}

test("each band test is one comparison", () => {
  const t0 = atEastern(2026, 3, 2, 9, 30);
  const bars: Bar[] = [];
  for (let i = 0; i < 25; i++) bars.push(bar(t0 + i * 300_000, 100, { v: 1_000 }));
  const params = defaultParams();
  params.bands.length = 20;
  params.slope.bars = 3;
  params.slope.buyFloor = 0;
  params.slope.sellFloor = 0;
  params.lower.buyPct = 100;
  params.lower.sellPct = 100;
  params.upper.buyPct = 100;
  params.upper.sellPct = 100;
  const ind = computeIndicators(bars, params);
  const touch = lowerFacts(22, bars, ind, params);
  assert.equal(touch.buy, true);
  assert.equal(upperFacts(22, bars, ind, params).sell, true);

  params.lower.buyPct = 99;
  assert.equal(lowerFacts(22, bars, ind, params).buy, false);

  params.volume.buyMult = 2;
  assert.equal(volumeFacts(22, bars, ind, params).buy, false);
  params.volume.buyMult = 1;
  assert.equal(volumeFacts(22, bars, ind, params).buy, true);
  assert.equal(slopeFacts(22, ind, params).buy, true);
  params.slope.sellFloor = -1;
  assert.equal(slopeFacts(22, ind, params).sell, false);
  params.slope.sellFloor = 0;
  assert.equal(slopeFacts(22, ind, params).sell, true);
});

test("VWAP inside the candle is separate from close versus VWAP", () => {
  const t0 = atEastern(2026, 3, 2, 9, 30);
  const bars: Bar[] = [];
  for (let i = 0; i < 6; i++) {
    const c = i < 5 ? 10 : 20;
    bars.push(bar(t0 + i * 300_000, c, { o: c, h: c + 1, l: c - 1, v: 1_000 }));
  }
  const params = defaultParams();
  const ind = computeIndicators(bars, params);
  const first = vwapFacts(0, bars, ind);
  assert.equal(first.contains, true);
  const last = vwapPxFacts(5, bars, ind);
  assert.equal(last.above, true);
  assert.equal(last.below, false);
  const dailyBar = bars[0];
  const daily = vwapFacts(0, [dailyBar], computeIndicators([dailyBar], params));
  assert.equal(daily.contains, true);
  assert.equal(sessionKey(bars[0].t), sessionKey(bars[5].t));
});

test("fees and delay change the strategy result versus buy and hold", () => {
  const t0 = atEastern(2026, 3, 2, 10, 0);
  const bars = [bar(t0, 10), bar(t0 + 86_400_000, 12)];
  const result = simulate(bars, "1d", quiet(defaultParams()), account({ startingCash: 1_000, flatFee: 1 }));
  assert.equal(result.stats.roundTrips, 0);
  assert.ok(Math.abs(result.stats.strategyReturnPct) < 1e-9);
  assert.ok(result.stats.buyHoldReturnPct > 19);
  assert.ok(result.stats.differencePct < 0);
  assert.ok(result.stats.buyHoldEquity < 1_200);
  assert.equal(result.holdEquity.length, bars.length);
  assert.ok(Math.abs(result.holdEquity[result.holdEquity.length - 1] - result.stats.buyHoldEquity) < 1e-6);
});

test("sample tape stays long-only and inside its own cash", () => {
  const bars = buildSampleTape("SOXL", "5m");
  assert.ok(bars.length > 500);
  const result = simulate(bars, "5m", defaultParams(), defaultAccount());
  for (const row of result.trace) {
    assert.ok(row.cashAfter >= -1e-6);
    assert.ok(Math.abs(row.buyingPowerAfter - row.cashAfter) < 1e-6);
    assert.ok(row.sharesAfter >= 0);
    if (row.action === "buy") {
      assert.equal(row.book, "flat");
      assert.equal(row.fired.includes("drop"), false);
    }
    if (row.action === "sell") {
      assert.equal(row.book, "long");
      assert.equal(row.sharesAfter, 0);
      assert.equal(row.fired.includes("drop"), false);
    }
  }
  const buys = result.fills.filter((f) => f.side === "buy").length;
  const sells = result.fills.filter((f) => f.side === "sell").length;
  assert.equal(sells, result.stats.roundTrips);
  assert.ok(buys === sells || buys === sells + 1);
  const view = viewForWindow(result.indicators.session, "5D");
  assert.ok(view.end - view.start < bars.length);
  assert.equal(view.end, bars.length);

  const only = quiet(defaultParams());
  only.mfi.buyOn = true;
  only.mfi.sellOn = true;
  only.mfi.buyLevel = 100;
  only.mfi.sellLevel = 0;
  const traded = simulate(bars, "5m", only, defaultAccount());
  assert.ok(traded.fills.some((fill) => fill.side === "buy"));
});

test("enabled rules on one side are ANDed", () => {
  const t0 = atEastern(2026, 3, 2, 9, 30);
  const bars: Bar[] = [];
  for (let i = 0; i < 40; i++) bars.push(bar(t0 + i * 300_000, 100, { v: 1_000 }));
  const params = quiet(defaultParams());
  params.lower.buyOn = true;
  params.lower.buyPct = 100;
  params.mfi.buyOn = true;
  params.mfi.buyLevel = 100;
  params.mfi.sellOn = false;
  const both = simulate(bars, "5m", params, account({ startingCash: 10_000 }));
  const buy = both.fills.find((fill) => fill.side === "buy");
  assert.ok(buy);
  assert.deepEqual(buy.strategies, ["lower", "mfi"]);

  params.mfi.buyLevel = 0;
  const blocked = simulate(bars, "5m", params, account({ startingCash: 10_000 }));
  assert.equal(blocked.fills.length, 0);

  params.mfi.buyOn = false;
  params.mfi.sellOn = true;
  params.mfi.sellLevel = 0;
  params.lower.buyOn = true;
  params.lower.sellOn = false;
  const split = simulate(bars, "5m", params, account({ startingCash: 10_000 }));
  assert.equal(split.fills[0]?.side, "buy");
  assert.deepEqual(split.fills[0]?.strategies, ["lower"]);
  const sold = split.fills.find((fill) => fill.side === "sell");
  assert.ok(sold);
  assert.deepEqual(sold.strategies, ["mfi"]);
});

test("an OR rule fires alone when an AND rule fails", () => {
  const t0 = atEastern(2026, 3, 2, 9, 30);
  const bars: Bar[] = [];
  for (let i = 0; i < 40; i++) bars.push(bar(t0 + i * 300_000, 100, { v: 1_000 }));
  const params = quiet(defaultParams());
  params.lower.buyOn = true;
  params.lower.buyPct = 99;
  params.lower.buyJoin = "and";
  params.mfi.buyOn = true;
  params.mfi.buyLevel = 100;
  params.mfi.buyJoin = "or";
  const saved = simulate(bars, "5m", params, account({ startingCash: 10_000 }));
  const buy = saved.fills.find((fill) => fill.side === "buy");
  assert.ok(buy);
  assert.deepEqual(buy.strategies, ["mfi"]);
  assert.equal(saved.logic.buyTick[buy.index], true);
  assert.equal(saved.logic.buy.find((lane) => lane.id === "lower")?.join, "and");
  assert.equal(saved.logic.buy.find((lane) => lane.id === "mfi")?.join, "or");

  params.mfi.buyJoin = "and";
  const blocked = simulate(bars, "5m", params, account({ startingCash: 10_000 }));
  assert.equal(blocked.fills.length, 0);
  assert.equal(blocked.logic.buyTick.some(Boolean), false);
});

test("a passing OR step can buy when the AND group fails", () => {
  const t0 = atEastern(2026, 3, 2, 10, 0);
  const bars = [bar(t0, 10), bar(t0 + 60_000, 12), bar(t0 + 120_000, 11)];
  const wants = [
    { buy: [] as StrategyId[], sell: [] as StrategyId[], buyTerms: [{ id: "mfi" as const, pass: true, join: "and" as const }], sellTerms: [] },
    { buy: [] as StrategyId[], sell: [] as StrategyId[], buyTerms: [{ id: "lower" as const, pass: false, join: "and" as const }], sellTerms: [{ id: "upper" as const, pass: true, join: "and" as const }] },
    { buy: [] as StrategyId[], sell: [] as StrategyId[], buyTerms: [{ id: "lower" as const, pass: false, join: "and" as const }], sellTerms: [] },
  ];
  const step = { buyOn: true, sellOn: false, buyJoin: "or" as const, sellJoin: "and" as const, aboveBuy: 1, belowSell: 1 };
  const book = applySignals(bars, wants, account({ startingCash: 10_000 }), { ...defaultParams().drop, sellOn: false }, undefined, step);
  assert.deepEqual(
    book.fills.map((fill) => `${fill.side}:${fill.strategies.join("+")}`),
    ["buy:mfi", "sell:upper", "buy:step"],
  );
  const held = applySignals(bars, wants, account({ startingCash: 10_000 }), { ...defaultParams().drop, sellOn: false }, undefined, { ...step, buyJoin: "and" });
  assert.deepEqual(held.fills.map((fill) => fill.side), ["buy", "sell"]);
});

test("hourly EMAs and the trend tests vote on their own side", () => {
  const t0 = atEastern(2026, 1, 5, 10, 0);
  const hourly: Bar[] = [];
  for (let i = 0; i < 25; i++) hourly.push(bar(t0 + i * 3_600_000, 100 + i));
  const params = defaultParams();
  params.ema20.hours = 20;
  const ind = computeIndicators(hourly, params, "1h");
  const up = emaFacts(19, hourly, ind.ema20);
  assert.equal(up.ready, true);
  assert.equal(up.buy, true);
  assert.equal(up.sell, false);
  const crash = bar(hourly[24].t + 3_600_000, 50);
  const crashed = [...hourly, crash];
  const downInd = computeIndicators(crashed, params, "1h");
  const down = emaFacts(25, crashed, downInd.ema20);
  assert.equal(down.sell, true);
  assert.equal(down.buy, false);
  assert.equal(emaFacts(10, hourly, ind.ema20).ready, false);

  const daily: Bar[] = [];
  for (let i = 0; i < 25; i++) daily.push(bar(t0 + i * 86_400_000, 100 + i));
  const dailyInd = computeIndicators(daily, params, "1d");
  assert.equal(emaFacts(24, daily, dailyInd.ema20).ready, false);

  const intraday: Bar[] = [];
  for (let i = 0; i < 60; i++) intraday.push(bar(t0 + i * 300_000, 100 + i * 0.4));
  const trendInd = computeIndicators(intraday, params, "5m");
  const trend = trendFacts(59, intraday, trendInd, params, "5m");
  assert.equal(trend.applicable, true);
  assert.equal(trend.count, 48);
  assert.equal(trend.buySlope, true);
  assert.equal(trend.above, true);
  assert.equal(trend.sellSlope, false);
  const falling: Bar[] = [];
  for (let i = 0; i < 60; i++) falling.push(bar(t0 + i * 300_000, 200 - i * 0.4));
  const fallInd = computeIndicators(falling, params, "5m");
  const fall = trendFacts(59, falling, fallInd, params, "5m");
  assert.equal(fall.sellSlope, true);
  assert.equal(fall.below, true);
  assert.equal(fall.buySlope, false);
  const dailyTrend = trendFacts(24, daily, dailyInd, params, "1d");
  assert.equal(dailyTrend.applicable, false);
  assert.equal(dailyTrend.buySlope, false);
});

test("last fill sells above the last buy and buys below the last sell", () => {
  const t0 = atEastern(2026, 3, 2, 10, 0);
  const bars = [10, 10.5, 12, 11, 9].map((price, index) => bar(t0 + index * 300_000, price));
  const step = { buyOn: true, sellOn: true, aboveBuy: 1, belowSell: 2 };
  const wants = [
    { buy: ["mfi" as const], sell: [], buyVoters: 1, sellVoters: 0 },
    { buy: [], sell: ["mfi" as const], buyVoters: 0, sellVoters: 1 },
    { buy: [], sell: ["mfi" as const], buyVoters: 0, sellVoters: 1 },
    { buy: ["mfi" as const], sell: [], buyVoters: 1, sellVoters: 0 },
    { buy: ["mfi" as const], sell: [], buyVoters: 1, sellVoters: 0 },
  ];
  const book = applySignals(bars, wants, account({ startingCash: 10_000 }), { ...defaultParams().drop, sellOn: false }, undefined, step);
  assert.deepEqual(
    book.fills.map((fill) => fill.price),
    [10, 12, 9],
  );
  assert.deepEqual(book.fills.map((fill) => fill.side), ["buy", "sell", "buy"]);
  assert.deepEqual(book.fills[0].strategies, ["mfi"]);
  assert.deepEqual(book.fills[1].strategies, ["mfi", "step"]);
  assert.deepEqual(book.fills[2].strategies, ["mfi", "step"]);
  assert.equal(book.trace[1].action, "none");
  assert.equal(book.trace[3].action, "none");
  assert.equal(book.sellAt[2], 11);
  assert.equal(book.buyAt[3], 10);
  assert.equal(book.trace[0].lastBuy, null);
  assert.equal(book.trace[2].lastBuy, 10);
  assert.equal(book.trace[3].lastSell, 12);

  const blocked = applySignals(
    bars,
    [
      { buy: ["mfi"], sell: [], buyVoters: 1, sellVoters: 0 },
      { buy: [], sell: [], buyVoters: 0, sellVoters: 1 },
      { buy: [], sell: [], buyVoters: 0, sellVoters: 1 },
      { buy: [], sell: [], buyVoters: 0, sellVoters: 1 },
      { buy: [], sell: [], buyVoters: 0, sellVoters: 1 },
    ],
    account({ startingCash: 10_000 }),
    { ...defaultParams().drop, sellOn: false },
    undefined,
    step,
  );
  assert.deepEqual(blocked.fills.map((fill) => fill.side), ["buy"]);

  const alone = applySignals(
    [bars[0], bars[2]],
    [
      { buy: ["mfi"], sell: [], buyVoters: 1, sellVoters: 0 },
      { buy: [], sell: [], buyVoters: 0, sellVoters: 0 },
    ],
    account({ startingCash: 10_000 }),
    { ...defaultParams().drop, sellOn: false },
    undefined,
    { ...step, buyOn: false },
  );
  assert.deepEqual(alone.fills.map((fill) => `${fill.side}:${fill.price}`), ["buy:10", "sell:12"]);
  assert.deepEqual(alone.fills[1].strategies, ["step"]);
});

test("a stop sells a close under the last buy, and a flat buy re-enters", () => {
  const t0 = atEastern(2026, 3, 3, 10, 0);
  const bars = [10, 9.8, 10.05, 9.9].map((price, index) => bar(t0 + index * 60_000, price));
  const step = { buyOn: true, sellOn: true, aboveBuy: 0.2, belowSell: 0.2, stopOn: true, stopBy: 0, flatOn: true };
  const quietWants = bars.map(() => ({ buy: [] as never[], sell: [] as never[], buyVoters: 0, sellVoters: 0 }));
  const book = applySignals(bars, quietWants, account({ startingCash: 10_000, delay: "instant" }), { ...defaultParams().drop, sellOn: false }, undefined, step);
  assert.deepEqual(
    book.fills.map((fill) => `${fill.side}:${fill.price}`),
    ["buy:10", "sell:9.8", "buy:10.05", "sell:9.9"],
  );
  assert.deepEqual(book.fills[1].strategies, ["step"]);
  const held = applySignals(
    [bars[0], bar(t0 + 60_000, 10.2)],
    [
      { buy: [], sell: [], buyVoters: 0, sellVoters: 0 },
      { buy: [], sell: [], buyVoters: 0, sellVoters: 0 },
    ],
    account({ startingCash: 10_000, delay: "instant" }),
    { ...defaultParams().drop, sellOn: false },
    undefined,
    step,
  );
  assert.deepEqual(
    held.fills.map((fill) => `${fill.side}:${fill.price}`),
    ["buy:10", "sell:10.2"],
  );
  const scratch = applySignals(
    [bars[0], bar(t0 + 60_000, 10)],
    [
      { buy: [], sell: [], buyVoters: 0, sellVoters: 0 },
      { buy: [], sell: [], buyVoters: 0, sellVoters: 0 },
    ],
    account({ startingCash: 10_000, delay: "instant" }),
    { ...defaultParams().drop, sellOn: false },
    undefined,
    step,
  );
  assert.deepEqual(scratch.fills.map((fill) => fill.side), ["buy"]);
});

test("EMA relations are generated from rank, touch, and gap", () => {
  const t0 = atEastern(2026, 3, 2, 10, 0);
  const bars = [bar(t0, 100)];
  const ind = { ema20: [103], ema50: [101], ema100: [99] };
  const base = defaultParams().emaA.clause;
  const rank = { ...base, op: "rank" as const, members: ["fast", "mid", "slow"] as const, sellMirror: true };
  const bull = relationFacts(0, bars, ind, { ...rank, members: [...rank.members] }, "buy");
  const bear = relationFacts(0, bars, ind, { ...rank, members: [...rank.members] }, "sell");
  assert.equal(bull.ready, true);
  assert.equal(bull.pass, true);
  assert.equal(bear.pass, false);
  const flipped = { ema20: [99], ema50: [101], ema100: [103] };
  assert.equal(relationFacts(0, bars, flipped, { ...rank, members: [...rank.members] }, "sell").pass, true);
  assert.equal(relationFacts(0, bars, flipped, { ...rank, members: [...rank.members] }, "buy").pass, false);

  const touch = { ...base, op: "touch" as const, members: ["fast", "mid", "slow"] as ("fast" | "mid" | "slow")[], tol: 5, tolUnit: "usd" as const };
  assert.equal(relationFacts(0, bars, ind, touch, "buy").pass, true);
  assert.equal(relationFacts(0, bars, ind, { ...touch, tol: 1 }, "buy").pass, false);
  assert.equal(relationFacts(0, bars, ind, { ...touch, members: ["fast"], tol: 4 }, "buy").pass, true);
  assert.equal(relationFacts(0, bars, ind, { ...touch, members: ["fast"], tol: 1 }, "buy").pass, false);

  const gap = { ...base, op: "gap" as const, members: ["fast", "slow"] as ("fast" | "slow")[], gapMode: "wide" as const, gap: 3, gapUnit: "usd" as const };
  assert.equal(relationFacts(0, bars, ind, gap, "buy").pass, true);
  assert.equal(relationFacts(0, bars, ind, { ...gap, gapMode: "tight", gap: 1 }, "buy").pass, false);
  assert.equal(relationFacts(0, bars, { ema20: [null], ema50: [101], ema100: [99] }, { ...rank, members: [...rank.members] }, "buy").ready, false);

  const rising: Bar[] = [];
  for (let i = 0; i < 40; i++) rising.push(bar(t0 + i * 3_600_000, 100 + i));
  const params = quiet(defaultParams());
  params.ema20.hours = 3;
  params.ema50.hours = 8;
  params.ema100.hours = 15;
  params.emaA.buyOn = true;
  params.emaA.sellOn = true;
  params.emaA.clause = { ...params.emaA.clause, op: "rank", members: ["fast", "mid", "slow"], sellMirror: true };
  params.step.buyOn = true;
  const ranked = simulate(rising, "1h", params, account({ startingCash: 10_000 }));
  const buy = ranked.fills.find((fill) => fill.side === "buy");
  assert.ok(buy);
  assert.deepEqual(buy.strategies, ["emaA"]);
  const stepLane = ranked.logic.buy.find((lane) => lane.id === "step");
  const relLane = ranked.logic.buy.find((lane) => lane.id === "emaA");
  assert.ok(stepLane && relLane);
  assert.equal(stepLane.levels[buy.index], 2);
  assert.equal(relLane.levels[buy.index], 1);
  assert.equal(ranked.logic.buyTick[buy.index], true);
  assert.equal(ranked.logic.sell.length > 0, true);
  for (let i = 0; i < rising.length; i++) {
    const levels = ranked.logic.buy.map((lane) => lane.levels[i]);
    const voting = levels.some((level) => level === 1);
    const blocked = levels.some((level) => level === 0);
    assert.equal(ranked.logic.buyTick[i], voting && !blocked);
  }

  const blocked = quiet(defaultParams());
  blocked.lower.buyOn = true;
  blocked.lower.buyPct = 1000;
  blocked.ema20.hours = 3;
  blocked.ema100.hours = 12;
  blocked.emaB.buyOn = true;
  blocked.emaB.clause = { ...blocked.emaB.clause, op: "touch", members: ["fast", "slow"], tol: 0, tolUnit: "pct" };
  const held = simulate(rising, "1h", blocked, account({ startingCash: 10_000 }));
  assert.equal(held.fills.length, 0);
  blocked.emaB.buyOn = false;
  const released = simulate(rising, "1h", blocked, account({ startingCash: 10_000 }));
  assert.ok(released.fills.some((fill) => fill.side === "buy"));
  assert.equal(buildLogic(rising, released.indicators, quiet(defaultParams()), "1h", released.trace).buy.length, 0);
});

test("robust book is the slow money-flow dip with a trend gate and a stop", () => {
  const params = robustParams();
  assert.equal(params.mfi.buyOn && !params.mfi.sellOn, true);
  assert.deepEqual([params.mfi.length, params.mfi.buyLevel], [21, 30]);
  assert.equal(params.mfi.buyJoin, "and");
  assert.equal(params.trend.hours, 4);
  assert.equal(params.trend.line.buyOn && !params.trend.line.sellOn, true);
  assert.equal(params.trend.line.buyJoin, "and");
  assert.equal(params.trend.slope.buyOn || params.trend.slope.sellOn, false);
  assert.deepEqual([params.step.sellOn, params.step.buyOn, params.step.aboveBuy, params.step.stopOn, params.step.stopBy, params.step.flatOn], [true, false, 2, true, 1.25, false]);
  assert.equal(params.drop.sellOn, false);
  for (const node of [params.lower, params.upper, params.slope, params.volume, params.rsi, params.vwap, params.vwapPx, params.ema20, params.ema50, params.ema100]) {
    assert.equal(node.buyOn || node.sellOn, false);
  }
});

test("relative trend reads up as strength above 50 and down as strength below 50", () => {
  const t0 = atEastern(2026, 3, 2, 10, 0);
  const rising = Array.from({ length: 40 }, (_, i) => bar(t0 + i * 300_000, 100 + i));
  const falling = Array.from({ length: 40 }, (_, i) => bar(t0 + i * 300_000, 140 - i));
  const params = quiet(defaultParams());
  params.rti.length = 10;
  params.rti.mult = 2;
  params.rti.smooth = 1;
  params.rti.direction = { ...params.rti.direction, buyOn: true, sellOn: true, up: 50, down: 50 };
  params.rti.strength = { ...params.rti.strength, buyOn: true, sellOn: true, buyFloor: 10, sellFloor: 10 };
  const up = rtiFacts(39, computeIndicators(rising, params), params);
  const down = rtiFacts(39, computeIndicators(falling, params), params);
  assert.ok((up.rti ?? 0) > 70);
  assert.equal(up.dirBuy, true);
  assert.equal(up.strBuy, true);
  assert.equal(up.dirSell, false);
  assert.equal(up.strSell, false);
  assert.ok((down.rti ?? 100) < 30);
  assert.equal(down.dirSell, true);
  assert.equal(down.strSell, true);
  assert.equal(down.dirBuy, false);
  assert.equal(down.strBuy, false);
});

test("relative trend sells while it is under its own slower line", () => {
  const t0 = atEastern(2026, 3, 2, 10, 0);
  const rising = Array.from({ length: 30 }, (_, i) => bar(t0 + i * 300_000, 100 + i));
  const hooked = [
    ...Array.from({ length: 24 }, (_, i) => bar(t0 + i * 300_000, 100 + i)),
    ...Array.from({ length: 8 }, (_, i) => bar(t0 + (24 + i) * 300_000, 123 - i * 4)),
  ];
  const params = quiet(defaultParams());
  params.rti.length = 8;
  params.rti.mult = 2;
  params.rti.smooth = 1;
  params.rti.line = { ...params.rti.line, buyOn: false, sellOn: true, length: 8 };
  const up = rtiFacts(29, computeIndicators(rising, params), params);
  const down = rtiFacts(31, computeIndicators(hooked, params), params);
  assert.equal(up.lineSell, false);
  assert.equal(down.lineSell, true);
  assert.equal(down.lineBuy, false);
  assert.ok((down.rti ?? 100) < (down.line ?? 0));
});

test("relative trend line buys on a rising line or a level, and sells on a falling line or a level", () => {
  const t0 = atEastern(2026, 3, 2, 10, 0);
  const wave = Array.from({ length: 40 }, (_, i) => bar(t0 + i * 300_000, 100 + Math.sin(i / 3) * 8));
  const params = quiet(defaultParams());
  params.rti.length = 8;
  params.rti.smooth = 1;
  params.rti.line = { ...params.rti.line, buyOn: true, sellOn: true, versus: false, trend: true, levelOn: false, length: 4 };
  const ind = computeIndicators(wave, params);
  const rising = rtiFacts(14, ind, params);
  const falling = rtiFacts(24, ind, params);
  assert.equal(rising.lineBuy, true);
  assert.equal(rising.lineSell, false);
  assert.equal(falling.lineSell, true);
  assert.equal(falling.lineBuy, false);
  params.rti.line = { ...params.rti.line, trend: false, levelOn: true, buyLevel: 60, sellLevel: 40 };
  const high = rtiFacts(18, ind, params);
  const low = rtiFacts(9, ind, params);
  assert.ok((high.rti ?? 0) >= 60);
  assert.equal(high.lineBuy, true);
  assert.equal(high.lineSell, false);
  assert.ok((low.rti ?? 100) <= 40);
  assert.equal(low.lineSell, true);
  assert.equal(low.lineBuy, false);
});

test("relative trend buys at or under its buy-below level", () => {
  const t0 = atEastern(2026, 3, 2, 10, 0);
  const rising = Array.from({ length: 40 }, (_, i) => bar(t0 + i * 300_000, 100 + i));
  const falling = Array.from({ length: 40 }, (_, i) => bar(t0 + i * 300_000, 140 - i));
  const params = quiet(defaultParams());
  params.rti.length = 10;
  params.rti.smooth = 1;
  params.rti.below = { ...params.rti.below, buyOn: true, level: 30 };
  const up = rtiFacts(39, computeIndicators(rising, params), params);
  const down = rtiFacts(39, computeIndicators(falling, params), params);
  assert.ok((up.rti ?? 0) > 30);
  assert.equal(up.lowBuy, false);
  assert.ok((down.rti ?? 100) <= 30);
  assert.equal(down.lowBuy, true);
});

test("relative trend can pass below zero", () => {
  const t0 = atEastern(2026, 3, 2, 10, 0);
  const flat = Array.from({ length: 20 }, (_, i) => bar(t0 + i * 300_000, 100));
  const broke = [...flat, bar(t0 + 20 * 300_000, 50)];
  const params = quiet(defaultParams());
  params.rti.length = 10;
  params.rti.mult = 2;
  params.rti.smooth = 1;
  params.rti.negative = { ...params.rti.negative, buyOn: true, sellOn: true };
  const calm = rtiFacts(19, computeIndicators(flat, params), params);
  const through = rtiFacts(20, computeIndicators(broke, params), params);
  assert.equal(calm.negBuy, false);
  assert.ok((through.rti ?? 0) < 0);
  assert.equal(through.negBuy, true);
  assert.equal(through.negSell, true);
});

test("an RTI reversal is an interior valley or peak", () => {
  const valley = [4, 3, 1, 2, 3];
  assert.deepEqual(rtiSwing(valley, 4, 5), { valley: true, peak: false });
  assert.deepEqual(rtiSwing([5, 4, 1], 2, 3), { valley: false, peak: false });
  const peak = [1, 2, 3, 5, 4];
  assert.deepEqual(rtiSwing(peak, 4, 5), { valley: false, peak: true });
  assert.deepEqual(rtiSwing([1, 2, 3, 4], 3, 4), { valley: false, peak: false });
});

test("a matrix row is an AND and any row can fire", () => {
  const terms = [
    { id: "lower" as const, pass: true, join: "and" as const },
    { id: "rsi" as const, pass: false, join: "and" as const },
    { id: "mfi" as const, pass: true, join: "and" as const },
  ];
  assert.deepEqual(
    matrixFired(
      [
        { members: ["lower", "rsi"] },
        { members: ["lower", "mfi"] },
      ],
      terms,
    ),
    ["lower", "mfi"],
  );
  const t0 = atEastern(2026, 3, 2, 10, 0);
  const bars = Array.from({ length: 8 }, (_, i) => bar(t0 + i * 300_000, 100 + i));
  const params = quiet(defaultParams());
  params.step = { ...params.step, buyOn: true, sellOn: false, flatOn: true };
  params.rsi = { ...params.rsi, buyOn: true, sellOn: false, buyLevel: 0, length: 2 };
  params.matrix.buy = {
    on: true,
    groups: [
      { id: "g1", members: ["rsi"] },
      { id: "g2", members: ["step"] },
    ],
  };
  const either = simulate(bars, "5m", params, account({ delay: "instant" }));
  assert.ok(either.fills.some((fill) => fill.side === "buy"));
  assert.equal(either.logic.buy.length, 2);
  assert.ok(either.logic.buyTick.some(Boolean));
  params.matrix.buy = { on: true, groups: [{ id: "g1", members: ["rsi"] }] };
  assert.equal(simulate(bars, "5m", params, account({ delay: "instant" })).fills.length, 0);
});

test("a date range fills only those sessions and marks the book at the last one", () => {
  const days = [
    [2026, 3, 2, 100],
    [2026, 3, 3, 100],
    [2026, 3, 4, 50],
  ] as const;
  const bars = days.map(([y, m, d, c]) => bar(atEastern(y, m, d, 10, 0), c));
  const params = quiet(defaultParams());
  params.step = { ...params.step, buyOn: true, sellOn: true, flatOn: true, aboveBuy: 0.5, stopOn: false };
  const ranged = simulate(bars, "5m", params, account({ fromDate: "2026-03-03", toDate: "2026-03-03", delay: "instant" }));
  assert.equal(ranged.fills.length, 1);
  assert.equal(ranged.fills[0].side, "buy");
  assert.equal(sessionKey(ranged.fills[0].time), "2026-03-03");
  assert.ok(Math.abs(ranged.stats.strategyReturnPct) < 1);
  const whole = simulate(bars, "5m", params, account({ delay: "instant" }));
  assert.ok(whole.fills.some((fill) => sessionKey(fill.time) === "2026-03-02"));
  assert.ok(whole.stats.strategyReturnPct < -40);
});

test("starter book matches the SOXL 5-minute baseline gates", () => {
  const params = defaultParams();
  const cash = defaultAccount();
  assert.equal(params.bands.length, 30);
  assert.equal(params.bands.mult, 2);
  assert.deepEqual([params.lower.buyOn, params.lower.sellOn, params.lower.buyPct], [true, false, 102]);
  assert.deepEqual([params.upper.buyOn, params.upper.sellOn, params.upper.sellPct], [false, true, 98]);
  assert.deepEqual([params.slope.buyOn, params.slope.sellOn, params.slope.buyFloor, params.slope.sellFloor, params.slope.bars], [true, false, -1, 1, 5]);
  assert.deepEqual([params.volume.buyOn, params.volume.sellOn, params.volume.buyMult], [true, false, 1.5]);
  assert.deepEqual([params.rsi.buyOn, params.rsi.sellOn, params.rsi.length, params.rsi.buyLevel, params.rsi.sellLevel], [true, true, 7, 30, 60]);
  assert.deepEqual([params.mfi.buyOn, params.mfi.sellOn, params.mfi.length, params.mfi.buyLevel], [true, false, 7, 50]);
  assert.deepEqual([params.vwap.buyOn, params.vwap.sellOn], [true, false]);
  assert.deepEqual([params.vwapPx.buyOn, params.vwapPx.sellOn], [false, true]);
  assert.equal(params.step.buyOn || params.step.sellOn, false);
  assert.equal(params.ema20.buyOn || params.ema50.buyOn || params.ema100.buyOn || params.emaA.buyOn || params.emaB.buyOn || params.emaC.buyOn, false);
  assert.equal(params.trend.slope.buyOn || params.trend.slope.sellOn || params.trend.line.buyOn || params.trend.line.sellOn, false);
  assert.equal(params.rti.direction.buyOn || params.rti.direction.sellOn || params.rti.strength.buyOn || params.rti.strength.sellOn || params.rti.line.buyOn || params.rti.line.sellOn || params.rti.negative.buyOn || params.rti.negative.sellOn || params.rti.reversal.buyOn || params.rti.reversal.sellOn || params.rti.below.buyOn, false);
  assert.deepEqual([params.drop.sellOn, params.drop.dropPct, params.drop.recoverPct], [true, 10, 50]);
  assert.equal(params.lower.buyJoin, "and");
  assert.equal(params.upper.sellJoin, "and");
  assert.equal(cash.startingCash, 25_000);
  assert.equal(cash.dollarsPerBuy, 0);
  assert.equal(cash.flatFee, 0);
  assert.equal(cash.percentFee, 0);
  assert.equal(cash.delay, "1d");
  assert.equal(cash.useConfirmedSaleProceeds, true);
});
