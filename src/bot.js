import fs from "node:fs";
import { EventEmitter } from "node:events";
import pino from "pino";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, generateMessageID } from "@whiskeysockets/baileys";
import { getConfig, updateConfig } from "./config.js";
import { respond, CONTEXT_MESSAGES } from "./responder.js";
import { formatIncoming, plainText } from "./reply-parser.js";
import { createFollowUpScheduler } from "./followup.js";
import { typingDelayMs } from "./pacing.js";
import { numberOf, toPhoneJid, isValidNumber, numberVariants, phoneNumbersOf, findContact } from "./phone.js";
import { findSensitiveTopic } from "./topics.js";

const HISTORY_FILE = "data/history.json";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LOG_LIMIT = 100; // entradas que se guardan en el log del panel
const STORED_MESSAGES = 60; // mensajes de historial que se persisten por contacto
const STALE_MESSAGE_SEC = 120; // un mensaje propio más viejo que esto es una reentrega, no algo escrito ahora
const TYPING_REFRESH_MS = 8000; // WhatsApp apaga "escribiendo…" solo a los pocos segundos

export const events = new EventEmitter();
export const state = { connection: "closed", qr: null, log: [] };

function log(kind, text, contact, words) {
  const entry = { t: Date.now(), kind, text, contact, ...(words?.length && { words }) };
  state.log = [...state.log.slice(-(LOG_LIMIT - 1)), entry];
  events.emit("update");
}
const setConn = (c, qr = null) => { state.connection = c; state.qr = qr; events.emit("update"); };

let history = {};
try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")); } catch {}
const saveHistory = () => { fs.mkdirSync("data", { recursive: true }); fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2)); };

// Guarda en el historial lo que el bot le contestó a un contacto y lo persiste.
function recordReply(number, parts) {
  const h = (history[number] ||= []);
  h.push({ role: "assistant", content: plainText(parts) });
  history[number] = h.slice(-STORED_MESSAGES);
  saveHistory();
}

export function setContactPaused(number, paused) {
  const contacts = getConfig().contacts.map((c) => (c.number === number ? { ...c, paused } : c));
  updateConfig({ contacts });
  if (paused) followUps.cancel(number);
  events.emit("update");
}

const buffers = new Map(); // number -> { msgs: [{ text, raw }], timer, jid }
const manualUntil = new Map();
let sock = null, stopping = false, retries = 0, reconnectTimer = null;

function dropSocket() {
  clearTimeout(reconnectTimer);
  if (!sock) return;
  const old = sock;
  sock = null; // los eventos del socket viejo se ignoran (ver chequeo `sock !== me`)
  try { old.ev.removeAllListeners(); old.end(undefined); } catch {}
}

function scheduleReconnect(delayMs) {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => startBot().catch((e) => log("error", String(e.message || e))), delayMs);
}

export async function startBot() {
  stopping = false;
  dropSocket(); // nunca dos sockets a la vez: eso causa "connectionReplaced" y el bucle
  setConn("connecting");
  const { state: auth, saveCreds } = await useMultiFileAuthState("auth");
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch {}
  const me = makeWASocket({ ...(version && { version }), auth, logger: pino({ level: "silent" }) });
  sock = me;
  me.ev.on("creds.update", saveCreds);
  me.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (sock !== me) return;
    if (qr) setConn("qr", qr); // el QR se mantiene hasta que se conecta o la sesión se reinicia
    if (connection === "open") { retries = 0; setConn("open"); log("info", "Conectado a WhatsApp"); }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      dropSocket();
      if (stopping) return setConn("closed");
      if (code === DisconnectReason.loggedOut) {
        fs.rmSync("auth", { recursive: true, force: true });
        log("info", "Sesión cerrada. Hay que escanear el QR de nuevo.");
        setConn("connecting");
        return scheduleReconnect(1000);
      }
      if (code === DisconnectReason.connectionReplaced) {
        setConn("closed");
        return log("error", "Otra instancia se conectó con esta sesión. No reconecto para evitar un bucle; cerrá la otra y reiniciá.");
      }
      setConn("connecting");
      if (code === DisconnectReason.restartRequired) return scheduleReconnect(0); // normal justo después de escanear el QR
      const delay = Math.min(30000, 1000 * 2 ** retries++);
      log("info", `Conexión caída (código ${code ?? "?"}). Reintento en ${Math.round(delay / 1000)}s`);
      scheduleReconnect(delay);
    }
  });

  me.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) handle(m).catch((e) => log("error", String(e.message || e)));
  });
}

