// Mapa interactivo de lotes — Lomas del Puerto
// Datos: data/lotes.json (geometría, generado desde el plano) + inventario (estado, precio, fotos) desde Supabase o data/inventario.json

const CONFIG = window.SITIO; // js/config.js

const NS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('map');
const tooltip = document.getElementById('tooltip');
const panel = document.getElementById('panel');

const fmt = (n, d = 2) => n.toLocaleString('es-HN', { minimumFractionDigits: d, maximumFractionDigits: d });
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
// El plano usa Y hacia arriba; SVG hacia abajo
const pt = ([x, y]) => `${x},${-y}`;

let lotes = [], selected = null, view = null, home = null;

init();

async function init() {
  const [geo, base, inv] = await Promise.all([
    ...['data/lotes.json', 'data/plano-base.json'].map(u => fetch(u).then(r => r.json())),
    window.cargarInventario(), // js/inventario.js
  ]);
  lotes = geo.map(l => ({ ...l, ...(inv[l.id] || { estado: 'disponible', fotos: [] }) }));
  lotes.forEach(l => { l.disponible = l.estado === 'disponible'; });

  drawBase(base);
  drawLots();
  drawLegend();
  home = fitBox();
  setView({ ...home });
  setupPanZoom();
  setupPanel();
  abrirDesdeUrl();
}

// /mapa?lote=A-1 (enlace compartido por WhatsApp): acerca el mapa a ese lote y abre su ficha
function abrirDesdeUrl() {
  const id = new URLSearchParams(location.search).get('lote')?.toUpperCase();
  const l = lotes.find(x => x.id === id);
  if (!l) return;
  const [cx, cy] = centroid(l.poligono);
  const w = home.w / 2.5, h = home.h / 2.5;
  setView({ x: cx - w / 2, y: -cy - h / 2, w, h });
  if (l.disponible) openPanel(l);
}

function drawBase(base) {
  const g = el('g', { class: 'base' }, svg);
  for (const line of base.lineas) el('polyline', { class: 'base-line', points: line.map(pt).join(' ') }, g);
  const { superficies, bordes, ejes } = base.calles;
  const path = segs => segs.map(([a, b]) => `M${pt(a)}L${pt(b)}`).join('');
  for (const s of superficies) el('polygon', { class: 'street', points: s.map(pt).join(' ') }, g);
  el('path', { class: 'street-edge', d: path(bordes) }, g);
  el('path', { class: 'street-center', d: path(ejes) }, g);
  for (const t of base.textos) {
    const [x, y] = t.p;
    const txt = el('text', {
      class: 'street-label', x, y: -y, 'dominant-baseline': 'hanging',
      transform: `rotate(${-t.angulo} ${x} ${-y})`,
    }, g);
    txt.textContent = t.texto;
  }
}

function drawLots() {
  const g = el('g', { class: 'lots' }, svg);
  for (const l of lotes) {
    const cls = l.disponible ? 'available' : 'sold';
    l.node = el('polygon', { class: `lot ${cls}`, points: l.poligono.map(pt).join(' ') }, g);
    if (l.disponible) {
      l.node.setAttribute('tabindex', '0');
      l.node.setAttribute('role', 'button');
      l.node.setAttribute('aria-label', `Lote ${l.id}, ${fmt(l.area_m2)} m², disponible`);
      l.node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPanel(l); } });
      l.node.addEventListener('pointerenter', e => showTip(l, e));
      l.node.addEventListener('pointermove', e => showTip(l, e));
      l.node.addEventListener('pointerleave', hideTip);
    }
    const [cx, cy] = centroid(l.poligono);
    el('text', { class: `lot-label ${cls}`, x: cx, y: -cy }, g).textContent = l.id;
  }
}

function drawLegend() {
  const libres = lotes.filter(l => l.disponible).length;
  document.getElementById('legend').innerHTML = `
    <li><i style="background:var(--available)"></i>Disponibles <b>${libres}</b></li>
    <li><i style="background:var(--sold)"></i>No disponibles <b>${lotes.length - libres}</b></li>`;
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
}

