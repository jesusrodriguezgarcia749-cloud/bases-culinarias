// Bases Culinarias — app.js
// Nota: la conexión a Firebase (Auth + Firestore/Storage) se agrega en la
// siguiente fase, cuando tengamos el contenido del compendio y el proyecto
// de Firebase creado. Este archivo cubre por ahora la interacción de UI.

document.addEventListener('DOMContentLoaded', () => {
  // Menú móvil
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.main-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      const isOpen = !nav.classList.contains('open');
      nav.classList.toggle('open', isOpen);
      toggle.setAttribute('aria-expanded', String(isOpen));
      nav.style.display = isOpen ? 'flex' : '';
    });
  }

  // Buscador (por ahora redirige al compendio con el término como query param;
  // en la siguiente fase esto filtrará contra el índice de subtemas real)
  const searchForm = document.querySelector('.search-form');
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = document.getElementById('search-input').value.trim();
      if (q) {
        window.location.href = `compendio.html?buscar=${encodeURIComponent(q)}`;
      }
    });
  }
});
