import { useEffect, useState } from 'react'
import { api } from './api'
import Panel from './tabs/Panel'
import Contacts from './tabs/Contacts'
import Training from './tabs/Training'
import Model from './tabs/Model'
import Test from './tabs/Test'
import Settings from './tabs/Settings'

const TABS = [['panel', 'Panel'], ['contacts', 'Contactos'], ['training', 'Entrenamiento'], ['model', 'Modelo'], ['test', 'Probar'], ['settings', 'Ajustes']]

export default function App() {
  const [s, setS] = useState(null)
  const [tab, setTab] = useState('panel')
  const [toast, setToast] = useState('')

  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onmessage = (e) => setS(JSON.parse(e.data))
    return () => es.close()
  }, [])

  const notify = (m) => { setToast(m); setTimeout(() => setToast(''), 2500) }
  const save = async (patch, msg = 'Guardado') => {
    try { await api('/config', 'PUT', patch); notify(msg) } catch (e) { notify('Error: ' + e.message) }
  }

  if (!s) return <div className="wrap">Conectando con el servidor… ¿está corriendo <code>npm run dev</code>?</div>
  const props = { s, save, notify }
  const conn = { open: ['ok', 'WhatsApp conectado'], qr: ['warn', 'Esperando QR'], connecting: ['warn', 'Conectando…'], closed: ['bad', 'Desconectado'] }[s.connection]

  return (
    <div className="wrap">
      <header className="top">
        <h1>Contestador WhatsApp</h1>
        <span className="pill"><span className={'dot ' + conn[0]} />{conn[1]}</span>
      </header>
      <nav className="tabs">
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </nav>
      {tab === 'panel' && <Panel {...props} />}
      {tab === 'contacts' && <Contacts {...props} />}
      {tab === 'training' && <Training {...props} />}
      {tab === 'model' && <Model {...props} />}
      {tab === 'test' && <Test {...props} />}
      {tab === 'settings' && <Settings {...props} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
