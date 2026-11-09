import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

// Aislamiento: config y datos se leen relativos al cwd, así que se usa una carpeta vacía (config por defecto)
// y la red queda bloqueada: ningún test puede tocar tu data/ real ni llamar a un modelo de verdad.
const realFetch = globalThis.fetch; // el cliente de los tests usa el fetch real contra el servidor local
globalThis.fetch = async (url, opts) => (String(url).startsWith("http://localhost") ? realFetch(url, opts) : Promise.reject(new Error("red bloqueada en tests")));
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "routes-")));
const { default: simulateRouter } = await import("../src/routes/simulate.js");
const { default: contactsRouter } = await import("../src/routes/contacts.js");

async function withApp(mount, router, fn) {
  const app = express(); app.use(express.json());
  app.use(mount, router);
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const post = (p, body) => realFetch(`http://localhost:${srv.address().port}${mount}${p}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => [r.status, await r.json()]);
  try { await fn(post); } finally { await new Promise((r) => srv.close(r)); }
}

test("POST /simulate rechaza entradas inválidas con 400 y mensaje", async () => {
  await withApp("/sim", simulateRouter, async (post) => {
    assert.deepEqual(await post("/", {}), [400, { error: "Falta el historial de mensajes" }]);
    assert.equal((await post("/", { messages: [{ role: "assistant", content: "hola" }] }))[0], 400); // último no es del contacto
    assert.equal((await post("/", undefined))[0], 400); // sin body
  });
});

test("POST /simulate/follow-up solo acepta si el último mensaje fue del bot", async () => {
  await withApp("/sim", simulateRouter, async (post) => {
    const [status, body] = await post("/follow-up", { messages: [{ role: "user", content: "hola" }] });
    assert.equal(status, 400);
    assert.match(body.error, /último mensaje fue del bot/);
  });
});

test("POST /simulate: un tema sensible responde pausa sin llamar al modelo", async () => {
  await withApp("/sim", simulateRouter, async (post) => {
    const [status, body] = await post("/", { messages: [{ role: "user", content: "sos un bot?" }] });
    assert.equal(status, 200);
    assert.deepEqual(body, { paused: true, topic: "Preguntan si soy un bot", parts: [] });
  });
});

test("POST /simulate: si el modelo falla responde 502", async () => {
  const blocked = globalThis.fetch;
  globalThis.fetch = async () => new Response("caído", { status: 500 }); // el modelo responde con error
  try {
    await withApp("/sim", simulateRouter, async (post) => {
      const [status, body] = await post("/", { messages: [{ role: "user", content: "hola, cómo andás?" }] });
      assert.equal(status, 502);
      assert.match(body.error, /LLM 500/);
    });
  } finally { globalThis.fetch = blocked; }
});

test("POST /contacts/verify limpia el número y rechaza formatos inválidos sin consultar a WhatsApp", async () => {
  await withApp("/c", contactsRouter, async (post) => {
    const expected = { valid: false, exists: false, jid: null, suggestion: null };
    assert.deepEqual(await post("/verify", { number: "abc" }), [200, expected]);
    assert.deepEqual(await post("/verify", {}), [200, expected]);
    assert.deepEqual(await post("/verify", { number: "0123" }), [200, expected]);
  });
});

test("POST /contacts/verify con número válido y WhatsApp desconectado responde 409", async () => {
  await withApp("/c", contactsRouter, async (post) => {
    const [status, body] = await post("/verify", { number: "+54 9 11 2345-6789" }); // se limpia a 5491123456789
    assert.equal(status, 409);
    assert.match(body.error, /no está conectado/);
  });
});
