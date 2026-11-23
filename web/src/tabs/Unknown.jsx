import { Fragment, useEffect, useState } from 'react'
import { api } from '../api'

const FILTERS = [['pending', 'Pendientes'], ['replied', 'Respondidos'], ['done', 'Listos'], ['rejected', 'Rechazados'], ['saved', 'Agendados']]
const STATUS_LABEL = { pending: 'pendiente', replied: 'respondido', done: 'listo', rejected: 'rechazado', saved: 'agendado' }
const time = (t) => new Date(t).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const path = (id) => `/unknown/${encodeURIComponent(id)}`
const MAX_THEIRS = 6 // el primer mensaje + 5 más (ver EXTRA_MESSAGES en src/unknown-inbox.js)
const theirs = (m) => m.from !== 'me'
// Mensajes de él después de tu última respuesta.
const unansweredOf = (msgs) => msgs.slice(msgs.findLastIndex((m) => m.from === 'me') + 1).filter(theirs)

const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'
const date = (t) => new Date(t).toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' })

function Avatar({ url, name, large }) {
  const [broken, setBroken] = useState(false)
  const cls = 'avatar' + (large ? ' lg' : '')
  if (!url || broken) return <span className={cls} title="Sin foto (o no la comparte)">{initials(name)}</span>
  const img = <img className={cls} src={url} alt={name || 'Foto de perfil'} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  return large ? <a href={url} target="_blank" rel="noreferrer">{img}</a> : img
}

