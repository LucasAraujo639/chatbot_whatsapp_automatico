import { useEffect, useRef } from 'react'
import AllowWords from './AllowWords'

// Presentación pura: lista de burbujas (con cita opcional) + indicador de "escribiendo".
export default function ChatThread({ items, typing, allowed, notify }) {
  const end = useRef(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [items, typing])
  return (
    <div className="chat" role="log" aria-live="polite">
      {items.length === 0 && <p className="hint">Escribí como si fueras el contacto (podés mandar varios mensajes seguidos). El bot te contesta con tu estilo.</p>}
      {items.map((i) => (
        <div key={i.id} className={'bubble ' + i.from}>
          {i.quote && <div className="quote">{i.quote}</div>}
          {i.text}
          {i.words && <AllowWords words={i.words} allowed={allowed} notify={notify} />}
        </div>
      ))}
      {typing && <div className="bubble bot typing">escribiendo…</div>}
      <div ref={end} />
    </div>
  )
}
