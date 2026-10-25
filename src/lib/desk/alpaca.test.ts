import assert from "node:assert/strict";
import test from "node:test";
import { clientOrderId, issueLiveArm, planOrder, readLiveArm, LIVE_KIND } from "./alpaca.ts";

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
