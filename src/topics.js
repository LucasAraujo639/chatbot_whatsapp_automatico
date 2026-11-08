// Detección de temas sensibles (puro, sin dependencias de config ni de WhatsApp).
export const normalize = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function findSensitiveTopic(text, topics) {
  const n = normalize(text);
  return topics.find((t) => t.enabled && t.keywords.some((k) => k.trim() && n.includes(normalize(k))));
}
