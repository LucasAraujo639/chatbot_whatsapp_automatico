// Asistente de bienvenida para desconocidos. No usa el estilo entrenado con chats exportados:
// se "entrena" con instrucciones propias y reglas "si te dicen X → respondé Y" (ver data/greeter.json).
import fs from "node:fs";
import path from "node:path";
import { chat } from "./llm.js";
import { loadProfile } from "./style.js";
import { getConfig, ownerNameOf, DEFAULT_OWNER_NAME } from "./config.js";

export const GREETER_FILE = "data/greeter.json";
export const MAX_RULES = 40;
const MAX_TEXT = 2000;

const clean = (s, max = MAX_TEXT) => String(s ?? "").trim().slice(0, max);

/** Normaliza lo que llega del panel: descarta reglas vacías y recorta textos. */
export function sanitizeGreeter(raw = {}) {
  const rules = (Array.isArray(raw.rules) ? raw.rules : [])
    .map((r) => ({ when: clean(r?.when, 500), reply: clean(r?.reply, 1000) }))
    .filter((r) => r.when && r.reply)
    .slice(0, MAX_RULES);
  return { instructions: clean(raw.instructions, 4000), rules };
}

export function createGreeterStore(file = GREETER_FILE) {
  return {
    load() { try { return sanitizeGreeter(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { return sanitizeGreeter(); } },
    save(raw) {
      const data = sanitizeGreeter(raw);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      return data;
    },
  };
}

export const greeterStore = createGreeterStore();

// Prompt puro (sin I/O) para poder testearlo.
export function buildGreeterPrompt({ instructions = "", rules = [], name = DEFAULT_OWNER_NAME } = {}) {
  const rulesBlock = rules.length
    ? `\nCómo responder según lo que te digan (si el mensaje se parece a uno de estos, respondé con esa idea y ese tono; podés adaptar las palabras):\n${rules.map((r) => `- Si te dicen: "${r.when}"\n  Respondé: "${r.reply}"`).join("\n")}\n`
    : "";
  return `Sos ${name} respondiendo por WhatsApp a una persona que no tenés agendada y que te escribió por primera vez.
${instructions ? `\nInstrucciones de ${name}:\n${instructions}\n` : ""}${rulesBlock}
REGLAS:
1. Escribí UN solo mensaje corto y natural, en español rioplatense.
2. Respondé a lo que la persona dijo. Si no coincide con ninguna regla, mandá un saludo breve y amable.
3. No inventes datos, precios, horarios ni compromisos que no estén en las instrucciones o reglas.
4. No digas que sos una IA. Devolvé solo el texto del mensaje, sin comillas ni explicaciones.`;
}

// El saludo necesita más margen que una respuesta de chat: los modelos que razonan gastan tokens pensando
// y con un maxTokens chico devuelven el mensaje cortado o vacío.
export const GREETER_MIN_TOKENS = 1024;

const defaultDeps = { getConfig, chat, load: () => greeterStore.load(), profile: loadProfile };

/**
 * Texto que se le mandaría a un desconocido.
 * @param {string[]} texts  Sus últimos mensajes (del más viejo al más nuevo).
 */
export async function draftGreeting(texts, deps = defaultDeps) {
  const cfg = deps.getConfig();
  if (cfg.unknownInbox?.mode !== "ai") return cfg.unknownInbox?.fixedText ?? "";
  return generateGreeting(texts, deps);
}

/** Siempre usa el asistente (lo usa también el botón "Probar"). */
export async function generateGreeting(texts, deps = defaultDeps) {
  const cfg = deps.getConfig();
  const system = buildGreeterPrompt({ ...deps.load(), name: ownerNameOf(cfg, deps.profile?.()) });
  const provider = { ...cfg.provider, maxTokens: Math.max(cfg.provider.maxTokens ?? 0, GREETER_MIN_TOKENS) };
  const out = await deps.chat(provider, system, [{ role: "user", content: texts.join("\n") }]);
  const text = out.replace(/^["“]|["”]$/g, "").trim();
  if (!text) throw new Error("El modelo no devolvió ningún texto (probá con otro modelo o subí el máximo de tokens)");
  return text;
}