// Lo que WhatsApp deja ver del perfil, para reconocer a la persona antes de agendarla.
function Profile({ e, p, loading }) {
  const b = p?.business
  const rows = [
    ['Nombre de perfil', e.pushName || 'No puso nombre'],
    ['Número', e.number ? '+' + e.number : 'WhatsApp no dio el número real'],
    ['Info', p?.about ? p.about + (p.aboutSetAt ? ` (desde ${date(p.aboutSetAt)})` : '') : loading ? '…' : 'No la comparte o no tiene'],
    ['Te escribió', `por primera vez el ${time(e.firstAt)}`],
    ...(b ? [
      ['Cuenta', 'WhatsApp Business' + (b.category ? ` · ${b.category}` : '')],
      b.description && ['Descripción', b.description],
      b.email && ['Email', b.email],
      b.website && ['Web', <a key="web" href={b.website} target="_blank" rel="noreferrer">{b.website}</a>],
      b.address && ['Dirección', b.address],
    ] : []),
  ].filter(Boolean)
  return (
    <div className="profile">
      <Avatar url={p?.photoUrl} name={e.pushName} large />
      <dl>{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
    </div>
  )
}

// Una persona de la bandeja: últimos mensajes, aceptar (con vista previa editable) o rechazar (y agendar).
function Entry({ e, s, notify }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(null) // texto a enviar; null = sin vista previa
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(e.pushName || '')
  const [saving, setSaving] = useState(false) // formulario de "Agendar" abierto
  const [profile, setProfile] = useState(undefined) // undefined = sin pedir todavía, null = no se pudo
  const connected = s.connection === 'open'
  const loadingProfile = connected && profile === undefined
  // La foto y la info se piden a WhatsApp (el servidor las cachea un rato); sin conexión no hay de dónde sacarlas.
  useEffect(() => {
    if (!connected || profile !== undefined) return
    let alive = true
    api(path(e.id) + '/profile').then((p) => alive && setProfile(p)).catch(() => alive && setProfile(null))
    return () => { alive = false }
  }, [connected, e.id, profile])
  const ai = s.config.unknownInbox.mode === 'ai'
  const last = e.messages[e.messages.length - 1]
  const toAnswer = unansweredOf(e.messages).length
  const full = e.messages.filter(theirs).length >= MAX_THEIRS
  const canAnswer = e.status === 'pending' || (e.status === 'replied' && toAnswer > 0)
  const done = e.status === 'done'
  const toggleDone = () => run(() => api(path(e.id) + '/done', 'POST', { done: !done }), done ? 'Vuelve a Respondidos' : 'Listo: pasa a Listos')

  const run = async (fn, ok) => {
    setBusy(true)
    try { const r = await fn(); if (ok) notify(ok); return r } catch (err) { notify('Error: ' + err.message) } finally { setBusy(false) }
  }
  const preview = () => run(async () => { const r = await api(path(e.id) + '/preview', 'POST'); setDraft(r.text); setOpen(true) })
  const send = () => run(async () => { await api(path(e.id) + '/accept', 'POST', { text: draft }); setDraft(null) }, s.config.dryRun ? 'Modo prueba: no se envió (mirá el log)' : 'Enviado')
  const writeOwn = () => { setDraft(''); setOpen(true) }

  return (
    <div className={'big' + (done ? ' done' : '')} style={{ display: 'block' }}>
      <div className="row" style={{ justifyContent: 'space-between', margin: 0, cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <div className="row" style={{ margin: 0, flexWrap: 'nowrap', minWidth: 0 }}>
        <Avatar url={profile?.photoUrl} name={e.pushName} />
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0 }}>{e.number ? '+' + e.number : e.label}{e.pushName && <span className="hint"> · {e.pushName}</span>}</h2>
          <p className="hint" style={{ margin: 0 }}>
            {time(e.lastAt)} · {STATUS_LABEL[e.status]} · {e.messages.length} mensaje{e.messages.length === 1 ? '' : 's'}
            {e.status === 'replied' && toAnswer > 0 && <b> · {toAnswer} sin contestar</b>}
          </p>
          {!open && !done && <p className="one-line" style={{ margin: '6px 0 0' }}>{last?.from === 'me' ? 'Vos: ' : ''}“{last?.text}”</p>}
        </div>
        </div>
        <div className="row" style={{ margin: 0, flexWrap: 'nowrap' }}>
          {(e.status === 'replied' || done) && (
            <label className="done-check" title={done ? 'Desmarcar para poder contestarle o quitarlo' : 'Dar por terminado: si vuelve a escribir no pide respuesta'} onClick={(ev) => ev.stopPropagation()}>
              <input type="checkbox" checked={done} disabled={busy} onChange={toggleDone} /> Listo
            </label>
          )}
          <span className="hint" style={{ margin: 0 }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <>
          <Profile e={e} p={profile} loading={loadingProfile} />
          {!connected && !profile && <p className="hint" style={{ marginTop: 6 }}>Conectá WhatsApp para ver la foto y la info de su perfil.</p>}
          <div className="chat" style={{ height: 'auto', maxHeight: 300, marginTop: 10 }}>
            {e.messages.map((m, i) => <div key={i} className={'bubble ' + (theirs(m) ? 'bot' : 'contact')} title={time(m.at)}>{m.text}</div>)}
          </div>
          {done && <p className="hint">Marcado como listo: lo que mande se guarda acá pero no queda pendiente. Para contestarle o quitarlo, desmarcá <b>Listo</b>.</p>}
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
          {!saving && <button disabled={busy} onClick={() => { setSaving(true); setOpen(true) }}>Agendar</button>}
        </div>
      )}

      {open && draft === null && e.status === 'replied' && canAnswer && (
        <div className="row" style={{ marginTop: 10, marginBottom: 0 }}>
          <button className="primary" disabled={busy} onClick={preview}>{ai ? 'Generar respuesta' : 'Responder con el mensaje fijo'}</button>
          <button disabled={busy} onClick={writeOwn}>Escribir yo</button>
        </div>
      )}

      {saving && e.status !== 'saved' && (
        <div className="row" style={{ marginTop: 10, marginBottom: 0, alignItems: 'flex-end' }}>
          <label className="f">Nombre para tu agenda<input value={name} autoFocus onChange={(ev) => setName(ev.target.value)} placeholder="Cómo querés agendarlo" /></label>
          <button
            className="primary"
            disabled={busy || !connected || !e.number || !name.trim()}
            title={!e.number ? 'WhatsApp no dio el número real de este chat' : connected ? '' : 'Conectá WhatsApp primero'}
            onClick={() => run(() => api(path(e.id) + '/save-contact', 'POST', { name }), 'Guardado en tu agenda')}
          >Guardar en agenda</button>
          <button disabled={busy} onClick={() => setSaving(false)}>Cancelar</button>
        </div>
      )}
      {saving && !e.number && <p className="hint" style={{ marginTop: 6 }}>WhatsApp no dio el número real de este chat: no se puede agendar.</p>}

      {e.status !== 'pending' && !done && (e.status !== 'replied' || open) && (
        <div className="row" style={{ marginTop: 10, marginBottom: 0 }}>
          {e.status === 'replied' && !saving && <button disabled={busy} onClick={() => setSaving(true)}>Agendar</button>}
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
  if (loadError) return <p className="hint check bad">No se pudo cargar el asistente: {loadError}</p>
  if (!g) return null

  const setRule = (i, k, v) => setG({ ...g, rules: g.rules.map((r, j) => (j === i ? { ...r, [k]: v } : r)) })
  const saveG = () => api('/unknown/greeter', 'PUT', g).then((r) => { setG(r); notify('Asistente guardado') }).catch((e) => notify('Error: ' + e.message))
  const test = async () => {
    setTesting(true)
    try { setTestReply((await api('/unknown/greeter/test', 'POST', { text: testText })).reply) } catch (e) { notify('Error: ' + e.message) } finally { setTesting(false) }
  }

  return (
    <section className="settings-section">
      <h3>Asistente de bienvenida</h3>
      <p className="hint">No usa tus chats exportados: aprende solo de lo que pongas acá. <b>Instrucciones</b>: quién sos, qué ofrecés, tono, qué nunca decir. <b>Reglas</b>: “si te dicen esto → respondé así”; el modelo toma la regla más parecida al mensaje y adapta la respuesta. Guardá y probá hasta que conteste como querés.</p>
      <label className="f">Instrucciones
        <textarea style={{ minHeight: 120 }} value={g.instructions} onChange={(e) => setG({ ...g, instructions: e.target.value })}
          placeholder="Ej: Soy Lucas, programador freelance. Respondé amable y corto. Si preguntan precios, decí que paso presupuesto por acá. Nunca des mi dirección." />
      </label>
      <h4>Reglas</h4>
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
      <h4>Probar</h4>
      <p className="hint">Usa lo guardado (guardá antes de probar).</p>
      <div className="row">
        <label className="f">Mensaje de un desconocido<input value={testText} onChange={(e) => setTestText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && test()} placeholder="Hola, me pasaron tu número por un trabajo" /></label>
        <button disabled={testing || !testText.trim()} onClick={test}>{testing ? 'Generando…' : 'Probar'}</button>
      </div>
      {testReply && <div className="chat" style={{ height: 'auto' }}><div className="bubble contact">{testText}</div><div className="bubble bot">{testReply}</div></div>}
    </section>
  )
}

// Ajustes de la bandeja (detrás de la rueda): qué se le manda a los que aceptás y el asistente de bienvenida.
function Settings({ cfg, save, notify }) {
  const [fixedText, setFixedText] = useState(cfg.fixedText)
  return (
    <>
      <section className="settings-section">
        <h3>Respuesta a los que aceptes</h3>
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
      </section>
      {cfg.mode === 'ai' && <Greeter notify={notify} />}
    </>
  )
}

export default function Unknown({ s, save, notify }) {
  const [filter, setFilter] = useState('pending')
  const [settings, setSettings] = useState(false)
  const cfg = s.config.unknownInbox
  const items = (s.unknown || []).filter((e) => e.status === filter)
  const count = (st) => (s.unknown || []).filter((e) => e.status === st).length

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{settings ? 'Desconocidos · Ajustes' : 'Desconocidos'}</h2>
        <div className="row" style={{ margin: 0 }}>
          <label className="switch" title="Detectar desconocidos"><input type="checkbox" checked={cfg.enabled} onChange={(e) => save({ unknownInbox: { enabled: e.target.checked } })} /><span /></label>
          <button className={'gear' + (settings ? ' on' : '')} title={settings ? 'Volver a la bandeja' : 'Ajustes: respuesta y asistente de bienvenida'} aria-label="Ajustes" aria-pressed={settings} onClick={() => setSettings(!settings)}>
            {settings ? '✕' : '⚙'}
          </button>
        </div>
      </div>

      {settings ? (
        <Settings cfg={cfg} save={save} notify={notify} />
      ) : (
        <>
          <p className="hint">Gente que te escribe sin estar en Contactos ni en tu agenda. No se les contesta nada hasta que aceptes. Después del primer mensaje se guardan hasta 5 más, que podés contestar desde acá (generado o escrito por vos) desde <b>Respondidos</b>; tocá un chat para expandirlo. Marcá <b>Listo</b> en un respondido para darlo por terminado: pasa a <b>Listos</b>, queda compacto y aunque vuelva a escribir no pide respuesta. Qué se les manda al aceptar se configura en la rueda ⚙.{s.config.dryRun && ' Modo prueba activo: al aceptar no se envía, solo queda en el log.'}</p>
          <nav className="tabs">
            {FILTERS.map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l} ({count(k)})</button>)}
          </nav>
          {items.length === 0 && <p className="hint">Nada por acá.</p>}
          {items.map((e) => <Entry key={e.id} e={e} s={s} notify={notify} />)}
        </>
      )}
    </div>
  )
}
