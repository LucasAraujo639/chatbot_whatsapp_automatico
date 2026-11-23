// Composition root del bot: conecta el núcleo de la conversación con sus adaptadores
// (WhatsApp, historial en disco, modelo) y expone el estado que muestra el panel.
// Para sumar otra plataforma: crear su adaptador en src/adapters/ y que llame a `conversation.receive`.
import { EventEmitter } from "node:events";
import { getConfig, updateConfig } from "./config.js";
import { respond } from "./responder.js";
import { createConversationService } from "./conversation.js";
import { createJsonHistoryStore } from "./adapters/history-file.js";
import { createWhatsAppAdapter, NotConnectedError } from "./adapters/whatsapp.js";
import { createUnknownInbox } from "./unknown-inbox.js";
import { createUnknownService } from "./unknown-service.js";
import { draftGreeting } from "./greeter.js";

const HISTORY_FILE = "data/history.json";
const UNKNOWN_FILE = "data/unknown-inbox.json";
const LOG_LIMIT = 100; // entradas que se guardan en el log del panel

export const events = new EventEmitter();
export const state = { connection: "closed", qr: null, log: [] };

function log(kind, text, contact, words) {
  const entry = { t: Date.now(), kind, text, contact, ...(words?.length && { words }) };
  state.log = [...state.log.slice(-(LOG_LIMIT - 1)), entry];
  events.emit("update");
}

const whatsapp = createWhatsAppAdapter({
  log,
  onConnection: (connection, qr) => { state.connection = connection; state.qr = qr; events.emit("update"); },
  onMessage: (msg) => conversation.receive(msg),
});

const unknown = createUnknownService({
  getConfig,
  inbox: createUnknownInbox(UNKNOWN_FILE),
  messenger: whatsapp.messenger,
  draft: (texts) => draftGreeting(texts),
  isInAddressBook: whatsapp.isInAddressBook,
  saveToAddressBook: whatsapp.saveToAddressBook,
  log,
  onChange: () => events.emit("update"),
});

const conversation = createConversationService({
  getConfig,
  updateConfig,
  history: createJsonHistoryStore(HISTORY_FILE),
  messenger: whatsapp.messenger,
  respond,
  log,
  onUnknown: unknown.receive,
  onChange: () => events.emit("update"),
});

export const startBot = () => whatsapp.start();
export const logoutBot = () => whatsapp.logout();
export const reconnectBot = () => whatsapp.reconnect();
export const stopBot = () => whatsapp.stop();
export const verifyNumber = (number) => whatsapp.verifyNumber(number);
export const setContactPaused = (number, paused) => conversation.setContactPaused(number, paused);
export const unknownInbox = unknown;
export { NotConnectedError };
