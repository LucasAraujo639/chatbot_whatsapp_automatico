// Simula conversaciones SIN WhatsApp: mismas reglas que el bot real
// (temas sensibles → pausa; si no, respuesta del modelo con encadenado/citas; y seguimientos).
// Es stateless: el historial lo manda el cliente, no se guarda nada en disco.
import { getConfig } from "./config.js";
import { findSensitiveTopic } from "./topics.js";
import { respond } from "./responder.js";
import { formatIncoming } from "./reply-parser.js";
import { delayFor } from "./followup.js";
import { plannedDelays } from "./pacing.js";

export const MAX_MESSAGES = 60;
export const MAX_CONTENT_LENGTH = 2000;
export const MAX_ATTEMPT = 9;

export class InvalidSimulationInput extends Error {}

const validText = (t) => typeof t === "string" && t.trim() && t.length <= MAX_CONTENT_LENGTH;

// Mensajes del contacto: `content` puede ser un string o un lote (array) de mensajes seguidos.
// Devuelve el historial normalizado y cuántos mensajes tiene el último lote del contacto.
export function validateMessages(messages, { lastRole = "user" } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) throw new InvalidSimulationInput("Falta el historial de mensajes");
  if (messages.length > MAX_MESSAGES) throw new InvalidSimulationInput(`Máximo ${MAX_MESSAGES} mensajes por chat de prueba`);
  let lastBatchSize = 0;
  const normalized = messages.map((m) => {
    const isBatch = m?.role === "user" && Array.isArray(m.content);
    const texts = isBatch ? m.content : [m?.content];
    if (!["user", "assistant"].includes(m?.role) || texts.length === 0 || !texts.every(validText)) throw new InvalidSimulationInput("Mensaje inválido en el historial");
    lastBatchSize = texts.length;
    return { role: m.role, content: m.role === "user" ? formatIncoming(texts) : texts[0] };
  });
  if (messages.at(-1).role !== lastRole) throw new InvalidSimulationInput(lastRole === "user" ? "El último mensaje tiene que ser del contacto" : "El seguimiento solo aplica si el último mensaje fue del bot");
  return { history: normalized, lastBatchSize, lastText: messages.at(-1).role === "user" ? [messages.at(-1).content].flat().join("\n") : "" };
}

// Cuánto "escribiría" el bot antes de cada mensaje (mismo cálculo que el envío real).
const pacing = (parts, deps) => plannedDelays(parts.length, deps.getConfig().typing);

export async function simulateTurn(rawMessages, deps = { getConfig, respond }) {
  const { history, lastBatchSize, lastText } = validateMessages(rawMessages);
  const topic = findSensitiveTopic(lastText, deps.getConfig().sensitiveTopics);
  if (topic) return { paused: true, topic: topic.label, parts: [] };
  const { parts, blocked, notes, flagged } = await deps.respond(history.slice(-30), { incomingCount: lastBatchSize });
  if (!parts.length && !blocked) throw new Error("El modelo no devolvió texto");
  return { paused: false, topic: null, parts, blocked, notes, flagged, delaysMs: pacing(parts, deps) };
}

// Seguimiento: ella no contestó después del último mensaje del bot.
export async function simulateFollowUp(rawMessages, rawAttempt = 0, deps = { getConfig, respond }) {
  const { history } = validateMessages(rawMessages, { lastRole: "assistant" });
  const attempt = Math.min(MAX_ATTEMPT, Math.max(0, Number.parseInt(rawAttempt, 10) || 0));
  const cfg = deps.getConfig().followUp;
  const minutesSilent = Math.round(delayFor(cfg, attempt) / 60000);
  const { parts, blocked, notes, flagged } = await deps.respond(history.slice(-30), { followUp: { attempt, minutesSilent } });
  if (!parts.length && !blocked) throw new Error("El modelo no devolvió texto");
  return { paused: false, topic: null, parts, blocked, notes, flagged, delaysMs: pacing(parts, deps), attempt, minutesSilent };
}
