import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createUnknownInbox, KEPT_MESSAGES, EXTRA_MESSAGES } from "../src/unknown-inbox.js";
import { createUnknownService } from "../src/unknown-service.js";
import { buildGreeterPrompt, draftGreeting, sanitizeGreeter, createGreeterStore } from "../src/greeter.js";
import { createUnknownRouter } from "../src/routes/unknown.js";
import { createAddressBook } from "../src/adapters/whatsapp.js";

const tmpFile = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "unknown-")), name);
const NUMBER = "5491100000009";
const msg = (text, extra = {}) => ({ phones: [NUMBER], address: "jid-9", text, ref: {}, id: `id-${text}`, fromOwner: false, pushName: "Juan", senderLabel: NUMBER, ...extra });

// ---------- bandeja ----------

test("la bandeja guarda el primer mensaje + EXTRA_MESSAGES y persiste en disco", () => {
  const file = tmpFile("inbox.json");
  const inbox = createUnknownInbox(file);
  for (let i = 1; i <= EXTRA_MESSAGES + 3; i++) inbox.record({ number: NUMBER, label: NUMBER, address: "jid", text: `m${i}` });
  const e = inbox.get(NUMBER);
  assert.ok(KEPT_MESSAGES > EXTRA_MESSAGES);
  assert.equal(e.messages.length, EXTRA_MESSAGES + 1);
  assert.equal(e.messages.at(-1).text, `m${EXTRA_MESSAGES + 1}`);
  assert.equal(e.status, "pending");
  assert.equal(createUnknownInbox(file).list().length, 1); // se relee del archivo
});

test("la bandeja usa la dirección como id si no hay número y valida el estado", () => {
  const inbox = createUnknownInbox(tmpFile("inbox.json"));
  inbox.record({ number: null, label: "123 (ID interno)", address: "123@lid", text: "hola" });
  assert.ok(inbox.get("123@lid"));
  assert.equal(inbox.setStatus("123@lid", "cualquiera"), null);
  assert.equal(inbox.setStatus("123@lid", "rejected").status, "rejected");
  assert.equal(inbox.remove("123@lid"), true);
  assert.equal(inbox.list().length, 0);
});

// ---------- asistente ----------

test("el prompt del asistente incluye instrucciones y reglas", () => {
  const p = buildGreeterPrompt({ instructions: "Soy programador", rules: [{ when: "cuánto cobrás", reply: "te paso presupuesto" }] });
  assert.match(p, /Soy programador/);
  assert.match(p, /Si te dicen: "cuánto cobrás"/);
  assert.match(p, /Respondé: "te paso presupuesto"/);
});

test("sanitizeGreeter descarta reglas incompletas", () => {
  assert.deepEqual(sanitizeGreeter({ instructions: " x ", rules: [{ when: "a", reply: "" }, { when: "b", reply: "c" }, null] }), { instructions: "x", rules: [{ when: "b", reply: "c" }] });
  const store = createGreeterStore(tmpFile("greeter.json"));
  assert.deepEqual(store.load(), { instructions: "", rules: [] });
  store.save({ instructions: "hola", rules: [{ when: "a", reply: "b" }] });
  assert.equal(store.load().rules.length, 1);
});

test("modo fijo no llama al modelo; modo IA sí, con el último mensaje", async () => {
  const calls = [];
  const deps = (mode) => ({
    getConfig: () => ({ provider: {}, unknownInbox: { mode, fixedText: "fijo" } }),
    chat: async (_p, system, messages) => { calls.push({ system, messages }); return '"generado"'; },
    load: () => ({ instructions: "", rules: [] }),
  });
  assert.equal(await draftGreeting(["hola"], deps("fixed")), "fijo");
  assert.equal(calls.length, 0);
  assert.equal(await draftGreeting(["hola", "quién sos"], deps("ai")), "generado");
  assert.equal(calls[0].messages[0].content, "hola\nquién sos");
});

// ---------- servicio ----------

