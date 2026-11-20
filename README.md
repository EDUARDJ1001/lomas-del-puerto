# Lomas del Puerto — mapa de lotes

Mapa interactivo de los lotes de Barrio Lomas del Puerto, Puerto Cortés, en dos lados:

- **Primer plano**: 61 lotes (bloques A, B y C), con ids `A-1` … `C-22`.
- **Lado 2, polígono 1B**: 33 lotes (bloques A, B y C) y 5 locales comerciales, al suroeste de la punta sur del primero. Sus ids llevan delante el polígono, `1B-A-1` … `1B-C-10`, y los locales son `1B-L-1` … `1B-L-5`.

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
| `media/hero-720.webm`, `media/hero-720.mp4` | Fondo de la portada en celulares (hasta 900 px de ancho) |
| `media/hero-1080.webm`, `media/hero-1080.mp4` | Fondo de la portada en pantallas grandes |
| `media/hero.jpg` | Imagen fija mientras carga el video, o si el sistema pide reducir movimiento |

El navegador usa WebM si lo soporta (pesa menos) y si no, MP4. Si ningún video carga, se muestra un fondo verde oscuro.
Los originales están en `videos/`, que no se sube al repositorio porque el master pesa unos 270 MB.

## Configuración — `js/config.js`

Número de WhatsApp (activa el botón "Me interesa este lote" en el mapa), moneda y coordenadas de la ubicación.

### Plano sobre el mapa

