import test from "node:test";
import assert from "node:assert/strict";
import { createConversationService } from "../src/conversation.js";

const NUMBER = "5491100000001";
const OWNER = "5491199999999";

// Núcleo completo con adaptadores en memoria: sin WhatsApp, sin disco, sin modelo y sin esperas reales.
function setup({ cfg = {}, reply = "hola", blocked = null, connected = true } = {}) {
  let config = {
    dryRun: false, paused: false, debounceMinSec: 6, debounceMaxSec: 10, manualPauseMin: 30, ownerNumber: OWNER,
    typing: { minSec: 0, maxSec: 0 },
    contacts: [{ number: NUMBER, name: "Ana", enabled: true, paused: false }],
    sensitiveTopics: [{ id: "dinero", label: "Dinero", enabled: true, keywords: ["plata"] }],
    followUp: { enabled: true, maxAttempts: 2, delaysMin: [20], quietHours: { enabled: false } },
    ...cfg,
  };
  let time = 1_000_000, nextId = 0;
  const timers = new Map();
  const sent = [], typing = [], ownerNotes = [], logs = [], respondCalls = [];
  const store = {}; let saves = 0;

  const conversation = createConversationService({
    getConfig: () => config,
    updateConfig: (patch) => { config = { ...config, ...patch }; },
    history: { get: (n) => (store[n] ||= []), set: (n, m) => { store[n] = m; }, save: () => { saves++; } },
    messenger: {
      isConnected: () => connected,
      addressFor: (n) => `addr:${n}`,
      showTyping: async (address, ms) => { typing.push({ address, ms }); },
      send: async (address, text, { quoted } = {}) => { sent.push({ address, text, quoted }); },
      notifyOwner: async (owner, text) => { ownerNotes.push({ owner, text }); },
    },
    respond: async (history, opts) => {
      respondCalls.push({ history: structuredClone(history), opts });
      return blocked ? { parts: [], blocked } : { parts: [{ text: reply, replyTo: opts.incomingCount > 1 ? 2 : null }], blocked: null };
    },
    log: (kind, text, contact, words) => logs.push({ kind, text, contact, words }),
    clock: {
      now: () => time,
      random: () => 0,
      setTimer: (fn, ms) => { timers.set(++nextId, { fn, ms }); return nextId; },
      clearTimer: (id) => timers.delete(id),
    },
  });

  return {
    conversation, sent, typing, ownerNotes, logs, respondCalls, store, timers,
    get config() { return config; },
    get saves() { return saves; },
    advance: (ms) => { time += ms; },
    // Dispara el próximo timer pendiente y espera a que termine.
    fire: async () => { const [[id, t]] = [...timers]; timers.delete(id); await t.fn(); },
  };
}

const incoming = (text, extra = {}) => ({ phones: [NUMBER], address: "chat-1", text, ref: { id: text }, id: `id-${text}`, fromOwner: false, senderLabel: NUMBER, ...extra });

test("junta los mensajes del contacto, pide la respuesta y la envía con 'escribiendo…'", async () => {
  const s = setup();
  s.conversation.receive(incoming("hola"));
  s.conversation.receive(incoming("estás?"));
  await s.fire();
  assert.equal(s.respondCalls.length, 1);
  assert.deepEqual(s.respondCalls[0].history, [{ role: "user", content: "[1] hola\n[2] estás?" }]);
  assert.equal(s.respondCalls[0].opts.incomingCount, 2);
  assert.deepEqual(s.sent, [{ address: "chat-1", text: "hola", quoted: { id: "estás?" } }]);
  assert.equal(s.typing.length, 1);
  assert.deepEqual(s.store[NUMBER].at(-1), { role: "assistant", content: "hola" });
  assert.ok(s.saves >= 1);
});

test("en dryRun no envía nada, solo lo registra", async () => {
  const s = setup({ cfg: { dryRun: true } });
  s.conversation.receive(incoming("hola"));
  await s.fire();
  assert.deepEqual(s.sent, []);
  assert.ok(s.logs.some((l) => l.kind === "dry" && l.text === "hola"));
});

