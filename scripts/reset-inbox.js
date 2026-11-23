// Vacía la bandeja de desconocidos para volver a probar desde cero. No toca la sesión de WhatsApp (auth/),
// ni la configuración, ni el historial con tus contactos. Correrlo con el bot APAGADO: si está prendido,
// tiene la bandeja en memoria y la vuelve a escribir con el próximo mensaje.
import fs from "node:fs";
import net from "node:net";

const FILE = "data/unknown-inbox.json";
const PORT = Number(process.env.PORT || 3001);

const inUse = await new Promise((resolve) => {
  const s = net.connect(PORT, "127.0.0.1", () => { s.end(); resolve(true); });
  s.on("error", () => resolve(false));
});
if (inUse) {
  console.error(`El bot está corriendo (puerto ${PORT} ocupado). Cortalo con Ctrl+C y volvé a correr esto.`);
  process.exit(1);
}

if (fs.existsSync(FILE)) { fs.rmSync(FILE); console.log("Bandeja de desconocidos vaciada."); }
else console.log("La bandeja ya estaba vacía.");
