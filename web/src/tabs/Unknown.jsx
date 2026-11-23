import { useEffect, useState } from 'react'
import { api } from '../api'

const FILTERS = [['pending', 'Pendientes'], ['replied', 'Respondidos'], ['rejected', 'Rechazados'], ['saved', 'Agendados']]
const STATUS_LABEL = { pending: 'pendiente', replied: 'respondido', rejected: 'rechazado', saved: 'agendado' }
const time = (t) => new Date(t).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const path = (id) => `/unknown/${encodeURIComponent(id)}`
const MAX_THEIRS = 6 // el primer mensaje + 5 más (ver EXTRA_MESSAGES en src/unknown-inbox.js)
const theirs = (m) => m.from !== 'me'
// Mensajes de él después de tu última respuesta.
const unansweredOf = (msgs) => msgs.slice(msgs.findLastIndex((m) => m.from === 'me') + 1).filter(theirs)

// Una persona de la bandeja: últimos mensajes, aceptar (con vista previa editable) o rechazar (y agendar).
function Entry({ e, s, notify }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(null) // texto a enviar; null = sin vista previa
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(e.pushName || '')
  const connected = s.connection === 'open'
  const ai = s.config.unknownInbox.mode === 'ai'
  const last = e.messages[e.messages.length - 1]
  const toAnswer = unansweredOf(e.messages).length
  const full = e.messages.filter(theirs).length >= MAX_THEIRS
  const canAnswer = e.status === 'pending' || (e.status === 'replied' && toAnswer > 0)

  const run = async (fn, ok) => {
    setBusy(true)
    try { const r = await fn(); if (ok) notify(ok); return r } catch (err) { notify('Error: ' + err.message) } finally { setBusy(false) }
  }
  const preview = () => run(async () => { const r = await api(path(e.id) + '/preview', 'POST'); setDraft(r.text); setOpen(true) })
  const send = () => run(async () => { await api(path(e.id) + '/accept', 'POST', { text: draft }); setDraft(null) }, s.config.dryRun ? 'Modo prueba: no se envió (mirá el log)' : 'Enviado')
  const writeOwn = () => { setDraft(''); setOpen(true) }

  return (
    <div className="big" style={{ display: 'block' }}>
      <div className="row" style={{ justifyContent: 'space-between', margin: 0, cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <div>
          <h2 style={{ margin: 0 }}>{e.number ? '+' + e.number : e.label}{e.pushName && <span className="hint"> · {e.pushName}</span>}</h2>
          <p className="hint" style={{ margin: 0 }}>
            {time(e.lastAt)} · {STATUS_LABEL[e.status]} · {e.messages.length} mensaje{e.messages.length === 1 ? '' : 's'}
            {e.status === 'replied' && toAnswer > 0 && <b> · {toAnswer} sin contestar</b>}
          </p>
          {!open && <p className="one-line" style={{ margin: '6px 0 0' }}>{last?.from === 'me' ? 'Vos: ' : ''}“{last?.text}”</p>}
        </div>
        <span className="hint" style={{ margin: 0 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <>
          <div className="chat" style={{ height: 'auto', maxHeight: 300, marginTop: 10 }}>
            {e.messages.map((m, i) => <div key={i} className={'bubble ' + (theirs(m) ? 'bot' : 'contact')} title={time(m.at)}>{m.text}</div>)}
          </div>
          {full && <p className="hint">Llegó al máximo de {MAX_THEIRS} mensajes: lo que mande ahora ya no se guarda acá (seguí desde WhatsApp).</p>}
        </>
      )}

      {open && draft !== null && (
        <div style={{ marginTop: 10 }}>
          <p className="hint">Se le va a mandar esto (podés editarlo):</p>
          <textarea value={draft} onChange={(ev) => setDraft(ev.target.value)} style={{ minHeight: 80 }} placeholder="Escribí tu respuesta" autoFocus />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={busy || !draft.trim()} onClick={send}>Enviar</button>
            {ai && <button disabled={busy} onClick={preview}>Regenerar</button>}
            <button disabled={busy} onClick={() => setDraft(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {draft === null && (e.status === 'pending' || e.status === 'rejected') && (
        <div className="row" style={{ marginTop: 10, marginBottom: 0 }}>
          <button className="primary" disabled={busy} onClick={preview}>{ai ? 'Aceptar (generar mensaje)' : 'Aceptar'}</button>
          <button disabled={busy} onClick={writeOwn}>Escribir yo</button>
          {e.status === 'pending' && <button disabled={busy} onClick={() => run(() => api(path(e.id) + '/reject', 'POST'), 'Rechazado: no se envía nada')}>Rechazar</button>}
        </div>
      )}

      {open && draft === null && e.status === 'replied' && canAnswer && (
        <div className="row" style={{ marginTop: 10, marginBottom: 0 }}>
          <button className="primary" disabled={busy} onClick={preview}>{ai ? 'Generar respuesta' : 'Responder con el mensaje fijo'}</button>
          <button disabled={busy} onClick={writeOwn}>Escribir yo</button>
        </div>
      )}

      {e.status === 'rejected' && (
        <div className="row" style={{ marginTop: 10, marginBottom: 0 }}>
          <label className="f">Nombre para tu agenda<input value={name} onChange={(ev) => setName(ev.target.value)} /></label>
          <button
            disabled={busy || !connected || !e.number || !name.trim()}
            title={!e.number ? 'WhatsApp no dio el número real de este chat' : connected ? '' : 'Conectá WhatsApp primero'}
            onClick={() => run(() => api(path(e.id) + '/save-contact', 'POST', { name }), 'Guardado en tu agenda')}
          >Guardar en agenda</button>
        </div>
      )}

      {e.status !== 'pending' && (e.status !== 'replied' || open) && (
        <div className="row" style={{ marginTop: 10, marginBottom: 0 }}>
          <button className="danger" disabled={busy} onClick={() => confirm('¿Quitar de la bandeja? Si vuelve a escribir aparece como pendiente.') && run(() => api(path(e.id), 'DELETE'))}>Quitar</button>
        </div>
      )}
    </div>
  )
}

// Entrenamiento del asistente de bienvenida: instrucciones + reglas "si te dicen X → respondé Y" + probar.
function Greeter({ notify }) {
  const [g, setG] = useState(null)
  const [testText, setTestText] = useState('')
  const [testReply, setTestReply] = useState('')
  const [testing, setTesting] = useState(false)

  const [loadError, setLoadError] = useState('')
  useEffect(() => { api('/unknown/greeter').then(setG).catch((e) => setLoadError(e.message)) }, [])
  if (loadError) return <div className="card"><p className="hint check bad">No se pudo cargar el asistente: {loadError}</p></div>
  if (!g) return null

  const setRule = (i, k, v) => setG({ ...g, rules: g.rules.map((r, j) => (j === i ? { ...r, [k]: v } : r)) })
  const saveG = () => api('/unknown/greeter', 'PUT', g).then((r) => { setG(r); notify('Asistente guardado') }).catch((e) => notify('Error: ' + e.message))
  const test = async () => {
    setTesting(true)
    try { setTestReply((await api('/unknown/greeter/test', 'POST', { text: testText })).reply) } catch (e) { notify('Error: ' + e.message) } finally { setTesting(false) }
  }

  return (
    <div className="card">
      <h2>Asistente de bienvenida</h2>
      <p className="hint">No usa tus chats exportados: aprende solo de lo que pongas acá. <b>Instrucciones</b>: quién sos, qué ofrecés, tono, qué nunca decir. <b>Reglas</b>: “si te dicen esto → respondé así”; el modelo toma la regla más parecida al mensaje y adapta la respuesta. Guardá y probá hasta que conteste como querés.</p>
      <label className="f">Instrucciones
        <textarea style={{ minHeight: 120 }} value={g.instructions} onChange={(e) => setG({ ...g, instructions: e.target.value })}
          placeholder="Ej: Soy Lucas, programador freelance. Respondé amable y corto. Si preguntan precios, decí que paso presupuesto por acá. Nunca des mi dirección." />
      </label>
      <h3 style={{ marginTop: 14 }}>Reglas</h3>
      {g.rules.length === 0 && <p className="hint">Sin reglas todavía.</p>}
      {g.rules.map((r, i) => (
        <div className="row" key={i}>
          <label className="f">Si te dicen…<input value={r.when} onChange={(e) => setRule(i, 'when', e.target.value)} placeholder="¿Cuánto cobrás una página web?" /></label>
          <label className="f">Respondé…<input value={r.reply} onChange={(e) => setRule(i, 'reply', e.target.value)} placeholder="Depende de lo que necesites, contame un poco y te paso presupuesto" /></label>
          <button className="danger" onClick={() => setG({ ...g, rules: g.rules.filter((_, j) => j !== i) })}>×</button>
        </div>
      ))}
      <div className="row">
        <button onClick={() => setG({ ...g, rules: [...g.rules, { when: '', reply: '' }] })}>+ Regla</button>
        <button className="primary" onClick={saveG}>Guardar asistente</button>
      </div>
      <h3 style={{ marginTop: 14 }}>Probar</h3>
      <p className="hint">Usa lo guardado (guardá antes de probar).</p>
      <div className="row">
        <label className="f">Mensaje de un desconocido<input value={testText} onChange={(e) => setTestText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && test()} placeholder="Hola, me pasaron tu número por un trabajo" /></label>
        <button disabled={testing || !testText.trim()} onClick={test}>{testing ? 'Generando…' : 'Probar'}</button>
      </div>
      {testReply && <div className="chat" style={{ height: 'auto' }}><div className="bubble contact">{testText}</div><div className="bubble bot">{testReply}</div></div>}
    </div>
  )
}

export default function Unknown({ s, save, notify }) {
  const [filter, setFilter] = useState('pending')
  const cfg = s.config.unknownInbox
  const [fixedText, setFixedText] = useState(cfg.fixedText)
  const items = (s.unknown || []).filter((e) => e.status === filter)
  const count = (st) => (s.unknown || []).filter((e) => e.status === st).length

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Desconocidos</h2>
          <label className="switch" title="Detectar desconocidos"><input type="checkbox" checked={cfg.enabled} onChange={(e) => save({ unknownInbox: { enabled: e.target.checked } })} /><span /></label>
        </div>
        <p className="hint">Gente que te escribe sin estar en Contactos ni en tu agenda. No se les contesta nada hasta que aceptes. Después del primer mensaje se guardan hasta 5 más, que podés contestar desde acá (generado o escrito por vos) desde <b>Respondidos</b>; tocá un chat para expandirlo.{s.config.dryRun && ' Modo prueba activo: al aceptar no se envía, solo queda en el log.'}</p>
        <nav className="tabs">
          {FILTERS.map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l} ({count(k)})</button>)}
        </nav>
        {items.length === 0 && <p className="hint">Nada por acá.</p>}
        {items.map((e) => <Entry key={e.id} e={e} s={s} notify={notify} />)}
      </div>

      <div className="card">
        <h2>Respuesta a los que aceptes</h2>
        <div className="row">
          <label><input type="radio" checked={cfg.mode === 'fixed'} onChange={() => save({ unknownInbox: { mode: 'fixed' } })} /> Siempre el mismo mensaje</label>
          <label><input type="radio" checked={cfg.mode === 'ai'} onChange={() => save({ unknownInbox: { mode: 'ai' } })} /> Generado por el asistente de bienvenida</label>
        </div>
        {cfg.mode === 'fixed' && (
          <>
            <textarea style={{ minHeight: 80 }} value={fixedText} onChange={(e) => setFixedText(e.target.value)} />
            <div className="row" style={{ marginTop: 10 }}><button className="primary" disabled={!fixedText.trim()} onClick={() => save({ unknownInbox: { fixedText } })}>Guardar mensaje</button></div>
          </>
        )}
      </div>

      {cfg.mode === 'ai' && <Greeter notify={notify} />}
    </>
  )
}
