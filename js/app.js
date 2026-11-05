// Mapa interactivo de lotes — Lomas del Puerto
// Datos: data/lotes.json (geometría, generado desde el plano) + inventario (estado, precio, fotos) desde Supabase o data/inventario.json
// El plano (en metros) se dibuja con Leaflet sobre un mapa real con relieve y calles, ubicado según SITIO.plano

const CONFIG = window.SITIO; // js/config.js

const tooltip = document.getElementById('tooltip');
const panel = document.getElementById('panel');
const wrap = document.querySelector('.map-wrap');

const fmt = (n, d = 2) => n.toLocaleString('es-HN', { minimumFractionDigits: d, maximumFractionDigits: d });

// Metros del plano -> [lat, lng]: giro alrededor de "origen" y traslado a su posición en el mapa
const GEO = CONFIG.plano;
const rad = GEO.rotacion * Math.PI / 180, latRad = GEO.lat * Math.PI / 180;
const M_LAT = 111132.92 - 559.82 * Math.cos(2 * latRad), M_LNG = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);
const geo = ([x, y]) => {
  const dx = x - GEO.origen[0], dy = y - GEO.origen[1];
  const e = dx * Math.cos(rad) - dy * Math.sin(rad), n = dx * Math.sin(rad) + dy * Math.cos(rad);
  return [GEO.lat + n / M_LAT, GEO.lng + e / M_LNG];
};

let lotes = [], map = null, home = null;
// Lotes elegidos en el cotizador (siempre pegados entre sí) y si se está en modo "combinar con vecinos"
let seleccion = [], combinando = false;

init();

async function init() {
  const [geom, base, inv] = await Promise.all([
    ...['data/lotes.json', 'data/plano-base.json'].map(u => fetch(u).then(r => r.json())),
    window.cargarInventario(), // js/inventario.js
  ]);
  lotes = geom.map(l => ({ ...l, ...(inv[l.id] || { estado: 'disponible', fotos: [] }) }));
  lotes.forEach(l => { l.disponible = l.estado === 'disponible'; });
  calcularVecinos();

  setupMap();
  drawBase(base);
  drawLots();
  drawLegend();
  setupPanel();
  abrirDesdeUrl();
}

// /mapa?lote=A-1 (enlace compartido por WhatsApp): acerca el mapa a ese lote y abre su ficha
function abrirDesdeUrl() {
  const id = new URLSearchParams(location.search).get('lote')?.toUpperCase();
  const l = lotes.find(x => x.id === id);
  if (!l) return;
  map.setView(geo(centroid(l.poligono)), 19.5, { animate: false });
  if (l.disponible) seleccionar(l);
}

// ---------- Mapa base ----------

