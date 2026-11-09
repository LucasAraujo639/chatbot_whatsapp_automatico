import fs from "node:fs";

const FILE = "data/config.json";

export const DEFAULTS = {
  dryRun: true,
  paused: false,
  debounceMinSec: 6,
  debounceMaxSec: 10,
  manualPauseMin: 30,
  ownerNumber: "",
  timezone: "America/Argentina/Buenos_Aires", // zona horaria IANA para saludar y hablar acorde a la hora
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
  // Control de fidelidad: rechaza respuestas con palabras que Lucas nunca usa y las reintenta.
  guard: { enabled: true, maxRetries: 2 },
  // Seguimientos: el bot escribe solo si ella deja de contestar. Desactivado por defecto.
  followUp: {
    enabled: false,
    maxAttempts: 2,
    delaysMin: [20, 120, 360], // espera antes de cada intento (el último valor se repite)
    quietHours: { enabled: true, from: "00:00", to: "08:00" },
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
    followUp: { ...base.followUp, ...(patch.followUp || {}), quietHours: { ...base.followUp.quietHours, ...(patch.followUp?.quietHours || {}) } },
  };
}

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
