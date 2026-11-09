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

const cache = new WeakMap(); // corpus → Map(intentId → respuestas)
const MAX_REPLY_CHARS = 140;

// Todas tus respuestas históricas (tandas de mensajes) al último mensaje de ella que cae en esa situación.
export function repliesForIntent(corpus, intentId) {
  if (!cache.has(corpus)) {
    const byIntent = new Map();
    for (const pair of corpus) {
      const intent = detectIntent(pair.her.at(-1) ?? "");
      const reply = pair.me.join("\n");
      if (!intent || reply.length > MAX_REPLY_CHARS || isContextual(reply)) continue;
      byIntent.set(intent.id, [...(byIntent.get(intent.id) ?? []), pair.me]);
    }
    cache.set(corpus, byIntent);
  }
  return cache.get(corpus).get(intentId) ?? [];
}