function setupMap() {
  // Solo se carga el entorno del proyecto: no se puede alejar ni mover más allá de radioMapaKm
  const km = (CONFIG.radioMapaKm || 5) * 1000;
  const limite = L.latLngBounds([GEO.lat - km / M_LAT, GEO.lng - km / M_LNG], [GEO.lat + km / M_LAT, GEO.lng + km / M_LNG]);
  map = L.map('map', {
    zoomControl: false, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
    minZoom: 13, maxZoom: 20, maxBounds: limite, maxBoundsViscosity: 1,
  });
  map.attributionControl.setPrefix(false);

  const capas = {
    relieve: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      subdomains: 'abc', maxNativeZoom: 17, maxZoom: 20, bounds: limite,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM · estilo © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    }),
    // Esri no tiene imagen más allá del zoom 18 en esta zona: de ahí en adelante se amplía esa misma
    satelite: L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxNativeZoom: 18, maxZoom: 20, bounds: limite, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics',
      }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
        maxNativeZoom: 18, maxZoom: 20, bounds: limite,
      }),
    ]),
  };
  let actual = capas.relieve.addTo(map);
  document.querySelector('.map-layers').addEventListener('click', e => {
    const b = e.target.closest('[data-capa]');
    if (!b || capas[b.dataset.capa] === actual) return;
    map.removeLayer(actual);
    actual = capas[b.dataset.capa].addTo(map);
    document.querySelectorAll('.map-layers button').forEach(x => x.setAttribute('aria-pressed', x === b));
  });

  home = L.latLngBounds(lotes.flatMap(l => l.poligono.map(geo)));
  // Pin del proyecto, visible solo con el mapa alejado; al tocarlo se vuelve a ver el plano completo
  L.marker(home.getCenter(), {
    icon: L.divIcon({ className: 'proyecto-pin', html: '<span>Lomas del Puerto</span>', iconSize: null }), keyboard: false,
  }).on('click', () => map.flyToBounds(home, { padding: [24, 24], duration: .8 })).addTo(map);
  map.fitBounds(home, { padding: [24, 24], animate: false });

  // Calles y textos del plano se dibujan en metros: --m = píxeles por metro en el zoom actual
  const escala = () => {
    const m = 2 ** map.getZoom() / (156543.03 * Math.cos(latRad));
    wrap.style.setProperty('--m', m);
    wrap.classList.toggle('sin-etiquetas', m < 3.4); // los números de lote solo se muestran cuando ya se leen
    wrap.classList.toggle('lejos', m < .35); // alejado, el plano mide pocos píxeles: se marca con un pin
  };
  map.on('zoomend', escala);
  escala();

  map.on('movestart', hideTip);
  // Alejado al máximo, el área permitida llena la pantalla; el panel de detalles cambia el ancho del mapa
  const ajustar = () => { map.invalidateSize(); map.setMinZoom(Math.max(12, map.getBoundsZoom(limite, true))); };
  new ResizeObserver(ajustar).observe(map.getContainer());
  ajustar();
  document.querySelector('.map-tools').addEventListener('click', e => {
    const z = e.target.dataset.zoom;
    if (z === 'fit') map.flyToBounds(home, { padding: [24, 24], duration: .6 });
    else if (z) map[z === 'in' ? 'zoomIn' : 'zoomOut'](1);
  });
}

function drawBase(base) {
  const fijo = { interactive: false, smoothFactor: 0 };
  for (const line of base.lineas) L.polyline(line.map(geo), { ...fijo, className: 'base-line' }).addTo(map);
  const { superficies, bordes, ejes } = base.calles;
  const segs = s => s.map(([a, b]) => [geo(a), geo(b)]);
  for (const s of superficies) L.polygon(s.map(geo), { ...fijo, className: 'street' }).addTo(map);
  L.polyline(segs(bordes), { ...fijo, className: 'street-edge' }).addTo(map);
  L.polyline(segs(ejes), { ...fijo, className: 'street-center' }).addTo(map);
  // El texto gira junto con el plano (CSS gira en sentido horario, el plano en antihorario)
  for (const t of base.textos) etiqueta(t.p, `<span style="--giro: ${-(t.angulo + GEO.rotacion)}deg">${t.texto}</span>`, 'street-label');
}

function drawLots() {
  for (const l of lotes) {
    // Reservado: naranja; vendido (o cualquier otro estado): rojo, con el estado escrito sobre el lote
    const cls = l.disponible ? 'available' : l.estado === 'reservado' ? 'reserved' : 'sold';
    const capa = L.polygon(l.poligono.map(geo), { className: `lot ${cls}`, interactive: l.disponible, smoothFactor: 0 }).addTo(map);
    l.node = capa.getElement();
    if (l.disponible) {
      l.node.setAttribute('tabindex', '0');
      l.node.setAttribute('role', 'button');
      l.node.setAttribute('aria-label', `Lote ${l.id}, ${fmt(l.area_m2)} m², disponible`);
      l.node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clicLote(l); } });
      capa.on('click', () => clicLote(l));
      capa.on('mouseover mousemove', e => showTip(l, e.originalEvent));
      capa.on('mouseout', hideTip);
    }
    const estado = { reserved: 'Reservado', sold: 'Vendido' }[cls];
    etiqueta(centroid(l.poligono), `<span>${l.id}${estado ? `<small>${estado}</small>` : ''}</span>`, `lot-label ${cls}`);
  }
}

function etiqueta(p, html, className) {
  L.marker(geo(p), { icon: L.divIcon({ className, html, iconSize: null }), interactive: false, keyboard: false }).addTo(map);
}