test("tema sensible: pausa al contacto, avisa al dueño y no llama al modelo", async () => {
  const s = setup();
  s.conversation.receive(incoming("me prestás plata?"));
  await s.fire();
  assert.equal(s.respondCalls.length, 0);
  assert.equal(s.config.contacts[0].paused, true);
  assert.equal(s.ownerNotes.length, 1);
  assert.match(s.ownerNotes[0].text, /Ana \(Dinero\)/);
  assert.deepEqual(s.sent, []);
});

test("respuesta bloqueada por el guard: avisa y no envía", async () => {
  const s = setup({ blocked: ["querido"] });
  s.conversation.receive(incoming("hola"));
  await s.fire();
  assert.deepEqual(s.sent, []);
  assert.ok(s.logs.some((l) => l.kind === "alert" && l.words?.includes("querido")));
});

test("si el dueño escribió a mano, el bot espera la pausa antes de contestar", async () => {
  const s = setup();
  s.conversation.receive(incoming("yo", { fromOwner: true }));
  s.conversation.receive(incoming("hola"));
  await s.fire();
  assert.deepEqual(s.sent, []);
  assert.ok(s.logs.some((l) => /el bot espera/.test(l.text)));
  s.advance(31 * 60_000);
  await s.fire();
  assert.equal(s.sent.length, 1);
});

test("contacto deshabilitado o desconocido: no responde; el desconocido se reporta una sola vez", async () => {
  const s = setup({ cfg: { contacts: [{ number: NUMBER, enabled: false }] } });
  s.conversation.receive(incoming("hola"));
  assert.equal(s.timers.size, 0);
  s.conversation.receive(incoming("hola", { phones: ["5491122223333"], senderLabel: "5491122223333" }));
  s.conversation.receive(incoming("otra", { phones: ["5491122223333"], senderLabel: "5491122223333" }));
  assert.equal(s.logs.filter((l) => /no está en Contactos/.test(l.text)).length, 1);
});

test("los mensajes de chats fuera de Contactos van al puerto onUnknown (los conocidos no)", () => {
  const unknown = [];
  const conversation = createConversationService({
    getConfig: () => ({ contacts: [{ number: NUMBER, enabled: true }], paused: false }),
    updateConfig: () => {},
    history: { get: () => [], set: () => {}, save: () => {} },
    messenger: { isConnected: () => true },
    respond: async () => ({ parts: [], blocked: null }),
    onUnknown: (msg) => unknown.push(msg),
    clock: { now: () => 0, random: () => 0, setTimer: () => 1, clearTimer: () => {} },
  });
  conversation.receive(incoming("hola"));
  conversation.receive(incoming("quién sos", { phones: ["5491122223333"] }));
  conversation.receive(incoming("yo", { phones: ["5491122223333"], fromOwner: true }));
  assert.deepEqual(unknown.map((m) => m.text), ["quién sos", "yo"]);
});

test("si el contacto no contesta, el seguimiento le escribe a la misma dirección", async () => {
  const s = setup({ reply: "che?" });
  s.conversation.receive(incoming("hola"));
  await s.fire();               // respuesta
  s.advance(20 * 60_000);
  await s.fire();               // seguimiento
  assert.equal(s.respondCalls.at(-1).opts.followUp.attempt, 0);
  assert.equal(s.sent.at(-1).address, "chat-1");
});

test("el seguimiento no se envía si la plataforma está desconectada", async () => {
  const s = setup({ connected: false });
  s.conversation.receive(incoming("hola"));
  await s.fire();
  s.advance(20 * 60_000);
  await s.fire();
  assert.equal(s.respondCalls.length, 1);
});

test("setContactPaused guarda la pausa y cancela el seguimiento pendiente", async () => {
  const s = setup();
  s.conversation.receive(incoming("hola"));
  await s.fire();
  assert.equal(s.timers.size, 1); // seguimiento armado
  s.conversation.setContactPaused(NUMBER, true);
  assert.equal(s.timers.size, 0);
  assert.equal(s.config.contacts[0].paused, true);
});
