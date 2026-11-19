// Administración: login con Supabase Auth y edición de lotes (estado, precio, datos y fotos)
// Solo las cuentas de la tabla "administradores" pueden guardar cambios (ver supabase/schema.sql)

const CONFIG = window.SITIO; // js/config.js
const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('es-HN', { maximumFractionDigits: 2 });

const sb = CONFIG.supabase?.url && CONFIG.supabase?.anonKey
  ? window.supabase.createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey)
  : null;
const fotoUrl = ruta => sb.storage.from('fotos').getPublicUrl(ruta).data.publicUrl;

let lotes = [], filtro = '';

if (!sb) mostrar('sin-config');
else {
  sb.auth.getSession().then(({ data }) => entrar(data.session));
  sb.auth.onAuthStateChange((evento, session) => { if (evento === 'SIGNED_OUT') entrar(null); else if (evento === 'SIGNED_IN') entrar(session); });
}

function mostrar(id) {
  for (const s of ['sin-config', 'login', 'sin-permiso', 'editor']) $(s).hidden = s !== id;
}

let sesionActual = null;
async function entrar(session) {
  if (session?.user.id === sesionActual) return; // onAuthStateChange también avisa al cargar
  sesionActual = session?.user.id || null;
  $('btn-salir').hidden = !session;
  $('btn-menu').hidden = true;
  if (!session) return mostrar('login');
  const { data: esAdmin } = await sb.rpc('es_admin');
  if (!esAdmin) return mostrar('sin-permiso');
  mostrar('editor');
  $('btn-menu').hidden = false;
  await cargar();
  irA();
}

// ---------- Secciones (barra lateral): #disponibilidad, #contabilidad/resumen, #contabilidad/pagos… ----------
function irA() {
  let vista = location.hash.slice(1) || 'disponibilidad';
  if (!document.querySelector(`#sidebar a[data-vista="${vista}"]`)) vista = 'disponibilidad';
  const conta = vista.startsWith('contabilidad/');
  $('vista-disponibilidad').hidden = conta;
  $('vista-contabilidad').hidden = !conta;
  document.querySelectorAll('#sidebar a').forEach(a => {
    const on = a.dataset.vista === vista;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  menu(false);
  window.scrollTo(0, 0);
  if (conta) window.abrirContabilidad(vista.split('/')[1]); // js/contabilidad.js
}
window.addEventListener('hashchange', () => { if (!$('editor').hidden) irA(); });

// En celular la barra lateral es un menú que se abre con ☰
function menu(abrir) {
  $('sidebar').classList.toggle('abierta', abrir);
  $('side-fondo').hidden = !abrir;
  $('btn-menu').setAttribute('aria-expanded', abrir);
}
$('btn-menu').addEventListener('click', () => menu(!$('sidebar').classList.contains('abierta')));
$('side-fondo').addEventListener('click', () => menu(false));

$('login').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, boton = form.querySelector('button');
  boton.disabled = true;
  $('login-error').hidden = true;
  const { error } = await sb.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
  boton.disabled = false;
  if (error) {
    $('login-error').textContent = error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message;
    $('login-error').hidden = false;
  } else form.reset();
});

$('btn-salir').addEventListener('click', () => sb.auth.signOut());

$('filtros').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  filtro = chip.dataset.bloque;
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
  pintar();
});

async function cargar() {
  const [{ data, error }, ajustes] = await Promise.all([
    sb.from('lotes').select('*').order('sector').order('bloque').order('numero'),
    sb.from('ajustes').select('precio_vara').eq('id', 1).maybeSingle(),
  ]);
  if (error) return aviso(`No se pudieron cargar los lotes: ${error.message}`, true);
  // Sin la tabla "ajustes" (falta ejecutar supabase/ajustes.sql) se muestra la tarifa de js/config.js, sin poder guardarla
  tarifaEditable = !ajustes.error && !!ajustes.data;
  if (tarifaEditable) precioVara = Number(ajustes.data.precio_vara);
  lotes = data;
  pintarTarifa();
  pintar();
}

// ---------- Tarifa general (precio por vara²) ----------
const dinero = n => `${CONFIG.moneda} ${Number(n).toLocaleString('es-HN', { maximumFractionDigits: 0 })}`;
let precioVara = CONFIG.precioVara, tarifaEditable = false;

document.querySelectorAll('.tarifa .moneda').forEach(m => { m.textContent = CONFIG.moneda; });

function pintarTarifa() {
  const form = $('tarifa'), sinPrecio = lotes.filter(l => l.precio == null).length;
  form.precio_vara.value = precioVara;
  form.precio_vara.disabled = form.querySelector('button').disabled = !tarifaEditable;
  $('tarifa-nota').textContent = tarifaEditable
    ? `Se usa en los ${sinPrecio} lotes sin precio propio. El mapa la toma al recargar.`
    : 'Para editarla, ejecuta supabase/ajustes.sql en el SQL Editor de Supabase.';
}

// Placeholder del precio de cada lote: el precio automático con la tarifa actual
const precioAuto = lote => `Automático: ≈ ${dinero(Math.round(lote.area_vrs2 * precioVara))}`;
function actualizarPlaceholders() {
  document.querySelectorAll('#lotes .lote').forEach(li => {
    const lote = lotes.find(l => l.id === li.dataset.id);
    if (lote) li.querySelector('input[name=precio]').placeholder = precioAuto(lote);
  });
}