`mapa.html` dibuja el plano con [Leaflet](https://leafletjs.com) encima de un mapa real. Hay dos fondos: **Relieve** (OpenTopoMap: curvas de nivel, sombreado y calles de OpenStreetMap) y **Satélite** (Esri World Imagery con las calles de Esri encima). Los mosaicos del mapa se piden solo dentro de `radioMapaKm` (5 km) alrededor del proyecto, y el mapa no deja alejarse ni moverse fuera de ese radio.

`plano` dice dónde va el plano. Está ajustado *a mano*, a escala real, para que su lado suroeste corra junto a la calle existente sin taparla:

```js
plano: { origen: [193.83, 179.34], lat: 15.812103, lng: -87.926960, rotacion: 86.8 },
```

- `lat` / `lng`: dónde cae el centro del plano. Para moverlo, 0.00001° son unos 1.1 m (en `lat` hacia el norte, en `lng` hacia el este).
- `rotacion`: grados de giro en sentido antihorario.

`plano2` hace lo mismo con el lado 2. Su `origen` es la esquina este del local 1: queda junto a la calle existente, al oeste de la calle que baja al sur. Sin `plano2` el lado 2 no se muestra.

```js
plano2: { origen: [216.4, 44.4], lat: 15.810837, lng: -87.926774, rotacion: 69.7 },
```

### Mi ubicación

El botón ◎ (arriba del + y −) pide permiso de ubicación y muestra un punto azul, con un círculo del margen de error del GPS, y una flecha hacia donde se camina. El lote donde está la persona se marca en azul y un aviso abajo dice "Estás en Lote 7 · Bloque B" ("Probablemente en…" si el margen de error llega al borde del lote). Al tocar el aviso se abre la ficha. Fuera de los lotes dice si se está en la calle o a cuántos metros o kilómetros queda el proyecto.

- Primer toque: busca la ubicación y la sigue. Al mover el mapa con el dedo deja de seguirla; tocar el botón la vuelve a centrar, y otro toque la apaga.
- Solo funciona con la página abierta y sobre HTTPS (Vercel). La ubicación no sale del teléfono.
- La precisión depende del plano: si el punto cae corrido unos metros en el terreno, se ajusta `plano` (y `plano2`) en `js/config.js`.

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

- `estado`: `disponible` (verde, se puede abrir), `reservado` (naranja, con la palabra "Reservado"), `vendido` (rojo, con la palabra "Vendido") o `no_disponible` (gris claro, con "No disponible": aún no está a la venta; de momento, todo el lado 2). Solo los disponibles abren ficha.
- `precio`: número propio del lote. Sin él, el mapa muestra un precio aproximado: `area_vrs2` × la tarifa general por vara² (ver "Tarifa general" más abajo).
- `medidas`: opcional. Si no se pone, se muestran las medidas de cada lado según las cotas del plano (o el largo medido en el dibujo donde no hay cota).
- `fotos`: rutas dentro de la carpeta `fotos/`. La primera es la portada.

## Base de datos — Supabase (opcional)

Mientras `supabase` esté vacío en `js/config.js`, el sitio usa `data/inventario.json`. Para pasar el inventario a Supabase:

1. **SQL Editor → New query**: pegar y ejecutar `supabase/schema.sql`. Crea:
   - la tabla `lotes`;
   - la tabla `administradores`;
   - los permisos;
   - el bucket público `fotos`.

   En una base que ya existía, volver a ejecutarlo agrega la columna `sector` (`'1B'` en el lado 2) y permite los locales (bloque `L`).
   También crea la tabla `ajustes` (tarifa general). En una base que ya existía, basta con ejecutar `supabase/ajustes.sql` (se puede repetir).
2. Ejecutar `supabase/seed.sql` (los 99 lotes de los dos lados). Se regenera con `node tools/seed-supabase.mjs` si cambia `data/inventario.json`.
3. **Authentication → Sign In / Providers**: desactivar *Allow new users to sign up*.
4. **Authentication → Users → Add user → Create new user**: crear la cuenta con correo y contraseña, y marcar *Auto Confirm User*. Después darle permiso de edición en el SQL Editor:
   ```sql
   insert into public.administradores (user_id, email)
   select id, email from auth.users where email = 'correo@ejemplo.com';
   ```
5. **Project Settings → API**: copiar la *Project URL* y la clave pública *anon* (o *publishable*) en `js/config.js`. Esa clave es pública por diseño. La *service_role* o *secret* nunca va en el sitio.

Las contraseñas las guarda Supabase Auth, cifradas, en `auth.users`. La tabla `administradores` solo indica qué cuentas pueden editar.

### Panel de administración — `/admin`

Tiene una barra lateral (en celular, un menú ☰) con dos partes: **Disponibilidad** y **Contabilidad**. Cada sección tiene su propia dirección (`/admin#contabilidad/pagos`), pero basta con entrar a `/admin`.

En **Disponibilidad** se puede:

- cambiar el estado de cada lote (se guarda al momento);
- editar precio, medidas y descripción;
- subir, ordenar y borrar fotos.

#### Tarifa general

Arriba de la lista de lotes está **Tarifa general**: el precio por vara² con el que el mapa calcula el precio aproximado de los lotes sin precio propio (ficha y cotizador). Se guarda en la tabla `ajustes` de Supabase (una sola fila) y el mapa la toma al recargar. En cada lote, el campo precio vacío muestra el precio automático ("Automático: ≈ L …").

Si la tabla no existe todavía, el mapa usa `precioVara` de `js/config.js` (950) y en `/admin` la tarifa se ve pero no se puede editar: hay que ejecutar `supabase/ajustes.sql` en el SQL Editor.

Las fotos se reducen a 1600 px antes de subirse y quedan en el bucket `fotos` (`A-7/…jpg`). Los cambios se ven en el mapa al recargar, sin hacer push.
La geometría sigue en `data/lotes.json`.

#### Contabilidad

Control privado de ventas, cobros y gastos. Solo las cuentas de administrador pueden leer estas tablas; el mapa público nunca ve nombres ni montos.

- **Resumen**: saldo en banco, total vendido, cobrado, por cobrar, saldo vencido y gastos.
- **Plano de ventas**: el plano con cada lote coloreado según la cuenta de su comprador (pagado, al día, saldo vencido, sin precio, libre). Al tocar un lote se ve a quién se le vendió, el precio y cómo va su cuenta, y desde ahí se registra un pago o una venta.
- **Cuentas por cobrar**, **Clientes**, **Ventas**, **Pagos recibidos**, **Gastos** y **Banco** (saldo inicial más pagos menos gastos).
- **Exportar**:
  - Reportes en PDF: **Resumen general**, **Ingresos** y **Gastos**, con el logo y la fecha y hora de emisión. Se puede limitar a un periodo (desde / hasta); los registros sin fecha solo entran sin periodo.
  - Archivos CSV que se abren con Excel.

  Resumen, Pagos recibidos y Gastos también tienen un botón **PDF**; en Pagos y Gastos usa el mes filtrado. La librería del PDF (jsPDF) se descarga de cdnjs la primera vez que se usa.

Cada venta es un acuerdo con un cliente por uno o varios lotes. Cada lote lleva su propio precio, por vara² o fijo:

- **Contado**: se debe el total desde la fecha de la venta.
- **Prima y cuotas**: se debe la prima más las cuotas mensuales ya vencidas desde la fecha de la primera cuota. La cuota es (total − prima) ÷ meses, salvo que se escriba otra.

Los pagos se abonan a la cuenta del cliente, sumando todas sus ventas. "Saldo vencido" es lo que ya debería haber pagado y no ha pagado.

Al registrar una venta, sus lotes pasan a "vendido" en el mapa público (se puede desmarcar). Al eliminarla, el panel pregunta si se vuelven a marcar como disponibles.

**Instalar en una base que ya existe**: ejecutar `supabase/contabilidad.sql` en el SQL Editor, después de `supabase/ajustes.sql`. Se puede repetir sin perder datos.

**Importar el control anterior** (el HTML con los datos de clientes, lotes, pagos y gastos), una sola vez:

```bash
node tools/importar-control.mjs pdfdata/control_lotes.html
```

Genera `pdfdata/importar-control.sql`, que queda fuera del repositorio porque lleva nombres y montos. Se pega en el SQL Editor y no hace nada si ya hay clientes cargados. Cada cliente queda con una venta de contado con todos sus lotes y su precio por vara². Los pagos acumulados quedan como un pago sin fecha. Después se completan la prima, los meses y las fechas de quienes pagan a plazos.

## Compartir un lote — `/lote/A-1`

El botón **Contáctame** abre WhatsApp con un mensaje que incluye el enlace `/lote/A-1`.

Ese enlace muestra en el chat una miniatura del plano con el lote marcado (`og/A-1.png`) y, al abrirlo, lleva a `/mapa?lote=A-1` con el lote seleccionado.
En Vercel lo atiende la función `api/lote.mjs`, mediante el rewrite de `vercel.json`.

Si cambia la geometría, las miniaturas se regeneran con Chrome o Edge (tarda unos 3 minutos):

```bash
node tools/og-lotes.mjs
```

## Regenerar la geometría desde el plano

`data/lotes.json` y `data/plano-base.json` salen de `pdfdata/pdfimport-lado1-updt20nov.dxf` (PDFIMPORT del plano actualizado al 20 de noviembre de 2026, en AutoCAD). Se lleva al sistema de coordenadas del primer plano (`pdfimport.dxf`) para que `plano` en `js/config.js` siga valiendo. Las áreas salen de los rótulos del plano, y las medidas de los lados, de sus cotas.

En una base que ya existía, ese cambio de plano se aplica una vez con `supabase/plano-20nov.sql`: renumera el bloque C (los antiguos C-8…C-14 pasan a C-16…C-22 con su estado y fotos), crea los lotes nuevos, agrega C-5 y C-6 a la venta de C-4 y actualiza las áreas.
El lado 2 sale de `pdfdata/pdfimport-lado2.dxf` (`tools/extract-lado2.mjs`): sus lotes se agregan a `data/lotes.json`, y sus calles y área verde van a `data/plano-base-lado2.json`. La carpeta `pdfdata/` no se sube al repositorio porque contiene datos del terreno:

```bash
node tools/extract-lotes.mjs
```
