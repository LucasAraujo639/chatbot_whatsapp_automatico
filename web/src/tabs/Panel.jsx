import { QRCodeSVG } from 'qrcode.react'
import { api } from '../api'
import AllowWords from '../components/AllowWords'

const KIND = { in: 'ella', out: 'enviado', dry: 'simulado', alert: 'alerta', info: 'info', error: 'error' }

export default function Panel({ s, save, notify }) {
  const c = s.config
  const dry = c.dryRun
  return (
    <>
      {s.connection !== 'open' && (
        <div className="card">
          <h2>Conectar WhatsApp</h2>
          {s.connection === 'qr' && s.qr ? (
            <>
              <p className="hint">En el celular: WhatsApp → Dispositivos vinculados → Vincular un dispositivo, y escaneá este código.</p>
              <div className="qr"><QRCodeSVG value={s.qr} size={240} /></div>
            </>
          ) : <p className="hint">Esperando que el servidor genere el QR…</p>}
        </div>
      )}

      <div className="card">
        <div className={'big ' + (dry ? 'safe' : 'live')}>
          <div>
            <h2>{dry ? 'Modo prueba' : 'Modo real: el bot ENVÍA mensajes'}</h2>
            <p className="hint" style={{ margin: 0 }}>{dry ? 'Las respuestas se muestran acá abajo pero no se mandan.' : 'Las respuestas se envían a los contactos activados.'}</p>
          </div>
          <button className={dry ? 'primary' : 'danger'} onClick={() => save({ dryRun: !dry }, dry ? 'Modo real activado' : 'Modo prueba activado')}>
            {dry ? 'Pasar a modo real' : 'Volver a prueba'}
          </button>
        </div>
        <div className="big">
          <div>
            <h2>{c.paused ? 'Bot en pausa' : 'Bot activo'}</h2>
            <p className="hint" style={{ margin: 0 }}>{c.paused ? 'No responde a nadie hasta que lo reanudes.' : 'Responde a los contactos activados.'}</p>
          </div>
          <button className={c.paused ? 'primary' : ''} onClick={() => save({ paused: !c.paused }, c.paused ? 'Reanudado' : 'Pausado')}>
            {c.paused ? '▶ Reanudar' : '⏸ Pausar todo'}
          </button>
        </div>
        {c.contacts.filter((x) => x.paused).map((x) => (
          <div className="big" key={x.number}>
            <div><h2>{x.name || x.number} está en pausa</h2><p className="hint" style={{ margin: 0 }}>Se pausó por un tema sensible. Respondé vos y reactivalo cuando quieras.</p></div>
            <button className="primary" onClick={() => api(`/contacts/${x.number}/paused`, 'POST', { paused: false }).then(() => notify('Reactivado'))}>Reactivar</button>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Actividad</h2>
        <div className="log">
          {s.log.length === 0 && <p className="hint">Todavía no hay mensajes.</p>}
          {[...s.log].reverse().map((l, i) => (
            <div key={i}><small>{new Date(l.t).toLocaleTimeString()}</small> <span className="tag">{KIND[l.kind] || l.kind}</span>{l.contact && <small>{l.contact} · </small>}{l.text} <AllowWords words={l.words} allowed={s.allowedWords} notify={notify} /></div>
          ))}
        </div>
      </div>
    </>
  )
}
