// Configuración compartida por el landing (index.html) y el mapa (mapa.html)
window.SITIO = {
  whatsapp: '', // número con código de país, p.ej. '50499999999'; vacío oculta los botones de WhatsApp
  moneda: 'L',
  coordenadas: { lat: 15.811090, lng: -87.926862 },
  // Supabase (Project Settings → API): URL del proyecto y clave pública "anon"/"publishable".
  // Vacío = se usa data/inventario.json. Nunca poner aquí la clave "service_role"/"secret".
  supabase: {
    url: 'https://lapubgwguzpdbptilqnu.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxhcHViZ3dndXpwZGJwdGlscW51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzNTY3MDUsImV4cCI6MjEwODkzMjcwNX0.ORFV0PCdiPYotA9OJS2N8BtMrxi63AD4K7KdPhw8nE0',
  },
};
