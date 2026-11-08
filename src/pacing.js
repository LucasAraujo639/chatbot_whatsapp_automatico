// Ritmo de envío: cuántos mensajes seguidos y cuánto "escribe" entre uno y otro (puro, con rng inyectable).
// Todo se normaliza al usarlo: valores inválidos o min > max nunca rompen el bot.
export const LIMITS = { burst: { min: 1, max: 8 }, typingSec: { min: 0, max: 120 } };

const num = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) && v !== "" && v !== null ? Math.min(hi, Math.max(lo, Number(v))) : fallback);

export function normalizeBurst({ min, max } = {}) {
  const { min: lo, max: hi } = LIMITS.burst;
  let a = Math.round(num(min, lo, hi, 1)), b = Math.round(num(max, lo, hi, 3));
  if (a > b) [a, b] = [b, a];
  return { min: a, max: b };
}

export function normalizeTyping({ minSec, maxSec } = {}) {
  const { min: lo, max: hi } = LIMITS.typingSec;
  let a = num(minSec, lo, hi, 2), b = num(maxSec, lo, hi, 6);
  if (a > b) [a, b] = [b, a];
  return { minSec: a, maxSec: b };
}

// Cantidad objetivo de mensajes para esta respuesta, al azar entre min y max (inclusive).
export function pickBurstSize(burst, rng = Math.random) {
  const { min, max } = normalizeBurst(burst);
  return min + Math.floor(rng() * (max - min + 1));
}

// Si el modelo se pasó del máximo, los mensajes sobrantes se unen al último permitido (no se pierde contenido).
export function limitParts(parts, max) {
  const { max: limit } = normalizeBurst({ min: 1, max });
  if (parts.length <= limit) return parts;
  const head = parts.slice(0, limit);
  const tail = parts.slice(limit).map((p) => p.text).join(" ");
  head[limit - 1] = { ...head[limit - 1], text: `${head[limit - 1].text} ${tail}`.trim() };
  return head;
}

// Cuánto tarda en "escribir" cada mensaje, al azar dentro del rango configurado.
export function typingDelayMs(typing, rng = Math.random) {
  const { minSec, maxSec } = normalizeTyping(typing);
  return Math.round((minSec + rng() * (maxSec - minSec)) * 1000);
}

export const plannedDelays = (count, typing, rng = Math.random) => Array.from({ length: count }, () => typingDelayMs(typing, rng));
