import test from "node:test";
import assert from "node:assert/strict";
import { parseReply, formatIncoming, plainText } from "../src/reply-parser.js";

test("sin marcadores: partes sin cita", () => assert.deepEqual(parseReply("hola\n---\n que tal \n---\n", 0), [{ text: "hola", replyTo: null }, { text: "que tal", replyTo: null }]));
test("marcador válido → replyTo", () => assert.deepEqual(parseReply("[2] jaja sí", 3), [{ text: "jaja sí", replyTo: 2 }]));
test("marcador fuera de rango se descarta pero se limpia el texto", () => assert.deepEqual(parseReply("[7] jaja", 2), [{ text: "jaja", replyTo: null }]));
test("un número en medio del texto no es marcador", () => assert.deepEqual(parseReply("tengo [2] gatos", 3), [{ text: "tengo [2] gatos", replyTo: null }]));
test("partes vacías se ignoran", () => assert.deepEqual(parseReply("[1]\n---\n   ", 2), []));
test("formatIncoming numera solo si hay varios", () => {
  assert.equal(formatIncoming(["hola"]), "hola");
  assert.equal(formatIncoming(["a", "b"]), "[1] a\n[2] b");
});
test("plainText para historial no lleva marcadores", () => assert.equal(plainText(parseReply("[1] a\n---\nb", 1)), "a\n---\nb"));