function drawLegend() {
  const libres = lotes.filter(l => l.disponible).length;
  const reservados = lotes.filter(l => l.estado === 'reservado').length;
  document.getElementById('legend').innerHTML = `
    <li><i style="background:var(--available)"></i>Disponibles <b>${libres}</b></li>
    <li><i style="background:var(--reserved)"></i>Reservados <b>${reservados}</b></li>
    <li><i style="background:var(--sold)"></i>Vendidos <b>${lotes.length - libres - reservados}</b></li>`;
}

// ---------- Panel de detalles ----------

function setupPanel() {
  document.getElementById('panel-close').addEventListener('click', closePanel);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.getElementById('modal-contacto').open) closeLightbox() || closePanel(); });
  const lb = document.getElementById('lightbox');
  lb.querySelector('.lb-close').addEventListener('click', closeLightbox);
  lb.querySelector('.lb-prev').addEventListener('click', () => stepLightbox(-1));
  lb.querySelector('.lb-next').addEventListener('click', () => stepLightbox(1));
  lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });
  setupTouch();
  setupContacto();

  document.getElementById('cot-combinar').addEventListener('click', () => {
    combinando = !combinando;
    renderPanel();
    if (combinando) document.querySelector('.cotizador').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  document.getElementById('cot-lista').addEventListener('click', e => {
    const id = e.target.closest('[data-quitar]')?.dataset.quitar;
    if (id) quitar(lotes.find(l => l.id === id));
  });
}

// ---------- Selección y cotizador ----------
// Se puede cotizar un lote o varios juntos, siempre que estén pegados entre sí (comparten lindero)

const dinero = n => `${CONFIG.moneda} ${fmt(n, 0)}`;
// Precio del inventario si lo tiene; si no, el aproximado por vara²
const precioLote = l => l.precio || Math.round(l.area_vrs2 * CONFIG.precioVara);
const suma = (ls, f) => ls.reduce((t, l) => t + f(l), 0);
const ordenar = ls => [...ls].sort((a, b) => a.bloque.localeCompare(b.bloque) || a.numero - b.numero);
const enLista = xs => xs.length < 2 ? xs[0] : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)}`;
const vecinosLibres = () => new Set(seleccion.flatMap(s => [...s.vecinos]).filter(v => v.disponible && !seleccion.includes(v)));

// Fuera del modo combinar, un clic abre ese lote solo; dentro, lo agrega o lo quita de la cotización
function clicLote(l) {
  hideTip();
  if (!combinando || panel.hidden) return seleccionar(l);
  if (seleccion.includes(l)) return quitar(l);
  if (!vecinosLibres().has(l)) {
    const de = seleccion.length > 1 ? 'los lotes elegidos' : `el lote ${seleccion[0].id}`;
    return avisar(`El lote ${l.id} no está pegado a ${de}. Solo se pueden cotizar juntos lotes vecinos.`);
  }
  seleccion.push(l);
  renderPanel();
}

function seleccionar(l) {
  seleccion = [l];
  combinando = false;
  renderPanel();
  panel.scrollTop = 0;
}

// Quitar un lote no puede dejar la cotización partida: de A-1, A-2 y A-3 no se puede quitar A-2
const puedeQuitar = l => seleccion.length > 1 && conectados(seleccion.filter(s => s !== l));
function quitar(l) {
  if (seleccion.length === 1) return avisar('Toca un lote vecino (marcado en el mapa) para agregarlo.');
  if (!puedeQuitar(l)) return avisar(`No se puede quitar el lote ${l.id}: los demás quedarían separados. Quita primero uno de los extremos.`);
  seleccion = seleccion.filter(s => s !== l);
  renderPanel();
}

function avisar(texto, error = true) {
  const aviso = document.getElementById('cot-aviso');
  aviso.textContent = texto;
  aviso.classList.toggle('error', error);
  aviso.hidden = !texto;
}

function renderPanel() {
  const sel = ordenar(seleccion), uno = sel.length === 1 ? sel[0] : null;
  const vecinos = vecinosLibres();
  for (const l of lotes) {
    if (!l.disponible) continue;
    l.node.classList.toggle('selected', sel.includes(l));
    l.node.classList.toggle('vecino', combinando && vecinos.has(l));
  }
  const m2 = suma(sel, l => l.area_m2), vrs = suma(sel, l => l.area_vrs2), total = suma(sel, precioLote);
  const bloques = [...new Set(sel.map(l => l.bloque))];
  const $ = id => document.getElementById(id);

  $('p-bloque').textContent = uno ? `Bloque ${uno.bloque}` : `${bloques.length > 1 ? 'Bloques' : 'Bloque'} ${enLista(bloques)}`;
  $('p-titulo').textContent = uno ? `Lote ${uno.numero}` : `${sel.length} lotes juntos`;
  $('p-area').textContent = `${fmt(m2)} m²`;
  $('p-vrs').textContent = `${fmt(vrs)} vrs²`;
  $('p-area').previousElementSibling.textContent = uno ? 'Área' : 'Área total';
  $('p-vrs').previousElementSibling.textContent = uno ? 'Área en varas²' : 'Total en varas²';
  // inventario.json puede traer "medidas" escritas a mano; si no, se usan las calculadas del plano (solo lotes de 4 lados)
  const med = uno && (uno.medidas || (uno.lados_m && uno.lados_m.map(d => fmt(d, 1)).join(' · ') + ' m'));
  $('p-medidas').textContent = med || '';
  $('p-medidas').parentElement.hidden = !med;
  $('p-precio').parentElement.style.gridColumn = med ? '' : 'span 2';
  $('p-precio').previousElementSibling.textContent = uno?.precio ? 'Precio' : 'Precio aprox.';
  $('p-precio').textContent = uno?.precio ? dinero(total) : `≈ ${dinero(total)}`;
  $('p-desc').textContent = uno?.descripcion || '';

  // Cotizador: desglose por lote; la × solo se activa si quitarlo no deja la selección partida
  $('cot-tarifa').textContent = `${dinero(CONFIG.precioVara)} por vara²`;
  $('cot-lista').innerHTML = sel.map(l => `<li>
      <span class="cot-id">Lote ${l.id}</span>
      <span class="cot-calc">${l.precio ? 'precio fijo' : `${fmt(l.area_vrs2)} vrs²`}</span>
      <span class="cot-monto">${dinero(precioLote(l))}</span>
      ${uno ? '' : `<button type="button" data-quitar="${l.id}" aria-label="Quitar lote ${l.id}"
        ${puedeQuitar(l) ? '' : 'disabled title="Quitarlo dejaría los demás lotes separados"'}>×</button>`}
    </li>`).join('');
  $('cot-total-label').textContent = uno ? 'Total aproximado' : `Total aproximado · ${sel.length} lotes`;
  $('cot-total').textContent = dinero(total);
  const btn = $('cot-combinar');
  btn.textContent = combinando ? 'Listo' : '+ Combinar con lotes vecinos';
  btn.setAttribute('aria-pressed', combinando);
  btn.hidden = !combinando && !vecinos.size; // ningún vecino disponible: no hay nada que combinar
  avisar(!combinando ? '' : vecinos.size ? 'Toca en el mapa un lote marcado para agregarlo; tócalo otra vez para quitarlo.'
    : 'No quedan lotes vecinos disponibles para agregar.', false);
  panel.classList.toggle('combinando', combinando);

  // WhatsApp: el enlace /lote/A-1 muestra en el chat una miniatura del plano con ese lote marcado (og/A-1.png)
  const cta = $('p-cta');
  cta.hidden = !CONFIG.whatsapp;
  if (CONFIG.whatsapp) {
    const que = uno ? `el lote ${uno.id} (bloque ${uno.bloque}, lote ${uno.numero}, ${fmt(m2)} m²)`
      : `los lotes ${enLista(sel.map(l => l.id))} juntos (${fmt(m2)} m², ${fmt(vrs)} vrs²)`;
    const msg = `Hola, estoy interesado en ${que} de Lomas del Puerto. Precio aproximado según el cotizador: ${dinero(total)}. ¿Me pueden dar más información?

