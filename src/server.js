import "dotenv/config";
import fs from "node:fs";
import express from "express";
import { getConfig, updateConfig } from "./config.js";
import { startBot, logoutBot, state, events, setContactPaused } from "./bot.js";
import { parseText, participants, saveProfile, loadProfile } from "./style.js";
import { chat, listModels } from "./llm.js";
import { ABOUT_FILE } from "./responder.js";
import simulateRouter from "./routes/simulate.js";
import contactsRouter from "./routes/contacts.js";
import { createVocabularyRouter } from "./routes/vocabulary.js";
import { allowlist } from "./allowlist.js";
import { publicConfig, withoutMaskedKey, resolveProvider } from "./provider-config.js";

const app = express();
app.use(express.json({ limit: "20mb" }));

const publicCfg = () => publicConfig(getConfig());
const snapshot = () => ({ connection: state.connection, qr: state.qr, log: state.log, config: publicCfg(), allowedWords: allowlist.list(), profile: (({ me, stats, pairs, vocabulary }) => ({ me, stats, pairs, vocabulary }))(loadProfile() || {}) });

app.get("/api/state", (_, res) => res.json(snapshot()));
app.get("/api/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = () => res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
  send();
  events.on("update", send);
  req.on("close", () => events.off("update", send));
});

app.put("/api/config", (req, res) => {
  updateConfig(withoutMaskedKey(req.body));
  events.emit("update");
  res.json(publicCfg());
});
app.post("/api/contacts/:number/paused", (req, res) => { setContactPaused(req.params.number, !!req.body.paused); res.json({ ok: true }); });
app.post("/api/logout", async (_, res) => { await logoutBot(); res.json({ ok: true }); });

app.post("/api/style/participants", (req, res) => res.json(participants(parseText(req.body.text || ""))));
app.post("/api/style/import", (req, res) => {
  const msgs = parseText(req.body.text || "");
  if (!msgs.some((m) => m.who === req.body.me)) return res.status(400).json({ error: "No encontré mensajes de esa persona" });
  saveProfile(msgs, req.body.me, req.body.lastN);
  events.emit("update");
  res.json({ ok: true });
});
app.get("/api/about", (_, res) => res.json({ text: fs.existsSync(ABOUT_FILE) ? fs.readFileSync(ABOUT_FILE, "utf8") : "" }));
app.put("/api/about", (req, res) => { fs.mkdirSync("data", { recursive: true }); fs.writeFileSync(ABOUT_FILE, req.body.text || ""); res.json({ ok: true }); });

const realProvider = (override) => resolveProvider(getConfig().provider, override);
app.post("/api/llm/models", async (req, res) => {
  try { res.json({ models: await listModels(realProvider(req.body)) }); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post("/api/llm/test", async (req, res) => {
  try { res.json({ reply: await chat(realProvider(req.body),"Respondé en una sola frase corta.", [{ role: "user", content: "Decime hola." }]) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.use("/api/simulate", simulateRouter);
app.use("/api/contacts", contactsRouter);
app.use("/api/vocabulary", createVocabularyRouter({ onChange: () => events.emit("update") }));

app.use(express.static("web/dist"));
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Panel API en http://localhost:${PORT}`));
startBot().catch((e) => console.error(e));
