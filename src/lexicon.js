// Vocabulario real de Lucas + detección de palabras que él nunca usa (puro, sin I/O).
import { normalize } from "./topics.js";

const TOKEN = /[\p{L}\p{N}]+/gu;
const LAUGH = /^[ah]?(?:j[aeiousk]?)+$/; // jajaja, ajaja, jsjs, jeje… (ya colapsado)
const DIGITS = /^\d+$/;

// Alargues: "amorrr" y "amor" son la misma palabra. Se aplica a ambos lados de la comparación.
export const collapse = (w) => w.replace(/(.)\1+/g, "$1");
export const canonical = (w) => collapse(normalize(w));
const isLaugh = (c) => LAUGH.test(c);

export const tokenize = (text) => text.match(TOKEN) ?? [];

// Conjunto de palabras canónicas de un texto (para permitir lo que ella ya escribió o está en "datos sobre mí").
export const wordSet = (...texts) => new Set(texts.flatMap((t) => tokenize(t).map(canonical)));

export function buildLexicon(messages, { minCount = 2, topN = 150 } = {}) {
  const counts = new Map(); // canónica → { n, forms: Map(raw → n) }
  for (const msg of messages) {
    for (const raw of tokenize(msg)) {
      const c = canonical(raw);
      if (DIGITS.test(c) || isLaugh(c)) continue;
      const e = counts.get(c) ?? { n: 0, forms: new Map() };
      const form = raw.toLowerCase();
      e.n++; e.forms.set(form, (e.forms.get(form) ?? 0) + 1);
      counts.set(c, e);
    }
  }
  const kept = [...counts].filter(([, e]) => e.n >= minCount).sort((a, b) => b[1].n - a[1].n);
  const words = Object.fromEntries(kept.map(([c, e]) => [c, e.n]));
  const top = kept.slice(0, topN).map(([, e]) => [...e.forms].sort((a, b) => b[1] - a[1])[0][0]);
  return { words, top, size: kept.length };
}

// Palabras de `text` que no están en el vocabulario de Lucas, ni en `allowed` (lo que ya se dijo en el hilo).
export function unknownWords(text, lexicon, allowed = new Set()) {
  const bad = new Set();
  for (const raw of tokenize(text)) {
    const c = canonical(raw);
    if (DIGITS.test(c) || isLaugh(c) || c in lexicon.words || allowed.has(c)) continue;
    bad.add(raw.toLowerCase());
  }
  return [...bad];
}
