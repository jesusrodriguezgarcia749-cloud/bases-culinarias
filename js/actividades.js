// actividades.js — evaluación FORMATIVA por subtema, ligada al alumno real.
// Principios: retroalimentación con explicación (no solo correcto/incorrecto);
// el alumno contesta TODAS las preguntas de un subtema antes de revisar (no
// hay revisión pregunta por pregunta, para evitar adivinar a fuerza de
// intentos); si falla alguna, debe volver a contestar todas las pendientes
// del subtema antes de poder revisar otra vez. El punto de Participación se
// registra en Firestore SOLO la primera vez que el alumno acierta esa
// actividad — nunca por solo intentarlo.
//
// Tipos de actividad soportados: opcion_multiple, verdadero_falso, relacionar
// (relacionar columnas — el alumno empareja cada elemento izquierdo con el
// derecho que le corresponde, usando un <select> por fila).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, increment,
  collection, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Bloques disponibles: agrega aquí cuando exista data/actividades_bloqueN.json
const BLOQUES_DISPONIBLES = [1, 2, 3];
const NOMBRES_BLOQUE = { 1: 'Bloque 1', 2: 'Bloque 2', 3: 'Bloque 3' };

const SESSION_KEY = 'bc_sesion_alumno';

let sesion = null;              // { grupoId, alumnoId, nombre, pin }
let actividadesPorBloque = {};  // { 1: [ {...}, ... ] }
let completadasSet = new Set(); // ids de actividades ya correctas ("b1-1.1-a", ...)
let bloqueActivo = 1;
let bloquesAbiertos = [1];   // los que el docente permitió responder

function slugNombre(nombre) {
  return nombre
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
}

function escaparHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function barajar(arr) {
  const copia = [...arr];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function mostrarErrorLogin(msg) {
  const errorEl = document.getElementById('login-alumno-error');
  errorEl.textContent = msg;
  errorEl.hidden = false;
}

// ---------- LOGIN ----------
async function cargarGruposEnSelect() {
  const select = document.getElementById('login-grupo');
  try {
    const snap = await getDocs(query(collection(db, 'grupos'), orderBy('nombre')));
    select.innerHTML = '<option value="">— Elige tu grupo —</option>';
    snap.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.data().nombre;
      select.appendChild(opt);
    });
    if (snap.empty) {
      mostrarErrorLogin('DIAGNÓSTICO: la consulta a Firestore funcionó, pero la colección "grupos" está vacía.');
    }
  } catch (err) {
    console.error('Error cargando grupos:', err);
    mostrarErrorLogin('DIAGNÓSTICO — error al cargar grupos: ' + (err && err.message ? err.message : String(err)));
  }
}

document.getElementById('form-alumno-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('login-alumno-error');
  errorEl.hidden = true;

  const grupoId = document.getElementById('login-grupo').value;
  const nombre = document.getElementById('login-nombre').value.trim();
  const pin = document.getElementById('login-pin').value.trim();

  if (!grupoId || !nombre || !pin) return;

  try {
    const alumnoId = slugNombre(nombre);
    const ref = doc(db, 'grupos', grupoId, 'alumnos', alumnoId);
    const snap = await getDoc(ref);

    if (!snap.exists() || String(snap.data().pin) !== pin) {
      errorEl.textContent = 'No encontramos ese nombre y PIN en el grupo elegido. Verifica con tu docente.';
      errorEl.hidden = false;
      return;
    }

    sesion = { grupoId, alumnoId, nombre: snap.data().nombre, pin };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(sesion));
    await iniciarApp();
  } catch (err) {
    console.error('Error en login:', err);
    mostrarErrorLogin('DIAGNÓSTICO — error al entrar: ' + (err && err.message ? err.message : String(err)));
  }
});

document.getElementById('btn-cambiar-alumno').addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_KEY);
  sesion = null;
  document.getElementById('act-app').hidden = true;
  document.getElementById('alumno-login').hidden = false;
});

