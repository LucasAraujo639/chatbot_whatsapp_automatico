// Adaptador de WhatsApp (Baileys): conexión, reconexión, traducción de mensajes entrantes
// al formato neutro del núcleo (IncomingMessage) e implementación del puerto Messenger.
// Acá no hay reglas de negocio: qué contestar y cuándo lo decide src/conversation.js.
import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, generateMessageID } from "@whiskeysockets/baileys";
import { numberOf, toPhoneJid, isValidNumber, numberVariants, phoneNumbersOf } from "../phone.js";

const AUTH_DIR = "auth";
const ADDRESS_BOOK_FILE = "data/address-book.json";
const STALE_MESSAGE_SEC = 120; // un mensaje propio más viejo que esto es una reentrega, no algo escrito ahora
const TYPING_REFRESH_MS = 8000; // WhatsApp apaga "escribiendo…" solo a los pocos segundos
const MAX_RECONNECT_DELAY_MS = 30000;
const CONNECT_TIMEOUT_MS = 60000;       // "conectando…" más que esto = socket colgado (ej. después de suspender la compu)
const REPLACED_RETRY_MS = 30000;        // otra conexión tomó la sesión: se reintenta, por si era un reinicio del propio bot
const MAX_REPLACED_RETRIES = 3;
// Agenda: WhatsApp NO avisa cuando borrás un contacto (Baileys no distingue alta de baja), así que la única
// fuente confiable es pedir el snapshot completo de la colección de contactos y reconstruir la lista.
const CONTACTS_COLLECTION = "critical_unblock_low";
const BOOK_SYNC_MIN_GAP_MS = 60000;     // como mucho un snapshot por minuto
const BOOK_SYNC_FLUSH_MS = 1500;        // Baileys entrega los eventos del resync con un pequeño retraso
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class NotConnectedError extends Error {
  constructor() { super("WhatsApp no está conectado todavía"); }
}

const isIgnoredChat = (jid) => !jid || jid.endsWith("@g.us") || jid === "status@broadcast";
const messageText = (m) => m.message?.conversation || m.message?.extendedTextMessage?.text;
// Mensajes viejos reentregados (reconexión/sincronización) no cuentan como "escribiste ahora".
const isStale = (m) => m.messageTimestamp && Date.now() / 1000 - Number(m.messageTimestamp?.low ?? m.messageTimestamp ?? 0) > STALE_MESSAGE_SEC;

