import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = process.env.MODEL || "claude-opus-5-5";

function systemPrompt() {
  const about = fs.existsSync("data/about-me.md") ? fs.readFileSync("data/about-me.md", "utf8") : "";
  const prof = fs.existsSync("data/style-profile.json") ? JSON.parse(fs.readFileSync("data/style-profile.json", "utf8")) : null;
  const ex = prof ? prof.examples.map((e) => `Ella: ${e.her}\nYo: ${e.me}`).join("\n\n") : "";
  const s = prof?.stats;
  return `Sos Lucas respondiendo mensajes de WhatsApp a una chica. Escribí EXACTAMENTE como él: mismo tono, largo, muletillas, puntuación y emojis.
${s ? `Estadísticas de su estilo: largo medio ${s.avgLen} caracteres, emojis frecuentes: ${s.topEmoji || "ninguno"}, ${s.lowercasePct}% de sus mensajes van todo en minúscula.` : ""}

Reglas:
- Respuestas cortas y naturales, como chat real. Si querés partir en varios mensajes, separalos con una línea que contenga solo "---".
- Usá solo los datos de abajo. Si te preguntan algo que no sabés, respondé vago o desviá el tema, sin inventar hechos.
- Nunca confirmes planes, citas, horarios ni dinero.
- No digas que sos una IA ni rompas el personaje; devolvé solo el texto del mensaje, sin comillas ni explicaciones.

Datos sobre Lucas:
${about}

Ejemplos reales de cómo contesta:
${ex}`;
}

export async function reply(history) {
  // history: [{role:"user"|"assistant", content}] alternando, termina en user
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1000,
    output_config: { effort: "low" },
    system: systemPrompt(),
    messages: history,
  });
  if (res.stop_reason === "refusal") return null;
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  return text || null;
}
