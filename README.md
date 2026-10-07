# Showtime

App web de **regiduría** (stage manager) para eventos en directo (festivales, galas, conciertos, corporativos).

- **Dashboard** (`index.html`): crea el evento (zonas, bandas, horarios de show y soundcheck, tareas, hitos) y lo lleva en directo: ▶ / ■, En hora, Tiempo extra y bis, retrasos, CALL, mensajes, avisos, el tiempo y Event Log.
- **Pantalla Live** (`live.html`): pantalla de escenario para el monitor HDMI — reloj, EN ESCENA, CHANGEOVER, SIGUIENTE, CALL y línea de tiempo. Se abre desde el Dashboard.
- **Móviles por QR** (cifrado de extremo a extremo): Staff (Live en solo lectura), Mando del Stage Manager (`remote.html`) y Producción (mensajes, OK de CALL y chat).

Funciona sin instalar nada: abrir `index.html` en el navegador (o usar la versión publicada en GitHub Pages). Los eventos se guardan en el navegador y se exportan como `.json`. Solo la emisión a móviles y el tiempo necesitan internet.

- **Pegar horario**: pega celdas de Excel/Numbers/Sheets o texto (PDF, WhatsApp, correo), o arrastra un `.csv` / `.tsv`; vista previa editable antes de importar.

Tests: `for f in tests/*.test.js; do node "$f"; done` o abrir `tests/index.html`.
