import test from "node:test";
import assert from "node:assert/strict";
import { chat, listModels } from "../src/llm.js";

const provider = { baseUrl: "https://api.example.com/v1///", apiKey: "sk-test", model: "m", maxTokens: 50, temperature: 0.2 };

// Reemplaza fetch (frontera de red) y restaura al terminar.
async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return impl(url, opts); };
  try { await fn(calls); } finally { globalThis.fetch = real; }
}
const reply = (content) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));

test("chat manda sistema + historial al endpoint /chat/completions con la clave", async () => {
  await withFetch(() => reply("hola"), async (calls) => {
    const out = await chat(provider, "SYS", [{ role: "user", content: "hey" }]);
    assert.equal(out, "hola");
    const { url, opts } = calls[0];
    assert.equal(url, "https://api.example.com/v1/chat/completions"); // sin barras de más
    assert.equal(opts.headers.Authorization, "Bearer sk-test");
    const body = JSON.parse(opts.body);
    assert.deepEqual(body.messages, [{ role: "system", content: "SYS" }, { role: "user", content: "hey" }]);
    assert.deepEqual([body.model, body.max_tokens, body.temperature], ["m", 50, 0.2]);
  });
});

test("chat no manda Authorization si no hay API key", async () => {
  await withFetch(() => reply("ok"), async (calls) => {
    await chat({ ...provider, apiKey: "" }, "S", []);
    assert.equal(calls[0].opts.headers.Authorization, undefined);
  });
});

test("chat quita los bloques <think> del modelo y recorta espacios", async () => {
  await withFetch(() => reply("<think>razono\nmucho</think>  respuesta \n"), async () => {
    assert.equal(await chat(provider, "S", []), "respuesta");
  });
});

test("chat devuelve texto vacío si el modelo no trae contenido", async () => {
  await withFetch(() => new Response(JSON.stringify({ choices: [] })), async () => {
    assert.equal(await chat(provider, "S", []), "");
  });
});

test("chat lanza error con el status y un extracto del cuerpo si la API falla", async () => {
  await withFetch(() => new Response("x".repeat(500), { status: 429 }), async () => {
    await assert.rejects(chat(provider, "S", []), (e) => e.message.startsWith("LLM 429: ") && e.message.length <= "LLM 429: ".length + 300);
  });
});

test("listModels devuelve los ids (soporta data[] y models[])", async () => {
  await withFetch(() => new Response(JSON.stringify({ data: [{ id: "a" }, { id: "b" }, {}] })), async (calls) => {
    assert.deepEqual(await listModels(provider), ["a", "b"]);
    assert.equal(calls[0].url, "https://api.example.com/v1/models");
  });
  await withFetch(() => new Response(JSON.stringify({ models: [{ name: "c" }] })), async () => {
    assert.deepEqual(await listModels(provider), ["c"]);
  });
});

test("listModels lanza error si la API responde con falla", async () => {
  await withFetch(() => new Response("no autorizado", { status: 401 }), async () => {
    await assert.rejects(listModels(provider), /^Error: 401: no autorizado/);
  });
});
