import { useState } from 'react'
import ChatThread from '../components/ChatThread'
import { useSimChat } from '../hooks/useSimChat'

export default function Test({ s, notify }) {
  const { items, typing, pausedBy, send, reset, simulateSilence, canSimulateSilence, realTiming, setRealTiming } = useSimChat()
  const [draft, setDraft] = useState('')
  const submit = (e) => {
    e.preventDefault()
    send(draft)
    setDraft('')
  }
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Chat de prueba</h2>
        <div className="row" style={{ margin: 0 }}>
          <button onClick={simulateSilence} disabled={!canSimulateSilence} title="El bot escribe por su cuenta como si ella no hubiera contestado">Simular silencio</button>
          <button onClick={reset} disabled={items.length === 0}>Reiniciar chat</button>
        </div>
      </div>
      <p className="hint">Simulá ser el contacto, sin WhatsApp. Es temporal: no se guarda ni se envía nada, y usa tu modelo, tu estilo y los temas sensibles configurados. Si mandás varios mensajes seguidos, el bot contesta todo junto y puede citar alguno.</p>
      <label className="row" style={{ gap: 8, fontSize: 13 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={realTiming} onChange={(e) => setRealTiming(e.target.checked)} />
        Simular los tiempos de “escribiendo…” configurados en Ajustes
      </label>
      <ChatThread items={items} typing={typing} allowed={s.allowedWords} notify={notify} />
      <form className="row chat-input" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={pausedBy ? 'Chat pausado: reiniciá para seguir probando' : 'Escribí un mensaje…'}
          disabled={!!pausedBy}
          autoFocus
        />
        <button className="primary" disabled={!!pausedBy || !draft.trim()}>Enviar</button>
      </form>
    </div>
  )
}
