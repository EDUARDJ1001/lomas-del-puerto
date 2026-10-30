// Inventario de lotes (estado, precio, descripción, medidas, fotos) como { 'A-7': {...} }
// Con window.SITIO.supabase configurado lo lee de Supabase; si no está o falla, usa data/inventario.json
window.cargarInventario = async function () {
  const sb = window.SITIO.supabase;
  if (sb && sb.url && sb.anonKey) {
    try {
      const r = await fetch(`${sb.url}/rest/v1/lotes?select=id,estado,precio,descripcion,medidas,fotos`, {
        headers: { apikey: sb.anonKey, authorization: `Bearer ${sb.anonKey}` },
      });
      if (!r.ok) throw new Error(`Supabase ${r.status}`);
      const filas = await r.json();
      // Las fotos se guardan como rutas del bucket "fotos" ('A-7/1.jpg')
      const foto = f => /^https?:/.test(f) ? f : `${sb.url}/storage/v1/object/public/fotos/${f}`;
      return Object.fromEntries(filas.map(({ id, medidas, ...l }) =>
        [id, { ...l, ...(medidas ? { medidas } : {}), fotos: (l.fotos || []).map(foto) }]));
    } catch (e) {
      console.warn('Inventario desde Supabase no disponible, se usa data/inventario.json', e);
    }
  }
  return fetch('data/inventario.json').then(r => r.json());
};
