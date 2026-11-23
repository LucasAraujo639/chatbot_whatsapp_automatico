export async function api(path, method = 'GET', body) {
  let res
  try {
    res = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    // El navegador solo dice "Failed to fetch": el panel no llega al servidor del bot
    throw new Error('No hay conexión con el servidor del bot (¿está corriendo o se está reiniciando? Probá de nuevo en unos segundos)')
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || (res.status >= 500 && !json.error ? 'El servidor del bot no responde (¿está corriendo?)' : res.statusText))
  return json
}
