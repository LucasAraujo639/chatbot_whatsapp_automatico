// Detecta frases que solo tienen sentido en una charla puntual (días, tiempos, terceras personas, temas personales).
// Se usa para no mostrarle al modelo esos ejemplos: copiaría su contenido, no solo el estilo.
import { normalize } from "./topics.js";

// Cada regla trabaja sobre el texto normalizado (sin tildes, en minúscula).
const RULES = [
  // Días, feriados y fechas del calendario
  /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|finde|fin de semana|feriados?|vacaciones)\b/,
  // Referencias temporales relativas ("hasta mañana" es una despedida genérica)
  /\b(hoy|ayer|anoche|anteayer|temprano|el otro dia|todos los dias|la semana que viene)\b|(?<!hasta )\bmanana\b/,
  // Cualquier número (horas, minutos, cantidades, fechas)
  /\d/,
  // Unidades de tiempo ("buen día" / "buenos días" son saludos)
  /\b(minutos?|horas?|semanas?|mes|meses|anos?)\b|(?<!\bbuen |\bbuenos )\bdias?\b/,
  // Terceras personas y anécdotas
  /\b(trabaja|viene|vino|dijo|hizo|sigue buscando|me sigue)\b/,
  /\b(mi|tu|su) (mama|papa|vieja|viejo|hermanos?|hermanas?|ex|amig[oa]s?|jefe|abuel[oa]s?|prim[oa]s?|ti[oa]s?|novi[oa])\b|\bel papa\b/,
  // Referencias a algo dicho antes ("por lo del…", "solo para eso")
  /\b(lo del|para eso)\b/,
  // Temas personales o delicados
  /\b(zorras?|pegar|pego|pegarle|besaste|beso a|una cuenta)\b/,
];

export function isContextual(text) {
  const n = normalize(text ?? "");
  return RULES.some((re) => re.test(n));
}
