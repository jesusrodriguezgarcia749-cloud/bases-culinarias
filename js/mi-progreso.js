// mi-progreso.js — panel personal del alumno: solo lee su propia información.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, collection, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const SESSION_KEY = 'bc_sesion_alumno';
const TOTAL_ACTIVIDADES_POR_BLOQUE = { 1: 20, 2: 20, 3: 20 };
const NOMBRES_BLOQUE = { 1: 'Bloque 1', 2: 'Bloque 2', 3: 'Bloque 3' };

let sesion = null;

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

document.getElementById('form-alumno-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('login-alumno-error');
  errorEl.hidden = true;

  const grupoId = document.getElementById('login-grupo').value;
  const nombre = document.getElementById('login-nombre').value.trim();
  const pin = document.getElementById('login-pin').value.trim();
  if (!grupoId || !nombre || !pin) return;

  const alumnoId = slugNombre(nombre);
  const ref = doc(db, 'grupos', grupoId, 'alumnos', alumnoId);
  const snap = await getDoc(ref);

  if (!snap.exists() || String(snap.data().pin) !== pin) {
    errorEl.textContent = 'No encontramos ese nombre y PIN en el grupo elegido. Verifica con tu docente.';
    errorEl.hidden = false;
    return;
  }

  sesion = { grupoId, alumnoId, nombre: snap.data().nombre, pin, puntosParticipacion: snap.data().puntosParticipacion || 0 };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(sesion));
  await iniciarApp();
});

document.getElementById('btn-cambiar-alumno').addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_KEY);
  sesion = null;
  document.getElementById('progreso-app').hidden = true;
  document.getElementById('alumno-login').hidden = false;
});

async function cargarGruposEnSelect() {
  const select = document.getElementById('login-grupo');
  const snap = await getDocs(query(collection(db, 'grupos'), orderBy('nombre')));
  select.innerHTML = '<option value="">— Elige tu grupo —</option>';
  snap.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.data().nombre;
    select.appendChild(opt);
  });
}

async function renderParticipacion() {
  const cont = document.getElementById('prog-participacion');
  // Por ahora solo el Bloque 1 tiene actividades publicadas.
  const bloquesConDatos = [1];
  cont.innerHTML = bloquesConDatos.map(b => {
    const total = TOTAL_ACTIVIDADES_POR_BLOQUE[b];
    const puntos = Math.min(sesion.puntosParticipacion || 0, total);
    const pct = total ? Math.round((puntos / total) * 100) : 0;
    return `
      <div class="prog-bloque-row">
        <span class="prog-bloque-nombre">${NOMBRES_BLOQUE[b]}</span>
        <div class="prog-bloque-bar-track"><div class="prog-bloque-bar-fill" style="width:${pct}%"></div></div>
        <span class="prog-bloque-stat">${puntos}/${total} actividades · ${pct}% de 20%</span>
      </div>
    `;
  }).join('') + `<p style="margin-top:14px;"><a href="actividades.html" class="btn btn-ghost-dark btn-small">Ir a Actividades</a></p>`;
}

async function renderPracticas() {
  const cont = document.getElementById('prog-practicas');
  const empty = document.getElementById('prog-practicas-empty');
  const snap = await getDocs(query(
    collection(db, 'grupos', sesion.grupoId, 'alumnos', sesion.alumnoId, 'evaluaciones'),
    orderBy('fecha', 'desc')
  ));

  if (snap.empty) { empty.hidden = false; cont.innerHTML = ''; return; }
  empty.hidden = true;

  cont.innerHTML = snap.docs.map(d => {
    const r = d.data();
    return `
      <div class="prog-practica-card">
        <div class="prog-practica-top">
          <span class="prog-practica-date">${r.fecha || 'sin fecha'}</span>
          <span class="prog-practica-score">${(r.calificacion || 0).toFixed(1)} / 10</span>
        </div>
        ${r.notas ? `<div>${escaparHTML(r.notas)}</div>` : ''}
      </div>
    `;
  }).join('');
}

async function iniciarApp() {
  document.getElementById('alumno-login').hidden = true;
  document.getElementById('progreso-app').hidden = false;
  document.getElementById('act-whoami-nombre').textContent = `Hola, ${sesion.nombre}`;
  await Promise.all([renderParticipacion(), renderPracticas()]);
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
        sesion.puntosParticipacion = snap.data().puntosParticipacion || 0;
        await iniciarApp();
        return;
      }
    } catch { /* sesión inválida */ }
    sessionStorage.removeItem(SESSION_KEY);
  }
});
