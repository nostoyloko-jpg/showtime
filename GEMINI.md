# GEMINI.md — Showtime

Las reglas generales (idioma, tono, permisos, commits, varias IAs) están en el `GEMINI.md` global. Este archivo solo añade lo específico de este proyecto.

## Qué es
- **Showtime**: app web de **regiduría** (stage manager). Dos pantallas:
  - **Panel de Control** (`index.html`): el regidor crea el **evento** (escenarios, bandas, horarios de show y soundcheck) y lo controla en directo.
  - **Pantalla Live** (`live.html`): la pantalla de escenario (reloj, EN ESCENA, CHANGEOVER, SIGUIENTE, CALL, línea de tiempo). Se abre como ventana emergente desde el Panel para llevarla al monitor HDMI.
- **Evento**, nunca «festival» en la interfaz (también galas, conciertos únicos, corporativos). En el JSON el campo sigue siendo `event`.
- **Synapse** = nombre actual de Stage Master (`~/Developer/mi-app-web`). Proyecto aparte: no lo toques desde aquí salvo con el parche de `parches/` y cuando L.A. lo pida.

## REGLA DE ORO
**Cero automatismos mágicos.** La app no adivina ni cambia estados sola (día, retrasos, standby, cascadas). Lo que falta se **avisa**; el regidor decide con una acción explícita.

## Archivos
- Copia de trabajo: `~/Claude/SHOWTIME` (no iCloud). Repositorio git en esta carpeta; en GitHub: `nostoyloko-jpg/showtime`, publicado con GitHub Pages.

| Archivo | Qué es |
|---|---|
| `index.html` · `control.js` · `control.css` | Panel de Control |
| `live.html` · `live.js` · `live.css` | Pantalla Live |
| `core.js` | Reglas de tiempo y edición, puras (sin DOM). Las usan las dos pantallas |
| `datos.js` | Estado compartido (localStorage) y sincronización entre ventanas |
| `importar.js` | «Pegar horario»: lee tablas (TSV/CSV) y texto libre, vista previa y alta. Puro, con tests |
| `tests/core.test.js` · `tests/importar.test.js` · `tests/index.html` | Tests (node o navegador) |
| `parches/synapse-live-completo/` | Parche que pone en Synapse Live el mismo código que la Pantalla Live de Showtime |
| `referencia/` | Material de partida (código extraído de Synapse, ejemplos). **No se publica ni se toca** |

- Sin npm, sin compilar: scripts clásicos. Funciona con doble clic y en GitHub Pages. **No añadas dependencias** sin preguntar.

## Zonas delicadas — preguntar antes de tocar
- **Tiempo**: todo en minutos absolutos desde 2000-01-01. Nunca «hora del día» suelta.
- **Jornada y hora de corte**: lo que empieza antes de la hora de corte (06:00 por defecto, configurable por evento) es de la jornada anterior. En el Panel se edita la **jornada**; la fecha real se calcula.
- **CALL en cascada**: hora de CALL escrita (anterior al inicio) → avisa desde esa hora; vacía o «—» → inicio − minutos del evento. Por margen, no por instante.
- **CHANGEOVER**: solo entre bandas del **mismo escenario y la misma jornada**. STANDBY solo si el regidor lo marca.
- Los manejadores van con `addEventListener` (no `onclick` en el HTML). `let`/`const` declarados antes de usarse.

## Reglas de trabajo
- **Después de cualquier cambio**: `node tests/core.test.js` y `node tests/importar.test.js` (todo en verde) y **abrir `index.html` y la Pantalla Live** desde el botón del Panel: que pinten y que la consola no tenga errores.
- Fondo **siempre oscuro**. Estilos con los mismos nombres que Synapse: Clásico, Escenario (alto contraste), Neutro, Raycast.
- Vocabulario del oficio: CALL, soundcheck, changeover, standby, jornada.

## Comprobación a mano
1. Panel: **Nuevo evento** → crear escenarios en Configuración → añadir 3–4 bandas (una de madrugada, p. ej. 02:00).
2. **Abrir Pantalla Live**: aparece el evento; cambiar estilo en Configuración → la Live cambia.
3. Pestañas de jornadas, Show/Soundcheck, Duplicar en otra jornada, marcar un hueco como STANDBY, Deshacer.
4. **Exportar** y volver a **Abrir** el JSON.

## Synapse Live (cuando L.A. lo pida)
- Aplicar o **actualizar** el parche (si ya estaba aplicado, solo sustituye su bloque):
  `node ~/Claude/SHOWTIME/parches/synapse-live-completo/aplicar-parche-synapse-completo.js ~/Developer/mi-app-web/index.html`
- Si cambia la Pantalla Live de Showtime, antes se regenera: `cd parches/synapse-live-completo && python3 generar.py`.
- Si algún punto no cuadra, el script no toca nada: enseña el mensaje a L.A.

## Contexto de trabajo
- El código lo escribe **Claude (Cowork)** directamente en esta carpeta y lo prueba en su entorno (Chromium). No tiene Firefox.
- Tu papel: **verificar en este Mac** (tests, abrir las pantallas en Firefox/Brave), enseñar el `git diff` y **commitear en local**. La subida a GitHub la hace L.A., paso a paso.
