import test from "node:test";
import assert from "node:assert/strict";
import { createMessageBuffer } from "../src/message-buffer.js";

const NUMBER = "5491100000001";

// Reloj y timers falsos: nada espera de verdad y el azar es fijo.
function setup({ cfg = {}, canReply = () => true, random = () => 0 } = {}) {
  let time = 1_000_000;
  let nextId = 0;
  const timers = new Map(); // id -> { fn, ms }
  const delivered = [], waits = [], errors = [];
  const config = { debounceMinSec: 6, debounceMaxSec: 10, manualPauseMin: 30, ...cfg };
  const buffer = createMessageBuffer({
    getConfig: () => config,
    canReply,
    deliver: async (number, msgs, jid) => { delivered.push({ number, texts: msgs.map((m) => m.text), jid }); },
    onWait: (number, ms) => waits.push({ number, ms }),
    onError: (number, e) => errors.push({ number, message: e.message }),
    now: () => time,
    random,
    setTimer: (fn, ms) => { timers.set(++nextId, { fn, ms }); return nextId; },
    clearTimer: (id) => timers.delete(id),
  });
  return {
    buffer, delivered, waits, errors, timers, config,
    advance: (ms) => { time += ms; },
    // Dispara el único timer pendiente (y espera a que termine el envío).
    fire: async () => { const [[id, t]] = [...timers]; timers.delete(id); await t.fn(); },
  };
}
const msg = (text) => ({ text, raw: { id: text } });

test("espera un tiempo al azar entre el mínimo y el máximo antes de responder", () => {
  const low = setup({ random: () => 0 });
  low.buffer.add(NUMBER, msg("hola"), "jid");
  assert.equal([...low.timers.values()][0].ms, 6000);
  const high = setup({ random: () => 1 });
  high.buffer.add(NUMBER, msg("hola"), "jid");
  assert.equal([...high.timers.values()][0].ms, 10000);
});

test("si el máximo es menor que el mínimo, espera el mínimo", () => {
  const s = setup({ cfg: { debounceMinSec: 8, debounceMaxSec: 2 }, random: () => 1 });
  s.buffer.add(NUMBER, msg("hola"), "jid");
  assert.equal([...s.timers.values()][0].ms, 8000);
});

test("mensajes seguidos reinician la espera y se entregan juntos, en orden", async () => {
  const s = setup();
  s.buffer.add(NUMBER, msg("hola"), "jid-1");
  s.buffer.add(NUMBER, msg("estás?"), "jid-2");
  assert.equal(s.timers.size, 1); // el timer anterior se canceló
  await s.fire();
  assert.deepEqual(s.delivered, [{ number: NUMBER, texts: ["hola", "estás?"], jid: "jid-2" }]);
});

test("después de entregar, el buffer queda vacío", async () => {
  const s = setup();
  s.buffer.add(NUMBER, msg("hola"), "jid");
  await s.fire();
  s.buffer.add(NUMBER, msg("otra"), "jid");
  await s.fire();
  assert.deepEqual(s.delivered.map((d) => d.texts), [["hola"], ["otra"]]);
});

test("cada contacto tiene su propio buffer", async () => {
  const s = setup();
  s.buffer.add("111", msg("a"), "j1");
  s.buffer.add("222", msg("b"), "j2");
  assert.equal(s.timers.size, 2);
  for (const [id, t] of [...s.timers]) { s.timers.delete(id); await t.fn(); }
  assert.deepEqual(s.delivered.map((d) => [d.number, d.texts]), [["111", ["a"]], ["222", ["b"]]]);
});

test("si no corresponde responder (contacto o bot pausado), descarta sin entregar", async () => {
  const s = setup({ canReply: () => false });
  s.buffer.add(NUMBER, msg("hola"), "jid");
  await s.fire();
  assert.deepEqual(s.delivered, []);
  assert.deepEqual(s.waits, []);
});

test("tras un mensaje escrito a mano, no responde y reintenta cuando termina la pausa", async () => {
  const s = setup();
  s.buffer.markManual(NUMBER); // pausa de 30 min
  s.buffer.add(NUMBER, msg("hola"), "jid");
  s.advance(10 * 60_000);
  await s.fire();
  assert.deepEqual(s.delivered, []);
  assert.deepEqual(s.waits, [{ number: NUMBER, ms: 20 * 60_000 }]);
  assert.equal([...s.timers.values()][0].ms, 20 * 60_000 + 1000); // vuelve a intentar un segundo después de que termine
  s.advance(20 * 60_000 + 1000);
  await s.fire();
  assert.deepEqual(s.delivered, [{ number: NUMBER, texts: ["hola"], jid: "jid" }]); // no se perdió lo que ella escribió
});

test("la pausa manual de un contacto no afecta a otro", async () => {
  const s = setup();
  s.buffer.markManual("111");
  assert.equal(s.buffer.isManuallyPaused("111"), true);
  assert.equal(s.buffer.isManuallyPaused("222"), false);
});

test("isManuallyPaused deja de ser verdadero cuando pasan los minutos configurados", () => {
  const s = setup({ cfg: { manualPauseMin: 5 } });
  assert.equal(s.buffer.isManuallyPaused(NUMBER), false);
  s.buffer.markManual(NUMBER);
  s.advance(4 * 60_000);
  assert.equal(s.buffer.isManuallyPaused(NUMBER), true);
  s.advance(60_000);
  assert.equal(s.buffer.isManuallyPaused(NUMBER), false);
});

test("un error al entregar se informa con el número y no tira el proceso", async () => {
  const s = setup();
  const failing = createMessageBuffer({
    getConfig: () => s.config, canReply: () => true,
    deliver: async () => { throw new Error("falló el modelo"); },
    onWait: () => {}, onError: (number, e) => s.errors.push({ number, message: e.message }),
    random: () => 0, setTimer: (fn) => { s.timers.set(99, { fn, ms: 0 }); return 99; }, clearTimer: () => {},
  });
  failing.add(NUMBER, msg("hola"), "jid");
  await s.fire();
  assert.deepEqual(s.errors, [{ number: NUMBER, message: "falló el modelo" }]);
});
