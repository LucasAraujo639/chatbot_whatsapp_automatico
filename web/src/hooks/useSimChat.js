import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'

// Igual que el bot real: espera un momento por si ella manda más mensajes antes de contestar todo junto.
const DEBOUNCE_MS = 1800

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const trailing = (items, from) => { // lote de mensajes seguidos del mismo autor al final
  const out = []
  for (let i = items.length - 1; i >= 0 && items[i].from === from; i--) out.unshift(items[i])
  return out
}

// Historial para la API: lotes del contacto = un array; respuestas del bot = un mensaje con partes separadas por ---
function toApiMessages(items) {
  const msgs = []
  for (const i of items) {
    if (i.from === 'system') continue
    const role = i.from === 'contact' ? 'user' : 'assistant'
    const last = msgs.at(-1)
    if (last?.role === role) {
      if (role === 'user') last.content.push(i.text)
      else last.content += '\n---\n' + i.text
    } else msgs.push({ role, content: role === 'user' ? [i.text] : i.text })
  }
  return msgs
}

// Chat temporal en memoria: se pierde al recargar o reiniciar. El servidor no guarda nada.
// items: { id, from: 'contact' | 'bot' | 'system', text, quote? }
export function useSimChat() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [pausedBy, setPausedBy] = useState(null)
  const [typing, setTyping] = useState(false)
  const [realTiming, setRealTiming] = useState(true) // simular las esperas configuradas entre mensajes
  const timingRef = useRef(true)
  const reveal = useRef({ run: 0, rest: [] })
  const itemsRef = useRef([])
  const attemptRef = useRef(0)
  const timer = useRef(null)
  const nextId = useRef(0)

  const commit = (updater) => { itemsRef.current = updater(itemsRef.current); setItems(itemsRef.current) }
  const make = (from, text, quote, words) => ({ id: nextId.current++, from, text, quote, words })

  // Muestra los mensajes del bot de a uno, con "escribiendo…" durante el tiempo que sortea el servidor
  const revealParts = useCallback(async (list, delays) => {
    const run = ++reveal.current.run
    reveal.current.rest = [...list]
    for (let i = 0; i < list.length; i++) {
      if (timingRef.current) {
        setTyping(true)
        await sleep(delays[i] ?? 0)
        if (reveal.current.run !== run) return // otro mensaje cortó la espera: el resto ya se mostró
      }
      commit((cur) => [...cur, reveal.current.rest.shift()])
    }
    setTyping(false)
  }, [])

  // Si llega otro mensaje (o se reinicia), lo que faltaba mostrar aparece de golpe para no perder el orden
  const flushReveal = useCallback(() => {
    reveal.current.run++
    const rest = reveal.current.rest.splice(0)
    setTyping(false)
    if (rest.length) commit((cur) => [...cur, ...rest])
  }, [])

  const request = useCallback(async (path, body, batch) => {
    setLoading(true)
    try {
      const res = await api(path, 'POST', body)
      if (res.paused) {
        setPausedBy(res.topic)
        commit((cur) => [...cur, make('system', `El bot se pausaría por tema sensible: ${res.topic}. En real no respondería y te avisaría.`)])
      } else {
        // Avisos del control de vocabulario: qué corrigió y, si no pudo, por qué el bot se habría callado
        // Los botones "Permitir" van en el último aviso: el de bloqueo, o el de la última corrección
        const notices = (res.notes || []).map((n, i, all) => make('system', n, undefined, !res.blocked && i === all.length - 1 ? res.flagged : undefined))
        if (res.blocked) notices.push(make('system', `El bot no respondería: seguía usando palabras que no usás (${res.blocked.join(', ')}). En real te avisa en el Panel para que contestes vos.`, undefined, res.blocked))
        commit((cur) => [...cur, ...notices])
        setLoading(false)
        await revealParts(res.parts.map((p) => make('bot', p.text, p.replyTo ? batch[p.replyTo - 1]?.text : undefined)), res.delaysMs || [])
      }
    } catch (e) {
      commit((cur) => [...cur, make('system', `Error: ${e.message}`)])
    } finally {
      setLoading(false)
    }
  }, [])

  const respond = useCallback(() => {
    const batch = trailing(itemsRef.current, 'contact')
    if (batch.length) request('/simulate', { messages: toApiMessages(itemsRef.current) }, batch)
  }, [request])

  const send = useCallback((text) => {
    const clean = text.trim()
    if (!clean || pausedBy) return
    flushReveal()
    attemptRef.current = 0
    commit((cur) => [...cur, make('contact', clean)])
    clearTimeout(timer.current)
    timer.current = setTimeout(respond, DEBOUNCE_MS)
  }, [pausedBy, respond, flushReveal])

  // "Ella no contesta": el bot escribe por su cuenta
  const simulateSilence = useCallback(async () => {
    await request('/simulate/follow-up', { messages: toApiMessages(itemsRef.current), attempt: attemptRef.current }, [])
    attemptRef.current += 1
  }, [request])

  const reset = useCallback(() => {
    clearTimeout(timer.current)
    flushReveal()
    attemptRef.current = 0
    commit(() => [])
    setPausedBy(null)
  }, [flushReveal])

  useEffect(() => { timingRef.current = realTiming }, [realTiming])
  useEffect(() => () => { clearTimeout(timer.current); reveal.current.run++ }, [])

  const canSimulateSilence = !loading && !typing && !pausedBy && items.findLast((i) => i.from !== 'system')?.from === 'bot'
  return { items, typing: loading || typing, pausedBy, send, reset, simulateSilence, canSimulateSilence, realTiming, setRealTiming }
}
