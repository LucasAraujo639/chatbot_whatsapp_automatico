import { useEffect, useState } from 'react'
import { api } from '../api'

export default function Training({ s, notify }) {
  const [text, setText] = useState('')
  const [people, setPeople] = useState([])
  const [me, setMe] = useState('')
  const [about, setAbout] = useState('')
  const [lastN, setLastN] = useState(10000)

  useEffect(() => { api('/about').then((r) => setAbout(r.text)) }, [])

  const onFile = async (e) => {
    const f = e.target.files[0]
    if (!f) return
    const t = await f.text()
    setText(t)
    const p = await api('/style/participants', 'POST', { text: t })
    setPeople(p); setMe(p[0]?.name || '')
    if (!p.length) notify('No pude leer mensajes en ese archivo')
  }
  const train = async () => {
    try { await api('/style/import', 'POST', { text, me, lastN }); notify('Estilo entrenado'); setText(''); setPeople([]) } catch (e) { notify(e.message) }
  }

  const p = s.profile
  return (
    <>
      <div className="card">
        <h2>Importar chat exportado de WhatsApp</h2>
        <p className="hint">En WhatsApp: abrí un chat → ⋮ → Más → Exportar chat → Sin multimedia, y subí el .txt. Elegí cuál de los participantes sos vos.</p>
        <input type="file" accept=".txt,text/plain" onChange={onFile} />
        {people.length > 0 && (
          <div className="row" style={{ marginTop: 12 }}>
            <label className="f">¿Quién sos vos?
              <select value={me} onChange={(e) => setMe(e.target.value)}>{people.map((x) => <option key={x.name} value={x.name}>{x.name} ({x.count} mensajes)</option>)}</select>
            </label>
            <label className="f" style={{ maxWidth: 220 }}>Usar solo los últimos N mensajes
              <input type="number" min="100" step="500" value={lastN} onChange={(e) => setLastN(Number(e.target.value))} />
            </label>
            <button className="primary" onClick={train}>Entrenar</button>
          </div>
        )}
        {p?.stats && <p className="hint" style={{ marginTop: 12 }}>Entrenado como <b>{p.me}</b>: {p.stats.count} mensajes, largo medio {p.stats.avgLen} caracteres, {p.stats.lowercasePct}% en minúscula, emojis: {p.stats.topEmoji || 'ninguno'}.{p.pairs ? ` Aprendió ${p.pairs} conversaciones y ${p.vocabulary} palabras tuyas.` : ' Volvé a importar el chat para que aprenda tu vocabulario y tus saludos reales.'}</p>}
      </div>
      <div className="card">
        <h2>Palabras permitidas</h2>
        <p className="hint">Palabras que aprobaste a mano desde los avisos (“+ Permitir”). El bot puede usarlas aunque no estén en tu chat. Se conservan si volvés a importar el chat.</p>
        {s.allowedWords.length === 0 && <p className="hint">Todavía no agregaste ninguna.</p>}
        <div className="chips">
          {s.allowedWords.map((w) => (
            <span className="chip" key={w}>{w}<button title="Quitar" onClick={() => api(`/vocabulary/allowed/${encodeURIComponent(w)}`, 'DELETE').then(() => notify('Quitada'))}>×</button></span>
          ))}
        </div>
      </div>
      <div className="card">
        <h2>Datos sobre vos</h2>
        <p className="hint">El bot solo puede afirmar cosas que estén acá (trabajo, gustos, ciudad…). Si no, no inventa.</p>
        <textarea style={{ minHeight: 160 }} value={about} onChange={(e) => setAbout(e.target.value)} />
        <div className="row" style={{ marginTop: 10 }}><button className="primary" onClick={() => api('/about', 'PUT', { text: about }).then(() => notify('Guardado'))}>Guardar</button></div>
      </div>
    </>
  )
}