export async function logoutBot() {
  stopping = true;
  try { await sock?.logout(); } catch {}
  dropSocket();
  fs.rmSync("auth", { recursive: true, force: true });
  setConn("closed");
  retries = 0;
  await startBot();
}

const sentByBot = new Set();
const jids = new Map(); // number -> último jid conocido (para escribir por iniciativa propia)

const followUps = createFollowUpScheduler({
  getConfig,
  canSend: (number) => {
    const cfg = getConfig();
    const c = cfg.contacts.find((x) => x.number === number);
    return !!c?.enabled && !cfg.paused && !c.paused && state.connection === "open" && Date.now() >= (manualUntil.get(number) || 0);
  },
  send: sendFollowUp,
  onError: (number, e) => log("error", `Seguimiento fallido: ${e.message || e}`, number, e.words),
});

// WhatsApp a veces entrega el chat con un ID interno (@lid) en vez del número: lo traducimos.
async function resolvePhoneNumbers(m) {
  const candidates = [m.key.remoteJid, m.key.remoteJidAlt];
  const jid = m.key.remoteJid;
  if (!phoneNumbersOf(candidates).length && jid?.endsWith("@lid")) {
    try {
      const pn = await sock?.signalRepository?.lidMapping?.getPNForLID(jid);
      if (pn) candidates.push(pn.includes("@") ? pn : toPhoneJid(pn));
    } catch {}
  }
  return phoneNumbersOf(candidates);
}

const reportedUnknown = new Set();

async function handle(m) {
  const jid = m.key.remoteJid;
  if (!jid || jid.endsWith("@g.us") || jid === "status@broadcast") return;
  const text = m.message?.conversation || m.message?.extendedTextMessage?.text;
  if (!text) return;
  const cfg = getConfig();
  const phones = await resolvePhoneNumbers(m);
  const contact = findContact(cfg.contacts, phones);
  if (!contact) {
    // Ayuda a diagnosticar "no responde": muestra qué número está llegando realmente (una vez por chat, sin el texto).
    const shown = phones[0] || `${numberOf(jid)} (ID interno, no se pudo obtener el número)`;
    if (!m.key.fromMe && !reportedUnknown.has(shown)) {
      reportedUnknown.add(shown);
      log("info", `Mensaje de un número que no está en Contactos: ${shown}`);
    }
    return;
  }

  if (m.key.fromMe) {
    // Escribiste vos a mano: el bot calla un rato y no insiste
    if (sentByBot.has(m.key.id)) return;
    // Mensajes viejos reentregados (reconexión/sincronización) no cuentan como "escribiste ahora"
    const ageSec = Date.now() / 1000 - Number(m.messageTimestamp?.low ?? m.messageTimestamp ?? 0);
    if (m.messageTimestamp && ageSec > STALE_MESSAGE_SEC) return;
    manualUntil.set(contact.number, Date.now() + cfg.manualPauseMin * 60000);
    followUps.cancel(contact.number);
    log("info", `Detecté un mensaje tuyo escrito a mano (id ${m.key.id}); el bot espera ${cfg.manualPauseMin} min.`, contact.number);
    return;
  }
  followUps.cancel(contact.number); // ella escribió: no hace falta insistir
  if (!contact.enabled) return;
  const b = buffers.get(contact.number) || { msgs: [], timer: null };
  b.msgs.push({ text, raw: m }); b.jid = jid;
  jids.set(contact.number, jid);
  clearTimeout(b.timer);
  const { debounceMinSec: lo, debounceMaxSec: hi } = cfg;
  b.timer = setTimeout(() => flush(contact.number).catch((e) => log("error", String(e.message || e), contact.number)), (lo + Math.random() * Math.max(0, hi - lo)) * 1000);
  buffers.set(contact.number, b);
  log("in", text, contact.number);
}

// Muestra "escribiendo…" durante `ms`; WhatsApp lo apaga solo a los pocos segundos, así que se renueva.
async function typeFor(jid, ms) {
  await sock.presenceSubscribe(jid);
  for (let left = ms; left > 0; left -= TYPING_REFRESH_MS) {
    await sock.sendPresenceUpdate("composing", jid);
    await sleep(Math.min(left, TYPING_REFRESH_MS));
  }
}

