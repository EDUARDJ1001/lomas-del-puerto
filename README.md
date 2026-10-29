# Lomas del Puerto — mapa de lotes

Mapa interactivo de los 53 lotes (bloques A, B y C) del plano de lotificación, Barrio Lomas del Puerto, Puerto Cortés.

## Ver la web

```bash
node tools/serve.mjs
```

Abrir http://localhost:5180 (el servidor también muestra la dirección para verlo desde el celular en la misma red).

- `index.html`: landing ("Oportunidad de inversión").
- `mapa.html`: mapa interactivo de lotes (publicado como `/mapa`).

## Despliegue — Vercel

Sitio estático, sin build: en Vercel, *Framework Preset* "Other", sin *Build Command* y con la raíz como *Output Directory*.
Cada push a `main` se publica solo. `vercel.json` activa las direcciones limpias y la caché; `.vercelignore` deja fuera `tools/` y `.claude/`.

## Videos del landing — carpeta `media/`

| Archivo | Dónde se ve |
|---|---|
| `media/hero.mp4` | Fondo de la portada (toma de dron, en bucle y sin sonido) |
| `media/hero.jpg` | Imagen fija mientras carga el video de portada (opcional) |

Mientras no exista, se muestra un fondo verde oscuro.
Para que cargue rápido en el celular conviene exportarlo en 1080p (H.264) y con una duración de unos 10–20 s.

## Configuración — `js/config.js`

Número de WhatsApp (activa el botón "Me interesa este lote" en el mapa), moneda y coordenadas de la ubicación.

## Editar lotes — `data/inventario.json`

Cada lote se identifica como `BLOQUE-NÚMERO` (por ejemplo `A-7`):

```json
"A-7": {
  "estado": "disponible",
  "precio": 350000,
  "descripcion": "Lote plano, frente a calle principal.",
  "medidas": "10 × 17 m",
  "fotos": ["fotos/A-7/1.jpg", "fotos/A-7/2.jpg"]
}
```

- `estado`: `disponible` (verde, se puede abrir) o cualquier otro valor como `vendido` o `reservado` (gris, sin acción).
- `precio`: número, o `null` para mostrar "A consultar".
- `medidas`: opcional. Si no se pone, se muestran las medidas calculadas del plano (solo en lotes de 4 lados).
- `fotos`: rutas dentro de la carpeta `fotos/`. La primera es la portada.

## Regenerar la geometría desde el plano

`data/lotes.json` y `data/plano-base.json` salen de `pdfdata/pdfimport.dxf` (PDFIMPORT del plano en AutoCAD). La carpeta `pdfdata/` no se sube al repositorio porque contiene datos del terreno:

```bash
node tools/extract-lotes.mjs
```
