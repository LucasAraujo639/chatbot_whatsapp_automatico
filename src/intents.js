// Situaciones típicas (saludos, cariño) para mostrarle al modelo tus respuestas REALES a ellas.
import { normalize } from "./topics.js";
import { isContextual } from "./context-filter.js";

export const INTENTS = [
  { id: "buenas_noches", label: "buenas noches / se va a dormir", test: /buenas? noches?|que descanses|descansa|me voy a dormir|me voy a acostar|dulces suenos/ },
  { id: "buen_dia", label: "buen día", test: /buen(?:os?|as?) dias?/ },
  { id: "buenas_tardes", label: "buenas tardes", test: /buenas? tardes?/ },
  { id: "te_amo", label: "te amo / te quiero", test: /te am+o|te quier+o|te adoro/ },
  { id: "te_extrano", label: "te extraña", test: /te extran|te echo de menos/ },
];

export function detectIntent(text) {
  const n = normalize(text);
  return INTENTS.find((i) => i.test.test(n)) ?? null;
}

// Despedidas / "andá a dormir": solo tienen sentido si el contacto dijo que se va.
const FAREWELL = /descans|dormi(?:te|lona|lon|r)?\b|buenas? noches?|dulces suenos|que suenes|hasta manana|chau/;
export const isFarewell = (text) => FAREWELL.test(normalize(text ?? ""));

// ¿El contacto dijo en sus últimos mensajes que se va a dormir / se despide?
export function sheIsLeaving(history, lastUserMessages = 2) {
  return history.filter((m) => m.role === "user").slice(-lastUserMessages)
    .some((m) => detectIntent(m.content)?.id === "buenas_noches" || isFarewell(m.content));
}

// Índices del corpus cuya respuesta tuya es una despedida (para no mostrarlas como ejemplo fuera de contexto).
const farewellCache = new WeakMap();
export function farewellPairs(corpus) {
  if (!farewellCache.has(corpus)) farewellCache.set(corpus, new Set(corpus.flatMap((p, i) => (isFarewell(p.me.join("\n")) ? [i] : []))));
  return farewellCache.get(corpus);
}

const cache = new WeakMap(); // corpus → Map(intentId → respuestas)
const MAX_REPLY_CHARS = 140;

// Todas tus respuestas históricas (tandas de mensajes) al último mensaje del contacto que cae en esa situación.
export function repliesForIntent(corpus, intentId) {
  if (!cache.has(corpus)) {
    const byIntent = new Map();
    for (const pair of corpus) {
      const intent = detectIntent(pair.them.at(-1) ?? "");
      const reply = pair.me.join("\n");
      if (!intent || reply.length > MAX_REPLY_CHARS || isContextual(reply)) continue;
      byIntent.set(intent.id, [...(byIntent.get(intent.id) ?? []), pair.me]);
    }
    cache.set(corpus, byIntent);
  }
  return cache.get(corpus).get(intentId) ?? [];
}
