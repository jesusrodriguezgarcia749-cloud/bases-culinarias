// compendio.js — lista de bloques con subtemas como enlaces a tema.html

const DATA_FILES = ['data/bloque1.json', 'data/bloque2.json', 'data/bloque3.json'];
const ACCENTS = ['#C98A2C', '#A63D2F', '#6B7A5E'];

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

function render(termino) {
  const root = document.getElementById('blocks-root');
  const noResults = document.getElementById('no-results');
  root.innerHTML = '';
  let totalVisibles = 0;

  BLOQUES.forEach((bloque, i) => {
    const visibles = bloque.subtemas.filter(s => coincide(s, termino));
    if (visibles.length === 0) return;
    totalVisibles += visibles.length;

    const section = document.createElement('section');
    section.className = 'comp-block';
    section.style.setProperty('--card-accent', ACCENTS[i % ACCENTS.length]);

    const header = document.createElement('div');
    header.className = 'comp-block-header';
    header.innerHTML = `
      <p class="section-eyebrow">Bloque ${bloque.bloque}</p>
      <h2>${escaparHTML(bloque.nombre)}</h2>
      <p>${escaparHTML(bloque.introduccion || '')}</p>
    `;
    section.appendChild(header);

    const list = document.createElement('ul');
    list.className = 'comp-topic-list';
    visibles.forEach(s => {
      const li = document.createElement('li');
      li.innerHTML = `
        <a href="tema.html?id=${encodeURIComponent(s.id)}">
          <span class="topic-id">${s.id}</span>
          <span>${resaltar(s.titulo, termino)}</span>
        </a>
      `;
      list.appendChild(li);
    });
    section.appendChild(list);
    root.appendChild(section);
  });

  noResults.hidden = totalVisibles > 0;
}

document.addEventListener('DOMContentLoaded', async () => {
  await cargarBloques();

  const params = new URLSearchParams(window.location.search);
  const inicial = params.get('buscar') || '';

  const input = document.getElementById('comp-search-input');
  input.value = inicial;
  render(inicial);

  input.addEventListener('input', (e) => render(e.target.value.trim()));

  const form = document.getElementById('comp-search-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    render(input.value.trim());
  });
});
