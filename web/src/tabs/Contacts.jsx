import { useState } from 'react'
import { api } from '../api'
import { cleanNumber, isValidNumber } from '../lib/phone'

// Resultado de /contacts/verify → texto + color para mostrar al usuario
function describe(r) {
  if (!r.valid) return { cls: 'bad', text: 'Formato inválido: usá solo dígitos con código de país, sin + ni 0 inicial.' }
  if (r.exists && r.suggestion) return { cls: 'warn', text: `Existe en WhatsApp, pero con el número ${r.suggestion}. Corregilo para que coincida.` }
  if (r.exists) return { cls: 'ok', text: 'Existe en WhatsApp ✓' }
  return { cls: 'bad', text: 'No se encontró en WhatsApp. Revisá el código de país y el número.' }
}

export default function Contacts({ s, save, notify }) {
  const [number, setNumber] = useState('')
  const [name, setName] = useState('')
  const [checks, setChecks] = useState({}) // number -> resultado de verificación
  const [checking, setChecking] = useState(null)
  const contacts = s.config.contacts
  const set = (list) => save({ contacts: list })

  const verify = async (raw) => {
    const n = cleanNumber(raw)
    setChecking(n)
    try {
      const result = await api('/contacts/verify', 'POST', { number: n })
      setChecks((c) => ({ ...c, [n]: describe(result) }))
    } catch (e) {
      notify('No se pudo verificar: ' + e.message)
    } finally {
      setChecking(null)
    }
  }

  const add = () => {
    const n = cleanNumber(number)
    if (!isValidNumber(n)) return notify('Número inválido: solo dígitos con código de país (ej. 5491122334455), sin + ni 0 inicial')
    if (contacts.some((c) => c.number === n)) return notify('Ese número ya está en la lista')
    set([...contacts, { number: n, name, enabled: false, paused: false }])
    setNumber(''); setName('')
  }

  const connected = s.connection === 'open'
  const typed = cleanNumber(number)
  return (
    <div className="card">
      <h2>Contactos a los que responde el bot</h2>
      <p className="hint">Solo responde a los que estén activados. Número con código de país, sin + (ej. 5491122334455). Los nuevos arrancan desactivados. Si algo no responde, usá “Verificar” (necesita WhatsApp conectado) y mirá el log de Actividad: ahí aparece el número real de quien te escribe.</p>
      <div className="row">
        <label className="f">Número<input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="5491122334455" inputMode="numeric" /></label>
        <label className="f">Nombre (opcional)<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button onClick={() => verify(number)} disabled={!connected || !typed || checking === typed} title={connected ? '' : 'Conectá WhatsApp primero'}>Verificar</button>
        <button className="primary" onClick={add}>Agregar</button>
      </div>
      {checks[typed] && typed && <p className={'hint check ' + checks[typed].cls}>{checks[typed].text}</p>}
      {contacts.length === 0 && <p className="hint">No hay contactos todavía.</p>}
      {contacts.map((c) => (
        <div className="big" key={c.number}>
          <div>
            <h2>{c.name || c.number}</h2>
            <p className="hint" style={{ margin: 0 }}>{c.number}{c.paused ? ' · en pausa' : ''}</p>
            {checks[c.number] && <p className={'hint check ' + checks[c.number].cls} style={{ margin: '4px 0 0' }}>{checks[c.number].text}</p>}
          </div>
          <div className="row" style={{ margin: 0 }}>
            <button onClick={() => verify(c.number)} disabled={!connected || checking === c.number} title={connected ? '' : 'Conectá WhatsApp primero'}>Verificar</button>
            <label className="switch" title="Activar / desactivar">
              <input type="checkbox" checked={c.enabled} onChange={(e) => set(contacts.map((x) => (x.number === c.number ? { ...x, enabled: e.target.checked } : x)))} /><span />
            </label>
            <button className="danger" onClick={() => confirm('¿Quitar contacto?') && set(contacts.filter((x) => x.number !== c.number))}>Quitar</button>
          </div>
        </div>
      ))}
    </div>
  )
}
