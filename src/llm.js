// Cliente para cualquier API compatible con OpenAI (OpenCode Zen, OpenRouter, Groq, Ollama, etc.)
const trim = (u) => u.replace(/\/+$/, "");
const headers = (key) => ({ "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) });

export async function chat(provider, system, messages) {
  const res = await fetch(`${trim(provider.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: headers(provider.apiKey),
    body: JSON.stringify({
      model: provider.model,
      max_tokens: provider.maxTokens,
      temperature: provider.temperature,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`LLM ${res.status}: ${body.slice(0, 300)}`);
  const text = JSON.parse(body).choices?.[0]?.message?.content;
  return (text || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export async function listModels(provider) {
  const res = await fetch(`${trim(provider.baseUrl)}/models`, { headers: headers(provider.apiKey) });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return (json.data || json.models || []).map((m) => m.id || m.name).filter(Boolean);
}
