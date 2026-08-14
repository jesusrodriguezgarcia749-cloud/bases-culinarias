// tema.js — muestra un subtema individual con navegación anterior/siguiente

const DATA_FILES = ['data/bloque1.json', 'data/bloque2.json', 'data/bloque3.json'];

function escaparHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function cargarLista() {
  const bloques = await Promise.all(
    DATA_FILES.map(url => fetch(url).then(r => r.json()))
  );
  // aplanar en una sola lista ordenada, conservando datos del bloque
  const lista = [];
  bloques.forEach(bloque => {
    bloque.subtemas.forEach(s => {
      lista.push({ ...s, bloqueNum: bloque.bloque, bloqueNombre: bloque.nombre });
    });
  });
  return lista;
}

function render(lista, id) {
  const idx = lista.findIndex(s => s.id === id);
  const root = document.getElementById('tema-root');
  const pager = document.getElementById('tema-pager');

  if (idx === -1) {
    root.innerHTML = `
      <div class="tema-card">
        <p>No encontramos ese subtema. <a href="compendio.html">Volver al compendio</a>.</p>
      </div>
    `;
    pager.innerHTML = '';
    return;
  }

  const s = lista[idx];
  document.title = `${s.titulo} — Bases Culinarias`;

  const parrafos = s.contenido.map(p => `<p>${escaparHTML(p)}</p>`).join('');

  root.innerHTML = `
    <article class="tema-card">
      <p class="tema-block-label">Bloque ${s.bloqueNum} — ${escaparHTML(s.bloqueNombre)}</p>
      <div class="tema-head">
        <span class="tema-id">${s.id}</span>
        <h1>${escaparHTML(s.titulo)}</h1>
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
    </article>
  `;

  const prev = lista[idx - 1];
  const next = lista[idx + 1];
  pager.innerHTML = `
    ${prev
      ? `<a class="prev" href="tema.html?id=${encodeURIComponent(prev.id)}"><span class="pager-label">← Anterior</span><span class="pager-title">${prev.id} ${escaparHTML(prev.titulo)}</span></a>`
      : `<span class="placeholder"></span>`}
    ${next
      ? `<a class="next" href="tema.html?id=${encodeURIComponent(next.id)}"><span class="pager-label">Siguiente →</span><span class="pager-title">${next.id} ${escaparHTML(next.titulo)}</span></a>`
      : `<span class="placeholder"></span>`}
  `;
}

document.addEventListener('DOMContentLoaded', async () => {
  const lista = await cargarLista();
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id') || (lista[0] && lista[0].id);
  render(lista, id);

  const form = document.getElementById('tema-search-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('tema-search-input').value.trim();
    if (q) window.location.href = `compendio.html?buscar=${encodeURIComponent(q)}`;
  });
});