export function createWhatsAppAdapter({
  onMessage,                 // (IncomingMessage) => void
  onConnection = () => {},   // (status, qr) => void
  log = () => {},
  addressBook = createAddressBook(ADDRESS_BOOK_FILE),
}) {
  const logError = (e) => log("error", String(e.message || e));
  let sock = null, stopping = false, retries = 0, reconnectTimer = null, connectTimer = null, connection = "closed";
  let replacedRetries = 0, loggedOutOnce = false, authKeys = null;
  let bookSync = null, bookSyncedAt = 0, collecting = null;
  const sentByBot = new Set();

  const setConn = (c, qr = null) => {
    connection = c;
    // Watchdog: si se queda en "conectando" sin abrir ni cerrar, se tira el socket y se reintenta.
    clearTimeout(connectTimer);
    if (c === "connecting") connectTimer = setTimeout(() => {
      if (connection !== "connecting" || stopping) return;
      log("info", "La conexión quedó colgada; reintento.");
      start().catch(logError);
    }, CONNECT_TIMEOUT_MS);
    onConnection(c, qr);
  };

  function dropSocket() {
    clearTimeout(reconnectTimer);
    clearTimeout(connectTimer);
    if (!sock) return;
    const old = sock;
    sock = null; // los eventos del socket viejo se ignoran (ver chequeo `sock !== me`)
    try { old.ev.removeAllListeners(); old.end(undefined); } catch {}
  }

  function scheduleReconnect(delayMs) {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => start().catch(logError), delayMs);
  }

  async function start() {
    stopping = false;
    dropSocket(); // nunca dos sockets a la vez: eso causa "connectionReplaced" y el bucle
    setConn("connecting");
    const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    authKeys = auth.keys;
    let version;
    try { ({ version } = await fetchLatestBaileysVersion()); } catch {}
    const me = makeWASocket({ ...(version && { version }), auth, logger: pino({ level: "silent" }) });
    sock = me;
    me.ev.on("creds.update", saveCreds);
    me.ev.on("connection.update", ({ connection: c, lastDisconnect, qr }) => {
      if (sock !== me) return;
      if (qr) setConn("qr", qr); // el QR se mantiene hasta que se conecta o la sesión se reinicia
      if (c === "open") {
        retries = 0; replacedRetries = 0; loggedOutOnce = false;
        setConn("open"); log("info", "Conectado a WhatsApp");
        setTimeout(() => { if (sock === me) syncAddressBook().catch(logError); }, 10000);
      }
      if (c === "close") {
        const code = lastDisconnect?.error?.output?.statusCode;
        dropSocket();
        if (stopping) return setConn("closed");
        if (code === DisconnectReason.loggedOut) {
          // WhatsApp a veces devuelve 401 por un corte puntual: se reintenta una vez con la sesión guardada
          // antes de borrarla y pedir QR.
          if (!loggedOutOnce) {
            loggedOutOnce = true;
            log("info", "WhatsApp rechazó la sesión; reintento una vez antes de pedir QR.");
            setConn("connecting");
            return scheduleReconnect(5000);
          }
          loggedOutOnce = false;
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          log("info", "Sesión cerrada. Hay que escanear el QR de nuevo.");
          setConn("connecting");
          return scheduleReconnect(1000);
        }
        if (code === DisconnectReason.connectionReplaced) {
          // Pasa también cuando el bot se reinicia (ej. `npm run dev` al guardar un archivo) y la conexión vieja
          // todavía no murió. Se reintenta unas veces; si sigue, de verdad hay otra instancia y se para.
          if (replacedRetries++ < MAX_REPLACED_RETRIES) {
            setConn("connecting");
            log("info", `Otra conexión tomó la sesión; reintento en ${REPLACED_RETRY_MS / 1000}s (${replacedRetries}/${MAX_REPLACED_RETRIES}).`);
            return scheduleReconnect(REPLACED_RETRY_MS);
          }
          setConn("closed");
          return log("error", "Otra instancia sigue usando esta sesión. Cerrala y tocá \"Reconectar\" (no hace falta cerrar sesión).");
        }
        setConn("connecting");
        if (code === DisconnectReason.restartRequired) return scheduleReconnect(0); // normal justo después de escanear el QR
        const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** retries++);
        log("info", `Conexión caída (código ${code ?? "?"}). Reintento en ${Math.round(delay / 1000)}s`);
        scheduleReconnect(delay);
      }
    });

    // Contactos de tu agenda (WhatsApp los sincroniza con `name`; `notify` es solo el nombre de perfil).
    const onContacts = (list) => {
      if (sock !== me) return;
      if (collecting) for (const c of list ?? []) if (c?.name) for (const n of contactNumbers(c)) collecting.add(n);
      addressBook.update(list);
    };
    me.ev.on("contacts.upsert", onContacts);
    me.ev.on("contacts.update", onContacts);

    me.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) handle(m).catch(logError);
    });
  }

  // Reconstruye la agenda desde el snapshot de WhatsApp: lo que no viene, ya no está agendado.
  function syncAddressBook() {
    if (bookSync) return bookSync;
    bookSync = (async () => {
      if (connection !== "open" || !sock || !authKeys) return false;
      const current = sock;
      collecting = new Set();
      try {
        await authKeys.set({ "app-state-sync-version": { [CONTACTS_COLLECTION]: null } }); // fuerza snapshot
        await current.resyncAppState([CONTACTS_COLLECTION], false);
        await sleep(BOOK_SYNC_FLUSH_MS);
        if (sock !== current || !collecting.size) return false; // sin datos: no se borra nada por las dudas
        const removed = addressBook.replace(collecting);
        log("info", `Agenda sincronizada con WhatsApp: ${collecting.size} contactos${removed.length ? `, ${removed.length} ya no están agendados` : ""}`);
        return true;
      } finally {
        collecting = null;
        bookSyncedAt = Date.now();
        bookSync = null;
      }
    })();
    return bookSync;
  }

  // ¿Está agendado? Si la lista dice que sí, se confirma con un snapshot fresco (puede que lo hayas borrado).
  async function isInAddressBook(phones) {
    const known = () => phones.some((p) => numberVariants(p).some(addressBook.has));
    if (!known()) return false;
    if (Date.now() - bookSyncedAt > BOOK_SYNC_MIN_GAP_MS || bookSync) {
      try { await syncAddressBook(); } catch (e) { logError(e); }
    }
    return known();
  }

  // Vuelve a conectar con la sesión guardada (sin QR).
  async function reconnect() {
    retries = 0; replacedRetries = 0; loggedOutOnce = false;
    await start();
  }

  // Cierre prolijo al apagar el proceso: corta el socket sin desvincular, así al volver no pide QR.
  function stop() {
    stopping = true;
    dropSocket();
  }

  async function logout() {
    stopping = true;
    try { await sock?.logout(); } catch {}
    dropSocket();
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    setConn("closed");
    retries = 0;
    await start();
  }

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

  // Traduce el mensaje de Baileys al formato del núcleo. Los ecos de lo que mandó el bot
  // y las reentregas viejas de mensajes propios no llegan al núcleo.
  async function handle(m) {
    const jid = m.key.remoteJid;
    if (isIgnoredChat(jid)) return;
    const text = messageText(m);
    if (!text) return;
    const phones = await resolvePhoneNumbers(m);
    const fromOwner = !!m.key.fromMe;
    if (fromOwner && (sentByBot.has(m.key.id) || isStale(m))) return;
    onMessage({
      phones,
      address: jid,
      text,
      ref: m,
      id: m.key.id,
      fromOwner,
      pushName: fromOwner ? "" : m.pushName || "",
      senderLabel: phones[0] || `${numberOf(jid)} (ID interno, no se pudo obtener el número)`,
    });
  }

  /** @type {import("../conversation.js").Messenger} */
  const messenger = {
    isConnected: () => connection === "open",
    addressFor: (number) => toPhoneJid(number),
    // Muestra "escribiendo…" durante `ms`; WhatsApp lo apaga solo a los pocos segundos, así que se renueva.
    async showTyping(jid, ms) {
      await sock.presenceSubscribe(jid);
      for (let left = ms; left > 0; left -= TYPING_REFRESH_MS) {
        await sock.sendPresenceUpdate("composing", jid);
        await sleep(Math.min(left, TYPING_REFRESH_MS));
      }
    },
    async send(jid, text, { quoted } = {}) {
      // El ID se registra ANTES de enviar: WhatsApp devuelve el eco (fromMe) antes de que sendMessage termine,
      // y si no, el bot lo confundía con un mensaje escrito a mano por vos.
      const messageId = generateMessageID();
      sentByBot.add(messageId);
      await sock.sendMessage(jid, { text }, { messageId, ...(quoted && { quoted }) });
      await sock.sendPresenceUpdate("paused", jid);
    },
    notifyOwner: async (ownerNumber, text) => { await sock.sendMessage(toPhoneJid(ownerNumber), { text }); },
  };

  // Comprueba contra WhatsApp que el número exista; si no, sugiere la variante (ej. Argentina con/sin 9).
  async function verifyNumber(number) {
    if (!isValidNumber(number)) return { valid: false, exists: false, jid: null, suggestion: null };
    if (connection !== "open" || !sock) throw new NotConnectedError();
    for (const candidate of numberVariants(number)) {
      const [r] = (await sock.onWhatsApp(candidate)) ?? [];
      if (r?.exists) return { valid: true, exists: true, jid: r.jid, suggestion: candidate === number ? null : candidate };
    }
    return { valid: true, exists: false, jid: null, suggestion: null };
  }

  // Guarda el número en la agenda del teléfono (sincronización de WhatsApp, como al agendar desde la app).
  async function saveToAddressBook(number, name) {
    if (connection !== "open" || !sock) throw new NotConnectedError();
    const jid = toPhoneJid(number);
    const fullName = name.trim();
    await sock.addOrEditContact(jid, { fullName, firstName: fullName.split(/\s+/)[0], pnJid: jid, saveOnPrimaryAddressbook: true });
    addressBook.update([{ id: jid, name: fullName }]);
  }

  return {
    start, reconnect, stop, logout, verifyNumber, saveToAddressBook, messenger,
    isInAddressBook, syncAddressBook,
    removeFromAddressBook: (phones) => addressBook.remove(phones),
  };
}

