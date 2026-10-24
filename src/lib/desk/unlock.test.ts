import assert from "node:assert/strict";
import test from "node:test";
import { defaultParams } from "./model.ts";
import { applyUnlock, issueUnlock, readUnlock, strategiesOff, UNLOCK_KIND } from "./unlock.ts";

test("a desk with no unlock file has every strategy off", () => {
  const quiet = strategiesOff(defaultParams());
  assert.equal(quiet.lower.buyOn, false);
  assert.equal(quiet.upper.sellOn, false);
  assert.equal(quiet.rsi.buyOn, false);
  assert.equal(quiet.rsi.sellOn, false);
  assert.equal(quiet.drop.sellOn, false);
  assert.equal(quiet.step.stopOn, false);
  assert.equal(quiet.matrix.buy.on, false);
  assert.equal(quiet.bands.length, defaultParams().bands.length);
});

test("an unlock file keeps the master's book except the strategies it names", () => {
  const master = defaultParams();
  master.rsi.buyLevel = 25;
  master.mfi.buyLevel = 40;
  const file = issueUnlock("Ada", ["rsi"], master, "2026-10-24");
  const edited = defaultParams();
  edited.rsi.buyLevel = 12;
  edited.rsi.buyOn = false;
  edited.mfi.buyLevel = 5;
  edited.bands.length = 9;
  const sealed = applyUnlock(edited, file);
  assert.equal(sealed.rsi.buyLevel, 12);
  assert.equal(sealed.rsi.buyOn, false);
  assert.equal(sealed.mfi.buyLevel, 40);
  assert.equal(sealed.bands.length, 30);
  assert.equal(file.tester, "Ada");
  assert.equal(file.kind, UNLOCK_KIND);
});

test("a file that is not an unlock file is refused", () => {
  assert.equal(readUnlock({ kind: "other", tester: "Ada", allow: [] }), null);
  assert.equal(readUnlock(null), null);
  const read = readUnlock({ kind: UNLOCK_KIND, tester: " Bea ", allow: ["rsi", "nope", "rsi"], params: {} });
  assert.deepEqual(read && { tester: read.tester, allow: read.allow }, { tester: "Bea", allow: ["rsi"] });
});
