import test from "node:test";
import assert from "node:assert/strict";
import { respond, buildSystemPrompt } from "../src/responder.js";
import { buildLexicon } from "../src/lexicon.js";

const lexicon = buildLexicon(["hola amor", "hola amor", "buenas noches negrita", "buenas noches negrita", "que haces", "que haces"]);
const corpus = [{ them: ["buenas noches"], me: ["buenas noches negrita"] }, { them: ["buenas noches amor"], me: ["descansa amor"] }];
const history = [{ role: "user", content: "hola" }];

const makeDeps = (outputs, guard = { enabled: true, maxRetries: 2 }) => {
  const calls = [];
  return {
    calls,
    getConfig: () => ({ provider: {}, guard }),
    load: () => ({ about: "", profile: null, corpus, lexicon }),
    random: () => 0.5,
    chat: async (_p, _s, messages) => { calls.push(messages); return outputs.shift(); },
  };
};

test("respuesta con vocabulario propio pasa sin reintentos", async () => {
  const d = makeDeps(["hola amor"]);
  const r = await respond(history, {}, d);
  assert.equal(d.calls.length, 1);
  assert.deepEqual(r.parts.map((p) => p.text), ["hola amor"]);
  assert.equal(r.blocked, null);
});

test("palabra inventada: reintenta con corrección y se queda con la limpia", async () => {
  const d = makeDeps(["Holuu amor", "hola amor"]);
  const r = await respond(history, {}, d);
  assert.equal(d.calls.length, 2);
  assert.match(d.calls[1].at(-1).content, /holuu/);
  assert.deepEqual(r.notes, ["Corregí: holuu"]);
  assert.equal(r.parts[0].text, "hola amor");
});

test("si persiste tras los reintentos devuelve blocked y no manda nada", async () => {
  const d = makeDeps(["Holuu", "Holuu", "Holuu"]);
  const r = await respond(history, {}, d);
  assert.equal(d.calls.length, 3);
  assert.deepEqual(r.blocked, ["holuu"]);
  assert.deepEqual(r.parts, []);
});

test("guard desactivado no controla nada", async () => {
  const d = makeDeps(["Holuu"], { enabled: false, maxRetries: 2 });
  const r = await respond(history, {}, d);
  assert.equal(r.parts[0].text, "Holuu");
});

test("el prompt incluye tus saludos reales y reglas anti-invento", () => {
  const p = buildSystemPrompt({ about: "Nombre: Lucas", corpus, lexicon, history: [{ role: "user", content: "Buenas noches" }], rng: () => 0.5 });
  assert.match(p, /buenas noches negrita/);
  assert.match(p, /Situación detectada/);
  assert.match(p, /Prohibido introducir temas/);
  assert.match(p, /Vocabulario real/);
});

test("saludo: no repite la respuesta que el bot ya usó", () => {
  const h = [{ role: "user", content: "Buenas noches" }, { role: "assistant", content: "buenas noches negrita" }, { role: "user", content: "Buenas noches" }];
  const section = buildSystemPrompt({ corpus, lexicon, history: h, rng: () => 0.5 }).split("Situación detectada")[1].split("Respondé con una")[0];
  assert.doesNotMatch(section, /buenas noches negrita/);
});

test("el prompt pide la cantidad de mensajes elegida dentro del rango", () => {
  assert.match(buildSystemPrompt({ history, burstTarget: 3 }), /hasta 3 mensajes seguidos/);
  assert.match(buildSystemPrompt({ history, burstTarget: 1 }), /UN solo mensaje/);
});

test("respond elige la cantidad con el rng y recorta lo que se pasa del máximo", async () => {
  const d = makeDeps(["hola\n---\namor\n---\nque haces\n---\nnada"]);
  d.getConfig = () => ({ provider: {}, guard: { enabled: false }, burst: { min: 2, max: 2 } });
  let prompt;
  d.chat = async (_p, system) => { prompt = system; return "hola\n---\namor\n---\nque haces\n---\nnada"; };
  const r = await respond(history, {}, d);
  assert.match(prompt, /hasta 2 mensajes/);
  assert.deepEqual(r.parts.map((p) => p.text), ["hola", "amor que haces nada"]);
});

test("el prompt aclara que de los ejemplos se copia el estilo, no el contenido", () => {
  const p = buildSystemPrompt({ corpus, lexicon, history: [{ role: "user", content: "Buenas noches" }], rng: () => 0.5 });
  assert.match(p, /copiá solo el tono y la forma/i);
  assert.match(p, /Nunca copies de los ejemplos hechos, personas, días, horarios/);
});

test("no se despide si el contacto no dijo que se va", async () => {
  const h = [{ role: "user", content: "Perdón amor, tengo que ganar plata jaja" }];
  const prompt = buildSystemPrompt({ history: h });
  assert.match(prompt, /prohibido despedirte/);
  const d = makeDeps(["jajaja\n---\nque descanses gorda\n---\nte amo"]);
  d.getConfig = () => ({ provider: {}, guard: { enabled: false }, burst: { min: 1, max: 5 } });
  const r = await respond(h, {}, d);
  assert.deepEqual(r.parts.map((p) => p.text), ["jajaja", "te amo"]);
});

test("si el contacto se va a dormir, la despedida está permitida", async () => {
  const h = [{ role: "user", content: "me voy a dormir amor" }];
  assert.doesNotMatch(buildSystemPrompt({ history: h }), /prohibido despedirte/);
  const d = makeDeps(["que descanses gorda"]);
  d.getConfig = () => ({ provider: {}, guard: { enabled: false }, burst: { min: 1, max: 5 } });
  const r = await respond(h, {}, d);
  assert.deepEqual(r.parts.map((p) => p.text), ["que descanses gorda"]);
});

test("el nombre del dueño sale de la config, si no del chat entrenado, si no uno genérico", async () => {
  const { ownerNameOf, DEFAULT_OWNER_NAME } = await import("../src/config.js");
  assert.equal(ownerNameOf({ ownerName: " Ana " }, { me: "Lucas" }), "Ana");
  assert.equal(ownerNameOf({ ownerName: "" }, { me: "Lucas" }), "Lucas");
  assert.equal(ownerNameOf({}, null), DEFAULT_OWNER_NAME);
  const p = buildSystemPrompt({ name: "Ana", history });
  assert.match(p, /^Sos Ana respondiendo/);
  assert.doesNotMatch(p, /Lucas/);
});

test("respond usa el nombre configurado en el prompt", async () => {
  const d = makeDeps(["hola"]);
  d.getConfig = () => ({ ownerName: "Ana", provider: {}, guard: { enabled: false }, burst: { min: 1, max: 1 } });
  let prompt;
  d.chat = async (_p, system) => { prompt = system; return "hola"; };
  await respond(history, {}, d);
  assert.match(prompt, /Sos Ana/);
});

test("el prompt incluye la hora actual y la regla de coherencia horaria", async () => {
  const { partOfDay } = await import("../src/responder.js");
  const p = buildSystemPrompt({ history, now: new Date(2026, 10, 22, 22, 5) });
  assert.match(p, /22:05 \(noche\)/);
  assert.match(p, /de noche no digas que te acabás de levantar/);
  assert.deepEqual([3, 9, 13, 16, 23].map(partOfDay), ["madrugada", "mañana", "mediodía", "tarde", "noche"]);
});
