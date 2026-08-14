// actividades.js — evaluación FORMATIVA por bloque
// Principios: retroalimentación con explicación (no solo correcto/incorrecto),
// reintentos ilimitados, y seguimiento de progreso guardado en el navegador
// para que el alumno sepa cuándo está listo para la evaluación sumativa.

let PREGUNTAS = [];
let bloqueActivo = 1;
const respuestasUsuario = {};   // { indiceGlobal: opcionElegida }
let calificado = false;

const META_DOMINIO = 0.8; // 80% de aciertos = bloque "dominado"
const STORAGE_KEY = 'bc_progreso_actividades';

function leerProgreso() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch { return {}; }
}
function guardarProgreso(bloque, aciertos, total) {
  const progreso = leerProgreso();
  const anterior = progreso[bloque] || { mejorAciertos: 0, intentos: 0 };
  progreso[bloque] = {
    mejorAciertos: Math.max(anterior.mejorAciertos, aciertos),
    total,
    intentos: anterior.intentos + 1
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progreso));
  return progreso[bloque];
}

async function cargarPreguntas() {
  const res = await fetch('data/preguntas.json');
  const data = await res.json();
  PREGUNTAS = data.preguntas;
}

function renderTabs() {
  const tabsRoot = document.getElementById('quiz-tabs');
  const bloques = [...new Set(PREGUNTAS.map(p => p.bloque))];
  const progreso = leerProgreso();
  tabsRoot.innerHTML = '';
  bloques.forEach(b => {
    const info = progreso[b];
    const dominado = info && (info.mejorAciertos / info.total) >= META_DOMINIO;
    const btn = document.createElement('button');
    btn.className = 'quiz-tab' + (b === bloqueActivo ? ' active' : '');
    btn.innerHTML = `Bloque ${b} ${dominado ? '<span class="badge-ok">✓</span>' : ''}`;
    btn.addEventListener('click', () => {
      bloqueActivo = b;
      calificado = false;
      document.getElementById('quiz-result').hidden = true;
      renderTabs();
      renderQuiz();
    });
    tabsRoot.appendChild(btn);
  });
}

function renderQuiz() {
  const root = document.getElementById('quiz-root');
  root.innerHTML = '';
  const preguntasBloque = PREGUNTAS
    .map((p, i) => ({ ...p, _idx: i }))
    .filter(p => p.bloque === bloqueActivo);

  preguntasBloque.forEach(p => {
    const card = document.createElement('div');
    card.className = 'quiz-question';
    card.id = `q-card-${p._idx}`;
    card.innerHTML = `
      <p class="quiz-sub">Subtema ${p.subtema}</p>
      <h3>${p.pregunta}</h3>
      <div class="quiz-options">
        ${p.opciones.map((op, i) => `
          <label class="quiz-option" data-idx="${i}">
            <input type="radio" name="q-${p._idx}" value="${i}">
            <span>${op}</span>
          </label>
        `).join('')}
      </div>
      <p class="quiz-feedback" hidden></p>
    `;
    card.querySelectorAll('.quiz-option').forEach(label => {
      label.addEventListener('click', () => {
        if (calificado) return; // no cambiar respuesta a media calificación
        const opcionIdx = parseInt(label.dataset.idx, 10);
        respuestasUsuario[p._idx] = opcionIdx;
      });
    });
    root.appendChild(card);
  });

  const actions = document.createElement('div');
  actions.className = 'quiz-actions';
  actions.innerHTML = `
    <button class="btn btn-primary" id="btn-calificar">Revisar mis respuestas</button>
    <button class="btn btn-ghost-dark" id="btn-reintentar" hidden>Intentar de nuevo</button>
  `;
  root.appendChild(actions);

  document.getElementById('btn-calificar').addEventListener('click', () => calificar(preguntasBloque));
  document.getElementById('btn-reintentar').addEventListener('click', () => {
    calificado = false;
    Object.keys(respuestasUsuario).forEach(k => delete respuestasUsuario[k]);
    document.getElementById('quiz-result').hidden = true;
    renderQuiz();
  });
}

function calificar(preguntasBloque) {
  calificado = true;
  let aciertos = 0;

  preguntasBloque.forEach(p => {
    const elegida = respuestasUsuario[p._idx];
    const card = document.getElementById(`q-card-${p._idx}`);
    const feedback = card.querySelector('.quiz-feedback');
    const labels = card.querySelectorAll('.quiz-option');

    labels.forEach(label => {
      const idx = parseInt(label.dataset.idx, 10);
      label.querySelector('input').disabled = true;
      if (idx === p.correcta) label.classList.add('correct');
      else if (idx === elegida) label.classList.add('incorrect');
    });

    const acerto = elegida === p.correcta;
    if (acerto) aciertos++;

    feedback.hidden = false;
    feedback.innerHTML = acerto
      ? `<strong>Correcto.</strong> ${p.explicacion}`
      : (elegida === undefined
          ? `<strong>Sin responder.</strong> La respuesta correcta era: "${p.opciones[p.correcta]}". ${p.explicacion}`
          : `<strong>No exactamente.</strong> ${p.explicacion}`);
    feedback.className = 'quiz-feedback visible ' + (acerto ? 'ok' : 'no-ok');
  });

  document.getElementById('btn-calificar').hidden = true;
  document.getElementById('btn-reintentar').hidden = false;

  const total = preguntasBloque.length;
  const stats = guardarProgreso(bloqueActivo, aciertos, total);
  const porcentaje = Math.round((aciertos / total) * 100);
  const dominado = (aciertos / total) >= META_DOMINIO;

  const resultEl = document.getElementById('quiz-result');
  resultEl.hidden = false;
  resultEl.innerHTML = `
    <h2>${aciertos} de ${total} correctas (${porcentaje}%)</h2>
    <p>${dominado
        ? 'Bloque dominado — vas con buen pie para la evaluación sumativa. Puedes seguir practicando si quieres subir tu marca.'
        : `Meta de dominio: ${Math.round(META_DOMINIO*100)}%. Repasa en el compendio los subtemas donde fallaste y vuelve a intentarlo — no hay límite de intentos.`}</p>
    <p class="quiz-stats">Mejor resultado en este bloque: ${stats.mejorAciertos}/${stats.total} · Intentos: ${stats.intentos}</p>
  `;
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  renderTabs();
}

document.addEventListener('DOMContentLoaded', async () => {
  await cargarPreguntas();
  renderTabs();
  renderQuiz();
});
