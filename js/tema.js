// tema.js — página de un subtema individual (tema.html?id=1.1)
// Lee los mismos 3 archivos de datos que compendio.js, encuentra el subtema
// pedido por su id, y dibuja su contenido reconociendo el formato de cada
// línea: "§ " = título de sección corta, "RECUERDA/IMPORTANTE/NOTA:" = caja
// destacada, "• " = punto de una lista (se agrupan en un solo <ul>), y
// cualquier otra línea = párrafo normal.
//
// Si se llega aquí con ?buscar=término (por ejemplo, desde un resultado de
// compendio.html), ese término se resalta en todo el contenido y la página
// salta automáticamente al primer párrafo donde aparece.

const DATA_FILES = ['data/bloque1.json', 'data/bloque2.json', 'data/bloque3.json'];

function escaparHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Igual que escaparHTML, pero además envuelve en <mark> las coincidencias
// del término buscado (si lo hay). Siempre escapa primero, así que es seguro
// aunque el texto traiga caracteres especiales.
function resaltarTexto(texto, termino) {
  const escapado = escaparHTML(texto);
  if (!termino) return escapado;
  const seguro = termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${seguro})`, 'ig');
  return escapado.replace(re, '<mark class="tema-highlight">$1</mark>');
}

function tipoDeLinea(linea) {
  if (linea.startsWith('§ ')) return 'titulo';
  if (/^(RECUERDA|IMPORTANTE|NOTA):/i.test(linea)) return 'callout';
  if (linea.startsWith('• ')) return 'bullet';
  return 'parrafo';
}

function renderContenido(contenido, termino) {
  let html = '';
  let bulletBuffer = [];

  const cerrarLista = () => {
    if (bulletBuffer.length) {
      html += `<ul class="tema-bullet-list">${bulletBuffer.map(b => `<li>${resaltarTexto(b, termino)}</li>`).join('')}</ul>`;
      bulletBuffer = [];
    }
  };

  contenido.forEach(linea => {
    const tipo = tipoDeLinea(linea);

    if (tipo === 'bullet') {
      bulletBuffer.push(linea.slice(2));
      return;
    }
    cerrarLista();

    if (tipo === 'titulo') {
      html += `<h3 class="tema-section-title">${resaltarTexto(linea.slice(2), termino)}</h3>`;
    } else if (tipo === 'callout') {
      const m = linea.match(/^(RECUERDA|IMPORTANTE|NOTA):\s*(.*)$/i);
      const etiqueta = m[1].toUpperCase();
      const resto = m[2];
      html += `<div class="tema-callout"><span class="tema-callout-tag">${etiqueta}</span><p>${resaltarTexto(resto, termino)}</p></div>`;
    } else {
      html += `<p>${resaltarTexto(linea, termino)}</p>`;
    }
  });

  cerrarLista();
  return html;
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const idBuscado = params.get('id');
  const termino = (params.get('buscar') || '').trim();
  const root = document.getElementById('tema-root');
  const pager = document.getElementById('tema-pager');

  if (!idBuscado) {
    root.innerHTML = `<div class="tema-card"><p>No se especificó ningún subtema. <a href="compendio.html">Volver al compendio</a>.</p></div>`;
    return;
  }

  const bloques = await Promise.all(DATA_FILES.map(url => fetch(url).then(r => r.json())));

  // Lista plana de todos los subtemas en orden, con referencia a su bloque,
  // para poder armar el botón "anterior / siguiente".
  const plano = [];
  bloques.forEach(b => {
    b.subtemas.forEach(s => plano.push({ bloqueNum: b.bloque, bloqueNombre: b.nombre, subtema: s }));
  });

  const idx = plano.findIndex(item => item.subtema.id === idBuscado);

  if (idx === -1) {
    root.innerHTML = `<div class="tema-card"><p>No encontramos el subtema "${escaparHTML(idBuscado)}". <a href="compendio.html">Volver al compendio</a>.</p></div>`;
    return;
  }

  const actual = plano[idx];
  const s = actual.subtema;

  document.title = `${s.titulo} — Bases Culinarias`;

  const notaBusqueda = termino
    ? `<p class="tema-buscar-nota" style="margin:0 0 16px; font-size:.85em; color:#8A8177;">
        Resultado para "<strong>${escaparHTML(termino)}</strong>" —
        <a href="compendio.html?buscar=${encodeURIComponent(termino)}">ver todos los resultados</a>
      </p>`
    : '';

  root.innerHTML = `
    <article class="tema-card">
      <p class="tema-block-label">Bloque ${actual.bloqueNum} · ${escaparHTML(actual.bloqueNombre)}</p>
      <div class="tema-head">
        <span class="tema-id">${escaparHTML(s.id)}</span>
        <h1>${resaltarTexto(s.titulo, termino)}</h1>
      </div>
      ${notaBusqueda}
      ${renderContenido(s.contenido, termino)}
    </article>
  `;

  // Si venimos de una búsqueda, salta directo al primer párrafo donde
  // aparece el término (en vez de dejar al alumno a buscarlo a mano).
  if (termino) {
    requestAnimationFrame(() => {
      const marca = root.querySelector('mark.tema-highlight');
      if (marca) marca.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // Pager anterior / siguiente
  const anterior = idx > 0 ? plano[idx - 1] : null;
  const siguiente = idx < plano.length - 1 ? plano[idx + 1] : null;

  pager.innerHTML = `
    ${anterior
      ? `<a href="tema.html?id=${encodeURIComponent(anterior.subtema.id)}"><span class="pager-label">← Anterior</span><span class="pager-title">${anterior.subtema.id} ${escaparHTML(anterior.subtema.titulo)}</span></a>`
      : `<span class="placeholder"></span>`}
    ${siguiente
      ? `<a href="tema.html?id=${encodeURIComponent(siguiente.subtema.id)}" class="next"><span class="pager-label">Siguiente →</span><span class="pager-title">${siguiente.subtema.id} ${escaparHTML(siguiente.subtema.titulo)}</span></a>`
      : `<span class="placeholder"></span>`}
  `;
}

// El buscador de esta página manda al compendio con el término aplicado,
// para no tener que volver atrás manualmente.
function conectarBuscador() {
  const form = document.getElementById('tema-search-form');
  const input = document.getElementById('tema-search-input');
  if (!form || !input) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) window.location.href = `compendio.html?buscar=${encodeURIComponent(q)}`;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  conectarBuscador();
  init();
});
