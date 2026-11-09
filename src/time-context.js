// Contexto horario: le dice al modelo qué hora es y corrige saludos que no corresponden a esa hora.
export const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// Franjas (hora local, 0-23) en las que cada saludo es natural. Fuera de ellas se considera un error.
const GREETINGS = [
  { id: "dia", label: "buen día", re: /\bbuen(?:os)?\s+d[ií]as?\b/i, hours: (h) => h >= 5 && h < 14 },
  { id: "tarde", label: "buenas tardes", re: /\bbuenas\s+tardes?\b/i, hours: (h) => h >= 12 && h < 21 },
  { id: "noche", label: "buenas noches", re: /\bbuenas\s+noches?\b/i, hours: (h) => h >= 19 || h < 6 },
];

function validTimezone(tz) {
  try { new Intl.DateTimeFormat("es-AR", { timeZone: tz }); return tz; } catch { return DEFAULT_TIMEZONE; }
}

// Hora local {hour, minute, weekday} para un instante (ms) y una zona horaria IANA.
export function localTime(nowMs, timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: validTimezone(timezone), hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { hour: Number(get("hour")), minute: Number(get("minute")), weekday };
}

export function dayPart(hour) {
  if (hour < 6) return "madrugada";
  if (hour < 12) return "mañana";
  if (hour < 14) return "mediodía";
  if (hour < 20) return "tarde";
  return "noche";
}

const pad = (n) => String(n).padStart(2, "0");

// Bloque para el system prompt.
export function timeBlock(nowMs, timezone) {
  const { hour, minute, weekday } = localTime(nowMs, timezone);
  const part = dayPart(hour);
  const sleeping = part === "madrugada" ? " Es de madrugada: no digas que salís, vas a la facultad o al trabajo, ni nada que no se haga a esa hora." : "";
  return `Ahora son las ${pad(hour)}:${pad(minute)} (${part}) del ${DAY_NAMES[weekday]}. Saludá y hablá acorde a esta hora: no digas "buen día" si no es de mañana ni "buenas noches" si no es de noche, y no menciones actividades que no corresponden a esta hora.${sleeping}`;
}

// Devuelve el saludo que no corresponde a la hora (ej. "buenas noches" a las 12), o null si está bien.
export function wrongGreeting(text, hour) {
  const bad = GREETINGS.find((g) => g.re.test(text) && !g.hours(hour));
  return bad ? bad.label : null;
}

// Saludo correcto para una hora (el más natural de la franja).
export function greetingFor(hour) {
  if (hour >= 5 && hour < 12) return "buen día";
  if (hour >= 12 && hour < 20) return "buenas tardes";
  return "buenas noches";
}

// Reemplaza los saludos que no corresponden a la hora por el correcto (último recurso tras los reintentos).
export function fixGreetings(text, hour) {
  const right = greetingFor(hour);
  return GREETINGS.reduce((t, g) => (g.re.test(t) && !g.hours(hour) ? t.replace(new RegExp(g.re.source, "gi"), right) : t), text);
}
