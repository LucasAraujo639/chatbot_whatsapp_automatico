# Arquitectura

Este documento explica cómo funciona el bot por dentro. Para una visión general y la puesta en marcha, ver el [README](../README.md).

## Vista general

```
WhatsApp ──► bot.js ──► responder.js ──► llm.js ──► modelo (API OpenAI-compatible)
   ▲           │              │
   │           │              └─ style.js, lexicon.js, allowlist.js, topics.js
   │           ▼
   └──── sendParts()     followup.js (seguimientos)
                         pacing.js   (ritmo de envío)

Panel web (web/) ──► Express (server.js) ──► config.js / bot.js / routes/
```

Hay dos caras que comparten el mismo proceso Node:

- **Bot**: escucha WhatsApp y responde.
- **API + panel**: Express expone el estado, la configuración y las herramientas de simulación. El panel se actualiza por Server-Sent Events (`/api/events`).

## Flujo de un mensaje entrante

1. **Recepción** (`src/bot.js`, evento `messages.upsert`). Solo se procesan mensajes de tipo `notify`. Se descartan grupos, estados y mensajes sin texto.
2. **Identificación del contacto** (`handle`). Se resuelve el número de teléfono, incluido el caso en que WhatsApp entrega un ID interno (`@lid`). Si el número no está en `contacts`, se registra una vez y se ignora.
3. **Mensajes del dueño**. Si el mensaje lo escribió el dueño a mano (no el bot), se marca una pausa de `manualPauseMin` minutos para ese contacto y se cancelan los seguimientos. Los mensajes viejos reentregados al reconectar se ignoran.
4. **Debounce**. Los mensajes de la misma persona se acumulan en un buffer. El procesamiento arranca `debounceMinSec`–`debounceMaxSec` segundos después del último mensaje.
5. **Flush** (`flush`). Se revisan las condiciones: contacto habilitado, bot no pausado, sin pausa manual activa. Si hay una pausa manual, los mensajes se reencolan.
6. **Temas sensibles**. Si el texto contiene palabras de un tema habilitado (`findSensitiveTopic`), el bot se pausa para ese contacto, guarda el historial y avisa al dueño. No responde.
7. **Generación** (`respond` en `src/responder.js`). Se arma el prompt y se llama al modelo. Si `guard.enabled` está activo, se revisa que la respuesta solo use palabras del léxico permitido; si no, se pide reintentar hasta `guard.maxRetries` veces. Si sigue fallando, la respuesta se bloquea y se avisa al dueño.
8. **Envío** (`sendParts`). Cada parte se envía con un tiempo de "escribiendo…" aleatorio (`typing`). Si `dryRun` está activo, solo se registra en el log.
9. **Seguimiento**. Al terminar, `followUps.arm` programa un seguimiento. Si la otra persona no contesta, el scheduler puede escribir de nuevo, hasta `maxAttempts` veces, respetando `quietHours`.

## Módulos

| Módulo | Responsabilidad |
|--------|-----------------|
| `server.js` | API Express, panel estático y arranque del bot. |
| `bot.js` | Conexión con WhatsApp, buffers de mensajes, envío y reconexión. |
| `config.js` | Carga, fusión con valores por defecto y guardado de `data/config.json`. |
| `responder.js` | Armado del prompt, llamada al modelo y control de fidelidad (guard). |
| `llm.js` | Cliente HTTP para cualquier API compatible con OpenAI. |
| `style.js` | Importación de exports de chat, perfil de estilo y ejemplos. |
| `lexicon.js` / `allowlist.js` | Léxico del dueño y palabras extra permitidas por el dueño. |
| `topics.js` | Detección de temas sensibles por palabras clave. |
| `intents.js` | Situaciones típicas (saludos, cariño, etc.) con las respuestas reales del dueño como ejemplo para el modelo. |
| `retrieval.js` | Búsqueda BM25 simplificada en el corpus: devuelve los pares "ella → dueño" más parecidos al mensaje actual. |
| `reply-parser.js` | Formato de los mensajes entrantes y separación de la respuesta del modelo en partes. |
| `followup.js` | Scheduler de seguimientos, con horario silencioso. Dependencias inyectadas para testear. |
| `pacing.js` | Cálculo de ráfagas y tiempos de escritura. Funciones puras. |
| `phone.js` | Normalización de números y variantes (por ejemplo, Argentina con y sin 9). |
| `simulator.js` / `routes/simulate.js` | Simula conversaciones y seguimientos sin enviar nada por WhatsApp. |
| `routes/contacts.js` | Verificación de que un número existe en WhatsApp. |
| `routes/vocabulary.js` | Alta y baja de palabras permitidas. |

## Decisiones de diseño

- **Imitar sin inventar**. El guard rechaza respuestas con palabras que el dueño no usa. Es la principal defensa contra respuestas que no suenen a él.
- **Modo seguro por defecto**. `dryRun` y `paused` arrancan en `true` en `data/config.json` del repositorio local. Para enviar de verdad hay que cambiarlos desde el panel.
- **Inyección de dependencias**. `respond` y `createFollowUpScheduler` reciben el modelo, el reloj y los timers como parámetros. Así se testean sin WhatsApp ni red.
- **Configuración editable en caliente**. `updateConfig` escribe el JSON y emite un evento para que el panel se actualice.
- **Respuestas en partes**. El modelo puede devolver varios mensajes. `limitParts` respeta el máximo de `burst` uniendo el excedente en el último, para no perder contenido.
- **Reconexión**. Si la conexión se cae, el bot reintenta con espera creciente (`scheduleReconnect`).

## Tests

Hay 10 archivos en `test/` que cubren la lógica pura: léxico, teléfonos, ritmo, seguimientos, respuestas, temas, intenciones y simulador. No hay tests de `bot.js` ni de las rutas HTTP, porque dependen de WhatsApp y de la red.

## Limitaciones conocidas

- `.env.example` no coincide con lo que lee el código (ver [README](../README.md#configuración)).
- `web/README.md` es la plantilla por defecto de Vite y no describe el proyecto.
- `@anthropic-ai/sdk` figura en `package.json`, pero no se usa. El cliente de modelos es `fetch` en `src/llm.js`.
- `scripts/build-style.js` no tiene entrada en `package.json`. Se ejecuta a mano con `node scripts/build-style.js <export.txt> <nombre>`.
- El modo `DRY_RUN` solo se controla desde `config.dryRun`. La variable de entorno del mismo nombre no tiene efecto.