function setup({ cfg = {}, inAgenda = false, connected = true } = {}) {
  const config = { dryRun: false, typing: { minSec: 0, maxSec: 0 }, unknownInbox: { enabled: true, mode: "fixed", fixedText: "hola!" }, ...cfg };
  const sent = [], logs = [], saved = [];
  let changes = 0;
  const service = createUnknownService({
    getConfig: () => config,
    inbox: createUnknownInbox(tmpFile("inbox.json")),
    messenger: { isConnected: () => connected, showTyping: async () => {}, send: async (address, text) => { sent.push({ address, text }); } },
    draft: async (texts) => `borrador: ${texts.join(" | ")}`,
    isInAddressBook: () => inAgenda,
    saveToAddressBook: async (number, name) => { saved.push({ number, name }); },
    log: (kind, text) => logs.push({ kind, text }),
    onChange: () => { changes++; },
  });
  return { service, sent, logs, saved, get changes() { return changes; } };
}

test("un desconocido queda pendiente y no se le contesta solo", async () => {
  const s = setup();
  await s.service.receive(msg("hola"));
  await s.service.receive(msg("estás?"));
  const [e] = s.service.list();
  assert.equal(e.status, "pending");
  assert.equal(e.pushName, "Juan");
  assert.equal(e.messages.length, 2);
  assert.equal(s.sent.length, 0);
  assert.equal(s.logs.filter((l) => /Nuevo desconocido/.test(l.text)).length, 1);
});

test("aceptar envía el texto confirmado; solo se puede volver a contestar si escribe de nuevo", async () => {
  const s = setup();
  await s.service.receive(msg("hola"));
  assert.equal(await s.service.preview(NUMBER), "borrador: hola");
  await s.service.accept(NUMBER, "buenas!");
  assert.deepEqual(s.sent, [{ address: "jid-9", text: "buenas!" }]);
  assert.equal(s.service.list()[0].status, "replied");
  await assert.rejects(s.service.accept(NUMBER, "otra vez"), /No hay mensajes nuevos/);
  await s.service.receive(msg("gracias")); // vuelve a escribir: sigue en respondidos y no se contesta solo
  await s.service.receive(msg("una pregunta"));
  assert.equal(s.service.list()[0].status, "replied");
  assert.equal(s.sent.length, 1);
  assert.equal(await s.service.preview(NUMBER), "borrador: gracias | una pregunta"); // solo lo no contestado
  await s.service.accept(NUMBER, "decime");
  assert.deepEqual(s.service.list()[0].messages.map((m) => `${m.from}:${m.text}`), ["them:hola", "me:buenas!", "them:gracias", "them:una pregunta", "me:decime"]);
});

test("después del primer mensaje se guardan como mucho EXTRA_MESSAGES más", async () => {
  const s = setup();
  for (let i = 0; i <= EXTRA_MESSAGES + 2; i++) await s.service.receive(msg(`m${i}`));
  assert.equal(s.service.list()[0].messages.length, EXTRA_MESSAGES + 1);
  assert.equal(s.logs.filter((l) => /no se guardan más/.test(l.text)).length, 1);
});

test("en modo prueba aceptar no envía nada", async () => {
  const s = setup({ cfg: { dryRun: true } });
  await s.service.receive(msg("hola"));
  await s.service.accept(NUMBER, "buenas");
  assert.equal(s.sent.length, 0);
  assert.ok(s.logs.some((l) => l.kind === "dry" && l.text === "buenas"));
});

test("rechazar no envía y permite agendar con nombre", async () => {
  const s = setup();
  await s.service.receive(msg("hola"));
  s.service.reject(NUMBER);
  assert.equal(s.sent.length, 0);
  await assert.rejects(s.service.saveContact(NUMBER, "  "), /nombre/);
  await s.service.saveContact(NUMBER, "Juan Pérez");
  assert.deepEqual(s.saved, [{ number: NUMBER, name: "Juan Pérez" }]);
  assert.equal(s.service.list()[0].status, "saved");
});

test("no se puede agendar un chat sin número real", async () => {
  const s = setup();
  await s.service.receive(msg("hola", { phones: [], address: "1@lid", senderLabel: "1 (ID interno)" }));
  s.service.reject("1@lid");
  await assert.rejects(s.service.saveContact("1@lid", "X"), /número real/);
});