$('tarifa').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, boton = form.querySelector('button'), valor = Number(form.precio_vara.value);
  if (!(valor > 0)) return aviso('La tarifa debe ser mayor que cero.', true);
  boton.disabled = true;
  const { data, error } = await sb.from('ajustes').update({ precio_vara: valor }).eq('id', 1).select('precio_vara').single();
  boton.disabled = false;
  if (error) return aviso(`No se guardó la tarifa: ${error.message}`, true);
  precioVara = Number(data.precio_vara);
  aviso(`Tarifa guardada: ${dinero(precioVara)} por vara²`);
  pintarTarifa();
  actualizarPlaceholders();
});

function pintar() {
  const lista = $('lotes');
  lista.replaceChildren(...lotes.filter(l => !filtro || (filtro === '1B' ? l.sector === '1B' : !l.sector && l.bloque === filtro)).map(fila));
  resumen();
}

function resumen() {
  const cuenta = e => lotes.filter(l => l.estado === e).length;
  $('resumen').textContent = `${cuenta('disponible')} disponibles · ${cuenta('reservado')} reservados · ${cuenta('vendido')} vendidos · ${cuenta('no_disponible')} no disponibles`;
}

function fila(lote) {
  const li = $('tpl-lote').content.firstElementChild.cloneNode(true);
  const toggle = li.querySelector('.lote-toggle'), body = li.querySelector('.lote-body'), estado = li.querySelector('.estado');
  li.dataset.estado = lote.estado;
  li.dataset.id = lote.id;
  li.querySelector('.lote-id').textContent = lote.id;
  li.querySelector('.lote-area').textContent = `${fmt(lote.area_m2)} m² · ${fmt(lote.area_vrs2)} vrs²`;
  li.querySelector('.moneda').textContent = CONFIG.moneda;

  toggle.addEventListener('click', () => {
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', !body.hidden);
  });

  // El estado se guarda al momento: es el cambio más frecuente
  estado.value = lote.estado;
  estado.addEventListener('change', async () => {
    const anterior = lote.estado;
    if (await guardar(lote, { estado: estado.value })) li.dataset.estado = lote.estado, resumen();
    else estado.value = anterior;
  });

  body.precio.value = lote.precio ?? '';
  body.precio.placeholder = precioAuto(lote); // vacío = precio automático con la tarifa general
  body.medidas.value = lote.medidas ?? '';
  body.descripcion.value = lote.descripcion;
  body.addEventListener('submit', async e => {
    e.preventDefault();
    const boton = body.querySelector('button[type=submit]');
    boton.disabled = true;
    await guardar(lote, {
      precio: body.precio.value === '' ? null : Number(body.precio.value),
      medidas: body.medidas.value.trim() || null,
      descripcion: body.descripcion.value.trim(),
    });
    boton.disabled = false;
  });

  const fotos = body.querySelector('.fotos');
  pintarFotos(lote, fotos);
  const input = body.querySelector('input[type=file]');
  input.addEventListener('change', async () => {
    const archivos = [...input.files];
    input.value = '';
    await subirFotos(lote, archivos, fotos, body.querySelector('.subir'));
  });
  return li;
}

async function guardar(lote, cambios) {
  const { data, error } = await sb.from('lotes').update(cambios).eq('id', lote.id).select().single();
  if (error) {
    aviso(`No se guardó ${lote.id}: ${error.message}`, true);
    return false;
  }
  Object.assign(lote, data);
  aviso(`${lote.id} guardado`);
  return true;
}

function pintarFotos(lote, cont) {
  cont.replaceChildren(...lote.fotos.map((ruta, i) => {
    const d = document.createElement('div');
    d.className = 'foto' + (i === 0 ? ' portada' : '');
    d.innerHTML = '<img alt="" loading="lazy"><div class="foto-acciones"></div>';
    d.querySelector('img').src = fotoUrl(ruta);
    const acciones = d.querySelector('.foto-acciones');
    if (i > 0) acciones.append(boton('★', 'Usar como portada', () => cambiarFotos(lote, cont, [ruta, ...lote.fotos.filter(f => f !== ruta)])));
    acciones.append(boton('✕', 'Eliminar foto', async () => {
      if (!confirm('¿Eliminar esta foto?')) return;
      if (await cambiarFotos(lote, cont, lote.fotos.filter(f => f !== ruta))) await sb.storage.from('fotos').remove([ruta]);
    }));
    return d;
  }));
}

function boton(texto, titulo, accion) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = texto;
  b.title = titulo;
  b.setAttribute('aria-label', titulo);
  b.addEventListener('click', accion);
  return b;
}

async function cambiarFotos(lote, cont, fotos) {
  const ok = await guardar(lote, { fotos });
  pintarFotos(lote, cont);
  return ok;
}

async function subirFotos(lote, archivos, cont, label) {
  if (!archivos.length) return;
  label.classList.add('subiendo');
  const nuevas = [];
  for (const [i, archivo] of archivos.entries()) {
    label.firstChild.textContent = `Subiendo ${i + 1} de ${archivos.length}…`;
    const ruta = `${lote.id}/${Date.now()}-${i}.jpg`;
    const { error } = await sb.storage.from('fotos').upload(ruta, await reducir(archivo), { contentType: 'image/jpeg' });
    if (error) aviso(`No se subió ${archivo.name}: ${error.message}`, true);
    else nuevas.push(ruta);
  }
  label.firstChild.textContent = 'Subir fotos';
  label.classList.remove('subiendo');
  if (nuevas.length) await cambiarFotos(lote, cont, [...lote.fotos, ...nuevas]);
}

// Las fotos del celular pesan varios MB: se reducen a 1600 px de lado mayor para que el mapa cargue rápido
async function reducir(archivo, max = 1600) {
  const img = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.82));
}

let avisoTimer;
function aviso(texto, error = false) {
  const t = $('toast');
  t.textContent = texto;
  t.classList.toggle('error', error);
  t.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { t.hidden = true; }, error ? 5000 : 1800);
}
