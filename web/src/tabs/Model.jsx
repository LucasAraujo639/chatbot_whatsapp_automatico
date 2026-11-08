import { useState } from 'react'
import { api } from '../api'

const PRESETS = [
  ['OpenCode Zen', 'https://opencode.ai/inference/openai/v1'],
  ['OpenRouter', 'https://openrouter.ai/api/v1'],
  ['Groq', 'https://api.groq.com/openai/v1'],
  ['Ollama (local)', 'http://localhost:11434/v1'],
]

export default function Model({ s, save, notify }) {
  const [p, setP] = useState(s.config.provider)
  const [guard, setGuard] = useState(s.config.guard)
  const [models, setModels] = useState([])
  const [result, setResult] = useState('')
  const set = (k, v) => setP({ ...p, [k]: v })
  const num = (k) => (e) => set(k, Number(e.target.value))

  const load = async () => {
    try { const r = await api('/llm/models', 'POST', p); setModels(r.models); notify(`${r.models.length} modelos`) } catch (e) { notify('Error: ' + e.message) }
  }
  const test = async () => {
    setResult('Probando…')
    try { setResult('✅ ' + (await api('/llm/test', 'POST', p)).reply) } catch (e) { setResult('❌ ' + e.message) }
  }

  return (
    <div className="card">
      <h2>Modelo de IA</h2>
      <p className="hint">Sirve cualquier API compatible con OpenAI. Para probar uno gratis, elegí un modelo cuyo nombre termine en <code>-free</code> en OpenCode Zen (necesitás la API key de tu cuenta en opencode.ai/console), o usá OpenRouter/Groq/Ollama.</p>
      <div className="row">
        {PRESETS.map(([n, u]) => <button key={n} onClick={() => set('baseUrl', u)}>{n}</button>)}
      </div>
      <div className="row"><label className="f">URL base<input value={p.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} /></label></div>
      <div className="row"><label className="f">API key<input type="password" value={p.apiKey} placeholder="pegá tu key" onChange={(e) => set('apiKey', e.target.value)} /></label></div>
      <div className="row">
        <label className="f">Modelo<input list="models" value={p.model} onChange={(e) => set('model', e.target.value)} />
          <datalist id="models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <button onClick={load}>Listar modelos</button>
      </div>
      {models.length > 0 && <div className="chips">{models.map((m) => <button key={m} className={m === p.model ? 'primary' : ''} onClick={() => set('model', m)}>{m}</button>)}</div>}
      <div className="row">
        <label className="f">Largo máximo de respuesta (tokens)<input type="number" value={p.maxTokens} onChange={num('maxTokens')} /></label>
        <label className="f">Creatividad (0–1.5)<input type="number" step="0.1" value={p.temperature} onChange={num('temperature')} /></label>
      </div>
      <p className="hint">Recomendado para que no invente: creatividad <b>0.3–0.5</b> y largo <b>200</b> o más (con pocos tokens la respuesta se corta, y algunos modelos gastan tokens “pensando”).</p>
      <div className="big">
        <div>
          <h2>Control de vocabulario</h2>
          <p className="hint" style={{ margin: 0 }}>Si la respuesta usa palabras que nunca escribís (ej. “Holuu”), la rehace hasta {guard.maxRetries} veces; si no lo logra, no envía nada y te avisa en el Panel. Necesita haber entrenado el estilo.</p>
        </div>
        <label className="switch"><input type="checkbox" checked={guard.enabled} onChange={(e) => setGuard({ ...guard, enabled: e.target.checked })} /><span /></label>
      </div>
      <div className="row">
        <button className="primary" onClick={() => save({ provider: p, guard })}>Guardar</button>
        <button onClick={test}>Probar conexión</button>
      </div>
      {result && <p className="hint">{result}</p>}
    </div>
  )
}
