# Refactorización: Panel Lateral de Producción

## Cambios Realizados

### 1. **control.js** - Refactorización de `showProducerQR()`
- ✅ Cambió de modal fullscreen a panel lateral integrado
- ✅ Renderiza en `.prod-qr-side` (panel derecho)
- ✅ Muestra: nombre productor, QR, estado, botones de acción
- ✅ Marca item como `.active` al seleccionar

### 2. **control.js** - Actualización de `paneHtml()`
- ✅ Estructura de `.cprod-split` (grid de 2 columnas)
  - `.cprod-left`: lista de productores + input + nota
  - `.cprod-right`: panel lateral con QR

### 3. **control.js** - Función `closeProducerQR()`
- ✅ Limpia el panel derecho (no modal fijo)
- ✅ Remueve clase `.active` de items

### 4. **control.css** - Nuevos Estilos
- ✅ `.cprod-split`: grid 240px + 1fr
- ✅ `.cprod-left/right`: flexbox vertical
- ✅ `.prod-qr-content`: centrado con flex
- ✅ `.prod-item.active`: highlight de selección
- ✅ `.prod-buttons`: botones apilados

## Arquitectura Final

```
┌─────────────────────────────────────────┐
│ EMISIÓN › PRODUCCIÓN                    │
├────────────────┬──────────────────────┤
│                │                      │
│  Productores   │   Panel de QR       │
│  ─────────────  │   ──────────────    │
│  ┌───────────┐ │   ┌──────────────┐  │
│  │+ Agregar  │ │   │  Nombre      │  │
│  │ · Prod 01 │◄──── │  · ID        │  │
│  │ · Prod 02 │ │   │              │  │
│  │ · Prod 03 │ │   │  [QR Code]   │  │
│  └───────────┘ │   │              │  │
│  Toca productor│   │  ● En directo│  │
│  para ver QR   │   │  0 conectados│  │
│                │   │              │  │
│                │   │ [Ampliar] [Copiar]
│                │   │ [Parar] [Regen]
│                │   └──────────────┘  │
└────────────────┴──────────────────────┘
```

## Funcionalidad

1. **Lado Izquierdo (Lista)**
   - Input para agregar productores
   - Lista de productores existentes
   - Click para seleccionar
   - Botón ✕ para eliminar

2. **Lado Derecho (Panel QR)**
   - Muestra QR del productor seleccionado
   - Nombre + ID del productor
   - Estado "En directo"
   - Dispositivos conectados
   - Botones:
     - **Ampliar**: abre modal elegante (reutiliza estilos glass)
     - **Copiar enlace**: copia URL al portapapeles
     - **Parar**: detiene emisión
     - **Regen**: regenera claves

3. **Comportamiento**
   - Al seleccionar productor → QR aparece en panel derecho
   - Panel derecho muestra mensaje "Selecciona..." si vacío
   - Botón Ampliar abre modal (reutiliza implementación existente)

## Compatibilidad

- ✅ Misma estructura que Staff/Manager (panel lateral)
- ✅ Reutiliza estilos glass effect para modales
- ✅ Responsive design (grid adapta a pantallas estrechas)
- ✅ Accesibilidad con estructura semántica