${location.origin}/lote/${sel[0].id}`;
    cta.href = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(msg)}`;
  }

  prepararContacto(sel, m2);
  $('gallery').hidden = !uno; // las fotos son de un lote; con varios se muestra solo la cotización
  if (uno) renderGallery(uno);
  panel.hidden = false;
}

// Formulario de solicitud: el mensaje se rellena con los lotes elegidos, salvo que la persona ya lo haya escrito a su manera
let mensajeAuto = '';
function prepararContacto(sel, m2) {
  const form = document.getElementById('contacto');
  const nuevo = sel.length === 1 ? `Me interesa el lote ${sel[0].numero} del bloque ${sel[0].bloque}.`
    : `Me interesan los lotes ${enLista(sel.map(l => l.id))} juntos.`;
  if (!form.mensaje.value.trim() || form.mensaje.value === mensajeAuto) form.mensaje.value = nuevo;
  mensajeAuto = nuevo;
  document.getElementById('modal-lote').textContent = `${sel.length === 1 ? 'Lote' : 'Lotes'} ${enLista(sel.map(l => l.id))} · ${fmt(m2)} m²`;
  document.getElementById('contacto-status').hidden = true;
  form.querySelectorAll('.invalid').forEach(c => c.classList.remove('invalid'));
}

function setupContacto() {
  const form = document.getElementById('contacto');
  const status = document.getElementById('contacto-status');
  const modal = document.getElementById('modal-contacto');
  document.getElementById('p-info').addEventListener('click', () => modal.showModal());
  document.getElementById('modal-close').addEventListener('click', () => modal.close());
  modal.addEventListener('click', e => { if (e.target === modal) modal.close(); }); // clic fuera del formulario
  form.addEventListener('input', e => e.target.closest('label')?.classList.remove('invalid'));
  form.addEventListener('submit', e => {
    e.preventDefault();
    const malos = [...form.elements].filter(c => c.willValidate && !c.checkValidity());
    form.querySelectorAll('label').forEach(lb => lb.classList.toggle('invalid', malos.some(c => lb.contains(c))));
    status.classList.toggle('error', malos.length > 0);
    if (malos.length) {
      status.textContent = 'Revisa los campos marcados: nombre, celular y mensaje son obligatorios.';
      malos[0].focus();
    } else {
      // Pendiente: guardar la solicitud (Supabase) o enviarla por correo/WhatsApp
      status.textContent = 'Formulario de prueba: la solicitud todavía no se envía.';
    }
    status.hidden = false;
  });
}

