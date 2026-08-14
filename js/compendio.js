// compendio.js — carga los bloques de contenido y arma la vista navegable + buscador

const DATA_FILES = ['data/bloque1.json', 'data/bloque2.json', 'data/bloque3.json'];

let BLOQUES = [];

async function cargarBloques() {
  const respuestas = await Promise.all(
    DATA_FILES.map(url => fetch(url).then(r => r.json()))
  );
  BLOQUES = respuestas;
  return BLOQUES;
}

function escaparHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function resaltar(texto, termino) {
  if (!termino) return escaparHTML(texto);
  const escapado = escaparHTML(texto);
  const seguro = termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${seguro})`, 'ig');
  return escapado.replace(re, '<mark>$1</mark>');
}

function coincide(subtema, termino) {
  if (!termino) return true;
  const t = termino.toLowerCase();
  const enTitulo = subtema.titulo.toLowerCase().includes(t);
  const enContenido = subtema.contenido.some(p => p.toLowerCase().includes(t));
  return enTitulo || enContenido;
}

function renderTOC(termino) {
  const toc = document.getElementById('toc');
  toc.innerHTML = '';
  BLOQUES.forEach(bloque => {
    const visibles = bloque.subtemas.filter(s => coincide(s, termino));
    if (termino && visibles.length === 0) return;
    const titleEl = document.createElement('p');
    titleEl.className = 'toc-block-title';
    titleEl.textContent = `Bloque ${bloque.bloque} — ${bloque.nombre}`;
    toc.appendChild(titleEl);
    visibles.forEach(s => {
      const a = document.createElement('a');
      a.href = `#sub-${s.id}`;
      a.textContent = `${s.id} ${s.titulo}`;
      toc.appendChild(a);
    });
  });
}

function renderContenido(termino) {
  const root = document.getElementById('content-root');
  const noResults = document.getElementById('no-results');
  root.innerHTML = '';

  let totalVisibles = 0;

  BLOQUES.forEach(bloque => {
    const visibles = bloque.subtemas.filter(s => coincide(s, termino));
    if (visibles.length === 0) return;
    totalVisibles += visibles.length;

    const section = document.createElement('section');
    section.className = 'block-section';
    section.id = `bloque-${bloque.bloque}`;

    const header = document.createElement('div');
    header.className = 'block-header';
    header.innerHTML = `
      <p class="section-eyebrow">Bloque ${bloque.bloque}</p>
      <h2>${escaparHTML(bloque.nombre)}</h2>
      <p>${escaparHTML(bloque.introduccion || '')}</p>
    `;
    section.appendChild(header);

    visibles.forEach(s => {
      const card = document.createElement('article');
      card.className = 'subtema-card';
      card.id = `sub-${s.id}`;

      const parrafos = s.contenido
        .map(p => `<p>${resaltar(p, termino)}</p>`)
        .join('');

      card.innerHTML = `
        <div class="subtema-head">
          <span class="subtema-id">${s.id}</span>
          <h3>${resaltar(s.titulo, termino)}</h3>
        </div>
        ${parrafos}
        <div class="activity-grid">
          <div class="activity-box docente">
            <h4>Actividad en clase</h4>
            <p>${escaparHTML(s.actividad_docente)}</p>
          </div>
          <div class="activity-box independiente">
            <h4>Actividad independiente</h4>
            <p>${escaparHTML(s.actividad_independiente)}</p>
          </div>
        </div>
        <span class="hours-tag">≈ ${s.horas_docente} h con docente · ${s.horas_independiente} h independientes</span>
      `;
      section.appendChild(card);
    });

    root.appendChild(section);
  });

  noResults.hidden = totalVisibles > 0;
}

function aplicarBusqueda(termino) {
  renderTOC(termino);
  renderContenido(termino);
}

document.addEventListener('DOMContentLoaded', async () => {
  await cargarBloques();

  // término inicial: query param ?buscar= desde la portada
  const params = new URLSearchParams(window.location.search);
  const inicial = params.get('buscar') || '';

  const sideInput = document.getElementById('side-search-input');
  sideInput.value = inicial;
  aplicarBusqueda(inicial);

  sideInput.addEventListener('input', (e) => {
    aplicarBusqueda(e.target.value.trim());
  });
});
