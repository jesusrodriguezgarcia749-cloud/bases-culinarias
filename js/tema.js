// tema.js — página de un subtema individual (tema.html?id=1.1)
// Lee los mismos 3 archivos de datos que compendio.js, encuentra el subtema
// pedido por su id, y dibuja su contenido reconociendo el formato de cada
// línea: "§ " = título de sección corta, "RECUERDA/IMPORTANTE/NOTA:" = caja
// destacada, "• " = punto de una lista (se agrupan en un solo <ul>), y
// cualquier otra línea = párrafo normal.

const DATA_FILES = ['data/bloque1.json', 'data/bloque2.json', 'data/bloque3.json'];

function escaparHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function tipoDeLinea(linea) {
  if (linea.startsWith('§ ')) return 'titulo';
  if (/^(RECUERDA|IMPORTANTE|NOTA):/i.test(linea)) return 'callout';
  if (linea.startsWith('• ')) return 'bullet';
  return 'parrafo';
}

function renderContenido(contenido) {
  let html = '';
  let bulletBuffer = [];

  const cerrarLista = () => {
    if (bulletBuffer.length) {
      html += `<ul class="tema-bullet-list">${bulletBuffer.map(b => `<li>${escaparHTML(b)}</li>`).join('')}</ul>`;
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
      html += `<h3 class="tema-section-title">${escaparHTML(linea.slice(2))}</h3>`;
    } else if (tipo === 'callout') {
      const m = linea.match(/^(RECUERDA|IMPORTANTE|NOTA):\s*(.*)$/i);
      const etiqueta = m[1].toUpperCase();
      const resto = m[2];
      html += `<div class="tema-callout"><span class="tema-callout-tag">${etiqueta}</span><p>${escaparHTML(resto)}</p></div>`;
    } else {
      html += `<p>${escaparHTML(linea)}</p>`;
    }
  });

  cerrarLista();
  return html;
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const idBuscado = params.get('id');
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

  root.innerHTML = `
    <article class="tema-card">
      <p class="tema-block-label">Bloque ${actual.bloqueNum} · ${escaparHTML(actual.bloqueNombre)}</p>
      <div class="tema-head">
        <span class="tema-id">${escaparHTML(s.id)}</span>
        <h1>${escaparHTML(s.titulo)}</h1>
      </div>
      ${renderContenido(s.contenido)}
    </article>
  `;

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

document.addEventListener('DOMContentLoaded', init);
