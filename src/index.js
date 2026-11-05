import "dotenv/config";
import fs from "node:fs";
import qrcode from "qrcode-terminal";
import pino from "pino";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import { reply } from "./responder.js";
import { jidNumber, isPaused, setPaused, isSensitive } from "./guard.js";

const TARGET = process.env.TARGET_NUMBER;
const OWNER = process.env.OWNER_NUMBER;
const DRY = process.env.DRY_RUN !== "0";
if (!TARGET) { console.error("Falta TARGET_NUMBER en .env"); process.exit(1); }

const HISTORY_FILE = "data/history.json";
let history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) : [];
const save = () => fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-60), null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let buffer = [], timer = null, manualUntil = 0;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state, logger: pino({ level: "silent" }) });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === "open") console.log(`Conectado. DRY_RUN=${DRY ? "ON (no envía)" : "OFF (envía de verdad)"}`);
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) start(); else console.log("Sesión cerrada. Borrá la carpeta auth/ y volvé a escanear.");
    }
  });

  const notifyOwner = (t) => OWNER && sock.sendMessage(`${OWNER}@s.whatsapp.net`, { text: `🤖 ${t}` });

  async function flush(jid) {
    const texts = buffer.splice(0);
    if (!texts.length || isPaused() || Date.now() < manualUntil) return;
    const joined = texts.join("\n");
    if (isSensitive(joined)) {
      setPaused(true);
      history.push({ role: "user", content: joined }); save();
      console.log("Tema sensible, bot pausado:", joined);
      await notifyOwner(`Pausé el bot: ella escribió algo sensible:\n"${joined}"\nRespondé vos y mandá /seguir cuando quieras reactivarlo.`);
      return;
    }
    history.push({ role: "user", content: joined });
    const out = await reply(history.slice(-30));
    if (!out) { await notifyOwner("La IA no pudo responder, mirá el chat."); return; }
    history.push({ role: "assistant", content: out }); save();
    for (const part of out.split(/\n---\n/)) {
      const msg = part.trim();
      if (!msg) continue;
      if (DRY) { console.log("[DRY_RUN] respondería:", msg); continue; }
      await sock.presenceSubscribe(jid);
      await sock.sendPresenceUpdate("composing", jid);
      await sleep(Math.min(12000, 1500 + msg.length * 90 + Math.random() * 2000));
      await sock.sendMessage(jid, { text: msg });
      await sock.sendPresenceUpdate("paused", jid);
    }
  }

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      const jid = m.key.remoteJid;
      if (!jid || jid.endsWith("@g.us")) continue;
      const text = m.message?.conversation || m.message?.extendedTextMessage?.text;
      if (!text) continue;
      const num = jidNumber(jid);
      if (m.key.fromMe) {
        // Comandos desde tu propio chat
        if (OWNER && num === OWNER) {
          if (text.trim() === "/pausa") { setPaused(true); notifyOwner("Pausado."); }
          if (text.trim() === "/seguir") { setPaused(false); fs.rmSync("PAUSE", { force: true }); notifyOwner("Reactivado."); }
        } else if (num === TARGET && !m.key.id?.startsWith("3EB0")) {
          manualUntil = Date.now() + 30 * 60 * 1000; // si escribís vos, el bot calla 30 min
        }
        continue;
      }
      if (num !== TARGET) continue;
      buffer.push(text);
      clearTimeout(timer);
      timer = setTimeout(() => flush(jid).catch((e) => console.error(e)), 6000 + Math.random() * 4000);
    }
  });
}
start();
