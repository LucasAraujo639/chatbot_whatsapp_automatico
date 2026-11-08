import test from "node:test";
import assert from "node:assert/strict";
import { findSensitiveTopic } from "../src/topics.js";

const topics = [
  { id: "dinero", label: "Dinero", enabled: true, keywords: ["plata", "préstamo"] },
  { id: "off", label: "Apagado", enabled: false, keywords: ["hola"] },
];

test("ignora tildes y mayúsculas", () => assert.equal(findSensitiveTopic("Necesito un PRESTAMO", topics)?.id, "dinero"));
test("ignora temas deshabilitados", () => assert.equal(findSensitiveTopic("hola", topics), undefined));
test("sin coincidencias devuelve undefined", () => assert.equal(findSensitiveTopic("qué tal", topics), undefined));