// ---------- CARGA DE DATOS ----------
async function cargarActividadesBloque(bloque) {
  if (actividadesPorBloque[bloque]) return actividadesPorBloque[bloque];
  const res = await fetch(`data/actividades_bloque${bloque}.json`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} al pedir data/actividades_bloque${bloque}.json`);
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error(`El archivo data/actividades_bloque${bloque}.json no es JSON válido (${e.message})`);
  }
  actividadesPorBloque[bloque] = data.actividades;
  return data.actividades;
}

// Lee qué bloques dejó abiertos el docente para responder.
async function cargarBloquesAbiertos() {
  try {
    const snap = await getDoc(doc(db, 'grupos', sesion.grupoId, 'config', 'bloques'));
    bloquesAbiertos = snap.exists() && Array.isArray(snap.data().activos)
      ? snap.data().activos.map(Number)
      : [1];
  } catch {
    bloquesAbiertos = [1];
  }
}

async function cargarCompletadas() {
  try {
    const snap = await getDocs(collection(db, 'grupos', sesion.grupoId, 'alumnos', sesion.alumnoId, 'actividades'));
    completadasSet = new Set(snap.docs.map(d => d.id));
  } catch (err) {
    // Un bache de conexión aquí no debe tumbar toda la pantalla: seguimos
    // con lo que ya sabíamos (o vacío) y dejamos que el alumno intente.
    console.warn('No se pudo verificar actividades completadas (se continúa igual):', err);
  }
}

// ---------- RENDER ----------
function renderTabs() {
  const tabsRoot = document.getElementById('quiz-tabs');
  tabsRoot.innerHTML = '';
  [1, 2, 3].forEach(b => {
    const disponible = BLOQUES_DISPONIBLES.includes(b);
    const btn = document.createElement('button');
    btn.className = 'quiz-tab' + (b === bloqueActivo ? ' active' : '') + (disponible ? '' : ' quiz-tab-disabled');
    btn.innerHTML = disponible ? NOMBRES_BLOQUE[b] : `${NOMBRES_BLOQUE[b]} <span class="tag-info">próximamente</span>`;
    btn.disabled = !disponible;
    btn.addEventListener('click', async () => {
      bloqueActivo = b;
      renderTabs();
      await renderBloque();
    });
    tabsRoot.appendChild(btn);
  });
}

// Muestra SIEMPRE los tres bloques con su propia barra, no solo el activo.
// Cada barra cuenta únicamente las actividades de ese bloque (los ids en
// Firestore llevan el prefijo "bN-", así que se filtran por ahí).
async function renderProgreso() {
  const cont = document.getElementById('progreso-bloque');

  // Nos aseguramos de tener cargadas las actividades de los tres bloques
  // disponibles, para saber el total de cada uno.
  await Promise.all(BLOQUES_DISPONIBLES.map(b => cargarActividadesBloque(b).catch(() => [])));

  const filas = BLOQUES_DISPONIBLES.map(b => {
    const listaB = actividadesPorBloque[b] || [];
    const total = listaB.length;
    const hechas = listaB.filter(a => completadasSet.has(`b${b}-${a.id}`)).length;
    const pct = total ? Math.round((hechas / total) * 100) : 0;
    const esActivo = b === bloqueActivo;
    return `
      <div class="progreso-fila${esActivo ? ' activo' : ''}">
        <span class="progreso-nombre">${NOMBRES_BLOQUE[b]}</span>
        <div class="progreso-bar-track"><div class="progreso-bar-fill" style="width:${pct}%"></div></div>
        <span class="progreso-stat">${hechas}/${total} · ${pct}%</span>
      </div>
    `;
  }).join('');

  cont.innerHTML = `
    ${filas}
    <p class="progreso-texto">Cada actividad correcta suma a tu Participación (20% de la Evaluación Parcial de ese bloque).</p>
  `;
}

function idCompleto(actividad) {
  return `b${bloqueActivo}-${actividad.id}`;
}

async function renderBloque() {
  const root = document.getElementById('quiz-root');
  let actividades;
  try {
    actividades = await cargarActividadesBloque(bloqueActivo);
  } catch (err) {
    console.error('Error cargando actividades del bloque', bloqueActivo, err);
    const motivo = (err && err.message) ? err.message : String(err);
    root.innerHTML = `
      <p class="subtema-retry-msg">No se pudo cargar el contenido de este bloque (data/actividades_bloque${bloqueActivo}.json).<br>Motivo: ${escaparHTML(motivo)}</p>
      <button class="btn btn-primary" data-action="reintentar-carga">Reintentar</button>
    `;
    document.getElementById('progreso-bloque').innerHTML = '';
    root.querySelector('[data-action="reintentar-carga"]').addEventListener('click', () => renderBloque());
    return;
  }
  await cargarCompletadas();
  await renderProgreso();

  root.innerHTML = '';

  if (!bloquesAbiertos.includes(bloqueActivo)) {
    const aviso = document.createElement('p');
    aviso.className = 'bloque-cerrado-aviso';
    aviso.innerHTML = `🔒 <strong>${NOMBRES_BLOQUE[bloqueActivo]} en modo lectura.</strong> Puedes revisar las preguntas para irte preparando, pero todavía no cuentan para tu calificación. Tu docente abrirá este bloque cuando corresponda.`;
    root.appendChild(aviso);
  }

  const subtemas = [...new Set(actividades.map(a => a.subtema))];

  subtemas.forEach(sub => {
    const actsDelSubtema = actividades.filter(a => a.subtema === sub);
    root.appendChild(renderSubtema(sub, actsDelSubtema));
  });
}

// ---------- LÓGICA POR TIPO DE ACTIVIDAD ----------

// ¿El alumno ya dio una respuesta (completa) a esta actividad?
function respuestaCompleta(act, respuesta) {
  if (act.tipo === 'relacionar') {
    return respuesta && act.pares.every((_, i) => respuesta[i] !== undefined);
  }
  return respuesta !== undefined;
}

// ¿La respuesta dada es correcta?
function esCorrecta(act, respuesta) {
  if (act.tipo === 'relacionar') {
    return act.pares.every((_, i) => respuesta[i] === i);
  }
  const correctaIdx = act.tipo === 'verdadero_falso' ? (act.correcta ? 0 : 1) : act.correcta;
  return respuesta === correctaIdx;
}

// Renderiza un subtema completo: todas sus preguntas + un solo botón "Revisar
// subtema" al final. No hay revisión pregunta por pregunta.
function renderSubtema(sub, actividades) {
  const section = document.createElement('section');
  section.className = 'act-subtema-block';
  section.innerHTML = `<h2 class="act-subtema-titulo">Subtema ${sub}</h2>`;

  const respuestas = {}; // { idFull: respuesta (formato depende del tipo) }

  const pendientes = actividades.filter(a => !completadasSet.has(idCompleto(a)));
  const todasCompletadas = pendientes.length === 0;

  actividades.forEach(act => {
    section.appendChild(renderTarjetaActividad(act, respuestas));
  });

  if (todasCompletadas) {
    const done = document.createElement('p');
    done.className = 'subtema-done-msg';
    done.textContent = '✓ Ya completaste correctamente todas las actividades de este subtema.';
    section.appendChild(done);
    return section;
  }

  const actions = document.createElement('div');
  actions.className = 'quiz-actions';

  // Si el docente aún no abre este bloque, el alumno puede leer pero no responder.
  if (!bloquesAbiertos.includes(bloqueActivo)) {
    actions.innerHTML = `<p class="subtema-cerrado-msg">🔒 Este bloque todavía no está abierto para responder. Puedes leer las preguntas, pero tu docente lo habilitará cuando llegue el momento.</p>`;
    section.appendChild(actions);
    section.querySelectorAll('input, select').forEach(el => { el.disabled = true; });
    return section;
  }

  actions.innerHTML = `<button class="btn btn-primary" data-action="revisar-subtema">Revisar subtema</button>`;
  section.appendChild(actions);

  actions.querySelector('[data-action="revisar-subtema"]').addEventListener('click', async () => {
    const faltantes = pendientes.filter(a => !respuestaCompleta(a, respuestas[idCompleto(a)]));
    if (faltantes.length > 0) {
      alert('Contesta todas las preguntas de este subtema antes de revisar.');
      return;
    }

    let todoCorrectoEsteIntento = true;

    for (const act of pendientes) {
      const idFull = idCompleto(act);
      const card = document.getElementById(`card-${idFull}`);
      const respuesta = respuestas[idFull];
      const acerto = esCorrecta(act, respuesta);

      marcarFeedbackTarjeta(card, act, respuesta, acerto);

      if (acerto) {
        try {
          await registrarAcierto(idFull, act);
          completadasSet.add(idFull);
          card.querySelector('.quiz-sub').innerHTML = '<span class="badge-ok">✓ Completada</span>';
        } catch (err) {
          console.error('No se pudo guardar el punto de esta actividad:', err);
          const feedback = card.querySelector('.quiz-feedback');
          feedback.innerHTML += `<br><strong>Aviso:</strong> tu respuesta fue correcta, pero no se pudo guardar el punto por un problema de conexión. Vuelve a intentar este subtema en cuanto tengas mejor señal.`;
          todoCorrectoEsteIntento = false;
        }
      } else {
        todoCorrectoEsteIntento = false;
      }
    }

    await renderProgreso();

    if (todoCorrectoEsteIntento) {
      actions.innerHTML = `<p class="subtema-done-msg">✓ Subtema completo — todas correctas.</p>`;
    } else {
      actions.innerHTML = `
        <p class="subtema-retry-msg">Te faltó alguna. Vuelve a contestar TODAS las preguntas pendientes de este subtema para intentar otra vez.</p>
        <button class="btn btn-primary" data-action="reintentar-subtema">Volver a contestar</button>
      `;
      actions.querySelector('[data-action="reintentar-subtema"]').addEventListener('click', () => {
        renderBloque();
      });
    }
  });

  return section;
}

function marcarFeedbackTarjeta(card, act, respuesta, acerto) {
  if (act.tipo === 'relacionar') {
    const selects = card.querySelectorAll('.relacionar-select');
    selects.forEach((sel, i) => {
      sel.disabled = true;
      sel.classList.remove('correct', 'incorrect');
      sel.classList.add(respuesta[i] === i ? 'correct' : 'incorrect');
    });
  } else {
    const opciones = act.tipo === 'verdadero_falso' ? ['Verdadero', 'Falso'] : act.opciones;
    const correctaIdx = act.tipo === 'verdadero_falso' ? (act.correcta ? 0 : 1) : act.correcta;
    const labels = card.querySelectorAll('.quiz-option');
    labels.forEach(label => {
      const idx = parseInt(label.dataset.idx, 10);
      label.classList.remove('correct', 'incorrect');
      if (idx === correctaIdx) label.classList.add('correct');
      else if (idx === respuesta) label.classList.add('incorrect');
      label.querySelector('input').disabled = true;
    });
  }

  const feedback = card.querySelector('.quiz-feedback');
  feedback.hidden = false;
  feedback.innerHTML = acerto
    ? `<strong>Correcto.</strong> ${escaparHTML(act.explicacion)}`
    : `<strong>No exactamente.</strong> ${escaparHTML(act.explicacion)}`;
  feedback.className = 'quiz-feedback visible ' + (acerto ? 'ok' : 'no-ok');
}

function renderTarjetaActividad(act, respuestas) {
  const idFull = idCompleto(act);
  const yaCompletada = completadasSet.has(idFull);

  const card = document.createElement('div');
  card.className = 'quiz-question';
  card.id = `card-${idFull}`;

  if (act.tipo === 'relacionar') {
    const derechaBarajada = barajar(act.pares.map((p, i) => ({ texto: p.derecha, origen: i })));
    card.innerHTML = `
      <p class="quiz-sub">${yaCompletada ? '<span class="badge-ok">✓ Completada</span>' : 'Pendiente'}</p>
      <h3>${escaparHTML(act.pregunta)}</h3>
      <div class="relacionar-list">
        ${act.pares.map((par, i) => `
          <div class="relacionar-row">
            <span class="relacionar-izq">${escaparHTML(par.izquierda)}</span>
            <select class="relacionar-select" data-idx="${i}" ${yaCompletada ? 'disabled' : ''}>
              <option value="">— Elige —</option>
              ${derechaBarajada.map(op => `<option value="${op.origen}">${escaparHTML(op.texto)}</option>`).join('')}
            </select>
          </div>
        `).join('')}
      </div>
      <p class="quiz-feedback" hidden></p>
    `;

    if (!yaCompletada) {
      card.querySelectorAll('.relacionar-select').forEach(sel => {
        sel.addEventListener('change', () => {
          const i = parseInt(sel.dataset.idx, 10);
          respuestas[idFull] = respuestas[idFull] || {};
          if (sel.value === '') {
            delete respuestas[idFull][i];
          } else {
            respuestas[idFull][i] = parseInt(sel.value, 10);
          }
        });
      });
    }
    return card;
  }

  const opciones = act.tipo === 'verdadero_falso' ? ['Verdadero', 'Falso'] : act.opciones;

  card.innerHTML = `
    <p class="quiz-sub">${yaCompletada ? '<span class="badge-ok">✓ Completada</span>' : 'Pendiente'}</p>
    <h3>${escaparHTML(act.pregunta)}</h3>
    <div class="quiz-options">
      ${opciones.map((op, i) => `
        <label class="quiz-option" data-idx="${i}">
          <input type="radio" name="q-${idFull}" value="${i}" ${yaCompletada ? 'disabled' : ''}>
          <span>${escaparHTML(op)}</span>
        </label>
      `).join('')}
    </div>
    <p class="quiz-feedback" hidden></p>
  `;

  if (!yaCompletada) {
    card.querySelectorAll('.quiz-option').forEach(label => {
      label.addEventListener('click', () => {
        respuestas[idFull] = parseInt(label.dataset.idx, 10);
        card.querySelectorAll('.quiz-option').forEach(l => l.classList.remove('selected'));
        label.classList.add('selected');
      });
    });
  }

  return card;
}

async function registrarAcierto(idFull, act) {
  // Crea el documento de la actividad (solo una vez — las reglas de Firestore
  // bloquean update/delete) y suma exactamente 1 punto de participación.
  const actRef = doc(db, 'grupos', sesion.grupoId, 'alumnos', sesion.alumnoId, 'actividades', idFull);
  await setDoc(actRef, {
    bloque: bloqueActivo,
    subtema: act.subtema,
    correcto: true,
    pinVerificado: sesion.pin,
  });
  const alumnoRef = doc(db, 'grupos', sesion.grupoId, 'alumnos', sesion.alumnoId);
  await updateDoc(alumnoRef, { puntosParticipacion: increment(1) });
}

// ---------- ARRANQUE ----------
async function iniciarApp() {
  document.getElementById('alumno-login').hidden = true;
  document.getElementById('act-app').hidden = false;
  document.getElementById('act-whoami-nombre').textContent = `Hola, ${sesion.nombre}`;
  await cargarBloquesAbiertos();
  renderTabs();
  await renderBloque();
}

document.addEventListener('DOMContentLoaded', async () => {
  await cargarGruposEnSelect();

  const guardada = sessionStorage.getItem(SESSION_KEY);
  if (guardada) {
    try {
      sesion = JSON.parse(guardada);
      const ref = doc(db, 'grupos', sesion.grupoId, 'alumnos', sesion.alumnoId);
      const snap = await getDoc(ref);
      if (snap.exists() && String(snap.data().pin) === String(sesion.pin)) {
        await iniciarApp();
        return;
      }
    } catch { /* sesión inválida, se ignora */ }
    sessionStorage.removeItem(SESSION_KEY);
  }
});
