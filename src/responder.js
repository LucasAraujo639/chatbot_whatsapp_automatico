import fs from "node:fs";
import { chat } from "./llm.js";
import { loadProfile, loadCorpus, loadLexicon } from "./style.js";
import { getConfig, ownerNameOf, DEFAULT_OWNER_NAME } from "./config.js";
import { parseReply } from "./reply-parser.js";
import { retrieveExamples } from "./retrieval.js";
import { detectIntent, repliesForIntent, isFarewell, sheIsLeaving, farewellPairs } from "./intents.js";
import { unknownWords, wordSet } from "./lexicon.js";
import { normalize } from "./topics.js";
import { allowlist } from "./allowlist.js";
import { pickBurstSize, limitParts, normalizeBurst } from "./pacing.js";

export const ABOUT_FILE = "data/about-me.md";
// Cuántos mensajes del historial se le pasan al modelo como contexto.
export const CONTEXT_MESSAGES = 30;

const INTENT_OPTIONS = 6;
const EXAMPLES = 8;
const stripMarkers = (t) => t.replace(/^\[\d+\]\s*/gm, "");
const lastUserText = (history) => stripMarkers(history.findLast((m) => m.role === "user")?.content ?? "");
const shuffle = (arr, rng) => arr.map((v) => [rng(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);
const asExample = (me) => me.join("\n---\n");

// Prompt puro (sin I/O) para poder testearlo. Las reglas van al final, donde más pesan para un modelo chico.
export function buildSystemPrompt({ name = DEFAULT_OWNER_NAME, about = "", profile = null, corpus = null, lexicon = null, allowlist = [], history = [], burstTarget = null, rng = Math.random }) {
  const incoming = lastUserText(history);
  const intent = incoming ? detectIntent(incoming) : null;

  let intentBlock = "";
  if (intent && corpus?.length) {
    const recent = new Set(history.filter((m) => m.role === "assistant").slice(-6).map((m) => normalize(m.content)));
    const options = repliesForIntent(corpus, intent.id).filter((me) => !recent.has(normalize(asExample(me))));
    const chosen = shuffle(options, rng).slice(0, INTENT_OPTIONS);
    if (chosen.length) intentBlock = `\nSituación detectada: la otra persona te dice "${intent.label}". Estas son respuestas REALES tuyas a ese tipo de mensaje:\n${chosen.map((me, i) => `Opción ${i + 1}:\n${asExample(me)}`).join("\n\n")}\nRespondé con una de estas opciones o con una variación mínima usando las mismas palabras. No uses siempre la misma ni repitas tu última respuesta.\n`;
  }

  const leaving = sheIsLeaving(history);
  let examples = "";
  if (corpus?.length) {
    // Si la otra persona no se está yendo, los ejemplos con "que descanses" solo invitan a despedirse sin motivo
    examples = retrieveExamples(corpus, incoming, { k: EXAMPLES, exclude: leaving ? new Set() : farewellPairs(corpus) })
      .map((p) => `Otra persona: ${p.them.join("\n")}\nYo: ${asExample(p.me)}`).join("\n\n");
  } else if (profile?.examples) {
    examples = profile.examples.map((e) => `Otra persona: ${e.them}\nYo: ${e.me}`).join("\n\n");
  }
  const s = profile?.stats;

  return `Sos ${name} respondiendo mensajes de WhatsApp. Escribí EXACTAMENTE como ${name}: mismo tono, largo, muletillas, puntuación y emojis.
${s ? `Estadísticas de su estilo: largo medio ${s.avgLen} caracteres, emojis frecuentes: ${s.topEmoji || "ninguno"}, ${s.lowercasePct}% de sus mensajes van todo en minúscula.` : ""}
${lexicon?.top?.length ? `\nVocabulario real de ${name} (palabras y apodos que usa; no uses otros): ${[...lexicon.top, ...allowlist].join(", ")}\n` : ""}
Datos sobre ${name}:
${about}

Ejemplos reales de situaciones parecidas (otra persona → ${name}). Son de otras charlas: copiá solo el tono y la forma, nunca lo que cuentan:
${examples}
${intentBlock}
REGLAS (en orden de prioridad):
1. Respondé SOLO a lo que la otra persona dijo en sus últimos mensajes y seguí el hilo de la charla. Prohibido introducir temas, planes, personas, lugares o hechos nuevos que no hayan aparecido en la conversación.
2. Hacé una pregunta solo si continúa exactamente el mismo tema; si no, no preguntes.
3. Sobre ${name} afirmá únicamente lo que está en "Datos sobre ${name}". Si la otra persona pregunta algo que no está ahí, no inventes: respondé corto y neutro con una reacción como las de los ejemplos.
4. Usá solo palabras, apodos, risas y emojis que aparezcan en su vocabulario o en los ejemplos. Nunca inventes formas nuevas de saludar ni de escribir.
5. Mismo largo y forma que los ejemplos: respuestas cortas y naturales, como chat real. Nunca copies de los ejemplos hechos, personas, días, horarios, tiempos ni anécdotas: pasaron en otra charla y acá no tienen sentido.
6. Sé coherente con lo que ${name} YA dijo en esta conversación (los mensajes "assistant" son tuyos): si dijiste que estabas comiendo, estás comiendo; nunca te contradigas ni cambies la historia.
7. ${leaving ? "La otra persona se está despidiendo: podés despedirte." : 'La otra persona NO dijo que se va a dormir ni que se despide: prohibido despedirte, decir "que descanses", "buenas noches", "andá a dormir" o similares.'}
8. Nunca confirmes planes, citas, horarios ni dinero.
9. No digas que sos una IA ni rompas el personaje; devolvé solo el texto del mensaje, sin comillas ni explicaciones.

Formato de respuesta:
${burstInstruction(burstTarget)}
- Si la otra persona mandó varios mensajes numerados ([1], [2]...), podés empezar un mensaje con su número entre corchetes, por ejemplo "[2] jaja sí", para responderle puntualmente a ese. Hacelo solo cuando aporte (a veces sí, a veces no); el número va únicamente al principio del mensaje.`;
}

const burstInstruction = (n) =>
  n === 1
    ? "- Respondé con UN solo mensaje."
    : n > 1
      ? `- Respondé con hasta ${n} mensajes seguidos, separados por una línea con solo "---". Cada uno tiene que aportar algo y vincularse con el anterior, como en un chat real. Si no tenés nada más que decir, mandá menos: nunca rellenes con mensajes vacíos, despedidas ni frases sueltas.`
      : '- Podés mandar varios mensajes seguidos, separados por una línea con solo "---". Que cada uno aporte algo y se vincule con el anterior, como en un chat real.';

const followUpInstruction = ({ attempt, minutesSilent }) =>
  `[Instrucción interna, no es un mensaje de la otra persona] La otra persona no contestó hace ${minutesSilent} minutos y es tu seguimiento número ${attempt + 1}. Escribí por tu cuenta un mensaje corto y natural para retomar la charla: sin reprochar, sin presionar, sin repetir lo que ya dijiste.`;

const correctionInstruction = (words, name) =>
  `[Corrección interna, no es un mensaje de la otra persona] Tu respuesta usó palabras que ${name} nunca escribe: ${words.map((w) => `"${w}"`).join(", ")}. Reescribila con el mismo sentido usando solo su vocabulario y las formas de los ejemplos.`;

const defaultDeps = {
  getConfig,
  chat,
  random: Math.random,
  load: () => ({
    about: fs.existsSync(ABOUT_FILE) ? fs.readFileSync(ABOUT_FILE, "utf8") : "",
    profile: loadProfile(), corpus: loadCorpus(), lexicon: loadLexicon(), allowlist: allowlist.list(),
  }),
};

/**
 * Genera la respuesta del bot y la controla antes de devolverla.
 * Devuelve { parts: [{text, replyTo}], blocked: string[]|null, notes: string[], flagged: string[] }
 *  - blocked: palabras ajenas que persistieron tras los reintentos (no hay que enviar nada).
 *  - notes: correcciones hechas en el camino (para mostrar en el chat de prueba).
 *  - flagged: palabras ajenas detectadas (aunque se hayan corregido): la UI ofrece agregarlas a las permitidas.
 */
export async function respond(history, { followUp, incomingCount = 0 } = {}, deps = defaultDeps) {
  const cfg = deps.getConfig();
  const data = deps.load();
  const burstTarget = pickBurstSize(cfg.burst, deps.random);
  const name = ownerNameOf(cfg, data.profile);
  const system = buildSystemPrompt({ ...data, name, history, burstTarget, rng: deps.random });
  const base = followUp ? [...history, { role: "user", content: followUpInstruction(followUp) }] : history;
  const guardOn = cfg.guard?.enabled && data.lexicon?.words;
  const allowed = wordSet(data.about, ...(data.allowlist ?? []), ...history.slice(-10).map((m) => stripMarkers(m.content)));
  const notes = [];
  const flagged = new Set(); // todas las palabras ajenas detectadas, para ofrecer "Permitir"

  const leaving = sheIsLeaving(history);
  let messages = base;
  let unknown = [];
  for (let attempt = 0; attempt <= (guardOn ? cfg.guard.maxRetries : 0); attempt++) {
    const out = await deps.chat(cfg.provider, system, messages);
    let parts = out ? parseReply(out, incomingCount) : [];
    // Red de seguridad: aunque el prompt lo prohíbe, un modelo chico a veces se despide sin motivo
    if (!leaving && parts.some((p) => isFarewell(p.text))) {
      notes.push(`Quité despedida fuera de contexto: ${parts.filter((p) => isFarewell(p.text)).map((p) => p.text).join(" / ")}`);
      parts = parts.filter((p) => !isFarewell(p.text));
    }
    parts = limitParts(parts, normalizeBurst(cfg.burst).max);
    if (!parts.length) return { parts: [], blocked: null, notes, flagged: [] };
    unknown = guardOn ? [...new Set(parts.flatMap((p) => unknownWords(p.text, data.lexicon, allowed)))] : [];
    if (!unknown.length) return { parts, blocked: null, notes, flagged: [...flagged] };
    unknown.forEach((w) => flagged.add(w));
    notes.push(`Corregí: ${unknown.join(", ")}`);
    messages = [...base, { role: "assistant", content: out }, { role: "user", content: correctionInstruction(unknown, name) }];
  }
  return { parts: [], blocked: unknown, notes, flagged: [...flagged] };
}
