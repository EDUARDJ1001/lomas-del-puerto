// Contabilidad (privada, solo administradores): clientes, ventas, pagos, gastos y banco.
// Tablas en Supabase: supabase/contabilidad.sql. La abre js/admin.js con window.abrirContabilidad(seccion).
// Usa de js/admin.js: sb (cliente de Supabase), aviso(), $(), fmt(), CONFIG, lotes (estado público), pintar() y precioVara.
(() => {
  const vista = $('vista-contabilidad');
  const modal = $('modal');

  // ---------- Formatos ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const M = n => `${CONFIG.moneda} ${num(n)}`;
  const r2 = n => Math.round(n * 100) / 100;
  const hoy = () => new Date().toLocaleDateString('en-CA'); // aaaa-mm-dd en la hora local
  const fecha = d => d ? new Date(`${d}T00:00`).toLocaleDateString('es-HN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  // Suma meses sin pasarse del último día del mes (31 de enero + 1 mes = 28/29 de febrero)
  const sumarMeses = (iso, k) => {
    const [y, m, d] = iso.split('-').map(Number);
    const ultimo = new Date(y, m - 1 + k + 1, 0).getDate();
    return new Date(y, m - 1 + k, Math.min(d, ultimo)).toLocaleDateString('en-CA');
  };

  const ESTADOS = {
    pagado: 'Pagado', al_dia: 'Al día', atrasado: 'Saldo vencido', sin_precio: 'Sin precio', sin_venta: 'Sin lotes', libre: 'Libre',
  };
  const COLOR = { libre: '#d3ecd9', no_disponible: '#bfc3c6', pagado: '#1e5b3c', al_dia: '#3b74c4', atrasado: '#d64541', sin_precio: '#e0a03a' };
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  const pill = e => `<span class="pill ${e}">${ESTADOS[e]}</span>`;
  const FORMAS = ['Efectivo', 'Transferencia', 'Depósito', 'Cheque', 'Otro'];

  // ---------- Datos ----------
  let D = null, falta = false, cargando = null, seccion = 'resumen', geom = null, bases = null;

  async function cargarDatos() {
    geom ||= await fetch('data/lotes.json').then(r => r.json());
    const orden = q => q.order('fecha', { ascending: false, nullsFirst: false }).order('creado', { ascending: false });
    const [c, v, vl, p, g, a] = await Promise.all([
      sb.from('clientes').select('*').order('nombre'),
      orden(sb.from('ventas').select('*')),
      sb.from('venta_lotes').select('*'),
      orden(sb.from('pagos').select('*')),
      orden(sb.from('gastos').select('*')),
      sb.from('ajustes').select('saldo_inicial').eq('id', 1).maybeSingle(),
    ]);
    const err = [c, v, vl, p, g].find(r => r.error)?.error;
    if (err) {
      // Sin las tablas (falta ejecutar supabase/contabilidad.sql) se explica qué hacer
      falta = ['PGRST205', '42P01', 'PGRST200'].includes(err.code) || /does not exist|schema cache/i.test(err.message);
      if (!falta) aviso(`No se pudo cargar la contabilidad: ${err.message}`, true);
      D = null;
      return;
    }
    falta = false;
    D = {
      clientes: c.data, ventas: v.data, ventaLotes: vl.data, pagos: p.data, gastos: g.data,
      saldoInicial: a.error ? 0 : Number(a.data?.saldo_inicial || 0),
    };
    calcular();
  }

  // Cuentas: cada venta debe su total (contado) o su prima más las cuotas ya vencidas (cuotas).
  // Los pagos se abonan a la cuenta del cliente, sumando todas sus ventas.
  function calcular() {
    const h = hoy();
    D.geomPorId = new Map(geom.map(l => [l.id, l]));
    D.clientePorId = new Map(D.clientes.map(c => [c.id, c]));
    for (const c of D.clientes) Object.assign(c, { ventas: [], pagos: [], total: 0, esperado: 0, pagado: 0 });
    for (const v of D.ventas) {
      v.lotes = D.ventaLotes.filter(x => x.venta_id === v.id)
        .sort((a, b) => a.lote_id.localeCompare(b.lote_id, 'es', { numeric: true }));
      v.total = r2(v.lotes.reduce((s, x) => s + Number(x.precio), 0));
      v.cliente = D.clientePorId.get(v.cliente_id);
      v.cuotaCalc = v.tipo === 'cuotas' ? (Number(v.cuota) || (v.meses > 0 ? r2(Math.max(0, v.total - v.prima) / v.meses) : 0)) : 0;
      if (v.tipo === 'contado') v.esperado = !v.fecha || v.fecha <= h ? v.total : 0;
      else {
        const vencidas = v.inicio_cuotas ? Array.from({ length: v.meses }, (_, k) => sumarMeses(v.inicio_cuotas, k)).filter(d => d <= h).length : 0;
        v.vencidas = vencidas;
        v.esperado = Math.min(v.total, Number(v.prima) + vencidas * v.cuotaCalc);
        v.proxima = v.inicio_cuotas && vencidas < v.meses ? sumarMeses(v.inicio_cuotas, vencidas) : null;
      }
      if (v.cliente) { v.cliente.ventas.push(v); v.cliente.total += v.total; v.cliente.esperado += v.esperado; }
    }
    for (const p of D.pagos) {
      p.cliente = D.clientePorId.get(p.cliente_id);
      if (p.cliente) { p.cliente.pagos.push(p); p.cliente.pagado += Number(p.monto); }
    }
    for (const c of D.clientes) {
      c.total = r2(c.total); c.pagado = r2(c.pagado);
      c.saldo = r2(c.total - c.pagado);
      c.vencido = r2(Math.max(0, c.esperado - c.pagado));
      c.lotes = c.ventas.flatMap(v => v.lotes.map(x => x.lote_id));
      c.estado = !c.ventas.length ? 'sin_venta' : c.total <= 0 ? 'sin_precio' : c.saldo <= 0.5 ? 'pagado' : c.vencido > 0.5 ? 'atrasado' : 'al_dia';
      c.proxima = c.ventas.map(v => v.proxima).filter(Boolean).sort()[0] || null;
    }
    D.ventaDeLote = new Map(D.ventas.flatMap(v => v.lotes.map(x => [x.lote_id, v])));
    const sum = (xs, f) => r2(xs.reduce((s, x) => s + Number(f(x)), 0));
    D.totales = {
      vendido: sum(D.ventas, v => v.total), lotesVendidos: D.ventaLotes.length,
      cobrado: sum(D.pagos, p => p.monto), gastos: sum(D.gastos, g => g.monto),
      porCobrar: sum(D.clientes.filter(c => c.saldo > 0), c => c.saldo),
      vencido: sum(D.clientes, c => c.vencido),
    };
    D.totales.banco = r2(D.saldoInicial + D.totales.cobrado - D.totales.gastos);
  }

  async function recargar() {
    await cargarDatos();
    pintarVista();
  }

  // Estado de un lote en el plano de ventas: el de la cuenta de su comprador, o libre / no disponible
  function estadoLote(id) {
    const v = D.ventaDeLote.get(id);
    if (v) return v.cliente?.estado === 'sin_venta' ? 'al_dia' : v.cliente?.estado || 'al_dia';
    return lotes.find(l => l.id === id)?.estado === 'no_disponible' ? 'no_disponible' : 'libre';
  }

  // ---------- Entrada desde la barra lateral ----------
  window.abrirContabilidad = async sec => {
    seccion = sec;
    if (!D && !falta) {
      vista.innerHTML = '<p class="mut">Cargando contabilidad…</p>';
      await (cargando ||= cargarDatos().finally(() => { cargando = null; }));
    }
    pintarVista();
  };

  function pintarVista() {
    if (mapa) { mapa.remove(); mapa = null; }
    if (falta) {
      vista.innerHTML = `<div class="conta-head"><h1>Contabilidad</h1></div>
        <div class="aviso-sql"><p><b>Falta crear las tablas de contabilidad.</b></p>
        <p>Ejecuta <code>supabase/contabilidad.sql</code> en el SQL Editor de Supabase y vuelve a intentarlo.</p>
        <button class="btn btn-sm" type="button" id="c-reintentar">Reintentar</button></div>`;
      $('c-reintentar').onclick = async () => { falta = false; await window.abrirContabilidad(seccion); };
      return;
    }
    if (!D) { vista.innerHTML = '<p class="mut">No se pudo cargar la contabilidad.</p>'; return; }
    VISTAS[seccion]();
  }

  const cabecera = (titulo, botones = '') => `<div class="conta-head"><h1>${titulo}</h1><div class="acciones">${botones}</div></div>`;
  const kpi = (txt, val, extra = '', cls = '') => `<div class="kpi ${cls}"><span>${txt}</span><b>${val}</b>${extra ? `<small>${extra}</small>` : ''}</div>`;
  const lotesTxt = ids => ids.length ? `<span class="lotes-txt">${esc(ids.join(', '))}</span>` : '<span class="mut">—</span>';
  const enlazar = (sel, fn) => vista.querySelectorAll(sel).forEach(el => el.addEventListener('click', () => fn(el.dataset.id)));
  const botonesDe = (map) => Object.entries(map).forEach(([id, fn]) => { const b = $(id); if (b) b.onclick = fn; });
  // Desactiva el botón mientras se genera el PDF (la primera vez descarga la librería)
  const conEspera = async (b, fn) => {
    const antes = b.textContent;
    b.disabled = true; b.textContent = 'Generando…';
    try { await fn(); } finally { b.disabled = false; b.textContent = antes; }
  };
  // Último día de un mes "aaaa-mm", para pasar el filtro de mes al PDF
  const rangoMes = mes => mes ? [`${mes}-01`, new Date(...mes.split('-').map(Number), 0).toLocaleDateString('en-CA')] : ['', ''];
  const BTN_PDF = '<button class="btn btn-sm btn-outline" id="c-pdf-btn" title="Descargar en PDF">PDF</button>';

  // ---------- Secciones ----------
  const VISTAS = {
    resumen() {
      const T = D.totales;
      const vencidos = D.clientes.filter(c => c.vencido > 0.5).sort((a, b) => b.vencido - a.vencido);
      const totalLotes = geom.length;
      vista.innerHTML = cabecera('Resumen', `<button class="btn btn-sm" id="c-pago">Registrar pago</button><button class="btn btn-sm btn-outline" id="c-venta">Nueva venta</button>${BTN_PDF}`) + `
        <div class="kpis">
          ${kpi('Saldo en banco', M(T.banco), `Saldo inicial ${M(D.saldoInicial)}`, 'principal')}
          ${kpi('Total vendido', M(T.vendido), `${T.lotesVendidos} de ${totalLotes} lotes`)}
          ${kpi('Cobrado', M(T.cobrado), plural(D.pagos.length, 'pago', 'pagos'))}
          ${kpi('Por cobrar', M(T.porCobrar))}
          ${kpi('Saldo vencido', `<span class="${T.vencido > 0 ? 'neg' : ''}">${M(T.vencido)}</span>`, plural(vencidos.length, 'cliente', 'clientes'))}
          ${kpi('Gastos', M(T.gastos), plural(D.gastos.length, 'registro', 'registros'))}
        </div>
        <div class="tarjeta"><h2>Cobros vencidos</h2>${vencidos.length ? tablaClientes(vencidos.slice(0, 8), true) : '<p class="mut">Nadie tiene cuotas vencidas sin pagar.</p>'}</div>
        <div class="tarjeta"><h2>Últimos pagos</h2>${tablaPagos(D.pagos.slice(0, 6), false)}</div>`;
      botonesDe({ 'c-pago': () => modalPago(), 'c-venta': () => modalVenta() });
      $('c-pdf-btn').onclick = e => conEspera(e.target, () => exportarPdf('resumen'));
      enlazar('tr[data-cliente]', id => modalCuenta(id));
      enlazar('tr[data-pago]', id => modalPago(D.pagos.find(p => p.id === id)));
    },

    plano() {
      vista.innerHTML = cabecera('Plano de ventas') + `
        <ul class="leyenda">${['pagado', 'al_dia', 'atrasado', 'sin_precio', 'libre', 'no_disponible']
          .map(e => `<li><i style="background:${COLOR[e]}"></i>${e === 'no_disponible' ? 'No disponible' : ESTADOS[e]}</li>`).join('')}</ul>
        <div class="plano-wrap">
          <div class="plano-mapa" id="c-mapa"></div>
          <div class="plano-ficha" id="c-ficha"><p class="mut">Toca un lote para ver a quién se le vendió y cómo va su cuenta.</p></div>
        </div>`;
      dibujarPlano();
    },

    cobrar() {
      vista.innerHTML = cabecera('Cuentas por cobrar', `<button class="btn btn-sm" id="c-pago">Registrar pago</button>`) + `
        <div class="filtro-bar">
          <input type="search" id="c-buscar" placeholder="Buscar cliente o lote">
          <select id="c-estado"><option value="">Todos con saldo</option><option value="atrasado">Saldo vencido</option><option value="al_dia">Al día</option><option value="sin_precio">Sin precio</option></select>
        </div><div id="c-tabla"></div>`;
      const pintarT = () => {
        const q = $('c-buscar').value.trim().toLowerCase(), e = $('c-estado').value;
        const xs = D.clientes.filter(c => c.ventas.length && (c.saldo > 0.5 || c.estado === 'sin_precio'))
          .filter(c => !e || c.estado === e)
          .filter(c => !q || c.nombre.toLowerCase().includes(q) || c.lotes.some(l => l.toLowerCase().includes(q)))
          .sort((a, b) => b.vencido - a.vencido || b.saldo - a.saldo);
        $('c-tabla').innerHTML = tablaClientes(xs, true, true);
        enlazar('tr[data-cliente]', id => modalCuenta(id));
      };
      $('c-buscar').oninput = $('c-estado').onchange = pintarT;
      pintarT();
      botonesDe({ 'c-pago': () => modalPago() });
    },

    clientes() {
      vista.innerHTML = cabecera('Clientes', `<button class="btn btn-sm" id="c-nuevo">Nuevo cliente</button>`) + `
        <div class="filtro-bar"><input type="search" id="c-buscar" placeholder="Buscar por nombre, teléfono o lote"></div><div id="c-tabla"></div>`;
      const pintarT = () => {
        const q = $('c-buscar').value.trim().toLowerCase();
        const xs = D.clientes.filter(c => !q || [c.nombre, c.telefono, ...c.lotes].some(t => t.toLowerCase().includes(q)));
        $('c-tabla').innerHTML = tablaClientes(xs, false, true, true);
        enlazar('tr[data-cliente]', id => modalCuenta(id));
      };
      $('c-buscar').oninput = pintarT;
      pintarT();
      botonesDe({ 'c-nuevo': () => modalCliente() });
    },

    ventas() {
      vista.innerHTML = cabecera('Ventas', `<button class="btn btn-sm" id="c-nueva">Nueva venta</button>`) + `
        <div class="filtro-bar"><input type="search" id="c-buscar" placeholder="Buscar cliente o lote"></div><div id="c-tabla"></div>`;
      const pintarT = () => {
        const q = $('c-buscar').value.trim().toLowerCase();
        const xs = D.ventas.filter(v => !q || (v.cliente?.nombre || '').toLowerCase().includes(q) || v.lotes.some(x => x.lote_id.toLowerCase().includes(q)));
        $('c-tabla').innerHTML = `<div class="tabla-wrap"><table class="tabla">
          <thead><tr><th>Fecha</th><th>Cliente</th><th>Lotes</th><th>Acuerdo</th><th class="n">Total</th></tr></thead>
          <tbody>${xs.map(v => `<tr class="clic" data-venta data-id="${v.id}">
            <td>${fecha(v.fecha)}</td><td>${esc(v.cliente?.nombre)}</td><td>${lotesTxt(v.lotes.map(x => x.lote_id))}</td>
            <td>${acuerdo(v)}</td><td class="n">${M(v.total)}</td></tr>`).join('') || '<tr><td colspan="5" class="vacio">Sin ventas registradas.</td></tr>'}</tbody>
          ${xs.length ? `<tfoot><tr><td colspan="4">${plural(xs.length, 'venta', 'ventas')} · ${plural(xs.reduce((s, v) => s + v.lotes.length, 0), 'lote', 'lotes')}</td><td class="n">${M(xs.reduce((s, v) => s + v.total, 0))}</td></tr></tfoot>` : ''}
        </table></div>`;
        enlazar('tr[data-venta]', id => modalVenta(D.ventas.find(v => v.id === id)));
      };
      $('c-buscar').oninput = pintarT;
      pintarT();
      botonesDe({ 'c-nueva': () => modalVenta() });
    },

    pagos() {
      vista.innerHTML = cabecera('Pagos recibidos', `<button class="btn btn-sm" id="c-nuevo">Registrar pago</button>${BTN_PDF}`) + `
        <div class="filtro-bar"><input type="search" id="c-buscar" placeholder="Buscar cliente, forma o nota"><input type="month" id="c-mes" aria-label="Mes"></div><div id="c-tabla"></div>`;
      const pintarT = () => {
        const q = $('c-buscar').value.trim().toLowerCase(), mes = $('c-mes').value;
        const xs = D.pagos.filter(p => (!mes || (p.fecha || '').startsWith(mes)) &&
          (!q || [p.cliente?.nombre || '', p.forma, p.nota].some(t => t.toLowerCase().includes(q))));
        $('c-tabla').innerHTML = tablaPagos(xs, true);
        enlazar('tr[data-pago]', id => modalPago(D.pagos.find(p => p.id === id)));
      };
      $('c-buscar').oninput = $('c-mes').oninput = pintarT;
      pintarT();
      botonesDe({ 'c-nuevo': () => modalPago() });
      $('c-pdf-btn').onclick = e => conEspera(e.target, () => exportarPdf('ingresos', ...rangoMes($('c-mes').value)));
    },

    gastos() {
      vista.innerHTML = cabecera('Gastos', `<button class="btn btn-sm" id="c-nuevo">Registrar gasto</button>${BTN_PDF}`) + `
        <div class="filtro-bar"><input type="search" id="c-buscar" placeholder="Buscar descripción, categoría o nota"><input type="month" id="c-mes" aria-label="Mes"></div><div id="c-tabla"></div>`;
      const pintarT = () => {
        const q = $('c-buscar').value.trim().toLowerCase(), mes = $('c-mes').value;
        const xs = D.gastos.filter(g => (!mes || (g.fecha || '').startsWith(mes)) &&
          (!q || [g.descripcion, g.categoria, g.nota].some(t => t.toLowerCase().includes(q))));
        $('c-tabla').innerHTML = `<div class="tabla-wrap"><table class="tabla">
          <thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th class="n">Monto</th></tr></thead>
          <tbody>${xs.map(g => `<tr class="clic" data-gasto data-id="${g.id}"><td>${fecha(g.fecha)}</td>
            <td>${esc(g.descripcion)}${g.nota ? `<br><span class="mut">${esc(g.nota)}</span>` : ''}</td><td>${esc(g.categoria) || '<span class="mut">—</span>'}</td>
            <td class="n">${M(g.monto)}</td></tr>`).join('') || '<tr><td colspan="4" class="vacio">Sin gastos.</td></tr>'}</tbody>
          ${xs.length ? `<tfoot><tr><td colspan="3">${plural(xs.length, 'gasto', 'gastos')}</td><td class="n">${M(xs.reduce((s, g) => s + Number(g.monto), 0))}</td></tr></tfoot>` : ''}
        </table></div>`;
        enlazar('tr[data-gasto]', id => modalGasto(D.gastos.find(g => g.id === id)));
      };
      $('c-buscar').oninput = $('c-mes').oninput = pintarT;
      pintarT();
      botonesDe({ 'c-nuevo': () => modalGasto() });
      $('c-pdf-btn').onclick = e => conEspera(e.target, () => exportarPdf('gastos', ...rangoMes($('c-mes').value)));
    },

    banco() {
      // Libro: saldo inicial, luego ingresos (pagos) y egresos (gastos) en orden de fecha, con el saldo después de cada uno
      const movs = [
        ...D.pagos.map(p => ({ fecha: p.fecha, creado: p.creado, txt: `Pago · ${p.cliente?.nombre || ''}`, nota: [p.forma, p.nota].filter(Boolean).join(' · '), monto: Number(p.monto) })),
        ...D.gastos.map(g => ({ fecha: g.fecha, creado: g.creado, txt: g.descripcion, nota: [g.categoria, g.nota].filter(Boolean).join(' · '), monto: -Number(g.monto) })),
      ].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || a.creado.localeCompare(b.creado));
      let saldo = D.saldoInicial;
      for (const m of movs) m.saldo = saldo = r2(saldo + m.monto);
      const T = D.totales;
      vista.innerHTML = cabecera('Banco') + `
        <div class="kpis">${kpi('Saldo actual', M(T.banco), '', 'principal')}${kpi('Ingresos (pagos)', M(T.cobrado))}${kpi('Egresos (gastos)', M(T.gastos))}</div>
        <form class="tarjeta tarifa" id="c-saldo">
          <div class="tarifa-texto"><h2>Saldo inicial</h2><p>Lo que tenía la cuenta antes del primer movimiento registrado.</p></div>
          <label><span>Saldo inicial (${CONFIG.moneda})</span><input name="saldo" type="number" step="0.01" inputmode="decimal" value="${D.saldoInicial}" required></label>
          <button class="btn" type="submit">Guardar</button>
        </form>
        <div class="tabla-wrap"><table class="tabla">
          <thead><tr><th>Fecha</th><th>Movimiento</th><th class="n">Ingreso</th><th class="n">Egreso</th><th class="n">Saldo</th></tr></thead>
          <tbody><tr><td>—</td><td>Saldo inicial</td><td></td><td></td><td class="n">${M(D.saldoInicial)}</td></tr>
          ${movs.map(m => `<tr><td>${fecha(m.fecha)}</td><td>${esc(m.txt)}${m.nota ? `<br><span class="mut">${esc(m.nota)}</span>` : ''}</td>
            <td class="n">${m.monto > 0 ? M(m.monto) : ''}</td><td class="n">${m.monto < 0 ? M(-m.monto) : ''}</td>
            <td class="n ${m.saldo < 0 ? 'neg' : ''}">${M(m.saldo)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="2">Totales</td><td class="n">${M(T.cobrado)}</td><td class="n">${M(T.gastos)}</td><td class="n">${M(T.banco)}</td></tr></tfoot>
        </table></div>`;
      $('c-saldo').onsubmit = async e => {
        e.preventDefault();
        const valor = Number(e.target.saldo.value);
        const { error } = await sb.from('ajustes').update({ saldo_inicial: valor }).eq('id', 1);
        if (error) return aviso(`No se guardó el saldo: ${error.message}`, true);
        aviso('Saldo inicial guardado');
        recargar();
      };
    },

    exportar() {
      vista.innerHTML = cabecera('Exportar') + `
        <form class="tarjeta" id="c-pdf"><h2>Reportes en PDF</h2>
          <p class="mut">Con el logo de Lomas del Puerto y la fecha y hora en que se emite. Deja las fechas vacías para incluir todo.</p>
          <div class="campos" style="margin-top:12px">
            <label><span>Desde</span><input type="date" name="desde"></label>
            <label><span>Hasta</span><input type="date" name="hasta"></label>
          </div>
          <div class="acciones" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
            <button class="btn btn-sm" type="button" data-pdf="resumen">Resumen general</button>
            <button class="btn btn-sm" type="button" data-pdf="ingresos">Ingresos</button>
            <button class="btn btn-sm" type="button" data-pdf="gastos">Gastos</button>
          </div></form>
        <div class="tarjeta"><h2>Descargar en Excel (CSV)</h2>
          <p class="mut">Cada archivo se abre directamente con Excel o Google Sheets.</p>
          <div class="acciones" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
            <button class="btn btn-sm btn-outline" data-csv="cuentas">Cuentas de clientes</button>
            <button class="btn btn-sm btn-outline" data-csv="lotes">Lotes vendidos</button>
            <button class="btn btn-sm btn-outline" data-csv="pagos">Pagos</button>
            <button class="btn btn-sm btn-outline" data-csv="gastos">Gastos</button>
            <button class="btn btn-sm btn-outline" data-csv="banco">Banco</button>
          </div></div>`;
      vista.querySelectorAll('[data-csv]').forEach(b => b.addEventListener('click', () => exportar(b.dataset.csv)));
      const f = $('c-pdf');
      f.querySelectorAll('[data-pdf]').forEach(b => b.addEventListener('click', () => conEspera(b, () => exportarPdf(b.dataset.pdf, f.desde.value, f.hasta.value))));
    },
  };

  // ---------- Tablas compartidas ----------
  function tablaClientes(xs, conVencido, conTotales = false, todos = false) {
    const fila = c => `<tr class="clic" data-cliente data-id="${c.id}">
      <td>${esc(c.nombre)}${todos && c.telefono ? `<br><span class="mut">${esc(c.telefono)}</span>` : ''}</td><td>${lotesTxt(c.lotes)}</td>
      <td class="n">${M(c.total)}</td><td class="n">${M(c.pagado)}</td>
      <td class="n">${c.saldo < 0 ? `<span class="mut">a favor ${M(-c.saldo)}</span>` : M(c.saldo)}</td>
      ${conVencido ? `<td class="n ${c.vencido > 0 ? 'neg' : ''}">${M(c.vencido)}</td>` : ''}<td>${pill(c.estado)}</td></tr>`;
    const s = f => xs.reduce((t, c) => t + f(c), 0);
    return `<div class="tabla-wrap"><table class="tabla">
      <thead><tr><th>Cliente</th><th>Lotes</th><th class="n">Total</th><th class="n">Pagado</th><th class="n">Saldo</th>${conVencido ? '<th class="n">Vencido</th>' : ''}<th>Estado</th></tr></thead>
      <tbody>${xs.map(fila).join('') || `<tr><td colspan="7" class="vacio">Nada que mostrar.</td></tr>`}</tbody>
      ${conTotales && xs.length ? `<tfoot><tr><td colspan="2">${plural(xs.length, 'cliente', 'clientes')}</td><td class="n">${M(s(c => c.total))}</td><td class="n">${M(s(c => c.pagado))}</td>
        <td class="n">${M(s(c => Math.max(0, c.saldo)))}</td>${conVencido ? `<td class="n">${M(s(c => c.vencido))}</td>` : ''}<td></td></tr></tfoot>` : ''}
    </table></div>`;
  }

  function tablaPagos(xs, conTotal) {
    return `<div class="tabla-wrap"><table class="tabla">
      <thead><tr><th>Fecha</th><th>Cliente</th><th>Forma</th><th class="n">Monto</th></tr></thead>
      <tbody>${xs.map(p => `<tr class="clic" data-pago data-id="${p.id}"><td>${fecha(p.fecha)}</td>
        <td>${esc(p.cliente?.nombre)}${p.nota ? `<br><span class="mut">${esc(p.nota)}</span>` : ''}</td><td>${esc(p.forma) || '<span class="mut">—</span>'}</td>
        <td class="n">${M(p.monto)}</td></tr>`).join('') || '<tr><td colspan="4" class="vacio">Sin pagos.</td></tr>'}</tbody>
      ${conTotal && xs.length ? `<tfoot><tr><td colspan="3">${plural(xs.length, 'pago', 'pagos')}</td><td class="n">${M(xs.reduce((s, p) => s + Number(p.monto), 0))}</td></tr></tfoot>` : ''}
    </table></div>`;
  }

  function acuerdo(v) {
    if (v.tipo === 'contado') return 'Contado';
    return `Prima ${M(v.prima)} + ${v.meses} × ${M(v.cuotaCalc)}`;
  }

  // ---------- Plano de ventas (Leaflet, sin mapa de fondo) ----------
  let mapa = null, plSel = null;
  const latRad = CONFIG.plano.lat * Math.PI / 180;
  const M_LAT = 111132.92 - 559.82 * Math.cos(2 * latRad), M_LNG = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);
  const transformacion = G => ([x, y]) => {
    const rad = G.rotacion * Math.PI / 180, dx = x - G.origen[0], dy = y - G.origen[1];
    return [G.lat + (dx * Math.sin(rad) + dy * Math.cos(rad)) / M_LAT, G.lng + (dx * Math.cos(rad) - dy * Math.sin(rad)) / M_LNG];
  };
  const geo1 = transformacion(CONFIG.plano), geo2 = CONFIG.plano2 ? transformacion(CONFIG.plano2) : null;
  const centro = p => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];

  async function dibujarPlano() {
    bases ||= await Promise.all([
      fetch('data/plano-base.json').then(r => r.json()),
      geo2 ? fetch('data/plano-base-lado2.json').then(r => r.json()) : null,
    ]);
    const el = $('c-mapa');
    if (!el) return; // se cambió de sección mientras cargaba
    mapa = L.map(el, { zoomSnap: 0.25, zoomDelta: 0.5, attributionControl: false, maxZoom: 22 });
    const fijo = { interactive: false, smoothFactor: 0 };
    bases.forEach((b, i) => {
      if (!b) return;
      const g = i ? geo2 : geo1;
      for (const s of b.calles.superficies) L.polygon(s.map(g), { ...fijo, className: 'c-calle' }).addTo(mapa);
    });
    const capas = [];
    for (const l of geom.filter(x => !x.sector || geo2)) {
      const g = l.sector ? geo2 : geo1, e = estadoLote(l.id);
      const capa = L.polygon(l.poligono.map(g), { className: `c-lote${l.id === plSel ? ' sel' : ''}`, fillColor: COLOR[e], smoothFactor: 0 }).addTo(mapa);
      const v = D.ventaDeLote.get(l.id);
      capa.bindTooltip(`${esc(l.id)}${v ? ` · ${esc(v.cliente?.nombre)}` : ''}`, { sticky: true });
      capa.on('click', () => { capas.forEach(c => c.getElement()?.classList.remove('sel')); capa.getElement().classList.add('sel'); fichaLote(l.id); });
      L.marker(g(centro(l.poligono)), { icon: L.divIcon({ className: `c-etq ${e}`, html: `<span>${esc(l.id.replace(/^1B-/, ''))}</span>`, iconSize: null }), interactive: false, keyboard: false }).addTo(mapa);
      capas.push(capa);
    }
    mapa.fitBounds(L.featureGroup(capas).getBounds(), { padding: [16, 16] });
    const etiquetas = () => el.classList.toggle('chico', mapa.getZoom() < 18.5);
    mapa.on('zoomend', etiquetas);
    etiquetas();
    if (plSel) fichaLote(plSel);
  }

  function fichaLote(id) {
    plSel = id;
    const l = D.geomPorId.get(id), v = D.ventaDeLote.get(id), ficha = $('c-ficha');
    if (!ficha) return;
    const datosLote = `<p class="mut" style="margin:0">${fmt(l.area_m2)} m² · ${fmt(l.area_vrs2)} vrs²</p>`;
    if (!v) {
      const pub = lotes.find(x => x.id === id)?.estado;
      ficha.innerHTML = `<h2>Lote ${esc(id)}</h2>${datosLote}
        <p style="margin:12px 0">${pill('libre')}${pub && pub !== 'disponible' ? ` <span class="mut">En el mapa público: ${esc(pub.replace('_', ' '))}${pub === 'vendido' ? ', sin venta registrada aquí' : ''}.</span>` : ''}</p>
        <div class="acciones"><button class="btn btn-sm" id="f-venta">Registrar venta</button></div>`;
      $('f-venta').onclick = () => modalVenta(null, { lote: id });
      return;
    }
    const c = v.cliente, x = v.lotes.find(y => y.lote_id === id);
    ficha.innerHTML = `<h2>Lote ${esc(id)}</h2>${datosLote}
      <dl>
        <dt>Cliente</dt><dd><b>${esc(c?.nombre)}</b></dd>
        <dt>Precio del lote</dt><dd>${M(x.precio)}${x.precio_vara != null ? `<br><span class="mut">${M(x.precio_vara)} / vara²</span>` : ''}</dd>
        <dt>Venta</dt><dd>${esc(acuerdo(v))}<br><span class="mut">${v.lotes.length} lote${v.lotes.length > 1 ? 's' : ''} · ${fecha(v.fecha)}</span></dd>
        <dt>Cuenta del cliente</dt><dd>${pill(c.estado)}</dd>
        <dt>Total</dt><dd>${M(c.total)}</dd>
        <dt>Pagado</dt><dd>${M(c.pagado)}</dd>
        <dt>Saldo</dt><dd>${M(Math.max(0, c.saldo))}</dd>
        ${c.vencido > 0.5 ? `<dt>Vencido</dt><dd class="neg">${M(c.vencido)}</dd>` : ''}
        ${c.proxima ? `<dt>Próxima cuota</dt><dd>${fecha(c.proxima)}</dd>` : ''}
      </dl>
      <div class="acciones"><button class="btn btn-sm" id="f-pago">Registrar pago</button>
        <button class="btn btn-sm btn-outline" id="f-cuenta">Ver cuenta</button><button class="btn btn-sm btn-outline" id="f-venta">Editar venta</button></div>`;
    botonesDe({ 'f-pago': () => modalPago(null, { cliente: c.id }), 'f-cuenta': () => modalCuenta(c.id), 'f-venta': () => modalVenta(v) });
  }

  // ---------- Ventanas (formularios) ----------
  function abrirModal(html) {
    modal.innerHTML = html;
    modal.querySelectorAll('[data-cerrar]').forEach(b => b.addEventListener('click', () => modal.close()));
    if (!modal.open) modal.showModal();
    return modal.querySelector('form');
  }
  const opcionesClientes = sel => D.clientes.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
  const pie = (borrar) => `<div class="modal-pie">${borrar ? '<button type="button" class="btn btn-sm btn-peligro izq" data-borrar>Eliminar</button>' : ''}
    <button type="button" class="btn btn-sm btn-outline" data-cerrar>Cancelar</button><button type="submit" class="btn btn-sm">Guardar</button></div>`;

  // Guarda y vuelve a pintar; devuelve true si salió bien
  async function ejecutar(promesa, ok) {
    const { error } = await promesa;
    if (error) { aviso(`No se guardó: ${error.message}`, true); return false; }
    aviso(ok);
    return true;
  }
  const despues = async () => { modal.close(); await recargar(); };

  function modalCliente(c = null) {
    const form = abrirModal(`<form><h2>${c ? 'Editar cliente' : 'Nuevo cliente'}</h2><div class="campos">
      <label class="full">Nombre <input name="nombre" required value="${esc(c?.nombre)}"></label>
      <label>Teléfono <input name="telefono" inputmode="tel" value="${esc(c?.telefono)}"></label>
      <label>Identidad <input name="identidad" value="${esc(c?.identidad)}"></label>
      <label class="full">Nota <textarea name="nota" rows="2">${esc(c?.nota)}</textarea></label>
    </div>${pie(c && !c.ventas.length && !c.pagos.length)}</form>`);
    form.onsubmit = async e => {
      e.preventDefault();
      const datos = { nombre: form.nombre.value.trim(), telefono: form.telefono.value.trim(), identidad: form.identidad.value.trim(), nota: form.nota.value.trim() };
      if (await ejecutar(c ? sb.from('clientes').update(datos).eq('id', c.id) : sb.from('clientes').insert(datos), 'Cliente guardado')) despues();
    };
    form.querySelector('[data-borrar]')?.addEventListener('click', async () => {
      if (confirm(`¿Eliminar a ${c.nombre}?`) && await ejecutar(sb.from('clientes').delete().eq('id', c.id), 'Cliente eliminado')) despues();
    });
  }

  function modalCuenta(id) {
    const c = D.clientePorId.get(id);
    abrirModal(`<div class="modal-cuerpo"><h2>${esc(c.nombre)}</h2>
      <p class="mut" style="margin:-8px 0 12px">${[c.telefono, c.identidad].filter(Boolean).map(esc).join(' · ') || 'Sin teléfono'}${c.nota ? `<br>${esc(c.nota)}` : ''}</p>
      <div class="kpis">${kpi('Total', M(c.total))}${kpi('Pagado', M(c.pagado))}${kpi('Saldo', M(Math.max(0, c.saldo)), c.saldo < 0 ? `a favor ${M(-c.saldo)}` : '')}
        ${kpi('Vencido', `<span class="${c.vencido > 0 ? 'neg' : ''}">${M(c.vencido)}</span>`, c.proxima ? `próxima cuota ${fecha(c.proxima)}` : '')}</div>
      <p>${pill(c.estado)}</p>
      <div class="historial"><h3>Ventas</h3>${c.ventas.length ? `<div class="tabla-wrap"><table class="tabla"><tbody>${c.ventas.map(v => `<tr class="clic" data-venta="${v.id}">
        <td>${fecha(v.fecha)}</td><td>${lotesTxt(v.lotes.map(x => x.lote_id))}</td><td>${acuerdo(v)}</td><td class="n">${M(v.total)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">Sin ventas.</p>'}</div>
      <div class="historial"><h3>Pagos</h3>${c.pagos.length ? `<div class="tabla-wrap"><table class="tabla"><tbody>${c.pagos.map(p => `<tr class="clic" data-pago="${p.id}">
        <td>${fecha(p.fecha)}</td><td>${esc(p.forma)}${p.nota ? ` <span class="mut">${esc(p.nota)}</span>` : ''}</td><td class="n">${M(p.monto)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mut">Sin pagos.</p>'}</div>
      <div class="modal-pie"><button type="button" class="btn btn-sm btn-outline izq" data-editar>Editar datos</button>
        <button type="button" class="btn btn-sm btn-outline" data-venta-nueva>Nueva venta</button><button type="button" class="btn btn-sm" data-pago-nuevo>Registrar pago</button>
        <button type="button" class="btn btn-sm btn-outline" data-cerrar>Cerrar</button></div></div>`);
    modal.querySelector('[data-editar]').onclick = () => modalCliente(c);
    modal.querySelector('[data-venta-nueva]').onclick = () => modalVenta(null, { cliente: c.id });
    modal.querySelector('[data-pago-nuevo]').onclick = () => modalPago(null, { cliente: c.id });
    modal.querySelectorAll('[data-venta]').forEach(tr => tr.onclick = () => modalVenta(D.ventas.find(v => v.id === tr.dataset.venta)));
    modal.querySelectorAll('[data-pago]').forEach(tr => tr.onclick = () => modalPago(D.pagos.find(p => p.id === tr.dataset.pago)));
  }

  function modalPago(p = null, pre = {}) {
    if (!D.clientes.length) return aviso('Primero agrega un cliente.', true);
    const form = abrirModal(`<form><h2>${p ? 'Editar pago' : 'Registrar pago'}</h2><div class="campos">
      <label class="full">Cliente <select name="cliente" required><option value="">Elegir…</option>${opcionesClientes(p?.cliente_id || pre.cliente)}</select></label>
      <label>Fecha <input name="fecha" type="date" value="${p ? p.fecha || '' : hoy()}"></label>
      <label>Monto (${CONFIG.moneda}) <input name="monto" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${p?.monto ?? ''}"></label>
      <label>Forma de pago <select name="forma"><option value="">—</option>${FORMAS.map(f => `<option ${f === p?.forma ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
      <label>Nota <input name="nota" value="${esc(p?.nota)}" placeholder="Cuota de marzo, recibo #…"></label>
      <p class="full mut" id="m-saldo" style="margin:0;font-size:.8rem"></p>
    </div>${pie(!!p)}</form>`);
    const saldo = () => {
      const c = D.clientePorId.get(form.cliente.value);
      $('m-saldo').textContent = c ? `Saldo de ${c.nombre}: ${M(Math.max(0, c.saldo))}${c.vencido > 0.5 ? ` · vencido ${M(c.vencido)}` : ''}` : '';
    };
    form.cliente.onchange = saldo;
    saldo();
    form.onsubmit = async e => {
      e.preventDefault();
      const monto = Number(form.monto.value);
      if (!(monto > 0)) return aviso('El monto debe ser mayor que cero.', true);
      const datos = { cliente_id: form.cliente.value, fecha: form.fecha.value || null, monto, forma: form.forma.value, nota: form.nota.value.trim() };
      if (await ejecutar(p ? sb.from('pagos').update(datos).eq('id', p.id) : sb.from('pagos').insert(datos), 'Pago guardado')) despues();
    };
    form.querySelector('[data-borrar]')?.addEventListener('click', async () => {
      if (confirm(`¿Eliminar el pago de ${M(p.monto)}?`) && await ejecutar(sb.from('pagos').delete().eq('id', p.id), 'Pago eliminado')) despues();
    });
  }

  function modalGasto(g = null) {
    const categorias = [...new Set(D.gastos.map(x => x.categoria).filter(Boolean))];
    const form = abrirModal(`<form><h2>${g ? 'Editar gasto' : 'Registrar gasto'}</h2><div class="campos">
      <label class="full">Descripción <input name="descripcion" required value="${esc(g?.descripcion)}"></label>
      <label>Fecha <input name="fecha" type="date" value="${g ? g.fecha || '' : hoy()}"></label>
      <label>Monto (${CONFIG.moneda}) <input name="monto" type="number" min="0" step="0.01" inputmode="decimal" required value="${g?.monto ?? ''}"></label>
      <label>Categoría <input name="categoria" list="m-categorias" value="${esc(g?.categoria)}" placeholder="Planos, topografía, trámites…"></label>
      <datalist id="m-categorias">${categorias.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      <label>Nota <input name="nota" value="${esc(g?.nota)}"></label>
    </div>${pie(!!g)}</form>`);
    form.onsubmit = async e => {
      e.preventDefault();
      const datos = { descripcion: form.descripcion.value.trim(), fecha: form.fecha.value || null, monto: Number(form.monto.value), categoria: form.categoria.value.trim(), nota: form.nota.value.trim() };
      if (await ejecutar(g ? sb.from('gastos').update(datos).eq('id', g.id) : sb.from('gastos').insert(datos), 'Gasto guardado')) despues();
    };
    form.querySelector('[data-borrar]')?.addEventListener('click', async () => {
      if (confirm(`¿Eliminar el gasto "${g.descripcion}"?`) && await ejecutar(sb.from('gastos').delete().eq('id', g.id), 'Gasto eliminado')) despues();
    });
  }

  // Venta: cliente (existente o nuevo), lotes con su precio, contado o prima + cuotas
  function modalVenta(v = null, pre = {}) {
    const ocupados = new Set(D.ventaLotes.filter(x => x.venta_id !== v?.id).map(x => x.lote_id));
    const libres = geom.filter(l => (!l.sector || geo2) && !ocupados.has(l.id));
    const tarifa = typeof precioVara === 'number' ? precioVara : CONFIG.precioVara; // tarifa general de js/admin.js
    let filas = v ? v.lotes.map(x => ({ id: x.lote_id, pv: x.precio_vara, precio: Number(x.precio) }))
      : pre.lote ? [{ id: pre.lote, pv: tarifa, precio: r2(D.geomPorId.get(pre.lote).area_vrs2 * tarifa) }] : [];
    const inicioDef = sumarMeses(v?.fecha || hoy(), 1);
    const form = abrirModal(`<form><h2>${v ? 'Editar venta' : 'Nueva venta'}</h2><div class="campos">
      <label class="full">Cliente <select name="cliente" required><option value="">Elegir…</option>${opcionesClientes(v?.cliente_id || pre.cliente)}<option value="__nuevo">+ Cliente nuevo…</option></select></label>
      <label class="full" id="m-nuevo" hidden>Nombre del cliente nuevo <input name="nuevo"></label>
      <label>Fecha de la venta <input name="fecha" type="date" value="${v ? v.fecha || '' : hoy()}"></label>
      <label>Forma de pago <select name="tipo"><option value="contado">Contado</option><option value="cuotas" ${v?.tipo === 'cuotas' ? 'selected' : ''}>Prima y cuotas mensuales</option></select></label>
      <div class="full"><p class="label" style="margin:0">Lotes <small>(precio por vara² o total del lote)</small></p>
        <div class="venta-lotes" id="m-lotes"></div>
        <div class="selector-lotes" style="margin-top:8px"><select id="m-agregar" aria-label="Lote para agregar"><option value="">Agregar lote…</option>
          ${libres.map(l => `<option value="${l.id}">${l.id} · ${fmt(l.area_vrs2)} vrs²</option>`).join('')}</select></div></div>
      <label class="m-cuotas">Prima (${CONFIG.moneda}) <input name="prima" type="number" min="0" step="0.01" value="${v?.prima ?? 0}"></label>
      <label class="m-cuotas">Meses <input name="meses" type="number" min="0" step="1" value="${v?.meses ?? 0}"></label>
      <label class="m-cuotas">Cuota mensual <input name="cuota" type="number" min="0" step="0.01" value="${v?.cuota ?? ''}" placeholder="Automática"></label>
      <label class="m-cuotas">Primera cuota <input name="inicio" type="date" value="${v?.inicio_cuotas || inicioDef}"></label>
      <div class="full calculo" id="m-calculo"></div>
      <label class="full">Nota del acuerdo <textarea name="nota" rows="2" placeholder="Condiciones especiales…">${esc(v?.nota)}</textarea></label>
      ${v ? '' : '<label class="full" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="marcar" checked style="width:auto"> Marcar los lotes como vendidos en el mapa público</label>'}
    </div>${pie(!!v)}</form>`);

    const pintarFilas = () => {
      $('m-lotes').innerHTML = filas.map((f, i) => `<div class="venta-lote" data-i="${i}"><b>${esc(f.id)}</b>
        <input type="number" step="0.01" min="0" data-campo="pv" value="${f.pv ?? ''}" placeholder="Fijo" aria-label="Precio por vara² de ${f.id}">
        <input type="number" step="0.01" min="0" data-campo="precio" value="${f.precio}" aria-label="Precio total de ${f.id}">
        <button type="button" data-quitar aria-label="Quitar ${f.id}">×</button></div>`).join('') || '<p class="mut" style="margin:0;font-size:.85rem">Sin lotes todavía.</p>';
      calculo();
    };
    const calculo = () => {
      const total = r2(filas.reduce((s, f) => s + Number(f.precio || 0), 0));
      const cuotas = form.tipo.value === 'cuotas';
      form.querySelectorAll('.m-cuotas').forEach(x => { x.hidden = !cuotas; });
      const prima = Number(form.prima.value || 0), meses = Number(form.meses.value || 0);
      const financiar = Math.max(0, total - prima), auto = meses > 0 ? r2(financiar / meses) : 0;
      form.cuota.placeholder = auto ? `Automática: ${num(auto)}` : 'Automática';
      $('m-calculo').innerHTML = `<div><span>Total</span><b>${M(total)}</b></div>` + (cuotas
        ? `<div><span>Prima</span><b>${M(prima)}</b></div><div><span>A financiar</span><b>${M(financiar)}</b></div><div><span>Cuota mensual</span><b>${meses ? M(Number(form.cuota.value) || auto) : '—'}</b></div>`
        : '');
    };
    $('m-lotes').addEventListener('input', e => {
      const i = +e.target.closest('[data-i]').dataset.i, f = filas[i], campo = e.target.dataset.campo;
      const vrs = D.geomPorId.get(f.id).area_vrs2;
      if (campo === 'pv') {
        f.pv = e.target.value === '' ? null : Number(e.target.value);
        if (f.pv != null) { f.precio = r2(vrs * f.pv); e.target.parentElement.querySelector('[data-campo=precio]').value = f.precio; }
      } else { f.precio = Number(e.target.value || 0); f.pv = null; e.target.parentElement.querySelector('[data-campo=pv]').value = ''; }
      calculo();
    });
    $('m-lotes').addEventListener('click', e => {
      if (!e.target.closest('[data-quitar]')) return;
      filas.splice(+e.target.closest('[data-i]').dataset.i, 1);
      pintarFilas();
    });
    $('m-agregar').onchange = e => {
      const id = e.target.value;
      if (id && !filas.some(f => f.id === id)) filas.push({ id, pv: tarifa, precio: r2(D.geomPorId.get(id).area_vrs2 * tarifa) });
      e.target.value = '';
      pintarFilas();
    };
    form.cliente.onchange = () => { $('m-nuevo').hidden = form.cliente.value !== '__nuevo'; form.nuevo.required = form.cliente.value === '__nuevo'; };
    for (const n of ['tipo', 'prima', 'meses', 'cuota']) form[n].addEventListener('input', calculo);
    form.tipo.addEventListener('change', calculo);
    pintarFilas();

    form.onsubmit = async e => {
      e.preventDefault();
      if (!filas.length) return aviso('Agrega al menos un lote.', true);
      const cuotas = form.tipo.value === 'cuotas';
      if (cuotas && !(Number(form.meses.value) > 0)) return aviso('Indica en cuántos meses se paga.', true);
      const boton = form.querySelector('[type=submit]');
      boton.disabled = true;
      try {
        let cliente_id = form.cliente.value;
        if (cliente_id === '__nuevo') {
          const r = await sb.from('clientes').insert({ nombre: form.nuevo.value.trim() }).select('id').single();
          if (r.error) return aviso(`No se creó el cliente: ${r.error.message}`, true);
          cliente_id = r.data.id;
        }
        const datos = {
          cliente_id, fecha: form.fecha.value || null, tipo: form.tipo.value, nota: form.nota.value.trim(),
          prima: cuotas ? Number(form.prima.value || 0) : 0, meses: cuotas ? Number(form.meses.value) : 0,
          cuota: cuotas && Number(form.cuota.value) > 0 ? Number(form.cuota.value) : null,
          inicio_cuotas: cuotas ? form.inicio.value || null : null,
        };
        const r = v ? await sb.from('ventas').update(datos).eq('id', v.id).select('id').single()
          : await sb.from('ventas').insert(datos).select('id').single();
        if (r.error) return aviso(`No se guardó la venta: ${r.error.message}`, true);
        const venta_id = r.data.id, ids = filas.map(f => f.id);
        // Lotes: se quitan los que ya no están y se guardan los demás con su precio
        const quitados = (v?.lotes || []).map(x => x.lote_id).filter(id => !ids.includes(id));
        if (quitados.length) {
          const q = await sb.from('venta_lotes').delete().in('lote_id', quitados);
          if (q.error) return aviso(`No se quitaron lotes: ${q.error.message}`, true);
        }
        const u = await sb.from('venta_lotes').upsert(filas.map(f => ({ lote_id: f.id, venta_id, precio_vara: f.pv, precio: r2(f.precio) })), { onConflict: 'lote_id' });
        if (u.error) {
          if (!v) await sb.from('ventas').delete().eq('id', venta_id); // no dejar una venta sin lotes
          return aviso(`No se guardaron los lotes: ${u.error.message}`, true);
        }
        if (form.marcar?.checked) await marcarLotes(ids, 'vendido');
        if (quitados.length && confirm(`¿Volver a marcar ${quitados.join(', ')} como disponible en el mapa público?`)) await marcarLotes(quitados, 'disponible');
        aviso('Venta guardada');
        despues();
      } finally { boton.disabled = false; }
    };
    form.querySelector('[data-borrar]')?.addEventListener('click', async () => {
      const ids = v.lotes.map(x => x.lote_id);
      if (!confirm(`¿Eliminar la venta de ${ids.join(', ')} a ${v.cliente?.nombre}? Los pagos del cliente se conservan.`)) return;
      if (!await ejecutar(sb.from('ventas').delete().eq('id', v.id), 'Venta eliminada')) return;
      if (confirm(`¿Volver a marcar ${ids.join(', ')} como disponible en el mapa público?`)) await marcarLotes(ids, 'disponible');
      despues();
    });
  }

  // Cambia el estado público de los lotes (tabla lotes) y la lista de Disponibilidad
  async function marcarLotes(ids, estado) {
    const { error } = await sb.from('lotes').update({ estado }).in('id', ids);
    if (error) return aviso(`No se cambió el estado de los lotes: ${error.message}`, true);
    for (const l of lotes) if (ids.includes(l.id)) l.estado = estado;
    pintar();
  }

  // ---------- Exportar (CSV para Excel) ----------
  function exportar(tipo) {
    const n = x => r2(Number(x || 0)).toFixed(2);
    const T = {
      cuentas: [['Cliente', 'Teléfono', 'Lotes', 'Total', 'Pagado', 'Saldo', 'Vencido', 'Estado'],
        ...D.clientes.map(c => [c.nombre, c.telefono, c.lotes.join(' '), n(c.total), n(c.pagado), n(c.saldo), n(c.vencido), ESTADOS[c.estado]])],
      lotes: [['Lote', 'Área m²', 'Área vrs²', 'Cliente', 'Fecha venta', 'Forma', 'Precio vara²', 'Precio'],
        ...D.ventas.flatMap(v => v.lotes.map(x => { const g = D.geomPorId.get(x.lote_id); return [x.lote_id, g?.area_m2, g?.area_vrs2, v.cliente?.nombre, v.fecha || '', v.tipo, x.precio_vara ?? '', n(x.precio)]; }))],
      pagos: [['Fecha', 'Cliente', 'Forma', 'Nota', 'Monto'], ...D.pagos.map(p => [p.fecha || '', p.cliente?.nombre, p.forma, p.nota, n(p.monto)])],
      gastos: [['Fecha', 'Descripción', 'Categoría', 'Nota', 'Monto'], ...D.gastos.map(g => [g.fecha || '', g.descripcion, g.categoria, g.nota, n(g.monto)])],
      banco: [['Fecha', 'Movimiento', 'Ingreso', 'Egreso'], ['', 'Saldo inicial', n(D.saldoInicial), ''],
        ...D.pagos.map(p => [p.fecha || '', `Pago ${p.cliente?.nombre || ''}`, n(p.monto), '']),
        ...D.gastos.map(g => [g.fecha || '', g.descripcion, '', n(g.monto)])],
    }[tipo];
    const csv = T.map(f => f.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const BOM = String.fromCharCode(0xfeff); // para que Excel abra el CSV con tildes
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' })),
      download: `lomas-${tipo}-${hoy()}.csv`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Reportes en PDF (jsPDF + AutoTable, se cargan solo al exportar) ----------
  let libPdf = null;
  const cargarScript = src => new Promise((ok, mal) => document.head.append(Object.assign(document.createElement('script'),
    { src, onload: ok, onerror: () => mal(new Error('sin conexión con la librería de PDF')) })));
  const prepararPdf = () => libPdf ||= (async () => {
    if (!window.jspdf) {
      await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
      await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js');
    }
    // El logo es WebP: se pasa a PNG con fondo blanco, que es lo que entiende jsPDF
    const img = await new Promise((ok, mal) => Object.assign(new Image(),
      { onload: e => ok(e.target), onerror: () => mal(new Error('no se encontró el logo')), src: 'img/logo-completo.webp' }));
    const cv = Object.assign(document.createElement('canvas'), { width: 600, height: Math.round(600 * img.naturalHeight / img.naturalWidth) });
    const cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    cx.drawImage(img, 0, 0, cv.width, cv.height);
    return { jsPDF: window.jspdf.jsPDF, logo: cv.toDataURL('image/png'), proporcion: cv.height / cv.width };
  })().catch(e => { libPdf = null; throw e; });

  // Las fuentes básicas del PDF no tienen los espacios finos que usa toLocaleString ("10:32 a. m.") ni el signo menos
  const txt = s => String(s ?? '').replace(/[   ]/g, ' ').replace(/−/g, '-');
  const enPeriodo = (f, desde, hasta) => (!desde && !hasta) || (f && (!desde || f >= desde) && (!hasta || f <= hasta));
  const textoPeriodo = (desde, hasta) => desde && hasta ? `Del ${fecha(desde)} al ${fecha(hasta)}` : desde ? `Desde el ${fecha(desde)}` : hasta ? `Hasta el ${fecha(hasta)}` : 'Todos los registros';
  const porCategoria = gs => [...gs.reduce((m, g) => m.set(g.categoria || 'Sin categoría', (m.get(g.categoria || 'Sin categoría') || 0) + Number(g.monto)), new Map())]
    .sort((a, b) => b[1] - a[1]);

  async function exportarPdf(tipo, desde = '', hasta = '') {
    if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
    let lib;
    try { lib = await prepararPdf(); } catch (e) { return aviso(`No se pudo generar el PDF: ${e.message}`, true); }
    const doc = new lib.jsPDF({ unit: 'mm', format: 'letter' });
    const ANCHO = doc.internal.pageSize.getWidth(), ALTO = doc.internal.pageSize.getHeight(), MARGEN = 15;
    const VERDE = [30, 91, 60], GRIS = [93, 101, 103];
    const titulo = { resumen: 'Resumen general', ingresos: 'Reporte de ingresos', gastos: 'Reporte de gastos' }[tipo];
    const emitido = txt(new Date().toLocaleString('es-HN', { dateStyle: 'long', timeStyle: 'short' }));
    const periodo = textoPeriodo(desde, hasta);
    const ALTO_CAB = 36;

    // Encabezado y pie en cada página
    const cabeceraPdf = () => {
      const anchoLogo = 34;
      doc.addImage(lib.logo, 'PNG', MARGEN, 9, anchoLogo, anchoLogo * lib.proporcion);
      doc.setTextColor(...VERDE).setFont('helvetica', 'bold').setFontSize(15).text(titulo, ANCHO - MARGEN, 15, { align: 'right' });
      doc.setTextColor(...GRIS).setFont('helvetica', 'normal').setFontSize(9)
        .text(`Emitido el ${emitido}`, ANCHO - MARGEN, 21, { align: 'right' })
        .text(`Periodo: ${periodo}`, ANCHO - MARGEN, 26, { align: 'right' });
      doc.setDrawColor(...VERDE).setLineWidth(0.6).line(MARGEN, ALTO_CAB - 4, ANCHO - MARGEN, ALTO_CAB - 4);
    };
    const pie = () => {
      doc.setTextColor(...GRIS).setFont('helvetica', 'normal').setFontSize(8)
        .text('Lomas del Puerto · Puerto Cortés · Documento de uso interno', MARGEN, ALTO - 8)
        .text(`Página ${doc.internal.getCurrentPageInfo().pageNumber} de {total}`, ANCHO - MARGEN, ALTO - 8, { align: 'right' });
    };
    const decorar = { didDrawPage: () => { cabeceraPdf(); pie(); }, margin: { top: ALTO_CAB + 2, left: MARGEN, right: MARGEN, bottom: 16 } };
    const estilo = {
      theme: 'grid', styles: { font: 'helvetica', fontSize: 9, cellPadding: 2, lineColor: [211, 215, 218], lineWidth: 0.2, textColor: [35, 41, 43] },
      headStyles: { fillColor: VERDE, textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [227, 243, 232], textColor: [35, 41, 43], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 248, 248] },
    };
    let y = ALTO_CAB + 2;
    const seccionPdf = (nombre) => {
      if (y > ALTO - 40) { doc.addPage(); y = ALTO_CAB + 2; }
      doc.setTextColor(...VERDE).setFont('helvetica', 'bold').setFontSize(11).text(nombre, MARGEN, y + 5);
      y += 8;
    };
    const tabla = (op) => {
      // Encabezado y totales alineados como su columna (las cifras a la derecha)
      const alinear = (f, conTamano) => f.map((c, i) => {
        const col = op.columnStyles?.[i] || {};
        return { content: txt(c), styles: { halign: col.halign || 'left', ...(conTamano && col.fontSize ? { fontSize: col.fontSize } : {}) } };
      });
      doc.autoTable({ ...estilo, ...decorar, startY: y, ...op,
        head: op.head && [alinear(op.head)], body: op.body.map(f => f.map(txt)), foot: op.foot && [alinear(op.foot, true)] });
      y = doc.lastAutoTable.finalY + 8;
    };
    const nota = (s) => {
      doc.setTextColor(...GRIS).setFont('helvetica', 'italic').setFontSize(8.5).text(txt(s), MARGEN, y - 4);
      y += 2;
    };
    // Cifras un poco más chicas y en una sola línea: "L 1,234,567.89" no se parte entre la L y el número
    const der = { halign: 'right', fontSize: 8, cellWidth: 'wrap' };

    const pagos = D.pagos.filter(p => enPeriodo(p.fecha, desde, hasta));
    const gastos = D.gastos.filter(g => enPeriodo(g.fecha, desde, hasta));
    const sinFecha = xs => (desde || hasta) ? xs.filter(x => !x.fecha).length : 0;
    const suma = (xs) => r2(xs.reduce((s, x) => s + Number(x.monto), 0));
    const ingresos = suma(pagos), egresos = suma(gastos);
    const cuentaSinFecha = (xs, uno, varios) => { const n = sinFecha(xs); if (n) nota(`${plural(n, uno, varios)} sin fecha no ${n === 1 ? 'entra' : 'entran'} en el periodo.`); };

    if (tipo === 'resumen') {
      const T = D.totales;
      seccionPdf(desde || hasta ? 'Movimientos del periodo' : 'Movimientos');
      tabla({ head: ['Concepto', 'Monto'], columnStyles: { 1: der },
        body: [['Ingresos (pagos de clientes)', M(ingresos)], ['Egresos (gastos)', M(egresos)]],
        foot: ['Diferencia', M(ingresos - egresos)] });
      cuentaSinFecha([...D.pagos, ...D.gastos], 'registro', 'registros');

      seccionPdf(`Situación al ${fecha(hoy())}`);
      tabla({ head: ['Indicador', 'Valor'], columnStyles: { 1: der }, body: [
        ['Saldo inicial', M(D.saldoInicial)],
        ['Saldo en banco (saldo inicial + ingresos − egresos)', M(T.banco)],
        ['Total vendido', `${M(T.vendido)} (${T.lotesVendidos} de ${geom.length} lotes)`],
        ['Cobrado a clientes', M(T.cobrado)],
        ['Por cobrar', M(T.porCobrar)],
        ['Saldo vencido', `${M(T.vencido)} (${plural(D.clientes.filter(c => c.vencido > 0.5).length, 'cliente', 'clientes')})`],
      ] });

      if (gastos.length) {
        seccionPdf('Gastos por categoría');
        tabla({ head: ['Categoría', 'Monto'], columnStyles: { 1: der }, body: porCategoria(gastos).map(([c, m]) => [c, M(m)]), foot: ['Total', M(egresos)] });
      }

      const cuentas = D.clientes.filter(c => c.ventas.length).sort((a, b) => b.vencido - a.vencido || b.saldo - a.saldo);
      seccionPdf('Cuentas de clientes');
      // Tabla ancha: la moneda va en el encabezado y no en cada cifra, para que quepan montos de millones
      const mon = CONFIG.moneda;
      tabla({ head: ['Cliente', 'Lotes', `Total (${mon})`, `Pagado (${mon})`, `Saldo (${mon})`, `Vencido (${mon})`, 'Estado'],
        styles: { ...estilo.styles, fontSize: 8, cellPadding: 1.6 },
        columnStyles: { 1: { cellWidth: 24 }, 2: der, 3: der, 4: der, 5: der },
        body: cuentas.map(c => [c.nombre, c.lotes.join(', '), num(c.total), num(c.pagado), c.saldo < 0 ? `a favor ${num(-c.saldo)}` : num(c.saldo), num(c.vencido), ESTADOS[c.estado]]),
        foot: [plural(cuentas.length, 'cliente', 'clientes'), '', num(cuentas.reduce((s, c) => s + c.total, 0)), num(cuentas.reduce((s, c) => s + c.pagado, 0)),
          num(cuentas.reduce((s, c) => s + Math.max(0, c.saldo), 0)), num(cuentas.reduce((s, c) => s + c.vencido, 0)), ''] });
    }

    if (tipo === 'ingresos') {
      seccionPdf('Pagos recibidos');
      tabla({ head: ['Fecha', 'Cliente', 'Lotes', 'Forma', 'Nota', 'Monto'],
        columnStyles: { 0: { cellWidth: 24 }, 2: { cellWidth: 30 }, 5: der },
        body: pagos.length ? pagos.map(p => [p.fecha ? fecha(p.fecha) : 'Sin fecha', p.cliente?.nombre, (p.cliente?.lotes || []).join(', '), p.forma || '—', p.nota || '', M(p.monto)])
          : [['', 'Sin pagos en este periodo.', '', '', '', '']],
        foot: [plural(pagos.length, 'pago', 'pagos'), '', '', '', '', M(ingresos)] });
      cuentaSinFecha(D.pagos, 'pago', 'pagos');
      if (pagos.length) {
        const formas = [...pagos.reduce((m, p) => m.set(p.forma || 'Sin indicar', (m.get(p.forma || 'Sin indicar') || 0) + Number(p.monto)), new Map())];
        seccionPdf('Por forma de pago');
        tabla({ head: ['Forma', 'Monto'], columnStyles: { 1: der }, body: formas.map(([f, m]) => [f, M(m)]), foot: ['Total', M(ingresos)] });
      }
    }

    if (tipo === 'gastos') {
      seccionPdf('Detalle de gastos');
      tabla({ head: ['Fecha', 'Descripción', 'Categoría', 'Nota', 'Monto'],
        columnStyles: { 0: { cellWidth: 24 }, 4: der },
        body: gastos.length ? gastos.map(g => [g.fecha ? fecha(g.fecha) : 'Sin fecha', g.descripcion, g.categoria || '—', g.nota || '', M(g.monto)])
          : [['', 'Sin gastos en este periodo.', '', '', '']],
        foot: [plural(gastos.length, 'gasto', 'gastos'), '', '', '', M(egresos)] });
      cuentaSinFecha(D.gastos, 'gasto', 'gastos');
      if (gastos.length) {
        seccionPdf('Por categoría');
        tabla({ head: ['Categoría', 'Monto'], columnStyles: { 1: der }, body: porCategoria(gastos).map(([c, m]) => [c, M(m)]), foot: ['Total', M(egresos)] });
      }
    }

    doc.putTotalPages('{total}');
    doc.save(`lomas-${tipo}-${hoy()}.pdf`);
  }
})();
