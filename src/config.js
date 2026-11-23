import fs from "node:fs";

const FILE = "data/config.json";

export const DEFAULTS = {
  dryRun: true,
  paused: false,
  debounceMinSec: 6,
  debounceMaxSec: 10,
  manualPauseMin: 30,
  ownerNumber: "",
  ownerName: "", // tu nombre: el bot se presenta y habla como esta persona (vacío = el nombre del chat entrenado)
  contacts: [], // { number, name, enabled, paused }
  provider: {
    baseUrl: "https://opencode.ai/inference/openai/v1",
    apiKey: "",
    model: "big-pickle",
    maxTokens: 200,
    temperature: 0.4, // baja: con modelos chicos, más creatividad = más inventos
  },
  // Ritmo de envío: mensajes seguidos por respuesta y segundos "escribiendo…" antes de cada uno (al azar entre min y max).
  burst: { min: 1, max: 3 },
  typing: { minSec: 2, maxSec: 6 },
  // Control de fidelidad: rechaza respuestas con palabras que el dueño nunca usa y las reintenta.
  guard: { enabled: true, maxRetries: 2 },
  // Seguimientos: el bot escribe solo si el contacto deja de contestar. Desactivado por defecto.
  followUp: {
    enabled: false,
    maxAttempts: 2,
    delaysMin: [20, 120, 360], // espera antes de cada intento (el último valor se repite)
    quietHours: { enabled: true, from: "00:00", to: "08:00" },
  },
  // Desconocidos: quien escribe sin estar en Contactos ni en la agenda cae en una bandeja y vos decidís
  // si se le manda UNA respuesta predeterminada (fija, o generada por el asistente de bienvenida).
  unknownInbox: {
    enabled: true,
    mode: "fixed", // "fixed" | "ai"
    fixedText: "Hola! Ahora no puedo contestar, te escribo apenas pueda.",
  },
  sensitiveTopics: [
    { id: "bot", label: "Preguntan si soy un bot", enabled: true, keywords: ["bot", "inteligencia artificial", "chatgpt", "robot", "sos una ia", "eres una ia"] },
    { id: "dinero", label: "Dinero", enabled: true, keywords: ["plata", "transferencia", "prestame", "préstamo", "deuda", "pagar", "cbu", "alias"] },
    { id: "emergencia", label: "Emergencias", enabled: true, keywords: ["emergencia", "hospital", "accidente", "urgente", "policía"] },
    { id: "emocional", label: "Temas emocionales fuertes", enabled: true, keywords: ["te amo", "terminemos", "dejemos", "cortamos", "tenemos que hablar", "embarazada"] },
    { id: "citas", label: "Coordinar encuentros", enabled: true, keywords: ["a qué hora nos vemos", "nos vemos hoy", "nos vemos mañana", "dónde nos vemos"] },
  ],
};

// Merge con un nivel de profundidad para los objetos de config anidados.
function merge(base, patch = {}) {
  return {
    ...base, ...patch,
    provider: { ...base.provider, ...(patch.provider || {}) },
    guard: { ...base.guard, ...(patch.guard || {}) },
    burst: { ...base.burst, ...(patch.burst || {}) },
    typing: { ...base.typing, ...(patch.typing || {}) },
    unknownInbox: { ...base.unknownInbox, ...(patch.unknownInbox || {}) },
    followUp: { ...base.followUp, ...(patch.followUp || {}), quietHours: { ...base.followUp.quietHours, ...(patch.followUp?.quietHours || {}) } },
  };
}

export const DEFAULT_OWNER_NAME = "el dueño de este WhatsApp";
// Nombre con el que el bot se presenta: el de Ajustes, si no el del chat con el que entrenaste, si no uno genérico.
export const ownerNameOf = (cfg, profile = null) => cfg?.ownerName?.trim() || profile?.me?.trim() || DEFAULT_OWNER_NAME;

export function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}
  return merge(DEFAULTS, saved);
}

let current = loadConfig();
export const getConfig = () => current;
export function updateConfig(patch) {
  current = merge(current, patch);
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(current, null, 2));
  return current;
}
