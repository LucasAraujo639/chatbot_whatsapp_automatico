// Adaptador de HistoryStore: guarda el historial de todos los contactos en un JSON en disco.
import fs from "node:fs";
import path from "node:path";

export function createJsonHistoryStore(file) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  return {
    get: (number) => (data[number] ||= []),
    set: (number, messages) => { data[number] = messages; },
    save: () => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    },
  };
}
