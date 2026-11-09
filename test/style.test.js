import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseText, participants, buildExamples, statsOf, buildCorpus } from "../src/style.js";

const msg = (who, text) => ({ who, text });

test("parseText lee el formato Android (fecha, hora - autor: texto)", () => {
  const raw = "12/03/2024, 10:15 - Ana: hola\n12/03/2024, 10:16 - Lucas: buenas";
  assert.deepEqual(parseText(raw), [msg("Ana", "hola"), msg("Lucas", "buenas")]);
});

test("parseText lee el formato iOS ([fecha, hora:seg] autor: texto)", () => {
  assert.deepEqual(parseText("[12/03/24, 10:15:30] Ana: hola"), [msg("Ana", "hola")]);
});

test("parseText une las líneas sin fecha al mensaje anterior", () => {
  const raw = "12/03/2024, 10:15 - Ana: primera línea\nsegunda línea\n\ntercera";
  assert.deepEqual(parseText(raw), [msg("Ana", "primera línea\nsegunda línea\ntercera")]);
});

test("parseText descarta multimedia, mensajes eliminados y 'null'", () => {
  const raw = [
    "12/03/2024, 10:15 - Ana: <Multimedia omitido>",
    "12/03/2024, 10:16 - Ana: Eliminaste este mensaje",
    "12/03/2024, 10:17 - Ana: null",
    "12/03/2024, 10:18 - Ana: image omitted",
    "12/03/2024, 10:19 - Ana: este sí",
  ].join("\n");
  assert.deepEqual(parseText(raw), [msg("Ana", "este sí")]);
});

test("parseText soporta saltos de línea de Windows y texto vacío", () => {
  assert.deepEqual(parseText("12/03/2024, 10:15 - Ana: a\r\n12/03/2024, 10:16 - Lucas: b"), [msg("Ana", "a"), msg("Lucas", "b")]);
  assert.deepEqual(parseText(""), []);
});

test("participants cuenta mensajes por persona, de más a menos", () => {
  const msgs = [msg("Ana", "a"), msg("Lucas", "b"), msg("Lucas", "c")];
  assert.deepEqual(participants(msgs), [{ name: "Lucas", count: 2 }, { name: "Ana", count: 1 }]);
});

test("buildExamples arma pares solo cuando Lucas contesta a ella", () => {
  const msgs = [msg("Ana", "hola"), msg("Lucas", "buenas"), msg("Lucas", "qué tal"), msg("Ana", "bien"), msg("Lucas", "genial")];
  assert.deepEqual(buildExamples(msgs, "Lucas"), [{ her: "hola", me: "buenas" }, { her: "bien", me: "genial" }]);
});

test("buildExamples limita la cantidad y se queda con los más recientes", () => {
  const msgs = [];
  for (let i = 0; i < 10; i++) msgs.push(msg("Ana", `a${i}`), msg("Lucas", `l${i}`));
  const out = buildExamples(msgs, "Lucas", 3);
  assert.equal(out.length, 3);
  assert.equal(out.at(-1).me, "l9");
});

test("statsOf calcula cantidad, largo medio, emojis y % en minúscula", () => {
  const msgs = [msg("Lucas", "hola 😂"), msg("Lucas", "Qué tal 😂😍"), msg("Ana", "no cuenta 🙈")];
  const s = statsOf(msgs, "Lucas");
  assert.equal(s.count, 2);
  assert.equal(s.avgLen, Math.round(("hola 😂".length + "Qué tal 😂😍".length) / 2));
  assert.equal(s.topEmoji, "😂 😍");
  assert.equal(s.lowercasePct, 50);
});

test("statsOf no falla si la persona no escribió nada", () => {
  assert.deepEqual(statsOf([msg("Ana", "hola")], "Lucas"), { count: 0, avgLen: 0, topEmoji: "", lowercasePct: 0 });
});

test("buildCorpus agrupa tandas: contexto de ella (últimos N) → tanda de Lucas (hasta M)", () => {
  const msgs = [msg("Ana", "1"), msg("Ana", "2"), msg("Ana", "3"), msg("Ana", "4"), msg("Lucas", "a"), msg("Lucas", "b"), msg("Lucas", "c")];
  assert.deepEqual(buildCorpus(msgs, "Lucas", { herContext: 3, maxMine: 2 }), [{ her: ["2", "3", "4"], me: ["a", "b"] }]);
});

test("buildCorpus ignora tandas de Lucas que no responden a nadie", () => {
  assert.deepEqual(buildCorpus([msg("Lucas", "hola"), msg("Ana", "hey")], "Lucas"), []);
});

// saveProfile/load* escriben en data/ relativo al cwd: se aíslan en una carpeta temporal.
test("saveProfile guarda perfil, corpus y léxico, y load* los devuelve", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "style-"));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const { saveProfile, loadProfile, loadCorpus, loadLexicon } = await import("../src/style.js?isolated");
    assert.equal(loadProfile(), null); // sin archivos todavía
    const msgs = [msg("Ana", "hola"), msg("Lucas", "buenas"), msg("Ana", "todo bien?"), msg("Lucas", "sí, vos?")];
    const profile = saveProfile(msgs, "Lucas");
    assert.equal(profile.me, "Lucas");
    assert.equal(profile.usedMessages, 4);
    assert.equal(profile.pairs, 2);
    assert.deepEqual(loadProfile(), profile);
    assert.equal(loadCorpus().length, 2);
    assert.ok(loadLexicon());
  } finally { process.chdir(prev); }
});

test("saveProfile usa solo los últimos N mensajes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "style-"));
  const prev = process.cwd();
  process.chdir(dir);
  try {
    const { saveProfile } = await import("../src/style.js?lastn");
    const msgs = [msg("Ana", "viejo"), msg("Lucas", "viejo"), msg("Ana", "nuevo"), msg("Lucas", "nuevo")];
    assert.equal(saveProfile(msgs, "Lucas", 2).usedMessages, 2);
  } finally { process.chdir(prev); }
});
