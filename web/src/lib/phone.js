// Misma regla que src/phone.js del servidor: E.164 sin "+", 8 a 15 dígitos, sin 0 inicial.
export const cleanNumber = (raw) => raw.replace(/\D/g, '')
export const isValidNumber = (n) => /^[1-9]\d{7,14}$/.test(n)
