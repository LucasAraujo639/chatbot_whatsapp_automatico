import test from "node:test";
import assert from "node:assert/strict";
import { parseReply } from "../src/reply-parser.js";
import { simulateTurn, simulateFollowUp, validateMessages, InvalidSimulationInput } from "../src/simulator.js";

const topics = [{ id: "dinero", label: "Dinero", enabled: true, keywords: ["plata"] }];
const followUp = { enabled: true, maxAttempts: 2, delaysMin: [20, 120], quietHours: { enabled: false } };
const deps = (out, seen = []) => ({
  getConfig: () => ({ sensitiveTopics: topics, followUp }),
  respond: async (h, o) => { seen.push({ h, o }); return { parts: out ? parseReply(out, o.incomingCount ?? 0) : [], blocked: null, notes: [] }; },
});
const user = (content) => [{ role: "user", content }];

test("tema sensible → pausa y no llama al modelo", async () => {
  let called = false;
  const r = await simulateTurn(user("me prestás plata?"), { ...deps("x"), respond: async () => { called = true; } });
  assert.deepEqual(r, { paused: true, topic: "Dinero", parts: [] });
  assert.equal(called, false);
});

test("respuesta normal se parte en mensajes", async () => {
  const r = await simulateTurn(user("hola"), deps("buenas\n---\nqué onda"));
  assert.deepEqual(r.parts, [{ text: "buenas", replyTo: null }, { text: "qué onda", replyTo: null }]);
});

test("lote de mensajes se numera y las citas válidas se conservan", async () => {
  const seen = [];
  const r = await simulateTurn([{ role: "user", content: ["hola", "cómo andás?"] }], deps("[2] bien vos\n---\n[9] jaja", seen));
  assert.equal(seen[0].h[0].content, "[1] hola\n[2] cómo andás?");
  assert.deepEqual(r.parts, [{ text: "bien vos", replyTo: 2 }, { text: "jaja", replyTo: null }]);
});

test("modelo sin texto lanza error", async () => assert.rejects(simulateTurn(user("hola"), deps("")), /no devolvió texto/));

test("validación rechaza entradas inválidas", () => {
  for (const bad of [undefined, [], [{ role: "system", content: "x" }], [{ role: "user", content: "  " }], [{ role: "user", content: [] }], [{ role: "assistant", content: "x" }]])
    assert.throws(() => validateMessages(bad), InvalidSimulationInput);
});

test("seguimiento: usa la espera configurada y manda la instrucción", async () => {
  const seen = [];
  const msgs = [{ role: "user", content: "hola" }, { role: "assistant", content: "buenas" }];
  const r = await simulateFollowUp(msgs, 1, deps("seguís por ahí?", seen));
  assert.deepEqual(seen[0].o, { followUp: { attempt: 1, minutesSilent: 120 } });
  assert.deepEqual(r.parts, [{ text: "seguís por ahí?", replyTo: null }]);
});

test("seguimiento solo si el último mensaje es del bot", () => assert.rejects(simulateFollowUp(user("hola"), 0, deps("x")), InvalidSimulationInput));

test("si el guard bloquea la respuesta, se informa en vez de fallar", async () => {
  const d = { ...deps("x"), respond: async () => ({ parts: [], blocked: ["holuu"], notes: ["Corregí: holuu"] }) };
  const r = await simulateTurn(user("hola"), d);
  assert.deepEqual(r.blocked, ["holuu"]);
  assert.deepEqual(r.parts, []);
});
