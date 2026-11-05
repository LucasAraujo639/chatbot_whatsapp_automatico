import fs from "node:fs";
import { parseExport, buildExamples, statsOf } from "../src/style.js";

const [file = "data/chat-export.txt", me] = process.argv.slice(2);
if (!me) { console.error("Uso: node scripts/build-style.js <export.txt> <TuNombreEnWhatsApp>"); process.exit(1); }
const msgs = parseExport(file);
const stats = statsOf(msgs, me);
const examples = buildExamples(msgs, me);
fs.writeFileSync("data/style-profile.json", JSON.stringify({ me, stats, examples }, null, 2));
console.log(`Mensajes tuyos: ${stats.count}, largo medio: ${stats.avgLen}, emojis: ${stats.topEmoji}, ejemplos: ${examples.length}`);
