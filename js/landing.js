// Landing: enlaces de ubicación y conteo de lotes disponibles
const { lat, lng } = window.SITIO.coordenadas;

document.getElementById('mapa-google').src = `https://www.google.com/maps?q=${lat},${lng}&z=15&output=embed`;
document.getElementById('btn-ruta').href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

window.cargarInventario().then(inv => {
  document.getElementById('stat-disponibles').textContent =
    Object.values(inv).filter(l => l.estado === 'disponible').length;
}).catch(() => {});

// Si ningún video de portada carga, se queda el fondo de respaldo (CSS); el error llega en el último <source>
const hero = document.querySelector('.hero-media');
hero.querySelector('source:last-of-type').addEventListener('error', () => hero.classList.add('missing'));
if (hero.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) hero.classList.add('missing'); // falló antes de este script
// Con "reducir movimiento" activado en el sistema se deja la imagen fija
if (matchMedia('(prefers-reduced-motion: reduce)').matches) { hero.removeAttribute('autoplay'); hero.pause(); }
