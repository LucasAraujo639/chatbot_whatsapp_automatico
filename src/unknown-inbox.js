// Bandeja de desconocidos: quién te escribió sin estar en Contactos, sus últimos mensajes y qué decidiste.
// Persiste en un JSON; `createUnknownInbox(file)` permite testearlo sin tocar data/.
import fs from "node:fs";
import path from "node:path";

export const EXTRA_MESSAGES = 5;  // después del primero, cuántos mensajes más se le guardan a cada desconocido
export const KEPT_MESSAGES = 30;  // tope de seguridad de la charla guardada (mensajes de él + tuyos)
export const STATUSES = ["pending", "replied", "rejected", "saved"];

/**
 * @typedef {object} UnknownEntry
 * @property {string} id            Número si se conoce; si no, la dirección (ej. un JID @lid).
 * @property {string|null} number   Teléfono real (null si WhatsApp solo dio un ID interno).
 * @property {string} label         Cómo mostrarlo.
 * @property {unknown} address      Dónde contestarle.
 * @property {string} pushName      Nombre que la persona puso en su perfil.
 * @property {"pending"|"replied"|"rejected"|"saved"} status
 * @property {Array<{ text: string, at: number, from: "them"|"me" }>} messages  La charla (sin `from` = de él, datos viejos).
 * @property {number} firstAt
 * @property {number} lastAt
 */

const isTheirs = (m) => m.from !== "me";
const theirCount = (e) => e.messages.filter(isTheirs).length;
/** Mensajes de él que llegaron después de tu última respuesta (lo que falta contestar). */
export const unanswered = (e) => {
  const lastMine = e.messages.findLastIndex((m) => m.from === "me");
  return e.messages.slice(lastMine + 1).filter(isTheirs);
};

export function createUnknownInbox(file, { now = Date.now } = {}) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  // Datos de antes de guardar tus respuestas: los ya respondidos no tienen que figurar como "sin contestar".
  for (const e of Object.values(data)) {
    if (e.status === "replied" && !e.messages.some((m) => m.from === "me")) {
      e.messages.push({ text: "(respuesta enviada)", at: e.lastAt, from: "me" });
    }
  }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  };

  return {
    /**
     * Registra un mensaje entrante; crea la entrada (pendiente) si es la primera vez.
     * Devuelve null si ya mandó el primero + EXTRA_MESSAGES (no se guarda más).
     */
    record({ number = null, label, address, pushName = "", text }) {
      const id = number || String(address);
      const at = now();
      const e = (data[id] ||= { id, number, label, address, pushName, status: "pending", messages: [], firstAt: at, lastAt: at });
      if (theirCount(e) > EXTRA_MESSAGES) return null;
      Object.assign(e, { address, label, lastAt: at, ...(pushName && { pushName }) });
      e.messages = [...e.messages, { text, at, from: "them" }].slice(-KEPT_MESSAGES);
      save();
      return e;
    },
    /** Guarda lo que le contestaste (desde la app o a mano en WhatsApp) para mostrar la charla completa. */
    recordReply(id, text) {
      const e = data[id];
      if (!e) return null;
      const at = now();
      e.messages = [...e.messages, { text, at, from: "me" }].slice(-KEPT_MESSAGES);
      e.lastAt = at;
      save();
      return e;
    },
    list: () => Object.values(data).sort((a, b) => b.lastAt - a.lastAt),
    get: (id) => data[id] ?? null,
    setStatus(id, status) {
      if (!data[id] || !STATUSES.includes(status)) return null;
      data[id].status = status;
      save();
      return data[id];
    },
    remove(id) {
      const had = id in data;
      delete data[id];
      if (had) save();
      return had;
    },
  };
}
