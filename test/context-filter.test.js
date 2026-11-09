import test from "node:test";
import assert from "node:assert/strict";
import { isContextual } from "../src/context-filter.js";

// Frases reales que el bot mandó fuera de contexto.
const CONTEXTUAL = [
  "Me cuido de las zorras",
  "Si viene una le podes pegar",
  "Yo no porque no le pego a las damas ahre",
  "Sii porque el martes es feriado por lo del papa",
  "Y como trabaja lo hizo un lunes",
  "Creo que es el unico dia que puede porque trabaja todos los dias bien temprano",
  "Porque hasta el dia de hoy me sigue buscando",
  "Tan bien lo besaste?",
  "Amor perdon se paso 20 minutos desde que te hable",
  "No me voy a crear una cuenta solo para eso",
];

for (const text of CONTEXTUAL) {
  test(`isContextual marca: "${text}"`, () => assert.equal(isContextual(text), true));
}

// Respuestas genéricas: sirven en cualquier charla y no se deben filtrar.
const GENERIC = [
  "jajajaja", "te amo", "Yo tambien te quiero mucho", "que haces amor?", "eso amor", "sii amor",
  "como estas?", "descansa amor", "buenas noches negrita", "Buen dia amor", "buenos días", "hasta mañana amor",
  "me voy a dormir", "que lindo", "ahre", "",
];

for (const text of GENERIC) {
  test(`isContextual no marca: "${text}"`, () => assert.equal(isContextual(text), false));
}
