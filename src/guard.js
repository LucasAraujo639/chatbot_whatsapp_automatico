import fs from "node:fs";

export const jidNumber = (jid = "") => jid.split("@")[0].split(":")[0];

let paused = false;
export const setPaused = (v) => { paused = v; };
export const isPaused = () => paused || fs.existsSync("PAUSE");

// Temas que NO se responden solos: se pausa y se avisa al dueño.
const SENSITIVE = [
  /\b(bot|ia|inteligencia artificial|chatgpt|robot)\b/i,
  /\b(plata|transfer|prest[aá]|deuda|pagar|cbu|alias)\b/i,
  /\b(emergencia|hospital|accidente|urgente|polic[ií]a)\b/i,
  /\b(embarazad|te amo|terminemos|dejemos|cortamos|ten[eé]mos que hablar)\b/i,
  /\b(a qu[eé] hora nos vemos|nos vemos (hoy|ma[nñ]ana)|d[oó]nde nos vemos)\b/i,
];
export const isSensitive = (text) => SENSITIVE.some((r) => r.test(text));
