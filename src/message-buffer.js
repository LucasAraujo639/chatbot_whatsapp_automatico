// Junta los mensajes seguidos de cada contacto y los entrega todos juntos tras una espera al azar (debounce),
// y respeta la pausa de unos minutos cuando Lucas escribe a mano.
// Todas las dependencias (config, reloj, timers, azar, envío) se inyectan para poder testearlo.
const MINUTE_MS = 60_000;
const RETRY_MARGIN_MS = 1000; // al terminar la pausa manual se reintenta un segundo después

export function createMessageBuffer({
  getConfig,
  canReply,            // (number) => boolean: contacto activo y sin pausas
  deliver,             // async (number, msgs, jid) => void: genera y envía la respuesta
  onWait = () => {},   // (number, waitMs): hay que esperar porque Lucas escribió a mano
  onError = () => {},  // (number, error)
  now = () => Date.now(),
  random = Math.random,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const buffers = new Map(); // number -> { msgs: [{ text, raw }], timer, jid }
  const manualUntil = new Map(); // number -> timestamp hasta el que el bot calla

  const manualWaitMs = (number) => (manualUntil.get(number) || 0) - now();

  function schedule(number, b, delayMs) {
    clearTimer(b.timer);
    b.timer = setTimer(() => flush(number).catch((e) => onError(number, e)), delayMs);
  }

  async function flush(number) {
    const b = buffers.get(number);
    const msgs = b.msgs.splice(0);
    if (!msgs.length || !canReply(number)) return;
    const waitMs = manualWaitMs(number);
    if (waitMs > 0) {
      // No descartar lo que ella escribió: se reintenta cuando termina la pausa
      b.msgs.unshift(...msgs);
      schedule(number, b, waitMs + RETRY_MARGIN_MS);
      return onWait(number, waitMs);
    }
    await deliver(number, msgs, b.jid);
  }

  return {
    // Mensaje de ella: se acumula y reinicia la espera.
    add(number, msg, jid) {
      const b = buffers.get(number) || { msgs: [], timer: null };
      b.msgs.push(msg);
      b.jid = jid;
      const { debounceMinSec: lo, debounceMaxSec: hi } = getConfig();
      schedule(number, b, (lo + random() * Math.max(0, hi - lo)) * 1000);
      buffers.set(number, b);
    },
    // Lucas escribió a mano: el bot calla `manualPauseMin` minutos.
    markManual: (number) => manualUntil.set(number, now() + getConfig().manualPauseMin * MINUTE_MS),
    isManuallyPaused: (number) => manualWaitMs(number) > 0,
  };
}
