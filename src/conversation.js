// Núcleo de la conversación, independiente de la plataforma de mensajería (WhatsApp, Telegram, ...).
// Decide qué hacer con cada mensaje: juntar el lote, pausar por temas sensibles, pedir la respuesta,
// enviarla con ritmo humano y programar seguimientos. No importa SDKs, disco ni red: todo llega por puertos.
import { formatIncoming, plainText } from "./reply-parser.js";
import { createFollowUpScheduler } from "./followup.js";
import { createMessageBuffer } from "./message-buffer.js";
import { typingDelayMs } from "./pacing.js";
import { findContact } from "./phone.js";
import { findSensitiveTopic } from "./topics.js";
import { CONTEXT_MESSAGES } from "./responder.js";

const STORED_MESSAGES = 60; // mensajes de historial que se persisten por contacto
const MINUTE_MS = 60000;

/**
 * Puerto de salida: la plataforma por la que se habla con el contacto.
 * `address` y `ref` son opacos para el núcleo: solo la plataforma sabe qué son (un JID, un chat id, un mensaje).
 * @typedef {object} Messenger
 * @property {() => boolean} isConnected
 * @property {(number: string) => unknown} addressFor  Dirección para escribirle a un contacto por iniciativa propia.
 * @property {(address: unknown, ms: number) => Promise<void>} showTyping  Muestra "escribiendo…" durante `ms`.
 * @property {(address: unknown, text: string, opts?: { quoted?: unknown }) => Promise<void>} send
 * @property {(ownerNumber: string, text: string) => Promise<void>} notifyOwner
 */

/**
 * Puerto de salida: dónde se guarda el historial de cada contacto.
 * @typedef {object} HistoryStore
 * @property {(number: string) => Array<{ role: string, content: string }>} get  Historial vivo (se puede modificar).
 * @property {(number: string, messages: Array<{ role: string, content: string }>) => void} set
 * @property {() => void} save  Persiste los cambios.
 */

/**
 * Mensaje entrante ya traducido por el adaptador de la plataforma.
 * @typedef {object} IncomingMessage
 * @property {string[]} phones       Números de teléfono del remitente.
 * @property {unknown} address       Dónde contestar.
 * @property {string} text
 * @property {unknown} ref           Mensaje original, para citarlo al responder.
 * @property {string} id
 * @property {boolean} fromOwner     Lo escribió el dueño a mano (los ecos del bot ya los filtró el adaptador).
 * @property {string} senderLabel    Cómo mostrar al remitente si no está en Contactos.
 */

