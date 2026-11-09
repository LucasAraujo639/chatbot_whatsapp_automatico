import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// config.js lee/escribe data/config.json relativo al cwd: cada test usa una carpeta temporal y una instancia nueva del módulo.
let n = 0;
async function inTempDir(saved, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
  if (saved !== undefined) {
    fs.mkdirSync(path.join(dir, "data"));
    fs.writeFileSync(path.join(dir, "data/config.json"), typeof saved === "string" ? saved : JSON.stringify(saved));
  }
  const prev = process.cwd();
  process.chdir(dir);
  try { await fn(await import(`../src/config.js?t=${n++}`), dir); } finally { process.chdir(prev); }
}

test("sin archivo guardado usa los valores por defecto (dryRun activo, seguimientos apagados)", async () => {
  await inTempDir(undefined, ({ getConfig, DEFAULTS }) => {
    assert.deepEqual(getConfig(), DEFAULTS);
    assert.equal(getConfig().dryRun, true);
    assert.equal(getConfig().followUp.enabled, false);
  });
});

test("un archivo corrupto no rompe: vuelve a los valores por defecto", async () => {
  await inTempDir("{no es json", ({ getConfig, DEFAULTS }) => assert.deepEqual(getConfig(), DEFAULTS));
});

test("lo guardado pisa los defaults pero conserva los campos anidados no mencionados", async () => {
  await inTempDir({ paused: true, provider: { model: "otro" }, followUp: { quietHours: { to: "09:00" } } }, ({ getConfig, DEFAULTS }) => {
    const c = getConfig();
    assert.equal(c.paused, true);
    assert.equal(c.provider.model, "otro");
    assert.equal(c.provider.baseUrl, DEFAULTS.provider.baseUrl);
    assert.equal(c.followUp.quietHours.to, "09:00");
    assert.equal(c.followUp.quietHours.from, DEFAULTS.followUp.quietHours.from);
    assert.deepEqual(c.followUp.delaysMin, DEFAULTS.followUp.delaysMin);
  });
});

test("updateConfig mezcla el cambio, lo persiste en disco y lo devuelve", async () => {
  await inTempDir(undefined, ({ getConfig, updateConfig, DEFAULTS }, dir) => {
    const res = updateConfig({ typing: { maxSec: 9 }, contacts: [{ number: "5491100000000", enabled: true }] });
    assert.equal(res, getConfig());
    assert.equal(getConfig().typing.maxSec, 9);
    assert.equal(getConfig().typing.minSec, DEFAULTS.typing.minSec);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "data/config.json"), "utf8"));
    assert.equal(onDisk.contacts[0].number, "5491100000000");
  });
});

test("updateConfig acumula cambios sucesivos sin perder los anteriores", async () => {
  await inTempDir(undefined, ({ getConfig, updateConfig }) => {
    updateConfig({ provider: { model: "x" } });
    updateConfig({ provider: { apiKey: "k" } });
    assert.deepEqual([getConfig().provider.model, getConfig().provider.apiKey], ["x", "k"]);
  });
});

test("al reiniciar se recupera lo último guardado", async () => {
  await inTempDir(undefined, async ({ updateConfig }, dir) => {
    updateConfig({ manualPauseMin: 45 });
    const { loadConfig } = await import(`../src/config.js?t=${n++}`);
    assert.equal(loadConfig().manualPauseMin, 45);
    assert.ok(fs.existsSync(path.join(dir, "data/config.json")));
  });
});

test("los temas sensibles por defecto cubren bot, dinero, emergencia, emocional y citas", async () => {
  await inTempDir(undefined, ({ DEFAULTS }) => {
    assert.deepEqual(DEFAULTS.sensitiveTopics.map((t) => t.id), ["bot", "dinero", "emergencia", "emocional", "citas"]);
    assert.ok(DEFAULTS.sensitiveTopics.every((t) => t.enabled && t.keywords.length > 0));
  });
});
