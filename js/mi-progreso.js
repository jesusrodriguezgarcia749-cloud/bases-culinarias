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

// Cuenta las actividades completadas POR BLOQUE (no un total global), leyendo
// los ids reales guardados en Firestore, que llevan el prefijo "bN-".
async function renderParticipacion() {
  const cont = document.getElementById('prog-participacion');

  let completadas = new Set();
  try {
    const snap = await getDocs(collection(db, 'grupos', sesion.grupoId, 'alumnos', sesion.alumnoId, 'actividades'));
    completadas = new Set(snap.docs.map(d => d.id));
  } catch (err) {
    console.warn('No se pudieron cargar las actividades completadas:', err);
  }

  const filas = await Promise.all([1, 2, 3].map(async (b) => {
    let total = TOTAL_ACTIVIDADES_POR_BLOQUE[b];
    try {
      const res = await fetch(`data/actividades_bloque${b}.json`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        total = data.actividades.length;
      }
    } catch { /* usamos el total por defecto */ }

    const hechas = [...completadas].filter(id => id.startsWith(`b${b}-`)).length;
    const pct = total ? Math.round((hechas / total) * 100) : 0;
    return `
      <div class="prog-bloque-row">
        <span class="prog-bloque-nombre">${NOMBRES_BLOQUE[b]}</span>
        <div class="prog-bloque-bar-track"><div class="prog-bloque-bar-fill" style="width:${pct}%"></div></div>
        <span class="prog-bloque-stat">${hechas}/${total} actividades · ${pct}%</span>
      </div>
    `;
  }));

  cont.innerHTML = filas.join('') +
    `<p style="margin-top:14px;"><a href="actividades.html" class="btn btn-ghost-dark btn-small">Ir a Actividades</a></p>`;
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

// Semanas de bitácora (deben coincidir con las del panel docente).
const SEMANAS_ENSAYO = [
  { n: 1, bloque: 1, tema: 'Géneros y Estructura Clásica' },
  { n: 2, bloque: 1, tema: 'Secuencia Operativa' },
  { n: 3, bloque: 1, tema: 'Rendimiento y Merma' },
  { n: 4, bloque: 1, tema: 'Termodinámica y Sanidad' },
  { n: 5, bloque: 1, tema: 'Escalabilidad — Micro-Ensayo 1' },
  { n: 6, bloque: 2, tema: 'Aprovisionamiento' },
  { n: 7, bloque: 2, tema: 'Propiedades Funcionales' },
  { n: 8, bloque: 2, tema: 'Grasas y Aceites' },
  { n: 9, bloque: 2, tema: 'Variedades Físicas y Scoville' },
  { n: 10, bloque: 2, tema: 'Cualidades Gastronómicas — Micro-Ensayo 2' },
  { n: 11, bloque: 3, tema: 'Técnicas de Cocción' },
  { n: 12, bloque: 3, tema: 'Destrezas con Proteínas' },
  { n: 13, bloque: 3, tema: 'Cortes Clásicos' },
  { n: 14, bloque: 3, tema: 'Semillas y Cereales' },
  { n: 15, bloque: 3, tema: 'Hierbas y Especias — Micro-Ensayo 3' },
];

async function renderEnsayos() {
  const cont = document.getElementById('prog-ensayos');
  const empty = document.getElementById('prog-ensayos-empty');
  cont.innerHTML = '';

  let datos = {};
  try {
    const snap = await getDocs(collection(db, 'grupos', sesion.grupoId, 'alumnos', sesion.alumnoId, 'ensayos'));
    snap.forEach(d => { datos[d.id] = d.data(); });
  } catch (err) {
    console.warn('No se pudieron cargar los ensayos:', err);
  }

  const conRegistro = Object.keys(datos).length > 0;
  empty.hidden = conRegistro;
  if (!conRegistro) return;

  cont.innerHTML = SEMANAS_ENSAYO.map(s => {
    const d = datos[String(s.n)] || {};
    const entregado = d.entregado === true;
    const calif = (d.calificacion !== null && d.calificacion !== undefined && d.calificacion !== '')
      ? Number(d.calificacion).toFixed(1) : null;
    return `
      <div class="prog-ensayo-row">
        <span class="prog-ensayo-icon ${entregado ? 'ok' : 'pendiente'}">${entregado ? '✓' : '○'}</span>
        <span class="prog-ensayo-tema">Sem. ${s.n} — ${escaparHTML(s.tema)}</span>
        <span class="prog-ensayo-calif">${calif !== null ? calif + ' / 10' : (entregado ? 'Entregada' : 'Pendiente')}</span>
      </div>
    `;
  }).join('');
}

async function renderAvisos() {
  const cont = document.getElementById('prog-avisos');
  const empty = document.getElementById('prog-avisos-empty');
  cont.innerHTML = '';

  let docs = [];
  try {
    const snap = await getDocs(query(collection(db, 'grupos', sesion.grupoId, 'avisos'), orderBy('creado', 'desc')));
    docs = snap.docs;
  } catch (err) {
    console.warn('No se pudieron cargar los avisos:', err);
  }

  empty.hidden = docs.length > 0;
  if (docs.length === 0) return;

  cont.innerHTML = docs.map(d => {
    const a = d.data();
    return `
      <div class="prog-aviso-card">
        <div class="prog-aviso-titulo">${escaparHTML(a.titulo || 'Aviso')}</div>
        <div class="prog-aviso-texto">${escaparHTML(a.texto || '')}</div>
      </div>
    `;
  }).join('');
}

// Calificación de cada bloque, combinando todo lo capturado.
// Asistencia y prácticas son globales del cuatrimestre (no están ligadas a un
// bloque específico); participación, ensayos y examen sí son por bloque.
async function renderBloques() {
  const cont = document.getElementById('prog-bloques');
  if (!cont) return;
  cont.innerHTML = '<p class="empty-inline">Calculando…</p>';

  const base = ['grupos', sesion.grupoId, 'alumnos', sesion.alumnoId];
  const [actSnap, evalSnap, ensSnap, asisSnap] = await Promise.all([
    getDocs(collection(db, ...base, 'actividades')).catch(() => null),
    getDocs(collection(db, ...base, 'evaluaciones')).catch(() => null),
    getDocs(collection(db, ...base, 'ensayos')).catch(() => null),
    getDocs(collection(db, ...base, 'asistencias')).catch(() => null),
  ]);

  const idsAct = actSnap ? actSnap.docs.map(d => d.id) : [];

  const practicas = evalSnap ? evalSnap.docs.map(d => d.data()) : [];
  const promPractica = practicas.length
    ? practicas.reduce((s, p) => s + (p.calificacion || 0), 0) / practicas.length : null;

  const asis = asisSnap ? asisSnap.docs.map(d => d.data()) : [];
  const presentes = asis.filter(a => a.estado === 'presente').length;
  const retardos = asis.filter(a => a.estado === 'retardo').length;
  const pctAsis = asis.length ? (presentes + retardos * 0.5) / asis.length * 100 : null;

  const ensayosPorSemana = {};
  if (ensSnap) ensSnap.docs.forEach(d => { ensayosPorSemana[d.id] = d.data(); });

  const SEMANAS_BLOQUE = { 1: [1,2,3,4,5], 2: [6,7,8,9,10], 3: [11,12,13,14,15] };

  const filas = await Promise.all([1, 2, 3].map(async (b) => {
    // Participación del bloque
    const total = TOTAL_ACTIVIDADES_POR_BLOQUE[b];
    const hechas = idsAct.filter(id => id.startsWith(`b${b}-`)).length;
    const pctPart = total ? hechas / total * 100 : 0;

    // Ensayos del bloque
    const semanas = SEMANAS_BLOQUE[b];
    const califs = semanas
      .map(n => ensayosPorSemana[String(n)])
      .filter(e => e && e.calificacion !== null && e.calificacion !== undefined && e.calificacion !== '')
      .map(e => Number(e.calificacion));
    const promEns = califs.length ? califs.reduce((s, x) => s + x, 0) / califs.length : null;

    // Examen del bloque
    let examen = null;
    try {
      const snap = await getDoc(doc(db, ...base, 'examenes', String(b)));
      if (snap.exists() && snap.data().calificacion !== null && snap.data().calificacion !== undefined) {
        examen = Number(snap.data().calificacion);
      }
    } catch { /* sin examen */ }

    const partes = [];
    if (pctAsis !== null) partes.push({ peso: 10, pct: pctAsis });
    partes.push({ peso: 20, pct: pctPart });
    if (promPractica !== null) partes.push({ peso: 20, pct: promPractica * 10 });
    if (promEns !== null) partes.push({ peso: 20, pct: promEns * 10 });
    if (examen !== null) partes.push({ peso: 30, pct: examen * 10 });

    const puntos = partes.reduce((s, p) => s + p.pct / 100 * p.peso, 0);
    const cubierto = partes.reduce((s, p) => s + p.peso, 0);
    const pctBarra = Math.min(100, puntos);

    return `
      <div class="prog-bloque-row">
        <span class="prog-bloque-nombre">${NOMBRES_BLOQUE[b]}</span>
        <div class="prog-bloque-bar-track"><div class="prog-bloque-bar-fill" style="width:${pctBarra}%"></div></div>
        <span class="prog-bloque-stat">${puntos.toFixed(1)} pts${cubierto < 100 ? ` (de ${cubierto} capturados)` : ''}</span>
      </div>
    `;
  }));

  cont.innerHTML = filas.join('');
}

async function iniciarApp() {
  document.getElementById('alumno-login').hidden = true;
  document.getElementById('progreso-app').hidden = false;
  document.getElementById('act-whoami-nombre').textContent = `Hola, ${sesion.nombre}`;
  await Promise.all([renderParticipacion(), renderPracticas(), renderEnsayos(), renderBloques(), renderAvisos()]);
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
