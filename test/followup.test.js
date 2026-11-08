import test from "node:test";
import assert from "node:assert/strict";
import { createFollowUpScheduler, isQuietHour, msUntilQuietEnd } from "../src/followup.js";

const at = (h, m = 0) => new Date(2026, 0, 1, h, m);
const quiet = { enabled: true, from: "00:00", to: "08:00" };

test("isQuietHour: ventana normal y que cruza medianoche", () => {
  assert.equal(isQuietHour(at(3), quiet), true);
  assert.equal(isQuietHour(at(8), quiet), false);
  const night = { enabled: true, from: "22:00", to: "07:00" };
  assert.equal(isQuietHour(at(23), night), true);
  assert.equal(isQuietHour(at(6, 59), night), true);
  assert.equal(isQuietHour(at(12), night), false);
  assert.equal(isQuietHour(at(3), { ...quiet, enabled: false }), false);
});

test("msUntilQuietEnd", () => {
  assert.equal(msUntilQuietEnd(at(3), quiet), 5 * 3600_000);
  assert.equal(msUntilQuietEnd(at(23), { enabled: true, from: "22:00", to: "07:00" }), 8 * 3600_000);
});

// Reloj y timers falsos
function harness(followUp, { canSend = () => true, startHour = 12 } = {}) {
  let t = at(startHour).getTime();
  const timers = [];
  const sent = [];
  const cfg = { followUp: { enabled: true, maxAttempts: 2, delaysMin: [20, 120], quietHours: { enabled: false }, ...followUp } };
  const s = createFollowUpScheduler({
    getConfig: () => cfg,
    canSend,
    send: async (n, info) => { sent.push([n, info]); },
    now: () => t,
    setTimer: (fn, ms) => { const x = { fn, at: t + ms, off: false }; timers.push(x); return x; },
    clearTimer: (x) => { x.off = true; },
  });
  const advance = async () => { // dispara el próximo timer vivo
    const x = timers.filter((y) => !y.off).sort((a, b) => a.at - b.at)[0];
    if (!x) return false;
    x.off = true; t = Math.max(t, x.at); await x.fn(); return true;
  };
  return { s, sent, advance, cfg, now: () => t };
}

test("dispara tras la espera, escala y respeta maxAttempts", async () => {
  const h = harness();
  h.s.arm("1");
  await h.advance(); await h.advance();
  assert.deepEqual(h.sent, [["1", { attempt: 0, minutesSilent: 20 }], ["1", { attempt: 1, minutesSilent: 120 }]]);
  assert.equal(await h.advance(), false); // no hay tercer intento
});

test("cancel (ella escribió) evita el seguimiento", async () => {
  const h = harness();
  h.s.arm("1"); h.s.cancel("1");
  assert.equal(await h.advance(), false);
  assert.deepEqual(h.sent, []);
});

test("desactivado no programa nada", async () => {
  const h = harness({ enabled: false });
  h.s.arm("1");
  assert.equal(h.s.has("1"), false);
});

test("si canSend es falso (pausa) no envía", async () => {
  const h = harness({}, { canSend: () => false });
  h.s.arm("1"); await h.advance();
  assert.deepEqual(h.sent, []);
  assert.equal(h.s.has("1"), false);
});

test("en horario de silencio se pospone hasta que termina", async () => {
  const h = harness({ quietHours: quiet }, { startHour: 23 });
  h.s.arm("1");
  await h.advance();           // 23:20: fuera del silencio, envía
  assert.equal(h.sent.length, 1);
  await h.advance();           // +120 min → 01:20, en silencio → reprograma 08:00
  assert.equal(h.sent.length, 1);
  assert.equal(new Date(h.now()).getHours(), 1);
  await h.advance();           // dispara a las 08:00
  assert.equal(h.sent.length, 2);
  assert.equal(new Date(h.now()).getHours(), 8);
});
