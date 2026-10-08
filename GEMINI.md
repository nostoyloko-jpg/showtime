# GEMINI.md — Showtime

Las reglas generales (idioma, tono, permisos, commits, varias IAs) están en el `GEMINI.md` global. Este archivo solo añade lo específico de este proyecto.

## Qué es
- **Showtime**: app web de **regiduría** (stage manager) para eventos en directo.
  - **Dashboard** (`index.html`): el **Stage Manager** crea el **evento** (zonas, bandas, horarios de show y soundcheck, tareas, hitos) y lo lleva en directo (▶ / ■, En hora, Tiempo extra y bis, retrasos, CALL, mensajes, avisos, el tiempo, Event Log).
  - **Pantalla Live** (`live.html`): la pantalla de escenario (reloj, EN ESCENA, CHANGEOVER, SIGUIENTE, CALL, línea de tiempo, cinta). Se abre como ventana emergente desde el Dashboard para llevarla al monitor HDMI.
  - **Emisión a móviles** (QR desde el Dashboard, MQTT cifrado de extremo a extremo): **Staff** (Live en solo lectura: Manager · Confidence por zona · Backstage), **Mando** del Stage Manager (`remote.html`) y **Producción** (Live de Manager + menú de mensajes a la izquierda + chat con el Stage Manager; un QR por persona).
- **Evento**, nunca «festival» en la interfaz (también galas, conciertos únicos, corporativos). En el JSON el campo sigue siendo `event`.
- **Roles**: «Stage Manager» (nunca «regidor» en la interfaz): control total. **Producción**: confirma CALL (queda en el log quién dio cada OK), manda mensajes y avisos; **sin** controles de tiempo ni edición de la escaleta.
- **Synapse** = nombre actual de Stage Master (`~/Developer/mi-app-web`). Proyecto aparte: no lo toques desde aquí salvo con el parche de `parches/` y cuando L.A. lo pida.

## REGLA DE ORO
**Cero automatismos mágicos.** La app no adivina ni cambia estados sola (día, retrasos, standby, cascadas). Lo que falta se **avisa**; el Stage Manager decide con una acción explícita.

## Archivos
- Copia de trabajo: `~/Claude/SHOWTIME` (no iCloud). Repositorio git en esta carpeta; en GitHub: `nostoyloko-jpg/showtime`, publicado con GitHub Pages.

| Archivo | Qué es |
|---|---|
| `index.html` · `control.js` · `control.css` | Dashboard |
| `live.html` · `live.js` · `live.css` | Pantalla Live (también la de Staff y la de Producción en el móvil) |
| `remote.html` · `remote.js` · `remote.css` | Mando táctil del Stage Manager |
| `core.js` | Reglas de tiempo y edición, puras (sin DOM). Las usan todas las pantallas |
| `mando.js` | Órdenes de directo (▶ / ■, En hora, Tiempo extra y bis, corrección de inicio, retrasos), compartidas por Dashboard y Mando |
| `vistas.js` | Vistas de la Live (Manager · Confidence · Backstage) y lo que ve cada una |
| `datos.js` | Estado compartido (localStorage), sincronización entre ventanas, avisos y chat |
| `emision.js` | Emisión a móviles: MQTT, AES-GCM, firmas, claves separadas de Staff / Mando / Producción |
| `log.js` | Event Log (solo se añade, nunca se reescribe) y exportación |
| `meteo.js` | El tiempo (Open-Meteo, URL propia o manual) y avisos de previsión |
| `importar.js` | «Pegar horario»: lee tablas (TSV/CSV) y texto libre, vista previa y alta |
| `qr.js` | Generador de QR propio (sin dependencias) |
| `xlsx.js` | Lector de Excel (.xlsx) propio, sin librerías: abre el ZIP con `DecompressionStream` y saca la primera hoja con datos como texto tabulado para «Pegar horario» |
| `tests/*.test.js` · `tests/_dom.js` · `tests/index.html` · `tests/fixtures/` | Tests (node o navegador). `_dom.js` = navegador simulado con **reloj simulado** (`makeEnv({ now })`) y archivos de verdad (File/FileReader). `fixtures/` = Excel reales para los tests del lector |
| `parches/synapse-live-completo/` | Parche que pone en Synapse Live el mismo código que la Pantalla Live de Showtime |
| `referencia/` | Material de partida (código extraído de Synapse, ejemplos). **No se publica ni se toca** |

- Sin npm, sin compilar: scripts clásicos. Funciona con doble clic y en GitHub Pages. **No añadas dependencias** sin preguntar.
- **Versión anti-caché**: al cambiar cualquier `.js`/`.css`, sube el número `?v=AAAAMMNN` en `index.html`, `live.html` y `remote.html`, `BUILD` en `emision.js` **y** `VERSION` en `sw.js` (todos iguales; `tests/pwa.test.js` lo comprueba).
- **App instalable / sin conexión (PWA)**: `manifest.webmanifest` (solo lo enlaza el Dashboard: la Live y el mando se guardan con su enlace, que lleva las claves), `sw.js` (red primero con 3 s de límite y caché de respaldo; solo archivos propios) y `pwa.js` (registro, solo por http/https). Un archivo nuevo de la app → añadirlo a `PRECACHE` en `sw.js` (el test avisa si falta).

