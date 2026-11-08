import { api } from '../api'

// Botones "Permitir" para las palabras que el control de vocabulario detectó como ajenas.
// `allowed` viene del estado en vivo del servidor, así que el botón desaparece apenas se aprueba.
export default function AllowWords({ words = [], allowed = [], notify }) {
  const pending = words.filter((w) => !allowed.includes(w))
  if (!pending.length) return null
  const allow = (w) =>
    api('/vocabulary/allowed', 'POST', { word: w })
      .then(() => notify(`“${w}” agregada: la próxima vez la puede usar`))
      .catch((e) => notify('Error: ' + e.message))
  return (
    <span className="allow">
      {pending.map((w) => (
        <button key={w} onClick={() => allow(w)} title="Agregar a tu vocabulario">+ Permitir “{w}”</button>
      ))}
    </span>
  )
}
