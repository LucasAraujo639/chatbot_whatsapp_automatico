import test from "node:test";
import assert from "node:assert/strict";
import { localTime, dayPart, timeBlock, wrongGreeting, fixGreetings, greetingFor } from "../src/time-context.js";
import { respond, buildSystemPrompt } from "../src/responder.js";
import { buildLexicon } from "../src/lexicon.js";

// 2026-01-05 (lunes) a la hora UTC dada; Buenos Aires es UTC-3.
const at = (utcHour, min = 0) => Date.UTC(2026, 0, 5, utcHour, min);
const TZ = "America/Argentina/Buenos_Aires";

test("localTime respeta la zona horaria", () => {
  assert.deepEqual(localTime(at(4, 10), TZ), { hour: 1, minute: 10, weekday: 1 });
  assert.equal(localTime(at(15), TZ).hour, 12);
  assert.equal(localTime(at(15), "Zona/Invalida").hour, 12); // cae al default
});

test("dayPart", () => {
  assert.equal(dayPart(1), "madrugada");
  assert.equal(dayPart(9), "mañana");
  assert.equal(dayPart(12), "mediodía");
  assert.equal(dayPart(17), "tarde");
  assert.equal(dayPart(22), "noche");
});

test("timeBlock avisa la hora y que es de madrugada", () => {
  const b = timeBlock(at(4, 10), TZ);
  assert.match(b, /01:10 \(madrugada\) del lunes/);
  assert.match(b, /facultad/);
  assert.doesNotMatch(timeBlock(at(15), TZ), /Es de madrugada/);
});

test("wrongGreeting detecta saludos fuera de hora", () => {
  assert.equal(wrongGreeting("buenas noches negrita", 12), "buenas noches");
  assert.equal(wrongGreeting("buen día amor", 22), "buen día");
  assert.equal(wrongGreeting("buenos días", 1), "buen día");
  assert.equal(wrongGreeting("buenas tardes", 9), "buenas tardes");
  assert.equal(wrongGreeting("buenas noches negrita", 23), null);
  assert.equal(wrongGreeting("buenas noches", 1), null);
  assert.equal(wrongGreeting("buen día", 8), null);
  assert.equal(wrongGreeting("hola amor", 12), null);
});

test("fixGreetings y greetingFor", () => {
  assert.equal(greetingFor(8), "buen día");
  assert.equal(greetingFor(16), "buenas tardes");
  assert.equal(greetingFor(23), "buenas noches");
  assert.equal(fixGreetings("Buenas noches negrita", 12), "buenas tardes negrita");
  assert.equal(fixGreetings("buenas noches negrita", 23), "buenas noches negrita");
});

test("buildSystemPrompt incluye el bloque de hora antes de las reglas", () => {
  const p = buildSystemPrompt({ timeContext: "Ahora son las 01:10 (madrugada)" });
  assert.ok(p.indexOf("Ahora son las 01:10") < p.indexOf("REGLAS"));
});

const makeDeps = (outputs, nowMs) => {
  const calls = [];
  return {
    calls,
    now: () => nowMs,
    getConfig: () => ({ provider: {}, guard: { enabled: false }, timezone: TZ }),
    load: () => ({ about: "", profile: null, corpus: null, lexicon: null }),
    random: () => 0.5,
    chat: async (_p, system, messages) => { calls.push({ system, messages }); return outputs.shift(); },
  };
};

test("respond manda la hora al modelo", async () => {
  const d = makeDeps(["hola"], at(15));
  await respond([{ role: "user", content: "hola" }], {}, d);
  assert.match(d.calls[0].system, /12:00 \(mediodía\)/);
});

test("saludo fuera de hora: reintenta con corrección y usa el bueno", async () => {
  const d = makeDeps(["buenas noches negrita", "buenas tardes negrita"], at(15)); // 12:00
  const r = await respond([{ role: "user", content: "hola" }], {}, d);
  assert.equal(d.calls.length, 2);
  assert.match(d.calls[1].messages.at(-1).content, /buenas noches/);
  assert.equal(r.parts[0].text, "buenas tardes negrita");
});

test("si el modelo insiste con el saludo, se corrige sin bloquear", async () => {
  const d = makeDeps(["buenas noches negrita", "buenas noches negrita"], at(15)); // 12:00
  const r = await respond([{ role: "user", content: "hola" }], {}, d);
  assert.equal(r.blocked, null);
  assert.equal(r.parts[0].text, "buenas tardes negrita");
  assert.ok(r.notes.some((n) => /Cambié el saludo/.test(n)));
});

// ---- Más casos: límites, formatos y combinaciones ----

test("localTime: medianoche es hora 0 y el día cambia con la zona", () => {
  // 03:00 UTC del lunes = 00:00 del lunes en Buenos Aires
  assert.equal(localTime(at(3), TZ).hour, 0);
  // 02:00 UTC del lunes = 23:00 del domingo en Buenos Aires
  assert.deepEqual(localTime(at(2), TZ), { hour: 23, minute: 0, weekday: 0 });
});

test("localTime: sin zona usa la de Buenos Aires", () => {
  assert.equal(localTime(at(15)).hour, 12);
  assert.equal(localTime(at(15), undefined).hour, 12);
});

