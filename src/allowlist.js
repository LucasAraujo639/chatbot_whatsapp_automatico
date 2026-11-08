// Palabras que Lucas aprobó a mano ("sí, esta la uso"). Viven aparte del corpus entrenado
// para no perderse al reimportar el chat. `createAllowlist(file)` permite testearlo sin tocar data/.
import fs from "node:fs";
import path from "node:path";
import { tokenize } from "./lexicon.js";

export const MAX_WORD_LENGTH = 40;

// Una sola palabra (letras/números); devuelve null si no es válida.
export function normalizeWord(raw) {
  const tokens = tokenize(String(raw ?? "").trim());
  const word = tokens.length === 1 ? tokens[0].toLowerCase() : null;
  return word && word.length <= MAX_WORD_LENGTH ? word : null;
}

export function createAllowlist(file) {
  const read = () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return []; } };
  const write = (list) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(list, null, 2)); return list; };
  return {
    list: read,
    add(raw) {
      const word = normalizeWord(raw);
      if (!word) return null;
      const list = read();
      return list.includes(word) ? list : write([...list, word].sort());
    },
    remove(raw) {
      const word = normalizeWord(raw);
      return write(read().filter((w) => w !== word));
    },
  };
}

export const allowlist = createAllowlist("data/style-allowlist.json");
