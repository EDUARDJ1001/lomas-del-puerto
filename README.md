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

## Base de datos — Supabase (opcional)

Mientras `supabase` esté vacío en `js/config.js`, el sitio usa `data/inventario.json`. Para pasar el inventario a Supabase:

1. **SQL Editor → New query**: pegar y ejecutar `supabase/schema.sql`. Crea:
   - la tabla `lotes`;
   - la tabla `administradores`;
   - los permisos;
   - el bucket público `fotos`.
2. Ejecutar `supabase/seed.sql` (los 53 lotes). Se regenera con `node tools/seed-supabase.mjs` si cambia `data/inventario.json`.
3. **Authentication → Sign In / Providers**: desactivar *Allow new users to sign up*.
4. **Authentication → Users → Add user → Create new user**: crear la cuenta con correo y contraseña, y marcar *Auto Confirm User*. Después darle permiso de edición en el SQL Editor:
   ```sql
   insert into public.administradores (user_id, email)
   select id, email from auth.users where email = 'correo@ejemplo.com';
   ```
5. **Project Settings → API**: copiar la *Project URL* y la clave pública *anon* (o *publishable*) en `js/config.js`. Esa clave es pública por diseño. La *service_role* o *secret* nunca va en el sitio.

Las contraseñas las guarda Supabase Auth, cifradas, en `auth.users`. La tabla `administradores` solo indica qué cuentas pueden editar.

### Panel de administración — `/admin`

Al entrar con una cuenta de administrador se puede:

- cambiar el estado de cada lote (se guarda al momento);
- editar precio, medidas y descripción;
- subir, ordenar y borrar fotos.

Las fotos se reducen a 1600 px antes de subirse y quedan en el bucket `fotos` (`A-7/…jpg`). Los cambios se ven en el mapa al recargar, sin hacer push.
La geometría sigue en `data/lotes.json`.

## Compartir un lote — `/lote/A-1`

El botón **Contáctame** abre WhatsApp con un mensaje que incluye el enlace `/lote/A-1`.

Ese enlace muestra en el chat una miniatura del plano con el lote marcado (`og/A-1.png`) y, al abrirlo, lleva a `/mapa?lote=A-1` con el lote seleccionado.
En Vercel lo atiende la función `api/lote.mjs`, mediante el rewrite de `vercel.json`.

Si cambia la geometría, las miniaturas se regeneran con Chrome o Edge (tarda unos 3 minutos):

```bash
node tools/og-lotes.mjs
```

## Regenerar la geometría desde el plano

`data/lotes.json` y `data/plano-base.json` salen de `pdfdata/pdfimport.dxf` (PDFIMPORT del plano en AutoCAD). La carpeta `pdfdata/` no se sube al repositorio porque contiene datos del terreno:

```bash
node tools/extract-lotes.mjs
```