function closePanel() {
  if (panel.hidden) return false;
  panel.hidden = true;
  seleccion = [];
  combinando = false;
  panel.classList.remove('combinando');
  lotes.forEach(l => l.node?.classList.remove('selected', 'vecino'));
  return true;
}

// Carrusel de altura fija (se desliza con el dedo): cambiar de foto nunca mueve el resto del panel
function renderGallery(l) {
  const box = document.getElementById('gallery');
  const n = l.fotos?.length || 0;
  if (!n) {
    box.innerHTML = `<div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-8 7"/></svg>
      Fotos próximamente</div>`;
    return;
  }
  box.innerHTML = `<div class="track">${l.fotos.map((f, i) =>
    `<img src="${f}" alt="Foto ${i + 1} del lote ${l.id}" draggable="false"${i ? ' loading="lazy"' : ''}>`).join('')}</div>` +
    (n > 1 ? `<span class="count"></span>
      <div class="thumbs">${l.fotos.map((f, i) => `<img src="${f}" data-i="${i}" alt="">`).join('')}</div>` : '');

  const track = box.querySelector('.track');
  const actual = () => Math.round(track.scrollLeft / track.clientWidth);
  const marcar = i => {
    if (n < 2) return;
    box.querySelector('.count').textContent = `${i + 1} / ${n}`;
    box.querySelectorAll('.thumbs img').forEach(t => t.classList.toggle('active', +t.dataset.i === i));
  };
  track.addEventListener('scroll', () => marcar(actual()), { passive: true });
  track.addEventListener('click', () => openLightbox(l.fotos, actual()));
  box.querySelectorAll('.thumbs img').forEach(t =>
    t.addEventListener('click', () => track.scrollTo({ left: +t.dataset.i * track.clientWidth, behavior: 'smooth' })));
  marcar(0);
}

let lbFotos = [], lbIndex = 0;
function openLightbox(fotos, i) {
  lbFotos = fotos; lbIndex = i;
  const lb = document.getElementById('lightbox');
  lb.querySelectorAll('.lb-nav, .lb-count').forEach(b => { b.hidden = fotos.length < 2; });
  showLightbox();
  lb.hidden = false;
}
function showLightbox() {
  document.querySelector('#lightbox img').src = lbFotos[lbIndex];
  document.querySelector('#lightbox .lb-count').textContent = `${lbIndex + 1} / ${lbFotos.length}`;
}
function stepLightbox(d) {
  lbIndex = (lbIndex + d + lbFotos.length) % lbFotos.length;
  showLightbox();
}
function closeLightbox() {
  const lb = document.getElementById('lightbox');
  if (lb.hidden) return false;
  lb.hidden = true;
  return true;
}

