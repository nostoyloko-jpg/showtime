# Parche completo: Synapse Live = Pantalla Live de Showtime

Deja la ventana Live de Synapse **exactamente igual** que la Pantalla Live de Showtime: usa el mismo código (`live.html` + `live.css` + `core.js` + `live.js`).
**Sustituye al parche anterior** (`parches/synapse-live`). Funciona tanto si aquel se aplicó como si no.

## Aplicar (agy)

```
node ~/Claude/SHOWTIME/parches/synapse-live-completo/aplicar-parche-synapse-completo.js ~/Developer/mi-app-web/index.html
```

- Cambia solo 2 sitios de `index.html`: renombra `function buildLiveWindow(){` → `buildLiveWindow_OLD` y `function pushLiveUpdate(){` → `pushLiveUpdate_OLD`, y añade delante el bloque nuevo (`bloque-showtime-live.js`).
- Si alguno de los 2 sitios no aparece exactamente una vez, **no toca nada**.
- Copia del original: `index.html.antes-showtime-live`.

## Qué incluye

Todo lo de la Pantalla Live de Showtime: reloj HH:MM · SIGUIENTE en 3 líneas con píldora de cambio · CHANGEOVER en EN ESCENA (solo dentro de la misma jornada) · nombres en 2 líneas · panel de las barras sin solapes · CALL en cascada (hora escrita o inicio − minutos) · línea de CALL tras medianoche · OK de CALL que no vuelve al recargar · FIN DE JORNADA · etiquetas de barras sin «SIGUIENTE» repetido · iconos SVG · pantalla completa (botón o F) · pantalla siempre encendida · arrastres con dedo · aviso visible si la jornada elegida no tiene datos · 4 estilos.

## Lo que no cambia en Synapse

- Se abre igual (botones del cronograma de Show y Soundcheck), con el mismo día filtrado y el mismo estilo (`liveStyle`).
- Los cambios de horario siguen llegando al momento (`pushLiveUpdate`), y el cambio de estilo en caliente también.
- STANDBY y CALL de show no aparecen porque Synapse no tiene esos campos (se verían si el JSON los trae de Showtime).
- Las preferencias de la ventana (zoom, altos, anchos) empiezan de cero una vez: ahora se guardan como en Showtime.

## Actualizar en el futuro

Si cambia la Pantalla Live de Showtime: `python3 generar.py` en esta carpeta rehace el bloque y el script con la versión nueva. Para aplicarlo hay que partir de la copia `.antes-showtime-live` (el script no se aplica dos veces).
