import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createAllowlist, normalizeWord } from "../src/allowlist.js";
import { createVocabularyRouter } from "../src/routes/vocabulary.js";
import { respond } from "../src/responder.js";
import { buildLexicon } from "../src/lexicon.js";

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "allow-")), "allow.json");

test("normalizeWord acepta una palabra y rechaza el resto", () => {
  assert.equal(normalizeWord("  Holuu "), "holuu");
  for (const bad of ["", "dos palabras", "x".repeat(41), "!!!", null]) assert.equal(normalizeWord(bad), null);
});

test("add es idempotente, ordena y persiste; remove la saca", () => {
  const a = createAllowlist(tmpFile());
  a.add("Holuu"); a.add("holuu"); a.add("bebu");
  assert.deepEqual(a.list(), ["bebu", "holuu"]);
  assert.equal(a.add("dos palabras"), null);
  a.remove("HOLUU");
  assert.deepEqual(a.list(), ["bebu"]);
});

test("API: agregar, listar, borrar y rechazar inválidas", async () => {
  let changes = 0;
  const app = express(); app.use(express.json());
  app.use("/v", createVocabularyRouter({ allowlist: createAllowlist(tmpFile()), onChange: () => changes++ }));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const url = (p) => `http://localhost:${srv.address().port}/v${p}`;
  const json = (method, p, body) => fetch(url(p), { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]);
  try {
    assert.deepEqual(await json("POST", "/allowed", { word: "holuu" }), [200, { words: ["holuu"] }]);
    assert.equal((await json("POST", "/allowed", { word: "dos palabras" }))[0], 400);
    assert.deepEqual(await json("GET", "/allowed"), [200, { words: ["holuu"] }]);
    assert.deepEqual(await json("DELETE", "/allowed/holuu"), [200, { words: [] }]);
    assert.equal(changes, 2);
  } finally { srv.close(); }
});

test("una palabra permitida deja de ser bloqueada (sin reintentos)", async () => {
  const lexicon = buildLexicon(["hola amor", "hola amor", "que haces", "que haces"]);
  let calls = 0;
  const deps = (allowlist) => ({
    getConfig: () => ({ provider: {}, guard: { enabled: true, maxRetries: 1 } }),
    load: () => ({ about: "", profile: null, corpus: [], lexicon, allowlist }),
    random: () => 0.5,
    chat: async () => { calls++; return "holuu amor"; },
  });
  const h = [{ role: "user", content: "hola" }];
  const before = await respond(h, {}, deps([]));
  assert.deepEqual(before.blocked, ["holuu"]);
  assert.deepEqual(before.flagged, ["holuu"]);
  calls = 0;
  const after = await respond(h, {}, deps(["holuu"]));
  assert.equal(calls, 1);
  assert.equal(after.blocked, null);
  assert.equal(after.parts[0].text, "holuu amor");
});
