import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBurst, normalizeTyping, pickBurstSize, limitParts, typingDelayMs, plannedDelays } from "../src/pacing.js";

test("normalizeBurst: defaults, límites y orden", () => {
  assert.deepEqual(normalizeBurst(undefined), { min: 1, max: 3 });
  assert.deepEqual(normalizeBurst({ min: 5, max: 2 }), { min: 2, max: 5 });
  assert.deepEqual(normalizeBurst({ min: 0, max: 99 }), { min: 1, max: 8 });
  assert.deepEqual(normalizeBurst({ min: "x", max: null }), { min: 1, max: 3 });
});

test("normalizeTyping: defaults, límites y orden", () => {
  assert.deepEqual(normalizeTyping(undefined), { minSec: 2, maxSec: 6 });
  assert.deepEqual(normalizeTyping({ minSec: 9, maxSec: 3 }), { minSec: 3, maxSec: 9 });
  assert.deepEqual(normalizeTyping({ minSec: -5, maxSec: 1000 }), { minSec: 0, maxSec: 120 });
});

test("pickBurstSize cubre todo el rango (inclusive)", () => {
  const b = { min: 2, max: 4 };
  assert.equal(pickBurstSize(b, () => 0), 2);
  assert.equal(pickBurstSize(b, () => 0.5), 3);
  assert.equal(pickBurstSize(b, () => 0.999), 4);
  assert.equal(pickBurstSize({ min: 1, max: 1 }, () => 0.9), 1);
});

test("limitParts une los sobrantes al último permitido", () => {
  const parts = [{ text: "a", replyTo: 1 }, { text: "b", replyTo: null }, { text: "c", replyTo: null }, { text: "d", replyTo: null }];
  assert.deepEqual(limitParts(parts, 2), [{ text: "a", replyTo: 1 }, { text: "b c d", replyTo: null }]);
  assert.equal(limitParts(parts, 9), parts);
});

test("typingDelayMs queda dentro del rango", () => {
  const t = { minSec: 2, maxSec: 6 };
  assert.equal(typingDelayMs(t, () => 0), 2000);
  assert.equal(typingDelayMs(t, () => 1), 6000);
  assert.equal(typingDelayMs({ minSec: 3, maxSec: 3 }, () => 0.7), 3000);
  assert.equal(plannedDelays(3, t, () => 0.5).length, 3);
});
