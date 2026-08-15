// actividades.js — evaluación FORMATIVA por subtema, ligada al alumno real.
// Principios: retroalimentación con explicación (no solo correcto/incorrecto),
// reintentos ilimitados, y el punto de Participación se registra en Firestore
// SOLO la primera vez que el alumno acierta — nunca por solo intentarlo.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, increment,
  collection, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Bloques disponibles: agrega aquí cuando exista data/actividades_bloqueN.json
const BLOQUES_DISPONIBLES = [1];
const NOMBRES_BLOQUE = { 1: 'Bloque 1', 2: 'Bloque 2', 3: 'Bloque 3' };

const SESSION_KEY = 'bc_sesion_alumno';

let sesion = null;           // { grupoId, alumnoId, nombre, pin }
let actividadesPorBloque = {}; // { 1: [ {...}, ... ] }
let completadasSet = new Set(); // ids de actividades ya correctas ("b1-1.1-a", ...)
let bloqueActivo = 1;

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
  const res = await fetch(`data/actividades_bloque${bloque}.json`);
  const data = await res.json();
  actividadesPorBloque[bloque] = data.actividades;
  return data.actividades;
}

async function cargarCompletadas() {
  const snap = await getDocs(collection(db, 'grupos', sesion.grupoId, 'alumnos', sesion.alumnoId, 'actividades'));
  completadasSet = new Set(snap.docs.map(d => d.id));
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

function renderProgreso(actividades) {
  const cont = document.getElementById('progreso-bloque');
  const total = actividades.length;
  const hechas = actividades.filter(a => completadasSet.has(idCompleto(a))).length;
  const pct = total ? Math.round((hechas / total) * 100) : 0;
  cont.innerHTML = `
    <div class="progreso-bar-track"><div class="progreso-bar-fill" style="width:${pct}%"></div></div>
    <p class="progreso-texto">${hechas} de ${total} actividades correctas · ${pct}% de tu Participación en este bloque</p>
  `;
}

function idCompleto(actividad) {
  return `b${bloqueActivo}-${actividad.id}`;
}

async function renderBloque() {
  const actividades = await cargarActividadesBloque(bloqueActivo);
  await cargarCompletadas();
  renderProgreso(actividades);

  const root = document.getElementById('quiz-root');
  root.innerHTML = '';

  const subtemas = [...new Set(actividades.map(a => a.subtema))];

  subtemas.forEach(sub => {
    const section = document.createElement('section');
    section.className = 'act-subtema-block';
    section.innerHTML = `<h2 class="act-subtema-titulo">Subtema ${sub}</h2>`;

    actividades.filter(a => a.subtema === sub).forEach(act => {
      section.appendChild(renderTarjetaActividad(act));
    });

    root.appendChild(section);
  });
}

function renderTarjetaActividad(act) {
  const idFull = idCompleto(act);
  const yaCompletada = completadasSet.has(idFull);

  const card = document.createElement('div');
  card.className = 'quiz-question';
  card.id = `card-${idFull}`;

  const opciones = act.tipo === 'verdadero_falso' ? ['Verdadero', 'Falso'] : act.opciones;
  const correctaIdx = act.tipo === 'verdadero_falso' ? (act.correcta ? 0 : 1) : act.correcta;

  card.innerHTML = `
    <p class="quiz-sub">${yaCompletada ? '<span class="badge-ok">✓ Completada</span>' : 'Pendiente'}</p>
    <h3>${escaparHTML(act.pregunta)}</h3>
    <div class="quiz-options">
      ${opciones.map((op, i) => `
        <label class="quiz-option" data-idx="${i}">
          <input type="radio" name="q-${idFull}" value="${i}">
          <span>${escaparHTML(op)}</span>
        </label>
      `).join('')}
    </div>
    <div class="quiz-actions">
      <button class="btn btn-primary btn-small" data-action="revisar">Revisar</button>
    </div>
    <p class="quiz-feedback" hidden></p>
  `;

  let elegida = null;
  card.querySelectorAll('.quiz-option').forEach(label => {
    label.addEventListener('click', () => {
      elegida = parseInt(label.dataset.idx, 10);
    });
  });

  card.querySelector('[data-action="revisar"]').addEventListener('click', async () => {
    if (elegida === null) return;
    const acerto = elegida === correctaIdx;
    const labels = card.querySelectorAll('.quiz-option');
    labels.forEach(label => {
      const idx = parseInt(label.dataset.idx, 10);
      if (idx === correctaIdx) label.classList.add('correct');
      else if (idx === elegida) label.classList.add('incorrect');
    });

    const feedback = card.querySelector('.quiz-feedback');
    feedback.hidden = false;
    feedback.innerHTML = acerto
      ? `<strong>Correcto.</strong> ${escaparHTML(act.explicacion)}`
      : `<strong>No exactamente.</strong> ${escaparHTML(act.explicacion)} Puedes intentarlo de nuevo.`;
    feedback.className = 'quiz-feedback visible ' + (acerto ? 'ok' : 'no-ok');

    if (acerto && !completadasSet.has(idFull)) {
      await registrarAcierto(idFull, act);
      completadasSet.add(idFull);
      card.querySelector('.quiz-sub').innerHTML = '<span class="badge-ok">✓ Completada</span>';
      renderProgreso(actividadesPorBloque[bloqueActivo]);
    }
  });

  return card;
}

async function registrarAcierto(idFull, act) {
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
