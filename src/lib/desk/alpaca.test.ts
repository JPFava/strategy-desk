import assert from "node:assert/strict";
import test from "node:test";
import { barIndexAt, clientOrderId, dailyStopHit, drawdownPct, equityOnBars, issueLiveArm, missedSignals, nextAccountSignal, openingPosition, planOrder, readFills, readHistory, readLiveArm, roundTrips, LIVE_KIND } from "./alpaca.ts";

const base = {
  paper: true,
  liveArmed: false,
  symbol: "SOXL",
  side: "buy" as const,
  dollars: 1000,
  price: 40,
  cash: 5000,
  positionQty: 0,
  sample: false,
  barTime: 1_730_000_000_000,
  working: false,
};

test("a paper buy sizes whole shares from the smaller of the budget and the cash", () => {
  const plan = planOrder({ ...base, dollars: 100, cash: 90 });
  assert.equal(plan.ok, true);
  if (plan.ok) assert.equal(plan.qty, 2);
});

test("a live order is refused unless the live key was loaded", () => {
  const blocked = planOrder({ ...base, paper: false });
  assert.equal(blocked.ok, false);
  const allowed = planOrder({ ...base, paper: false, liveArmed: true });
  assert.equal(allowed.ok, true);
});

test("a sample tape, a second buy, and a sell while flat are refused", () => {
  assert.equal(planOrder({ ...base, sample: true }).ok, false);
  assert.equal(planOrder({ ...base, positionQty: 3 }).ok, false);
  assert.equal(planOrder({ ...base, side: "sell" }).ok, false);
  const sell = planOrder({ ...base, side: "sell", positionQty: 4.8 });
  assert.equal(sell.ok, true);
  if (sell.ok) assert.equal(sell.qty, 4);
});

test("the order id is stable and fits Alpaca's limit", () => {
  const id = clientOrderId("SOXL", "buy", base.barTime);
  assert.equal(id, clientOrderId("SOXL", "buy", base.barTime));
  assert.ok(id.length <= 48);
});

test("an unlock file is not a live key", () => {
  assert.equal(readLiveArm({ kind: "strategy-desk-unlock", tester: "Ada" }), null);
  const file = issueLiveArm(" Ada ", "2026-10-25");
  assert.equal(file.kind, LIVE_KIND);
  assert.equal(readLiveArm(file)?.tester, "Ada");
});

test("a flat account buys the next valid signal and does not invent the ones it missed", () => {
  assert.equal(nextAccountSignal(0, true, true, false), "buy");
  assert.equal(nextAccountSignal(4, true, true, false), "sell");
  assert.equal(nextAccountSignal(4, false, true, true), "none");
  const missed = missedSignals(
    [
      { signalBuy: true, signalSell: false, sellHold: false },
      { signalBuy: false, signalSell: true, sellHold: false },
    ],
    [{ index: 0, side: "buy" }],
    4,
  );
  assert.deepEqual(missed, [{ index: 1, side: "sell" }]);
});

test("a closed market and a daily loss stop refuse a naked order", () => {
  const closed = planOrder({ ...base, marketOpen: false });
  assert.equal(closed.ok, false);
  const limited = planOrder({ ...base, slippageCents: 15 });
  assert.equal(limited.ok, true);
  if (limited.ok) {
    assert.equal(limited.body.type, "limit");
    assert.equal(limited.body.limit_price, "40.15");
  }
  assert.equal(dailyStopHit(97, 100, 3), true);
  assert.equal(dailyStopHit(98, 100, 3), false);
  assert.deepEqual(openingPosition([], 4, 12), { qty: 4, price: 12 });
  assert.deepEqual(openingPosition([{ side: "buy", qty: 4 }], 4, 12), { qty: 0, price: 0 });
});

test("account history and fills land on the bars of this tape", () => {
  const points = readHistory({ timestamp: [100, 200], equity: [1000, 1100] });
  assert.deepEqual(equityOnBars([90_000, 150_000, 250_000], points), [1000, 1000, 1100]);
  const fills = readFills(
    [
      { id: "a", symbol: "SOXL", side: "buy", qty: "2", price: "40", transaction_time: "2026-10-01T14:00:00.000Z" },
      { symbol: "AAPL", side: "buy", qty: "1", price: "1", transaction_time: "2026-10-01T14:00:00.000Z" },
    ],
    "SOXL",
  );
  assert.equal(fills.length, 1);
  assert.equal(barIndexAt([Date.parse("2026-10-01T13:55:00.000Z"), Date.parse("2026-10-01T14:00:00.000Z")], fills[0].time), 1);
  assert.equal(roundTrips([{ side: "buy" }, { side: "sell" }, { side: "buy" }]), 1);
  assert.equal(drawdownPct([100, 80, 90]), 20);
});