// Envía los mensajes uno tras otro con ritmo humano; `quotable[n-1]` es el mensaje de ella que se cita con replyTo = n.
async function sendParts(number, jid, parts, quotable = []) {
  for (const { text, replyTo } of parts) {
    if (getConfig().dryRun) { log("dry", replyTo ? `↩ ${replyTo}: ${text}` : text, number); continue; }
    await typeFor(jid, typingDelayMs(getConfig().typing));
    const quoted = replyTo ? quotable[replyTo - 1] : undefined;
    // El ID se registra ANTES de enviar: WhatsApp devuelve el eco (fromMe) antes de que sendMessage termine,
    // y si no, el bot lo confundía con un mensaje escrito a mano por vos.
    const messageId = generateMessageID();
    sentByBot.add(messageId);
    await sock.sendMessage(jid, { text }, { messageId, ...(quoted && { quoted }) });
    await sock.sendPresenceUpdate("paused", jid);
    log("out", text, number);
  }
}

async function flush(number) {
  const b = buffers.get(number);
  const msgs = b.msgs.splice(0);
  const cfg = getConfig();
  const contact = cfg.contacts.find((c) => c.number === number);
  if (!msgs.length || !contact?.enabled || cfg.paused || contact.paused) return;
  const waitMs = (manualUntil.get(number) || 0) - Date.now();
  if (waitMs > 0) {
    // No descartar lo que ella escribió: se reintenta cuando termina la pausa
    b.msgs.unshift(...msgs);
    clearTimeout(b.timer);
    b.timer = setTimeout(() => flush(number).catch((e) => log("error", String(e.message || e), number)), waitMs + 1000);
    return log("info", `Escribiste vos, el bot espera ${Math.ceil(waitMs / 60000)} min más.`, number);
  }

  const texts = msgs.map((x) => x.text);
  const joined = texts.join("\n");
  const h = (history[number] ||= []);
  h.push({ role: "user", content: formatIncoming(texts) });
  const topic = findSensitiveTopic(joined, cfg.sensitiveTopics);
  if (topic) {
    setContactPaused(number, true);
    saveHistory();
    log("alert", `Pausado por tema: ${topic.label}`, number);
    if (cfg.ownerNumber) await sock.sendMessage(`${cfg.ownerNumber}@s.whatsapp.net`, { text: `🤖 Pausé el bot con ${contact.name || number} (${topic.label}):\n"${joined}"` });
    return;
  }
  const { parts, blocked } = await respond(h.slice(-CONTEXT_MESSAGES), { incomingCount: msgs.length });
  if (blocked) return log("alert", `Respuesta bloqueada: usó palabras que no usás (${blocked.join(", ")}). Contestá vos.`, number, blocked);
  if (!parts.length) return log("error", "El modelo no devolvió texto", number);
  recordReply(number, parts);

  await sendParts(number, b.jid, parts, msgs.map((x) => x.raw));
  followUps.arm(number); // si ella no contesta, el scheduler decide si insistir
}

// Mensaje espontáneo cuando ella dejó de contestar.
async function sendFollowUp(number, info) {
  const jid = jids.get(number) || `${number}@s.whatsapp.net`;
  const h = (history[number] ||= []);
  const { parts, blocked } = await respond(h.slice(-CONTEXT_MESSAGES), { followUp: info });
  if (blocked) throw Object.assign(new Error(`Seguimiento bloqueado: usó palabras que no usás (${blocked.join(", ")})`), { words: blocked });
  if (!parts.length) throw new Error("El modelo no devolvió texto");
  recordReply(number, parts);
  log("info", `Seguimiento ${info.attempt + 1} (ella no contesta hace ${info.minutesSilent} min)`, number);
  await sendParts(number, jid, parts);
}

// Comprueba contra WhatsApp que el número exista; si no, sugiere la variante (ej. Argentina con/sin 9).
export async function verifyNumber(number) {
  if (!isValidNumber(number)) return { valid: false, exists: false, jid: null, suggestion: null };
  if (state.connection !== "open" || !sock) throw new NotConnectedError();
  for (const candidate of numberVariants(number)) {
    const [r] = (await sock.onWhatsApp(candidate)) ?? [];
    if (r?.exists) return { valid: true, exists: true, jid: r.jid, suggestion: candidate === number ? null : candidate };
  }
  return { valid: true, exists: false, jid: null, suggestion: null };
}

export class NotConnectedError extends Error {
  constructor() { super("WhatsApp no está conectado todavía"); }
}