## Zonas delicadas — preguntar antes de tocar
- **Tiempo**: todo en minutos absolutos desde 2000-01-01. Nunca «hora del día» suelta.
- **Jornada y hora de corte**: lo que empieza antes de la hora de corte (06:00 por defecto, configurable por evento) es de la jornada anterior. En el Dashboard se edita la **jornada**; la fecha real se calcula.
- **CALL en cascada**: hora de CALL escrita (anterior al inicio) → avisa desde esa hora; vacía o «—» → inicio − minutos del evento. Por margen, no por instante.
- **CHANGEOVER**: solo entre bandas de la **misma zona y la misma jornada**. STANDBY solo si el Stage Manager lo marca.
- **Bis (Tiempo extra tardío)**: se puede rescatar la banda que acaba de terminar hasta que la siguiente de su zona dé ▶, y como mucho 15 min (o el colchón del cambio si es mayor). En EN ESCENA sale en la tarjeta de CHANGEOVER, en «Sin actividad» si la anterior era de la jornada de antes (pasada la hora de corte) o en una fila «ACABÓ» si no viene nadie detrás.
- **Importar**: todo lo que se pega o se suelta (⌘V, arrastrar, «Subir archivo») pasa por la **vista previa**; nada se guarda hasta «Importar». Sin evento abierto, al importar se crea «Evento sin nombre» con las jornadas detectadas. PDF: no se lee (sin librerías); se abre la caja de pegar con el aviso de copiar el texto. Tablas reales de festival (ES/EN): relleno hacia abajo de celdas combinadas (Jornada, Zona), cabeceras repetidas por jornada, zona en el título de la primera columna («GIGANTE»), columnas de turnos del personal ignoradas, horas de prueba (entrada/salida a escenario) → soundcheck, concierto → show, comidas → tarea; un Excel con una hoja por zona se junta solo. Hojas de ruta (roadbook) en bloques «hora / actividad / quién va» o en tabla HORA · ACCIÓN · NOTA: la columna de personas va a notas (nunca zonas), «(45')» = duración, «TBC»/«En ruta» se ignoran (listadas).
- **Importador: reglas generales, no a medida** (cada caso nuevo entra en `tests/importar-corpus.test.js` ANTES de tocar el código, y no puede romper los anteriores):
  - Palabras de tarea **fuertes** (comida, montaje, transfer, load in…) valen siempre; las **débiles** (hotel, bus, prensa, ave…) solo en documentos de producción, porque también son nombres de banda.
  - Lo que no se reconoce queda como **show**: el Stage Manager lo cambia en la vista previa (no se adivina).
  - **Zonas nuevas solo de shows y soundchecks**; el sitio de una tarea («Hotel», «Aeropuerto») va a notas. Las columnas de personas («ANA + BEA», «CREW», «ALL») son notas, nunca zonas.
  - Una fila o línea corta con palabra de escenario es una **sección de zona**; un título en mayúsculas sin ella («ACTIVIDADES») cierra la zona.
  - Formatos: parrilla con una columna por escenario, fechas con ordinal y mes/día americano, AM/PM, «until/till/→/~», emojis y puntos de relleno.
- **Producción**: sus mensajes **nunca** van a Confidence (solo Manager / Backstage). Los avisos permanentes solo los quita el Stage Manager (✕ en el Dashboard). El chat Producción ↔ Stage Manager no entra en el Event Log y va con clave propia (privado frente a Staff).
- Los manejadores van con `addEventListener` (no `onclick` en el HTML). `let`/`const` declarados antes de usarse. Sin `console.log` de depuración (solo `console.error` en errores reales).

## Reglas de trabajo
- **Toda función nueva va con su test.** Los tests no dependen de la hora real: usan el reloj simulado de `tests/_dom.js`.
- **Después de cualquier cambio**: todos los tests en verde —
  `for f in tests/*.test.js; do node "$f"; done`
  — y **abrir el Dashboard y la Pantalla Live**: que pinten y que la consola no tenga errores.
- Fondo **siempre oscuro**. Estilos con los mismos nombres que Synapse: Clásico, Escenario (alto contraste), Neutro, Raycast.
- Vocabulario del oficio: CALL, soundcheck, changeover, standby, jornada, bis.

## Comprobación a mano
1. Dashboard: **Nuevo evento** → crear zonas en Configuración → añadir 3–4 bandas (una de madrugada, p. ej. 02:00).
2. **Abrir Pantalla Live**: aparece el evento; cambiar estilo en Configuración → la Live cambia.
3. Jornadas, Show/Soundcheck, Duplicar en otra jornada, marcar un hueco como STANDBY, Deshacer, Modo foco (⇧⌘F).
4. **Emisión**: QR de Staff, del Mando y de Producción → abrir en el móvil.
5. **Exportar** y volver a **Abrir** el JSON.

## Synapse Live (cuando L.A. lo pida)
- Aplicar o **actualizar** el parche (si ya estaba aplicado, solo sustituye su bloque):
  `node ~/Claude/SHOWTIME/parches/synapse-live-completo/aplicar-parche-synapse-completo.js ~/Developer/mi-app-web/index.html`
- Si cambia la Pantalla Live de Showtime, antes se regenera: `cd parches/synapse-live-completo && python3 generar.py`.
- Si algún punto no cuadra, el script no toca nada: enseña el mensaje a L.A.

## Contexto de trabajo
- El código lo escribe **Claude (Cowork)** directamente en esta carpeta y lo prueba en su entorno (Chromium). No tiene Firefox.
- Tu papel: **verificar en este Mac** (tests, abrir las pantallas en Firefox/Brave), enseñar el `git diff`. El commit y la subida a GitHub los hace L.A.
