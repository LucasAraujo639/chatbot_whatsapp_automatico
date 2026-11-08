// Utilidades puras para números de teléfono y JIDs de WhatsApp.
export const PHONE_JID = "@s.whatsapp.net";

export const numberOf = (jid = "") => jid.split("@")[0].split(":")[0];
export const toPhoneJid = (n) => `${n}${PHONE_JID}`;

// Formato E.164 sin "+": 8 a 15 dígitos, sin 0 inicial.
export const isValidNumber = (n) => /^[1-9]\d{7,14}$/.test(n);

// Algunos países tienen dos formas del mismo móvil (con/sin prefijo de móvil):
// Argentina 549… ↔ 54…, México 521… ↔ 52…
export function numberVariants(n) {
  const v = new Set([n]);
  if (/^549\d{10}$/.test(n)) v.add("54" + n.slice(3));
  if (/^54(?!9)\d{10}$/.test(n)) v.add("549" + n.slice(2));
  if (/^521\d{10}$/.test(n)) v.add("52" + n.slice(3));
  if (/^52(?!1)\d{10}$/.test(n)) v.add("521" + n.slice(2));
  return [...v];
}

// Números de teléfono presentes en una lista de JIDs (ignora los @lid, que son IDs internos y no teléfonos).
export const phoneNumbersOf = (jids) =>
  jids.filter((j) => j?.endsWith(PHONE_JID)).map(numberOf);

export function findContact(contacts, phoneNumbers) {
  const wanted = new Set(phoneNumbers.flatMap(numberVariants));
  return contacts.find((c) => numberVariants(c.number).some((v) => wanted.has(v)));
}
