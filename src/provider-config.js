// Manejo de la API key del proveedor de IA: el panel nunca ve la clave real, solo una versión enmascarada.
// Funciones puras (sin acceso a config ni a disco) para poder testearlas.
const MASK = "••••";

export const maskApiKey = (key) => (key ? MASK + key.slice(-4) : "");
const isMasked = (key) => !key || key.startsWith(MASK);

// Config lista para mandar al panel: igual a la real pero con la clave enmascarada.
export const publicConfig = (cfg) => ({ ...cfg, provider: { ...cfg.provider, apiKey: maskApiKey(cfg.provider.apiKey) } });

// Si el panel reenvía la clave enmascarada, se descarta para no pisar la real al guardar.
export function withoutMaskedKey(patch = {}) {
  if (!patch.provider?.apiKey?.startsWith(MASK)) return patch;
  const { apiKey, ...provider } = patch.provider;
  return { ...patch, provider };
}

// Proveedor a usar para probar conexión/modelos: lo que mandó el panel sobre lo guardado, con la clave real si vino enmascarada o vacía.
export const resolveProvider = (saved, override) => ({
  ...saved,
  ...override,
  apiKey: isMasked(override?.apiKey) ? saved.apiKey : override.apiKey,
});
