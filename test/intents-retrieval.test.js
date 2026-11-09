import test from "node:test";
import assert from "node:assert/strict";
import { detectIntent, repliesForIntent } from "../src/intents.js";
import { retrieveExamples } from "../src/retrieval.js";
import { buildCorpus, parseText } from "../src/style.js";

test("detectIntent entiende variantes de buenas noches", () => {
  for (const t of ["Buenas noches amor", "BUENAS NOCHESSS", "me voy a dormir", "que descanses"]) assert.equal(detectIntent(t)?.id, "buenas_noches", t);
  assert.equal(detectIntent("buen día"), detectIntent("Buenos días!") && detectIntent("buen día"));
  assert.equal(detectIntent("qué hacés"), null);
});

const msgs = [
  { who: "Ella", text: "Buenas noches amor" }, { who: "Yo", text: "Buenas noches negrita" }, { who: "Yo", text: "Descansa" },
  { who: "Ella", text: "Vamos a la cancha el sábado?" }, { who: "Yo", text: "Siii amorrr" },
  { who: "Ella", text: "Buenas noches" }, { who: "Yo", text: "Buenas noches negrita ❤" },
  { who: "Ella", text: "Qué hacés" }, { who: "Yo", text: "Nada, mirando tele" },
];
const corpus = buildCorpus(msgs, "Yo");

test("buildCorpus agrupa tandas y conserva todos tus mensajes", () => {
  assert.equal(corpus.length, 4);
  assert.deepEqual(corpus[0], { her: ["Buenas noches amor"], me: ["Buenas noches negrita", "Descansa"] });
});

test("repliesForIntent devuelve tus respuestas reales a esa situación", () => {
  const r = repliesForIntent(corpus, "buenas_noches");
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], ["Buenas noches negrita", "Descansa"]);
});

test("retrieveExamples prioriza pares parecidos", () => {
  const r = retrieveExamples(corpus, "vamos a la cancha?", { k: 2 });
  assert.equal(r[0].me[0], "Siii amorrr");
});

test("retrieveExamples completa con muestra si no hay coincidencias", () => assert.ok(retrieveExamples(corpus, "zzz", { k: 4 }).length >= 1));

test("parseText limpia mensajes borrados y marcas invisibles", () => {
  const out = parseText("12/05/2024, 10:00 - Yo: ‎You deleted this message.\n12/05/2024, 10:01 - Yo: ‎hola");
  assert.deepEqual(out, [{ who: "Yo", text: "hola" }]);
});

// Pares cuya respuesta solo tiene sentido en esa charla puntual.
const mixed = [
  { her: ["vamos a la cancha?"], me: ["no puedo, el martes es feriado"] },
  { her: ["vamos a la cancha?"], me: ["siii vamos"] },
  { her: ["buenas noches"], me: ["se paso 20 minutos y no me contestaste"] },
  { her: ["buenas noches"], me: ["buenas noches negrita"] },
];

test("retrieveExamples no devuelve respuestas contextuales aunque se parezcan", () => {
  const r = retrieveExamples(mixed, "vamos a la cancha?", { k: 4 });
  assert.equal(r[0].me[0], "siii vamos");
  assert.ok(r.every((p) => !/feriado|minutos/.test(p.me[0])), JSON.stringify(r.map((p) => p.me)));
});

test("retrieveExamples no usa respuestas contextuales para completar la muestra", () => {
  const r = retrieveExamples(mixed, "zzz", { k: 4 });
  assert.ok(r.length >= 1);
  assert.ok(r.every((p) => !/feriado|minutos/.test(p.me[0])), JSON.stringify(r.map((p) => p.me)));
});

test("retrieveExamples conserva el índice original del par", () => {
  assert.equal(retrieveExamples(mixed, "vamos a la cancha?", { k: 4 })[0].index, 1);
});

test("repliesForIntent descarta respuestas contextuales", () => {
  assert.deepEqual(repliesForIntent(mixed, "buenas_noches"), [["buenas noches negrita"]]);
});
