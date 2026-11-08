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