test("ignora a quien está en tu agenda y respeta el interruptor", async () => {
  const agenda = setup({ inAgenda: true });
  await agenda.service.receive(msg("hola"));
  assert.equal(agenda.service.list().length, 0);

  const off = setup({ cfg: { unknownInbox: { enabled: false } } });
  await off.service.receive(msg("hola"));
  await off.service.receive(msg("hola de nuevo"));
  assert.equal(off.service.list().length, 0);
  assert.equal(off.logs.filter((l) => /no está en Contactos/.test(l.text)).length, 1);
});

test("si le contestás a mano a un pendiente, pasa a respondido", async () => {
  const s = setup();
  await s.service.receive(msg("hola"));
  await s.service.receive(msg("te escribo yo", { fromOwner: true }));
  assert.equal(s.service.list()[0].status, "replied");
  assert.deepEqual(s.service.list()[0].messages.map((m) => m.from), ["them", "me"]); // tu mensaje queda como tuyo
});

test("sin WhatsApp conectado aceptar falla y queda pendiente", async () => {
  const s = setup({ connected: false });
  await s.service.receive(msg("hola"));
  await assert.rejects(s.service.accept(NUMBER, "hola"), /no está conectado/);
  assert.equal(s.service.list()[0].status, "pending");
});

// ---------- agenda ----------

test("la agenda guarda solo contactos con nombre (agendados) y en todas sus variantes", () => {
  const book = createAddressBook(tmpFile("book.json"));
  book.update([{ id: "5491111111111@s.whatsapp.net", notify: "solo perfil" }, { id: "x@lid", phoneNumber: "5491122222222@s.whatsapp.net", name: "Ana" }]);
  assert.equal(book.has("5491111111111"), false);
  assert.equal(book.has("5491122222222"), true);
});

test("agenda: un contacto que llega con nombre vacío (lo borraste) se quita; sin campo name no se toca", () => {
  const book = createAddressBook(tmpFile("book.json"));
  book.update([{ id: "5491122222222@s.whatsapp.net", name: "Ana" }, { id: "5491133333333@s.whatsapp.net", name: "Beto" }]);
  book.update([{ id: "5491133333333@s.whatsapp.net", imgUrl: "changed" }]);
  book.update([{ id: "5491122222222@s.whatsapp.net", name: undefined }]);
  assert.equal(book.has("5491122222222"), false);
  assert.equal(book.has("5491133333333"), true);
  assert.equal(book.remove(["5491133333333"]), true);
  assert.equal(book.has("5491133333333"), false);
  book.update([{ id: "5491144444444@s.whatsapp.net", name: "Caro" }, { id: "5491155555555@s.whatsapp.net", name: "Dani" }]);
  assert.deepEqual(book.replace(new Set(["5491144444444"])), ["5491155555555"]); // snapshot sin Dani: lo borraste
  assert.equal(book.has("5491144444444"), true);
  assert.equal(book.has("5491133333333"), false);
});

// ---------- rutas ----------

test("rutas: errores de la bandeja se traducen a status HTTP", async () => {
  const s = setup();
  await s.service.receive(msg("hola"));
  const app = express(); app.use(express.json());
  app.use("/u", createUnknownRouter({ service: s.service, greeter: { load: () => ({}), save: (x) => x }, test: async (t) => `re: ${t}` }));
  const srv = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
  const call = (p, method = "POST", body) => fetch(`http://localhost:${srv.address().port}/u${p}`, {
    method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body),
  }).then(async (r) => [r.status, await r.json()]);
  try {
    assert.equal((await call("/nadie/reject"))[0], 404);
    assert.equal((await call(`/${NUMBER}/accept`, "POST", { text: "" }))[0], 400);
    assert.deepEqual(await call(`/${NUMBER}/preview`), [200, { text: "borrador: hola" }]);
    assert.equal((await call(`/${NUMBER}/accept`, "POST", { text: "hey" }))[1].status, "replied");
    assert.deepEqual(await call("/greeter/test", "POST", { text: "hola" }), [200, { reply: "re: hola" }]);
    assert.equal((await call("/", "GET"))[1].items.length, 1);
  } finally { await new Promise((r) => srv.close(r)); }
});