export function createConversationService({
  getConfig,
  updateConfig,
  history,           // HistoryStore
  messenger,         // Messenger
  respond,           // async (history, opts) => { parts, blocked }
  log = () => {},    // (kind, text, contact?, words?)
  onUnknown,         // (IncomingMessage) => void: mensaje (tuyo o de la otra persona) en un chat que no está en Contactos
  onChange = () => {},
  clock = {},        // { now, random, setTimer, clearTimer } para tests
}) {
  const addresses = new Map(); // number -> última dirección conocida (para escribir por iniciativa propia)
  const reportedUnknown = new Set();
  const contactByNumber = (cfg, number) => cfg.contacts.find((c) => c.number === number);
  const logError = (contact) => (e) => log("error", String(e.message || e), contact);

  // El contacto está activo y ni el bot ni el contacto están en pausa.
  function canReply(number) {
    const cfg = getConfig();
    const c = contactByNumber(cfg, number);
    return !!c?.enabled && !cfg.paused && !c.paused;
  }

  const messageBuffer = createMessageBuffer({
    getConfig,
    canReply,
    deliver: reply,
    onWait: (number, waitMs) => log("info", `Escribiste vos, el bot espera ${Math.ceil(waitMs / MINUTE_MS)} min más.`, number),
    onError: (number, e) => logError(number)(e),
    ...clock,
  });

  const followUps = createFollowUpScheduler({
    getConfig,
    canSend: (number) => canReply(number) && messenger.isConnected() && !messageBuffer.isManuallyPaused(number),
    send: sendFollowUp,
    onError: (number, e) => log("error", `Seguimiento fallido: ${e.message || e}`, number, e.words),
    ...clock,
  });

  function setContactPaused(number, paused) {
    const contacts = getConfig().contacts.map((c) => (c.number === number ? { ...c, paused } : c));
    updateConfig({ contacts });
    if (paused) followUps.cancel(number);
    onChange();
  }

  // Guarda en el historial lo que el bot le contestó a un contacto y lo persiste.
  function recordReply(number, parts) {
    const h = history.get(number);
    h.push({ role: "assistant", content: plainText(parts) });
    history.set(number, h.slice(-STORED_MESSAGES));
    history.save();
  }

  // Envía los mensajes uno tras otro con ritmo humano; `quotable[n-1]` es el mensaje de ella que se cita con replyTo = n.
  async function sendParts(number, address, parts, quotable = []) {
    for (const { text, replyTo } of parts) {
      if (getConfig().dryRun) { log("dry", replyTo ? `↩ ${replyTo}: ${text}` : text, number); continue; }
      await messenger.showTyping(address, typingDelayMs(getConfig().typing));
      const quoted = replyTo ? quotable[replyTo - 1] : undefined;
      await messenger.send(address, text, { quoted });
      log("out", text, number);
    }
  }

  // Tema sensible: pausa el contacto y avisa al dueño para que conteste él.
  async function pauseForTopic(number, contact, topic, joined, cfg) {
    setContactPaused(number, true);
    history.save();
    log("alert", `Pausado por tema: ${topic.label}`, number);
    if (cfg.ownerNumber) await messenger.notifyOwner(cfg.ownerNumber, `🤖 Pausé el bot con ${contact.name || number} (${topic.label}):\n"${joined}"`);
  }

  // Responde al lote de mensajes que ella mandó (el buffer ya resolvió debounce y pausas).
  async function reply(number, msgs, address) {
    const cfg = getConfig();
    const contact = contactByNumber(cfg, number);
    const texts = msgs.map((x) => x.text);
    const joined = texts.join("\n");
    const h = history.get(number);
    h.push({ role: "user", content: formatIncoming(texts) });
    const topic = findSensitiveTopic(joined, cfg.sensitiveTopics);
    if (topic) return pauseForTopic(number, contact, topic, joined, cfg);
    const { parts, blocked } = await respond(h.slice(-CONTEXT_MESSAGES), { incomingCount: msgs.length });
    if (blocked) return log("alert", `Respuesta bloqueada: usó palabras que no usás (${blocked.join(", ")}). Contestá vos.`, number, blocked);
    if (!parts.length) return log("error", "El modelo no devolvió texto", number);
    recordReply(number, parts);

    await sendParts(number, address, parts, msgs.map((x) => x.ref));
    followUps.arm(number); // si ella no contesta, el scheduler decide si insistir
  }

  // Mensaje espontáneo cuando ella dejó de contestar.
  async function sendFollowUp(number, info) {
    const address = addresses.get(number) || messenger.addressFor(number);
    const { parts, blocked } = await respond(history.get(number).slice(-CONTEXT_MESSAGES), { followUp: info });
    if (blocked) throw Object.assign(new Error(`Seguimiento bloqueado: usó palabras que no usás (${blocked.join(", ")})`), { words: blocked });
    if (!parts.length) throw new Error("El modelo no devolvió texto");
    recordReply(number, parts);
    log("info", `Seguimiento ${info.attempt + 1} (ella no contesta hace ${info.minutesSilent} min)`, number);
    await sendParts(number, address, parts);
  }

  // Ayuda a diagnosticar "no responde": muestra qué número está llegando realmente (una vez por chat, sin el texto).
  function reportUnknownSender({ fromOwner, senderLabel }) {
    if (!fromOwner && !reportedUnknown.has(senderLabel)) {
      reportedUnknown.add(senderLabel);
      log("info", `Mensaje de un número que no está en Contactos: ${senderLabel}`);
    }
  }

  // Escribiste vos a mano: el bot calla un rato y no insiste.
  function onOwnerMessage({ id }, contact, cfg) {
    messageBuffer.markManual(contact.number);
    followUps.cancel(contact.number);
    log("info", `Detecté un mensaje tuyo escrito a mano (id ${id}); el bot espera ${cfg.manualPauseMin} min.`, contact.number);
  }

  // Mensaje de ella: se acumula y se responde todo junto tras una espera aleatoria (debounce).
  function onIncomingMessage({ text, ref, address }, contact) {
    followUps.cancel(contact.number); // ella escribió: no hace falta insistir
    if (!contact.enabled) return;
    messageBuffer.add(contact.number, { text, ref }, address);
    addresses.set(contact.number, address);
    log("in", text, contact.number);
  }

  /** Puerto de entrada: la plataforma entrega aquí cada mensaje de texto. @param {IncomingMessage} msg */
  function receive(msg) {
    const cfg = getConfig();
    const contact = findContact(cfg.contacts, msg.phones);
    if (!contact) return (onUnknown ?? reportUnknownSender)(msg);
    if (msg.fromOwner) return onOwnerMessage(msg, contact, cfg);
    onIncomingMessage(msg, contact);
  }

  return { receive, setContactPaused };
}
