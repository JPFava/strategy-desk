import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPassword, hashPassword, newKey, seal, unseal } from "./vault.ts";

test("a desk password matches only itself", () => {
  const stored = hashPassword("correct-horse");
  assert.equal(checkPassword("correct-horse", stored.salt, stored.hash), true);
  assert.equal(checkPassword("wrong-horse", stored.salt, stored.hash), false);
});

test("broker keys round-trip through the local seal and do not sit in the clear", () => {
  const key = newKey();
  const secret = "AK-secret-value";
  const sealed = seal(key, { secret });
  assert.equal(sealed.includes(secret), false);
  assert.deepEqual(unseal<{ secret: string }>(key, sealed), { secret });
  assert.throws(() => unseal(newKey(), sealed));
});