function openPanel(l) {
  if (selected) selected.node.classList.remove('selected');
  selected = l;
  l.node.classList.add('selected');
  hideTip();

  document.getElementById('p-bloque').textContent = `Bloque ${l.bloque}`;
  document.getElementById('p-titulo').textContent = `Lote ${l.numero}`;
  document.getElementById('p-area').textContent = `${fmt(l.area_m2)} m²`;
  document.getElementById('p-vrs').textContent = `${fmt(l.area_vrs2)} vrs²`;
  // inventario.json puede traer "medidas" escritas a mano; si no, se usan las calculadas del plano (solo lotes de 4 lados)
  const med = l.medidas || (l.lados_m && l.lados_m.map(d => fmt(d, 1)).join(' · ') + ' m');
  document.getElementById('p-medidas').textContent = med || '';
  document.getElementById('p-medidas').parentElement.hidden = !med;
  document.getElementById('p-precio').parentElement.style.gridColumn = med ? '' : 'span 2';
  document.getElementById('p-precio').textContent = l.precio ? `${CONFIG.moneda} ${fmt(l.precio, 0)}` : 'A consultar';
  document.getElementById('p-desc').textContent = l.descripcion || '';

  // WhatsApp: el enlace /lote/A-1 muestra en el chat una miniatura del plano con ese lote marcado (og/A-1.png)
  const cta = document.getElementById('p-cta');
  cta.hidden = !CONFIG.whatsapp;
  if (CONFIG.whatsapp) {
    const msg = `Hola, estoy interesado en el lote ${l.id} (bloque ${l.bloque}, lote ${l.numero}, ${fmt(l.area_m2)} m²) de Lomas del Puerto. ¿Me pueden dar más información?

${location.origin}/lote/${l.id}`;
    cta.href = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(msg)}`;
  }

  prepararContacto(l);
  renderGallery(l);
  panel.hidden = false;
  panel.scrollTop = 0;
}

// Formulario de solicitud: el mensaje se rellena con el lote abierto, salvo que la persona ya lo haya escrito a su manera
let mensajeAuto = '';
function prepararContacto(l) {
  const form = document.getElementById('contacto');
  const nuevo = `Me interesa el lote ${l.numero} del bloque ${l.bloque}.`;
  if (!form.mensaje.value.trim() || form.mensaje.value === mensajeAuto) form.mensaje.value = nuevo;
  mensajeAuto = nuevo;
  document.getElementById('modal-lote').textContent = `Lote ${l.id} · ${fmt(l.area_m2)} m²`;
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
  if (selected) selected.node.classList.remove('selected');
  selected = null;
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
  const r = svg.getBoundingClientRect();
  tooltip.textContent = `Lote ${l.id} · ${fmt(l.area_m2)} m²`;
  tooltip.style.left = `${e.clientX - r.left}px`;
  tooltip.style.top = `${e.clientY - r.top}px`;
  tooltip.hidden = false;
}
function hideTip() { tooltip.hidden = true; }

// ---------- Pan / zoom (sobre el viewBox) ----------

function fitBox() {
  const pts = lotes.flatMap(l => l.poligono);
  const xs = pts.map(p => p[0]), ys = pts.map(p => -p[1]);
  const pad = 8;
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

function setView(v) {
  view = v;
  svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
}

// Convierte coordenadas de pantalla a coordenadas del viewBox (respetando preserveAspectRatio meet)
function toSvg(clientX, clientY) {
  const p = new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM().inverse());
  return [p.x, p.y];
}

function zoomAt(factor, clientX, clientY) {
  const w = view.w / factor;
  if (w < 15 || w > home.w * 2.5) return;
  const [px, py] = toSvg(clientX, clientY);
  setView({ x: px - (px - view.x) / factor, y: py - (py - view.y) / factor, w, h: view.h / factor });
}

function setupPanZoom() {
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
  }, { passive: false });

  const pointers = new Map();
  let moved = 0, pinchDist = 0, downTarget = null;

  svg.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svg.setPointerCapture(e.pointerId);
    if (pointers.size === 1) { moved = 0; downTarget = e.target; }
    if (pointers.size === 2) pinchDist = dist(...pointers.values());
  });

  svg.addEventListener('pointermove', e => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (pointers.size === 1) {
      moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
      if (moved > 6) {
        svg.classList.add('dragging');
        hideTip();
        const [ax, ay] = toSvg(prev.x, prev.y), [bx, by] = toSvg(cur.x, cur.y);
        setView({ ...view, x: view.x - (bx - ax), y: view.y - (by - ay) });
      }
    }
    pointers.set(e.pointerId, cur);
    if (pointers.size === 2) {
      moved = Infinity;
      const [a, b] = [...pointers.values()], d = dist(a, b);
      if (pinchDist) zoomAt(d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinchDist = d;
    }
  });

  const end = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      svg.classList.remove('dragging');
      if (moved <= 6 && e.type === 'pointerup') {
        const lot = lotes.find(l => l.node === downTarget);
        if (lot?.disponible) openPanel(lot);
      }
    }
    if (pointers.size < 2) pinchDist = 0;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  document.querySelector('.map-tools').addEventListener('click', e => {
    const z = e.target.dataset.zoom;
    if (!z) return;
    const r = svg.getBoundingClientRect();
    if (z === 'fit') setView({ ...home });
    else zoomAt(z === 'in' ? 1.4 : 1 / 1.4, r.left + r.width / 2, r.top + r.height / 2);
  });
}

// ---------- Geometría ----------

function centroid(p) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length], f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  return [cx / (3 * a), cy / (3 * a)];
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
