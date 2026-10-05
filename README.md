# Showtime

App web de **regiduría** para eventos en directo (festivales, galas, conciertos, corporativos).

- **Panel de Control** (`index.html`): crea el evento (escenarios, bandas, horarios de show y soundcheck), marca standby, controla la jornada y los avisos CALL.
- **Pantalla Live** (`live.html`): pantalla de escenario para el monitor HDMI — reloj, EN ESCENA, CHANGEOVER, SIGUIENTE, CALL y línea de tiempo. Se abre desde el Panel.

Funciona sin internet y sin instalar nada: abrir `index.html` en el navegador (o usar la versión publicada en GitHub Pages). Los eventos se guardan en el navegador y se exportan como `.json`.

Tests de las reglas de tiempo: `node tests/core.test.js` o abrir `tests/index.html`.
