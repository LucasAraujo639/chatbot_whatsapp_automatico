import test from "node:test";
import assert from "node:assert/strict";
import { buildLexicon, unknownWords, wordSet, canonical } from "../src/lexicon.js";

const mine = ["Hola amorrr", "hola amor", "Buenas noches negrita", "buenas noches negrita jajaja", "Que haces amor", "que haces"];
const lex = buildLexicon(mine);

test("canonical colapsa alargues y acentos", () => {
  assert.equal(canonical("Amorrr"), canonical("amor"));
  assert.equal(canonical("está"), canonical("esta"));
});

test("buildLexicon descarta palabras de un solo uso y risas", () => {
  assert.ok("amor" in lex.words);
  assert.ok(!("jajaja" in lex.words) && !("ja" in lex.words));
  assert.ok(lex.top.includes("hola"));
});

test("unknownWords bloquea inventos como 'holuu'", () => assert.deepEqual(unknownWords("Holuu amor", lex), ["holuu"]));
test("acepta alargues y risas de palabras conocidas", () => assert.deepEqual(unknownWords("hola amorrrr jajajaja jsjs 😍 2", lex), []));
test("acepta palabras que ella ya dijo en el hilo", () => assert.deepEqual(unknownWords("dormiste bien", lex, wordSet("¿Dormiste bien?")), []));
test("palabras nuevas fuera del hilo se detectan", () => assert.deepEqual(unknownWords("vamos al zoologico", lex).sort(), ["al", "vamos", "zoologico"].sort()));
