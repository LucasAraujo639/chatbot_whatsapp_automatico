import { useState } from 'react'
import { api } from '../api'

export default function Settings({ s, save, notify }) {
  const c = s.config
  const [t, setT] = useState({ debounceMinSec: c.debounceMinSec, debounceMaxSec: c.debounceMaxSec, manualPauseMin: c.manualPauseMin, ownerNumber: c.ownerNumber, timezone: c.timezone })
  const [f, setF] = useState({ ...c.followUp, delaysText: c.followUp.delaysMin.join(', ') })
  const saveFollowUp = () => {
    const delaysMin = f.delaysText.split(',').map((x) => Number(x.trim())).filter((x) => x > 0)
    if (!delaysMin.length) return notify('Poné al menos una espera en minutos (ej: 20, 120)')
    save({ followUp: { enabled: f.enabled, maxAttempts: f.maxAttempts, delaysMin, quietHours: f.quietHours } })
  }
  const [pace, setPace] = useState({ burst: { ...c.burst }, typing: { ...c.typing } })
  const setBurst = (k, v) => setPace({ ...pace, burst: { ...pace.burst, [k]: Number(v) } })
  const setTyping = (k, v) => setPace({ ...pace, typing: { ...pace.typing, [k]: Number(v) } })
  const savePace = () => {
    const { burst, typing } = pace
    if (!(burst.min >= 1 && burst.max >= burst.min && burst.max <= 8)) return notify('Mensajes seguidos: el mínimo debe ser ≥ 1 y no mayor que el máximo (hasta 8)')
    if (!(typing.minSec >= 0 && typing.maxSec >= typing.minSec && typing.maxSec <= 120)) return notify('Tiempo escribiendo: el mínimo no puede ser mayor que el máximo (hasta 120 seg)')
    save(pace)
  }
  const topics = c.sensitiveTopics
  const setTopics = (list) => save({ sensitiveTopics: list })
  const [newTopic, setNewTopic] = useState('')

  const addKeyword = (id, kw) => kw.trim() && setTopics(topics.map((x) => (x.id === id ? { ...x, keywords: [...x.keywords, kw.trim()] } : x)))
  const delKeyword = (id, kw) => setTopics(topics.map((x) => (x.id === id ? { ...x, keywords: x.keywords.filter((k) => k !== kw) } : x)))

  return (
    <>
      <div className="card">
        <h2>Tiempos</h2>
        <p className="hint">Cuando ella manda varios mensajes seguidos, el bot espera un tiempo al azar entre el mínimo y el máximo antes de contestar todo junto.</p>
        <div className="row">
          <label className="f">Espera mínima (seg)<input type="number" min="1" value={t.debounceMinSec} onChange={(e) => setT({ ...t, debounceMinSec: Number(e.target.value) })} /></label>
          <label className="f">Espera máxima (seg)<input type="number" min="1" value={t.debounceMaxSec} onChange={(e) => setT({ ...t, debounceMaxSec: Number(e.target.value) })} /></label>
          <label className="f">Silencio si escribís vos (min)<input type="number" min="0" value={t.manualPauseMin} onChange={(e) => setT({ ...t, manualPauseMin: Number(e.target.value) })} /></label>
        </div>
        <div className="row">
          <label className="f">Tu número (para recibir avisos por WhatsApp, opcional)<input value={t.ownerNumber} onChange={(e) => setT({ ...t, ownerNumber: e.target.value.replace(/\D/g, '') })} /></label>
        </div>
        <div className="row">
          <label className="f">Zona horaria (para saludar según la hora, ej: America/Argentina/Buenos_Aires)<input value={t.timezone} onChange={(e) => setT({ ...t, timezone: e.target.value })} /></label>
        </div>
        <button className="primary" onClick={() => save(t)}>Guardar</button>
      </div>

      <div className="card">
        <h2>Mensajes seguidos y ritmo de escritura</h2>
        <p className="hint">Cada respuesta tiene entre el mínimo y el máximo de mensajes seguidos (se sortea cada vez). Antes de cada mensaje el bot aparece “escribiendo…” un tiempo al azar entre el mínimo y el máximo de segundos.</p>
        <div className="row">
          <label className="f">Mensajes seguidos: mínimo<input type="number" min="1" max="8" value={pace.burst.min} onChange={(e) => setBurst('min', e.target.value)} /></label>
          <label className="f">Mensajes seguidos: máximo<input type="number" min="1" max="8" value={pace.burst.max} onChange={(e) => setBurst('max', e.target.value)} /></label>
        </div>
        <div className="row">
          <label className="f">Escribiendo antes de cada mensaje: mínimo (seg)<input type="number" min="0" max="120" step="0.5" value={pace.typing.minSec} onChange={(e) => setTyping('minSec', e.target.value)} /></label>
          <label className="f">Escribiendo antes de cada mensaje: máximo (seg)<input type="number" min="0" max="120" step="0.5" value={pace.typing.maxSec} onChange={(e) => setTyping('maxSec', e.target.value)} /></label>
        </div>
        <button className="primary" onClick={savePace}>Guardar ritmo</button>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Seguimientos</h2>
          <label className="switch" title="Activar seguimientos"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /><span /></label>
        </div>
        <p className="hint">Si ella deja de contestar después de que el bot le escribió, el bot puede mandar un mensaje por su cuenta. Se cancela apenas ella (o vos) escriba. Respeta las pausas y el modo prueba. Los pendientes se pierden si reiniciás el servidor.</p>
        <div className="row">
          <label className="f">Máximo de mensajes por silencio<input type="number" min="1" max="9" value={f.maxAttempts} onChange={(e) => setF({ ...f, maxAttempts: Number(e.target.value) })} /></label>
          <label className="f">Esperas en minutos (una por intento, separadas por coma)<input value={f.delaysText} onChange={(e) => setF({ ...f, delaysText: e.target.value })} placeholder="20, 120, 360" /></label>
        </div>
        <div className="row">
          <label className="switch" title="Horario de silencio"><input type="checkbox" checked={f.quietHours.enabled} onChange={(e) => setF({ ...f, quietHours: { ...f.quietHours, enabled: e.target.checked } })} /><span /></label>
          <span className="hint" style={{ margin: 0 }}>Sin mensajes espontáneos entre</span>
          <input type="time" style={{ width: 120 }} value={f.quietHours.from} onChange={(e) => setF({ ...f, quietHours: { ...f.quietHours, from: e.target.value } })} />
          <span className="hint" style={{ margin: 0 }}>y</span>
          <input type="time" style={{ width: 120 }} value={f.quietHours.to} onChange={(e) => setF({ ...f, quietHours: { ...f.quietHours, to: e.target.value } })} />
        </div>
        <button className="primary" onClick={saveFollowUp}>Guardar seguimientos</button>
      </div>

      <div className="card">
        <h2>Temas que pausan al bot</h2>
        <p className="hint">Si ella menciona alguna de estas palabras, el bot deja de responderle y te avisa. Después lo reactivás desde el Panel.</p>
        {topics.map((x) => (
          <div className="big" key={x.id} style={{ display: 'block' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <h2>{x.label}</h2>
              <div className="row" style={{ margin: 0 }}>
                <label className="switch"><input type="checkbox" checked={x.enabled} onChange={(e) => setTopics(topics.map((y) => (y.id === x.id ? { ...y, enabled: e.target.checked } : y)))} /><span /></label>
                <button className="danger" onClick={() => setTopics(topics.filter((y) => y.id !== x.id))}>Borrar</button>
              </div>
            </div>
            <div className="chips">{x.keywords.map((k) => <span className="chip" key={k}>{k}<button onClick={() => delKeyword(x.id, k)}>×</button></span>)}</div>
            <input placeholder="Agregar palabra y Enter" onKeyDown={(e) => { if (e.key === 'Enter') { addKeyword(x.id, e.target.value); e.target.value = '' } }} />
          </div>
        ))}
        <div className="row">
          <label className="f">Nuevo tema<input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="Ej: Familia" /></label>
          <button onClick={() => { if (newTopic.trim()) { setTopics([...topics, { id: String(Date.now()), label: newTopic.trim(), enabled: true, keywords: [] }]); setNewTopic('') } }}>Crear tema</button>
        </div>
      </div>

      <div className="card">
        <h2>Sesión de WhatsApp</h2>
        <p className="hint">Si querés vincular otro número, cerrá la sesión y escaneá un QR nuevo.</p>
        <button className="danger" onClick={() => confirm('¿Cerrar la sesión de WhatsApp?') && api('/logout', 'POST').then(() => notify('Sesión cerrada'))}>Cerrar sesión</button>
      </div>
    </>
  )
}
