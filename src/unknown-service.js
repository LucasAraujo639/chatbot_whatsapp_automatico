// Flujo de desconocidos: quien escribe sin estar en Contactos (ni en la agenda) queda pendiente en la bandeja
// y vos decidís si se le manda UNA respuesta predeterminada. Independiente de la plataforma: todo llega por puertos.
import { typingDelayMs } from "./pacing.js";
import { unanswered, EXTRA_MESSAGES } from "./unknown-inbox.js";

const PROFILE_TTL_MS = 10 * 60 * 1000;

export class InboxError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function createUnknownService({
  getConfig,
  inbox,                          // ver src/unknown-inbox.js
  messenger,                      // Messenger (src/conversation.js)
  draft,                          // async (texts: string[]) => string
  isInAddressBook = () => false,  // (phones: string[]) => boolean | Promise<boolean>
  saveToAddressBook,              // async (number, name) => void
  fetchProfile = async () => null, // async (address) => { photoUrl, about, aboutSetAt, business } | null
  now = Date.now,
  log = () => {},
  onChange = () => {},
}) {
  const reported = new Set();
  const idOf = (msg) => msg.phones[0] || String(msg.address);

  function find(id) {
    const entry = inbox.get(id);
    if (!entry) throw new InboxError("No encontré ese chat en la bandeja", 404);
    return entry;
  }

  function setStatus(id, status) {
    const entry = inbox.setStatus(id, status);
    onChange();
    return entry;
  }

  /** Puerto de entrada: mensaje de un chat que no está en Contactos. @param {import("./conversation.js").IncomingMessage} msg */
  async function receive(msg) {
    if (msg.fromOwner) {
      // Le contestaste vos a mano desde WhatsApp: queda en la charla y ya no está pendiente.
      const entry = inbox.get(idOf(msg));
      if (!entry) return;
      inbox.recordReply(entry.id, msg.text);
      if (entry.status === "pending") inbox.setStatus(entry.id, "replied");
      onChange();
      return;
    }
    if (await isInAddressBook(msg.phones)) {
      // Diagnóstico: si lo borraste de la agenda y WhatsApp no avisó, se ve acá por qué no cae en la bandeja.
      if (!reported.has(`book:${msg.senderLabel}`)) { reported.add(`book:${msg.senderLabel}`); log("info", `${msg.senderLabel} figura en tu agenda: no va a la bandeja de desconocidos`); }
      return;
    }
    if (!getConfig().unknownInbox?.enabled) {
      if (!reported.has(msg.senderLabel)) { reported.add(msg.senderLabel); log("info", `Mensaje de un número que no está en Contactos: ${msg.senderLabel}`); }
      return;
    }
    const isNew = !inbox.get(idOf(msg));
    const entry = inbox.record({ number: msg.phones[0] ?? null, label: msg.senderLabel, address: msg.address, pushName: msg.pushName, text: msg.text });
    if (!entry) {
      if (!reported.has(`full:${idOf(msg)}`)) { reported.add(`full:${idOf(msg)}`); log("info", `${msg.senderLabel} ya mandó ${EXTRA_MESSAGES + 1} mensajes: no se guardan más en la bandeja`); }
      return;
    }
    if (isNew) log("info", `Nuevo desconocido en la bandeja: ${msg.senderLabel}`);
    onChange();
  }

  /** Borrador de la respuesta (texto fijo o generado) a lo que todavía no contestaste, para mostrar antes de enviar. */
  const preview = (id) => {
    const entry = find(id);
    const pending = unanswered(entry);
    return draft((pending.length ? pending : entry.messages).map((m) => m.text));
  };

  async function accept(id, text) {
    const entry = find(id);
    const body = String(text ?? "").trim();
    if (!body) throw new InboxError("El mensaje está vacío");
    if (entry.status === "saved") throw new InboxError("Ese chat ya fue resuelto", 409);
    if (entry.status === "done") throw new InboxError("Ese chat está marcado como listo; desmarcalo para contestar", 409);
    if (entry.status === "replied" && !unanswered(entry).length) throw new InboxError("No hay mensajes nuevos para contestar", 409);
    const cfg = getConfig();
    if (cfg.dryRun) {
      log("dry", body, entry.label);
    } else {
      if (!messenger.isConnected()) throw new InboxError("WhatsApp no está conectado todavía", 409);
      await messenger.showTyping(entry.address, typingDelayMs(cfg.typing));
      await messenger.send(entry.address, body);
      log("out", body, entry.label);
    }
    inbox.recordReply(id, body);
    return setStatus(id, "replied");
  }

  function reject(id) {
    find(id);
    return setStatus(id, "rejected");
  }

  async function saveContact(id, name) {
    const entry = find(id);
    const clean = String(name ?? "").trim();
    if (!clean) throw new InboxError("Poné un nombre para agendarlo");
    if (!entry.number) throw new InboxError("WhatsApp no dio el número real de este chat; no se puede agendar");
    await saveToAddressBook(entry.number, clean);
    log("info", `Agendado como "${clean}"`, entry.number);
    return setStatus(id, "saved");
  }

  // Perfil de WhatsApp para reconocerlo antes de decidir. Se cachea un rato: la URL de la foto vence
  // y no tiene sentido pedirlo cada vez que se redibuja el panel.
  const profiles = new Map();
  async function profile(id) {
    const entry = find(id);
    const hit = profiles.get(id);
    if (hit && now() - hit.at < PROFILE_TTL_MS) return hit.data;
    const target = entry.number ? messenger.addressFor(entry.number) : entry.address;
    const data = { ...(await fetchProfile(target)), name: entry.pushName || null, number: entry.number, firstAt: entry.firstAt };
    profiles.set(id, { at: now(), data });
    return data;
  }

  /** Listo / no listo: solo para chats ya respondidos. Listo = no vuelve a pedir respuesta ni se puede quitar. */
  function setDone(id, done) {
    const entry = find(id);
    if (done && entry.status !== "replied") throw new InboxError("Solo se puede marcar como listo un chat ya respondido", 409);
    if (!done && entry.status !== "done") throw new InboxError("Ese chat no está marcado como listo", 409);
    return setStatus(id, done ? "done" : "replied");
  }

  function remove(id) {
    if (find(id).status === "done") throw new InboxError("Está marcado como listo: desmarcalo para poder quitarlo", 409);
    inbox.remove(id);
    onChange();
  }

  return { receive, preview, accept, reject, saveContact, profile, setDone, remove, list: () => inbox.list() };
}
