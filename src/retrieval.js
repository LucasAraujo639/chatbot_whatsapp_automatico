// Busca en tu corpus los pares (ella → vos) más parecidos al mensaje actual. BM25 simplificado, sin dependencias.
import { normalize } from "./topics.js";
import { tokenize, collapse } from "./lexicon.js";
import { isContextual } from "./context-filter.js";

const STOP = new Set("de la que el en y a los se del las un por con no una su para es al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos uno les ni contra otros ese eso ante e esto mi antes yo otro otra tanto esa mucho nada poco ella algo te tu vos sos soy estoy".split(" "));

const terms = (text) => [...new Set(tokenize(normalize(text)).map(collapse).filter((t) => t.length > 2 && !STOP.has(t)))];

const indexes = new WeakMap();
function indexOf(corpus) {
  if (!indexes.has(corpus)) {
    const docs = corpus.map((p) => terms(p.her.join(" ")));
    const df = new Map();
    for (const d of docs) for (const t of d) df.set(t, (df.get(t) ?? 0) + 1);
    // Respuestas que solo tienen sentido en su charla original: no se muestran como ejemplo.
    const contextual = new Set(corpus.flatMap((p, i) => (isContextual(p.me.join("\n")) ? [i] : [])));
    indexes.set(corpus, { docs, df, contextual });
  }
  return indexes.get(corpus);
}

export function retrieveExamples(corpus, text, { k = 8, exclude = new Set() } = {}) {
  if (!corpus?.length) return [];
  const { docs, df, contextual } = indexOf(corpus);
  const skip = (i) => exclude.has(i) || contextual.has(i);
  const query = terms(text);
  const N = corpus.length;
  const scored = [];
  docs.forEach((doc, i) => {
    if (skip(i) || !doc.length) return;
    let score = 0;
    for (const t of query) if (doc.includes(t)) score += Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
    if (score > 0) scored.push({ i, score: (score / Math.sqrt(doc.length)) * (1 + 0.1 * (i / N)) }); // leve sesgo a lo reciente
  });
  const picked = scored.sort((a, b) => b.score - a.score).slice(0, k).map((s) => s.i);
  // Si hay pocos parecidos (ej. "jajaja"), completa con una muestra repartida para que igual vea tu estilo
  const stride = Math.max(1, Math.floor(N / k));
  for (let i = N - 1; picked.length < Math.min(k, 4) && i >= 0; i -= stride) if (!picked.includes(i) && !skip(i)) picked.push(i);
  return picked.map((i) => ({ index: i, ...corpus[i] }));
}
