// Configuración compartida por el landing (index.html) y el mapa (mapa.html)
window.SITIO = {
  whatsapp: '50494917294', // número con código de país, p.ej. '50499999999'; vacío oculta los botones de WhatsApp
  moneda: 'L',
  precioVara: 950, // lempiras por vara²: precio aproximado de los lotes que no tienen "precio" en el inventario
  coordenadas: { lat: 15.811090, lng: -87.926862 },
  // Ubicación del plano sobre el mapa (aproximada: su lado suroeste va junto a la calle existente, sin taparla):
  // el punto "origen" del plano (metros, X al este, Y al norte) cae en lat/lng y el plano se gira "rotacion" grados
  // en sentido antihorario. Para corregirlo: mover lat/lng (0.00001° ≈ 1.1 m) o cambiar la rotación.
  plano: { origen: [193.83, 179.34], lat: 15.812103, lng: -87.926960, rotacion: 86.8 },
  radioMapaKm: 5, // el mapa no deja alejarse ni moverse más allá de este radio alrededor del proyecto
  // Supabase (Project Settings → API): URL del proyecto y clave pública "anon"/"publishable".
  // Vacío = se usa data/inventario.json. Nunca poner aquí la clave "service_role"/"secret".
  supabase: {
    url: 'https://lapubgwguzpdbptilqnu.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhcHViZ3dndXpwZGJwdGlscW51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzNTY3MDUsImV4cCI6MjEwODkzMjcwNX0.ORFV0PCdiPYotA9OJS2N8BtMrxi63AD4K7KdPhw8nE0',
  },
};
