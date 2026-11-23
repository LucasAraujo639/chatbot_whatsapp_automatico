// Cliente para cualquier API compatible con OpenAI (OpenCode Zen, OpenRouter, Groq, Ollama, etc.)
const trim = (u) => (u ?? "").trim().replace(/\/+$/, "");
const headers = (key) => ({ "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) });
const TIMEOUT_MS = 60_000;

// fetch solo dice "fetch failed": se traduce a algo que explique qué revisar.
const NET_HINTS = {
  ECONNREFUSED: "no hay nada escuchando en esa dirección (¿el servicio está corriendo? Ollama, por ejemplo, tiene que estar abierto)",
  ENOTFOUND: "no existe ese dominio (revisá la URL base)",
  EAI_AGAIN: "no se pudo resolver el dominio (¿hay internet?)",
  ETIMEDOUT: "el servidor no respondió a tiempo",
  ECONNRESET: "el servidor cortó la conexión",
  CERT_HAS_EXPIRED: "el certificado del servidor está vencido",
};
async function request(url, init) {
  if (!/^https?:\/\//i.test(url)) throw new Error(`URL base inválida: "${url}" (tiene que empezar con http:// o https://)`);
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    if (e.name === "TimeoutError") throw new Error(`${url} no respondió en ${TIMEOUT_MS / 1000} segundos`);
    const code = e.cause?.code;
    throw new Error(`No se pudo conectar con ${url}: ${NET_HINTS[code] ?? code ?? e.cause?.message ?? e.message}`);
  }
}

// Los modelos que razonan (DeepSeek, etc.) gastan max_tokens pensando antes de escribir: con un tope
// chico la respuesta llega vacía o cortada (finish_reason "length"). En ese caso se reintenta una vez
// con este margen, y si igual se corta se avisa en vez de mandar medio mensaje.
export const RETRY_MIN_TOKENS = 1024;

async function complete(provider, system, messages, maxTokens) {
  const res = await request(`${trim(provider.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: headers(provider.apiKey),
    body: JSON.stringify({
      model: provider.model,
      max_tokens: maxTokens,
      temperature: provider.temperature,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`LLM ${res.status}: ${body.slice(0, 300)}`);
  const choice = JSON.parse(body).choices?.[0];
  const text = (choice?.message?.content || "").replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();
  return { text, truncated: choice?.finish_reason === "length" };
}

export async function chat(provider, system, messages) {
  const first = await complete(provider, system, messages, provider.maxTokens);
  if (!first.truncated) return first.text;
  const retryTokens = Math.max((provider.maxTokens ?? 0) * 4, RETRY_MIN_TOKENS);
  const second = await complete(provider, system, messages, retryTokens);
  if (!second.truncated) return second.text;
  throw new Error(`La respuesta del modelo se cortó por el límite de tokens (probé con ${retryTokens}); subí el "Largo máximo de respuesta"`);
}

export async function listModels(provider) {
  const res = await request(`${trim(provider.baseUrl)}/models`, { headers: headers(provider.apiKey) });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return (json.data || json.models || []).map((m) => m.id || m.name).filter(Boolean);
}
