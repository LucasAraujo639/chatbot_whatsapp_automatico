// Seguimientos: si ella deja de contestar, el bot puede escribir por su cuenta.
// Todas las dependencias (reloj, timers, envío) se inyectan para poder testearlo.
const MIN = 60_000;

const toMinutes = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };

export function isQuietHour(date, quiet) {
  if (!quiet?.enabled) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  const from = toMinutes(quiet.from), to = toMinutes(quiet.to);
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to; // cruza medianoche
}

export function msUntilQuietEnd(date, quiet) {
  const end = new Date(date);
  const to = toMinutes(quiet.to);
  end.setHours(Math.floor(to / 60), to % 60, 0, 0);
  if (end <= date) end.setDate(end.getDate() + 1);
  return end - date;
}

export const delayFor = (followUp, attempt) => followUp.delaysMin[Math.min(attempt, followUp.delaysMin.length - 1)] * MIN;

export function createFollowUpScheduler({
  getConfig,
  canSend,            // (number) => boolean: contacto activo, sin pausas
  send,               // async (number, { attempt, minutesSilent }) => void
  onError = () => {},
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const pending = new Map(); // number -> { attempt, timer, lastBotAt }

  function schedule(number, attempt, lastBotAt, delayMs) {
    const cfg = getConfig().followUp;
    if (!cfg?.enabled || attempt >= cfg.maxAttempts || !cfg.delaysMin?.length) return pending.delete(number);
    const timer = setTimer(() => fire(number), delayMs ?? delayFor(cfg, attempt));
    pending.set(number, { attempt, timer, lastBotAt });
  }

  async function fire(number) {
    const st = pending.get(number);
    const cfg = getConfig().followUp;
    if (!st || !cfg?.enabled) return pending.delete(number);
    const date = new Date(now());
    if (isQuietHour(date, cfg.quietHours)) return schedule(number, st.attempt, st.lastBotAt, msUntilQuietEnd(date, cfg.quietHours));
    if (!canSend(number)) return pending.delete(number);
    try {
      await send(number, { attempt: st.attempt, minutesSilent: Math.round((now() - st.lastBotAt) / MIN) });
    } catch (e) {
      pending.delete(number);
      return onError(number, e);
    }
    if (pending.get(number) === st) schedule(number, st.attempt + 1, now()); // si ella escribió mientras tanto, cancel() ya lo borró
  }

  return {
    arm: (number) => { cancel(number); schedule(number, 0, now()); },
    cancel,
    has: (number) => pending.has(number),
  };

  function cancel(number) {
    const st = pending.get(number);
    if (st) clearTimer(st.timer);
    pending.delete(number);
  }
}
