// Formato de salida del modelo: mensajes separados por una línea "---".
// Cada mensaje puede empezar con "[N]" = responde (cita) al mensaje N de ella.
const SEPARATOR = /\n---\n/;
const REPLY_TAG = /^\[(\d+)\]\s*/;

export function parseReply(text, incomingCount = 0) {
  return text
    .split(SEPARATOR)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const tag = raw.match(REPLY_TAG);
      const n = tag ? Number(tag[1]) : null;
      const body = tag ? raw.replace(REPLY_TAG, "").trim() : raw;
      return { text: body, replyTo: n && n >= 1 && n <= incomingCount ? n : null };
    })
    .filter((p) => p.text);
}

// Mensajes de ella numerados para que el modelo pueda citarlos. Con uno solo no hace falta.
export const formatIncoming = (texts) => (texts.length > 1 ? texts.map((t, i) => `[${i + 1}] ${t}`).join("\n") : texts[0] ?? "");

// Para guardar en el historial: sin marcadores de cita (los números solo valen para el lote actual).
export const plainText = (parts) => parts.map((p) => p.text).join("\n---\n");
