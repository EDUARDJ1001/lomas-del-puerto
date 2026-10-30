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
  if (!session) return mostrar('login');
  const { data: esAdmin } = await sb.rpc('es_admin');
  if (!esAdmin) return mostrar('sin-permiso');
  mostrar('editor');
  await cargar();
}

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
  const { data, error } = await sb.from('lotes').select('*').order('bloque').order('numero');
  if (error) return aviso(`No se pudieron cargar los lotes: ${error.message}`, true);
  lotes = data;
  pintar();
}

function pintar() {
  const lista = $('lotes');
  lista.replaceChildren(...lotes.filter(l => !filtro || l.bloque === filtro).map(fila));
  resumen();
}

function resumen() {
  const cuenta = e => lotes.filter(l => l.estado === e).length;
  $('resumen').textContent = `${cuenta('disponible')} disponibles · ${cuenta('reservado')} reservados · ${cuenta('vendido')} vendidos`;
}

function fila(lote) {
  const li = $('tpl-lote').content.firstElementChild.cloneNode(true);
  const toggle = li.querySelector('.lote-toggle'), body = li.querySelector('.lote-body'), estado = li.querySelector('.estado');
  li.dataset.estado = lote.estado;
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
