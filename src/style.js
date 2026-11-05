import fs from "node:fs";

// Formatos típicos: "12/03/24, 21:45 - Nombre: texto" o "[12/03/24 21:45:10] Nombre: texto"
const LINE = /^\[?(\d{1,2}\/\d{1,2}\/\d{2,4}),? (\d{1,2}:\d{2})(?::\d{2})?(?:\s?[ap]\.?\s?m\.?)?\]?\s*-?\s*([^:]+?): (.*)$/i;

export function parseExport(path) {
  const msgs = [];
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(LINE);
    if (m) msgs.push({ who: m[3].trim(), text: m[4].trim() });
    else if (msgs.length && line.trim()) msgs[msgs.length - 1].text += "\n" + line.trim();
  }
  return msgs.filter((m) => !/omitted|omitido|<Multimedia|mensaje eliminado/i.test(m.text));
}

// Pares (mensajes de ella -> respuesta de Lucas)
export function buildExamples(msgs, me, max = 40) {
  const pairs = [];
  for (let i = 1; i < msgs.length; i++) {
    if (msgs[i].who === me && msgs[i - 1].who !== me) {
      pairs.push({ her: msgs[i - 1].text, me: msgs[i].text });
    }
  }
  const step = Math.max(1, Math.floor(pairs.length / max));
  return pairs.filter((_, i) => i % step === 0).slice(-max);
}

export function statsOf(msgs, me) {
  const mine = msgs.filter((m) => m.who === me).map((m) => m.text);
  const avg = Math.round(mine.reduce((a, t) => a + t.length, 0) / (mine.length || 1));
  const emoji = {};
  for (const t of mine) for (const e of t.match(/\p{Extended_Pictographic}/gu) ?? []) emoji[e] = (emoji[e] ?? 0) + 1;
  const topEmoji = Object.entries(emoji).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([e]) => e).join(" ");
  const lower = mine.filter((t) => t === t.toLowerCase()).length / (mine.length || 1);
  return { count: mine.length, avgLen: avg, topEmoji, lowercasePct: Math.round(lower * 100) };
}