const contactNumbers = (c) => phoneNumbersOf([c.id, c.phoneNumber, c.jid, c.lid].map((x) => (x && !x.includes("@") ? toPhoneJid(x) : x)));

// Números agendados en el teléfono, persistidos para no depender de que WhatsApp los vuelva a sincronizar.
// Un contacto llega con `name` cuando está agendado; si llega con `name` vacío (lo borraste de la agenda)
// se quita. Si `name` ni viene (ej. solo cambió la foto de perfil), no se toca.
export function createAddressBook(file) {
  let numbers = new Set();
  try { numbers = new Set(JSON.parse(fs.readFileSync(file, "utf8"))); } catch {}
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify([...numbers]));
  };
  return {
    has: (number) => numbers.has(number),
    update(contacts) {
      let changed = false;
      for (const c of contacts ?? []) {
        if (!c || !("name" in c)) continue;
        for (const n of contactNumbers(c)) {
          if (c.name && !numbers.has(n)) { numbers.add(n); changed = true; }
          if (!c.name && numbers.delete(n)) changed = true;
        }
      }
      if (changed) save();
    },
    /** Reemplaza la lista entera (snapshot de WhatsApp). Devuelve los números que salieron. */
    replace(fresh) {
      const removed = [...numbers].filter((n) => !fresh.has(n));
      const added = [...fresh].some((n) => !numbers.has(n));
      numbers = new Set(fresh);
      if (removed.length || added) save();
      return removed;
    },
    remove(phones) {
      let changed = false;
      for (const p of phones) for (const v of numberVariants(p)) if (numbers.delete(v)) changed = true;
      if (changed) save();
      return changed;
    },
  };
}