// ---------- Gestos táctiles: deslizar fotos ampliadas y bajar el panel para cerrarlo ----------

function setupTouch() {
  const lb = document.getElementById('lightbox');
  let lbX = null;
  lb.addEventListener('touchstart', e => { lbX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - lbX;
    if (lbFotos.length > 1 && Math.abs(dx) > 50) stepLightbox(dx < 0 ? 1 : -1);
    lbX = null;
  });

  const esHoja = () => matchMedia('(max-width: 760px)').matches;
  let x0 = 0, y0 = null, dy = 0, eje = null;
  panel.addEventListener('touchstart', e => {
    if (!esHoja()) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dy = 0; eje = null;
  }, { passive: true });
  panel.addEventListener('touchmove', e => {
    if (y0 === null) return;
    const t = e.touches[0];
    dy = t.clientY - y0;
    eje ??= Math.abs(dy) > Math.abs(t.clientX - x0) ? 'y' : 'x';
    // Solo se arrastra la hoja hacia abajo cuando su contenido ya está arriba del todo
    if (eje !== 'y' || dy <= 0 || panel.scrollTop > 0) { dy = 0; return; }
    e.preventDefault();
    panel.style.transition = 'none';
    panel.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  panel.addEventListener('touchend', () => {
    if (y0 === null) return;
    y0 = null;
    panel.style.transition = '';
    panel.style.transform = '';
    if (dy > 90) closePanel();
  });
}

// ---------- Tooltip ----------

function showTip(l, e) {
  const r = wrap.getBoundingClientRect();
  tooltip.textContent = !combinando || panel.hidden ? `Lote ${l.id} · ${fmt(l.area_m2)} m²`
    : seleccion.includes(l) ? `Quitar lote ${l.id}`
    : vecinosLibres().has(l) ? `Agregar lote ${l.id} · ${dinero(precioLote(l))}`
    : `Lote ${l.id} · no es vecino`;
  tooltip.style.left = `${e.clientX - r.left}px`;
  tooltip.style.top = `${e.clientY - r.top}px`;
  tooltip.hidden = false;
}
function hideTip() { tooltip.hidden = true; }

// ---------- Geometría ----------

// Dos lotes son vecinos si comparten un tramo de lindero de más de 1 m (tocarse solo en una esquina no cuenta).
// Tolerancia de 0.4 m porque en el plano los vértices compartidos no siempre coinciden exactamente.
function calcularVecinos() {
  const TOL = 0.4, MIN = 1;
  const lados = p => p.map((a, i) => [a, p[(i + 1) % p.length]]);
  const comparten = (A, B) => lados(A).some(([p, q]) => {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]), ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
    const dist = v => Math.abs((v[0] - p[0]) * uy - (v[1] - p[1]) * ux); // distancia a la recta del lado
    const pos = v => (v[0] - p[0]) * ux + (v[1] - p[1]) * uy; // posición a lo largo del lado
    return lados(B).some(([r, s]) => dist(r) <= TOL && dist(s) <= TOL &&
      Math.min(len, Math.max(pos(r), pos(s))) - Math.max(0, Math.min(pos(r), pos(s))) > MIN);
  });
  lotes.forEach(l => { l.vecinos = new Set(); });
  lotes.forEach((a, i) => lotes.slice(i + 1).forEach(b => {
    if (comparten(a.poligono, b.poligono)) { a.vecinos.add(b); b.vecinos.add(a); }
  }));
}

// ¿Forman los lotes un solo grupo pegado?
function conectados(ls) {
  const vistos = new Set([ls[0]]), cola = [ls[0]];
  while (cola.length) for (const v of cola.pop().vecinos) if (ls.includes(v) && !vistos.has(v)) { vistos.add(v); cola.push(v); }
  return vistos.size === ls.length;
}

function centroid(p) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length], f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  return [cx / (3 * a), cy / (3 * a)];
}
