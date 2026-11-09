# contestador-automatico

Bot de WhatsApp que responde mensajes en nombre del dueño, imitando su forma de escribir. Solo contesta a los contactos que el dueño habilita, y se controla desde un panel web.

Si acabás de llegar al proyecto, leé primero esta página. El flujo técnico detallado está en [docs/arquitectura.md](docs/arquitectura.md).

## Qué hace

- Escucha los mensajes entrantes de WhatsApp (vía [Baileys](https://github.com/WhiskeySockets/Baileys)).
- Si el remitente está en la lista de contactos habilitados, junta los mensajes que llegan en ráfaga y genera una respuesta con un modelo de lenguaje.
- Arma el prompt con: la descripción del dueño (`data/about-me.md`), su perfil de estilo (`data/style-*.json`), el historial reciente de la conversación y un léxico permitido.
- Envía la respuesta en uno o varios mensajes, con pausas de "escribiendo…" para parecer humano.
- Opcionalmente, escribe seguimientos si la otra persona deja de contestar.
- Se pausa solo si detecta temas sensibles (dinero, emergencias, citas, etc.), y avisa al dueño.
- Si el dueño escribe a mano en esa conversación, el bot se calla un rato (`manualPauseMin`).

## Stack

- Node.js con ES modules (`"type": "module"`).
- Express 5: API del panel en el puerto 3001.
- Baileys: cliente de WhatsApp.
- React + Vite en `web/`: panel de control.
- Tests con `node --test`.
- Modelos: cualquier API compatible con OpenAI (por defecto, OpenCode). Ver `src/llm.js`.

## Puesta en marcha

Requisitos: Node.js (el proyecto no declara una versión mínima en `package.json`; se usó Node 24) y una cuenta de WhatsApp para vincular.

```bash
npm install
npm --prefix web install
npm run build      # genera web/dist, que el servidor sirve como panel
npm start          # API en http://localhost:3001
```

Para desarrollo con recarga automática del backend y del frontend:

```bash
npm run dev
```

Al arrancar, el bot muestra un QR en el panel. Escanearlo desde WhatsApp vincula la sesión, que se guarda en `auth/`.

Para correr los tests:

```bash
npm test
```

## Configuración

La configuración vive en `data/config.json` y se edita desde el panel. El archivo se crea con valores por defecto (`DEFAULTS` en `src/config.js`) si no existe.

Campos principales:

| Campo | Qué controla |
|-------|--------------|
| `dryRun` | Si es `true`, el bot genera las respuestas pero no las envía; solo las registra en el log. |
| `paused` | Pausa global del bot. |
| `contacts` | Lista de contactos `{ number, name, enabled, paused }`. Solo se responde a los `enabled`. |
| `ownerNumber` | Número del dueño, para recibir avisos y comandos. |
| `provider` | `baseUrl`, `model`, `maxTokens`, `temperature` y la clave de API del modelo. |
| `burst` / `typing` | Cuántos mensajes seguidos enviar y cuántos segundos "escribir" antes de cada uno. |
| `debounceMinSec` / `debounceMaxSec` | Espera antes de responder, para agrupar mensajes que llegan de a poco. |
| `manualPauseMin` | Minutos que el bot espera después de que el dueño escribe a mano. |
| `guard` | Rechaza respuestas con palabras que el dueño nunca usa, y pide reintentar. |
| `followUp` | Seguimientos automáticos, con horario silencioso (`quietHours`). |
| `sensitiveTopics` | Temas con palabras clave que pausan el bot y avisan al dueño. |

Notas:

- `.env.example` lista `ANTHROPIC_API_KEY`, `TARGET_NUMBER`, `OWNER_NUMBER`, `MODEL` y `DRY_RUN`, pero el código **no los lee**. La única variable de entorno que usa es `PORT`. La configuración real está en `data/config.json`.
- La clave del proveedor se guarda en `data/config.json`. Ese archivo, junto con `auth/` y `data/`, está en `.gitignore`. No lo subas al repositorio.

## Estructura del repositorio

```
src/        Lógica del bot y de la API (ver docs/arquitectura.md)
web/        Panel de control en React + Vite
test/       Tests unitarios (node --test)
scripts/    Herramientas auxiliares (build-style.js)
data/       Configuración, perfiles e historial (no versionado)
auth/       Sesión de WhatsApp (no versionado)
docs/       Documentación técnica
```

## Documentación relacionada

- [docs/arquitectura.md](docs/arquitectura.md): flujo de un mensaje, módulos y decisiones de diseño.
