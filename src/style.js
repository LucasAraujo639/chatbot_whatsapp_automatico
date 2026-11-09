import fs from "node:fs";
import { buildLexicon } from "./lexicon.js";

const LINE = /^‎?\[?(\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}),? (\d{1,2}:\d{2})(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?\]?\s*-?\s*([^:]+?): (.*)$/i;
const SKIP = /omitted|omitido|<Multimedia|mensaje eliminado|eliminaste este mensaje|image omitted|imagen omitida|you deleted this message|this message was deleted|se elimin[oó] este mensaje|^null$/i;

const EDITED = /\s*<(?:This message was edited|Se edit[oó] este mensaje\.?)>/gi;

export function parseText(raw) {
  const msgs = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(LINE);
    if (m) msgs.push({ who: m[3].trim(), text: m[4].trim() });
    else if (msgs.length && line.trim()) msgs[msgs.length - 1].text += "\n" + line.trim();
  }
  return msgs.map((m) => ({ ...m, text: m.text.replace(/[\u200e\u200f]/g, "").replace(EDITED, "").trim() })).filter((m) => m.text && !SKIP.test(m.text));
}

export function participants(msgs) {
  const c = {};
  for (const m of msgs) c[m.who] = (c[m.who] || 0) + 1;
  return Object.entries(c).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export function buildExamples(msgs, me, max = 40) {
  const pairs = [];
  for (let i = 1; i < msgs.length; i++) {
    if (msgs[i].who === me && msgs[i - 1].who !== me) pairs.push({ her: msgs[i - 1].text, me: msgs[i].text });
  }
  const step = Math.max(1, Math.floor(pairs.length / max));
  return pairs.filter((_, i) => i % step === 0).slice(-max);
}

export function statsOf(msgs, me) {
  const mine = msgs.filter((m) => m.who === me).map((m) => m.text);
  const avgLen = Math.round(mine.reduce((a, t) => a + t.length, 0) / (mine.length || 1));
  const emoji = {};
  for (const t of mine) for (const e of t.match(/\p{Extended_Pictographic}/gu) ?? []) emoji[e] = (emoji[e] ?? 0) + 1;
  const topEmoji = Object.entries(emoji).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([e]) => e).join(" ");
  const lowercasePct = Math.round((mine.filter((t) => t === t.toLowerCase()).length / (mine.length || 1)) * 100);
  return { count: mine.length, avgLen, topEmoji, lowercasePct };
}

// Agrupa mensajes seguidos del mismo autor en "tandas" y arma pares (últimos mensajes de ella → toda tu tanda).
export function buildCorpus(msgs, me, { herContext = 3, maxMine = 5 } = {}) {
  const turns = [];
  for (const m of msgs) {
    const last = turns.at(-1);
    if (last?.mine === (m.who === me)) last.texts.push(m.text);
    else turns.push({ mine: m.who === me, texts: [m.text] });
  }
  const pairs = [];
  for (let i = 1; i < turns.length; i++) {
    if (turns[i].mine && !turns[i - 1].mine) pairs.push({ her: turns[i - 1].texts.slice(-herContext), me: turns[i].texts.slice(0, maxMine) });
  }
  return pairs;
}

const PROFILE = "data/style-profile.json";
const CORPUS = "data/style-corpus.json";
const LEXICON = "data/style-lexicon.json";

// Lee un JSON y lo cachea hasta que cambie el archivo (se consulta en cada respuesta).
const cache = new Map();
function readJson(file) {
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (cache.get(file)?.mtime !== mtime) cache.set(file, { mtime, data: JSON.parse(fs.readFileSync(file, "utf8")) });
    return cache.get(file).data;
  } catch { return null; }
}
const writeJson = (file, data, indent) => { fs.mkdirSync("data", { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, indent)); };

export function saveProfile(msgs, me, lastN = 10000) {
  // Solo los mensajes más recientes: el estilo viejo ya no es cómo habla hoy
  const recent = msgs.slice(-Math.max(1, Number(lastN) || 10000));
  const corpus = buildCorpus(recent, me);
  const lexicon = buildLexicon(recent.filter((m) => m.who === me).map((m) => m.text));
  const profile = { me, usedMessages: recent.length, stats: statsOf(recent, me), examples: buildExamples(recent, me), pairs: corpus.length, vocabulary: lexicon.size };
  writeJson(CORPUS, corpus);
  writeJson(LEXICON, lexicon);
  writeJson(PROFILE, profile, 2);
  return profile;
}
export const loadProfile = () => readJson(PROFILE);
export const loadCorpus = () => readJson(CORPUS);
export const loadLexicon = () => readJson(LEXICON);
