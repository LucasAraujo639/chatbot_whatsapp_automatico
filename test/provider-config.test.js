import test from "node:test";
import assert from "node:assert/strict";
import { maskApiKey, publicConfig, withoutMaskedKey, resolveProvider } from "../src/provider-config.js";

const saved = { baseUrl: "https://a/v1", apiKey: "sk-secret-1234", model: "m1", maxTokens: 200, temperature: 0.4 };

test("maskApiKey muestra solo los últimos 4 caracteres", () => {
  assert.equal(maskApiKey("sk-secret-1234"), "••••1234");
});

test("maskApiKey devuelve vacío si no hay clave", () => {
  assert.equal(maskApiKey(""), "");
  assert.equal(maskApiKey(undefined), "");
});

test("publicConfig enmascara la clave sin tocar el resto ni la config original", () => {
  const cfg = { paused: true, provider: saved };
  const pub = publicConfig(cfg);
  assert.equal(pub.provider.apiKey, "••••1234");
  assert.equal(pub.provider.model, "m1");
  assert.equal(pub.paused, true);
  assert.equal(cfg.provider.apiKey, "sk-secret-1234");
});

test("withoutMaskedKey descarta la clave si viene enmascarada (el panel la reenvía tal cual)", () => {
  const patch = { provider: { apiKey: "••••1234", model: "m2" } };
  assert.deepEqual(withoutMaskedKey(patch), { provider: { model: "m2" } });
  assert.equal(patch.provider.apiKey, "••••1234"); // no muta la entrada
});

test("withoutMaskedKey conserva una clave nueva real y los parches sin provider", () => {
  assert.deepEqual(withoutMaskedKey({ provider: { apiKey: "sk-nueva" } }), { provider: { apiKey: "sk-nueva" } });
  assert.deepEqual(withoutMaskedKey({ paused: true }), { paused: true });
});

test("withoutMaskedKey tolera un body ausente", () => {
  assert.deepEqual(withoutMaskedKey(undefined), {});
});

test("resolveProvider usa la clave guardada si llega enmascarada o vacía", () => {
  assert.equal(resolveProvider(saved, { apiKey: "••••1234" }).apiKey, "sk-secret-1234");
  assert.equal(resolveProvider(saved, { apiKey: "" }).apiKey, "sk-secret-1234");
  assert.equal(resolveProvider(saved, undefined).apiKey, "sk-secret-1234");
});

test("resolveProvider usa la clave nueva si es real y pisa solo lo que viene", () => {
  const p = resolveProvider(saved, { apiKey: "sk-otra", model: "m9" });
  assert.deepEqual(p, { ...saved, apiKey: "sk-otra", model: "m9" });
});