test("dayPart: límites exactos", () => {
  assert.equal(dayPart(0), "madrugada");
  assert.equal(dayPart(5), "madrugada");
  assert.equal(dayPart(6), "mañana");
  assert.equal(dayPart(11), "mañana");
  assert.equal(dayPart(13), "mediodía");
  assert.equal(dayPart(14), "tarde");
  assert.equal(dayPart(19), "tarde");
  assert.equal(dayPart(20), "noche");
  assert.equal(dayPart(23), "noche");
});

test("wrongGreeting: límites de cada franja", () => {
  assert.equal(wrongGreeting("buen día", 4), "buen día");
  assert.equal(wrongGreeting("buen día", 5), null);
  assert.equal(wrongGreeting("buen día", 13), null);
  assert.equal(wrongGreeting("buen día", 14), "buen día");
  assert.equal(wrongGreeting("buenas tardes", 11), "buenas tardes");
  assert.equal(wrongGreeting("buenas tardes", 12), null);
  assert.equal(wrongGreeting("buenas tardes", 20), null);
  assert.equal(wrongGreeting("buenas tardes", 21), "buenas tardes");
  assert.equal(wrongGreeting("buenas noches", 18), "buenas noches");
  assert.equal(wrongGreeting("buenas noches", 19), null);
  assert.equal(wrongGreeting("buenas noches", 5), null);
  assert.equal(wrongGreeting("buenas noches", 6), "buenas noches");
});

test("wrongGreeting: mayúsculas, sin tilde y plurales", () => {
  assert.equal(wrongGreeting("BUEN DIA amor", 22), "buen día");
  assert.equal(wrongGreeting("Buenos Días", 22), "buen día");
  assert.equal(wrongGreeting("buenas noche", 12), "buenas noches");
});

test("wrongGreeting: palabras parecidas no cuentan como saludo", () => {
  assert.equal(wrongGreeting("tengo un buen diario", 22), null);
  assert.equal(wrongGreeting("", 12), null);
});

test("fixGreetings: conserva el resto del texto y arregla varios saludos", () => {
  assert.equal(fixGreetings("buenas noches amor, buenas noches", 9), "buen día amor, buen día");
  assert.equal(fixGreetings("hola amor", 9), "hola amor");
});

test("respond: sin saludo fuera de hora hace una sola llamada", async () => {
  const d = makeDeps(["buenas tardes negrita"], at(15));
  await respond([{ role: "user", content: "hola" }], {}, d);
  assert.equal(d.calls.length, 1);
});

test("respond: solo se corrige el mensaje de la ráfaga con el saludo malo", async () => {
  const out = "buenas noches\n---\nque haces";
  const d = makeDeps([out, out], at(15)); // 12:00
  d.getConfig = () => ({ provider: {}, guard: { enabled: false }, timezone: TZ, burst: { min: 2, max: 2 } });
  const r = await respond([{ role: "user", content: "hola" }], {}, d);
  assert.deepEqual(r.parts.map((p) => p.text), ["buenas tardes", "que haces"]);
});

test("respond: usa la zona horaria de la config", async () => {
  const d = makeDeps(["hola"], at(15)); // 12:00 en Buenos Aires, 17:00 en Madrid (enero)
  d.getConfig = () => ({ provider: {}, guard: { enabled: false }, timezone: "Europe/Madrid" });
  await respond([{ role: "user", content: "hola" }], {}, d);
  assert.match(d.calls[0].system, /16:00 \(tarde\)/);
});

test("respond: saludo malo y palabra ajena juntos se corrigen en una sola vuelta", async () => {
  const lexicon = buildLexicon(["hola amor", "hola amor", "buenas tardes", "buenas tardes"]);
  const d = makeDeps(["buenas noches holuu", "buenas tardes amor"], at(15));
  d.getConfig = () => ({ provider: {}, guard: { enabled: true, maxRetries: 2 }, timezone: TZ });
  d.load = () => ({ about: "", profile: null, corpus: null, lexicon });
  const r = await respond([{ role: "user", content: "hola" }], {}, d);
  assert.equal(d.calls.length, 2);
  const correction = d.calls[1].messages.at(-1).content;
  assert.match(correction, /holuu/);
  assert.match(correction, /buenas noches/);
  assert.equal(r.parts[0].text, "buenas tardes amor");
});

test("respond: el control de saludos no gasta los reintentos de palabras ajenas", async () => {
  const lexicon = buildLexicon(["hola amor", "hola amor"]);
  const d = makeDeps(["holuu"], at(15));
  d.getConfig = () => ({ provider: {}, guard: { enabled: true, maxRetries: 0 }, timezone: TZ });
  d.load = () => ({ about: "", profile: null, corpus: null, lexicon });
  const r = await respond([{ role: "user", content: "hola" }], {}, d);
  assert.equal(d.calls.length, 1); // maxRetries 0 = sin reintentos
  assert.deepEqual(r.blocked, ["holuu"]);
});

test("respond: también corrige el saludo de un seguimiento de madrugada", async () => {
  const d = makeDeps(["buen día amor", "buen día amor"], at(5)); // 02:00
  const r = await respond([{ role: "assistant", content: "hola" }], { followUp: { attempt: 0, minutesSilent: 20 } }, d);
  assert.equal(r.parts[0].text, "buenas noches amor");
});
