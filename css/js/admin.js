// admin.js — Panel docente: grupos, alumnos, evaluación con rúbrica y checklist
// Usa el SDK modular de Firebase, igual que biblioteca.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, getDocs, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const CRITERIOS = [
  { id: 'higiene', nombre: 'Higiene personal y uniforme', peso: 0.15 },
  { id: 'seguridad', nombre: 'Seguridad (NOM-251)', peso: 0.15 },
  { id: 'miseEnPlace', nombre: 'Mise en place y orden', peso: 0.20 },
  { id: 'tecnica', nombre: 'Técnica y ejecución', peso: 0.30 },
  { id: 'productoFinal', nombre: 'Producto final', peso: 0.20 },
];

const CHECKLIST_ITEMS = [
  { id: 'uniforme', texto: 'Uniforme completo: filipina, mandil limpio, calzado antiderrapante.' },
  { id: 'higienePersonal', texto: 'Higiene personal: pelo recogido, sin anillos/relojes/pulseras, uñas cortas.' },
  { id: 'salud', texto: 'Salud: sin heridas expuestas, sin síntomas de enfermedad.' },
  { id: 'lavadoManos', texto: 'Lavado de manos con técnica correcta.' },
  { id: 'sanitizacion', texto: 'Sanitización: área de trabajo desinfectada y seca.' },
  { id: 'tablasCorte', texto: 'Tablas de picar identificadas por uso y limpias.' },
  { id: 'organizacion', texto: 'Ingredientes porcionados en compoteras.' },
  { id: 'residuos', texto: 'Bote de basura con tapa y bolsa, bien ubicado.' },
  { id: 'utensilios', texto: 'Cuchillos afilados y herramientas listas.' },
];

let grupoActivo = null;
let alumnosCache = [];

onAuthStateChanged(auth, user => {
  if (user) {
    document.getElementById('login-screen').hidden = true;
    document.getElementById('app-screen').hidden = false;
    cargarGrupos();
  } else {
    document.getElementById('login-screen').hidden = false;
    document.getElementById('app-screen').hidden = true;
  }
});

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value;
    const errorEl = document.getElementById('login-error');
    errorEl.hidden = true;
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
      errorEl.textContent = 'No se pudo entrar: verifica tu correo y contraseña.';
      errorEl.hidden = false;
    }
  });

  document.getElementById('btn-logout').addEventListener('click', () => signOut(auth));

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('btn-nuevo-grupo').addEventListener('click', crearGrupo);
  document.getElementById('grupo-select').addEventListener('change', (e) => {
    grupoActivo = e.target.value || null;
    if (grupoActivo) {
      cargarAlumnos();
    } else {
      renderAlumnos([]);
    }
  });

  document.getElementById('form-alumno').addEventListener('submit', agregarAlumno);
  document.getElementById('btn-guardar-eval').addEventListener('click', guardarEvaluacion);
  document.getElementById('hist-alumno-select').addEventListener('change', cargarHistorial);
  document.getElementById('eval-alumno-select').addEventListener('change', () => {
    resetRubricaYChecklist();
  });

  document.getElementById('eval-fecha').valueAsDate = new Date();

  renderRubrica();
  renderChecklist();
});

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  if (tab === 'historial') cargarHistorial();
}

// ---------- GRUPOS ----------
async function cargarGrupos() {
  const select = document.getElementById('grupo-select');
  const snap = await getDocs(query(collection(db, 'grupos'), orderBy('nombre')));
  select.innerHTML = '<option value="">— Elige un grupo —</option>';
  snap.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.data().nombre;
    select.appendChild(opt);
  });
}

async function crearGrupo() {
  const nombre = prompt('Nombre del nuevo grupo (ej. "Bases Culinarias — Vespertino A"):');
  if (!nombre || !nombre.trim()) return;
  const ref = await addDoc(collection(db, 'grupos'), { nombre: nombre.trim(), creado: serverTimestamp() });
  await cargarGrupos();
  document.getElementById('grupo-select').value = ref.id;
  grupoActivo = ref.id;
  cargarAlumnos();
}

// ---------- ALUMNOS ----------
async function cargarAlumnos() {
  if (!grupoActivo) return;
  const snap = await getDocs(query(collection(db, 'grupos', grupoActivo, 'alumnos'), orderBy('nombre')));
  alumnosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderAlumnos(alumnosCache);
  renderSelectAlumnos();
}

function renderAlumnos(lista) {
  const ul = document.getElementById('lista-alumnos');
  const empty = document.getElementById('alumnos-empty');
  ul.innerHTML = '';
  empty.hidden = lista.length > 0;
  lista.forEach(a => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escaparHTML(a.nombre)}</span>`;
    ul.appendChild(li);
  });
}

function renderSelectAlumnos() {
  ['eval-alumno-select', 'hist-alumno-select'].forEach(id => {
    const select = document.getElementById(id);
    const placeholder = select.options[0];
    select.innerHTML = '';
    select.appendChild(placeholder);
    alumnosCache.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.nombre;
      select.appendChild(opt);
    });
  });
}

async function agregarAlumno(e) {
  e.preventDefault();
  if (!grupoActivo) { alert('Primero elige o crea un grupo.'); return; }
  const input = document.getElementById('input-alumno-nombre');
  const nombre = input.value.trim();
  if (!nombre) return;
  await addDoc(collection(db, 'grupos', grupoActivo, 'alumnos'), { nombre, creado: serverTimestamp() });
  input.value = '';
  cargarAlumnos();
}

// ---------- RÚBRICA ----------
function renderRubrica() {
  const grid = document.getElementById('rubric-grid');
  grid.innerHTML = '';
  CRITERIOS.forEach(c => {
    const row = document.createElement('div');
    row.className = 'rubric-row';
    row.innerHTML = `
      <div class="rubric-row-top">
        <span class="crit-name">${c.nombre}</span>
        <span class="crit-weight">${Math.round(c.peso * 100)}%</span>
      </div>
      <input type="range" min="0" max="10" step="1" value="8" id="crit-${c.id}">
      <div class="rubric-row-val" id="crit-${c.id}-val">8</div>
    `;
    grid.appendChild(row);
  });
  CRITERIOS.forEach(c => {
    document.getElementById(`crit-${c.id}`).addEventListener('input', actualizarScore);
  });
  actualizarScore();
}

function actualizarScore() {
  let total = 0;
  CRITERIOS.forEach(c => {
    const val = parseFloat(document.getElementById(`crit-${c.id}`).value);
    document.getElementById(`crit-${c.id}-val`).textContent = val;
    total += val * c.peso;
  });
  document.getElementById('score-display').textContent = `Calificación: ${total.toFixed(1)} / 10`;
  return total;
}

function resetRubricaYChecklist() {
  CRITERIOS.forEach(c => {
    document.getElementById(`crit-${c.id}`).value = 8;
  });
  actualizarScore();
  CHECKLIST_ITEMS.forEach(item => {
    document.getElementById(`chk-${item.id}`).checked = false;
  });
  document.getElementById('eval-notas').value = '';
  document.getElementById('eval-fecha').valueAsDate = new Date();
}

// ---------- CHECKLIST ----------
function renderChecklist() {
  const grid = document.getElementById('checklist-grid');
  grid.innerHTML = '';
  CHECKLIST_ITEMS.forEach(item => {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" id="chk-${item.id}"><span>${item.texto}</span>`;
    grid.appendChild(label);
  });
}

// ---------- GUARDAR EVALUACIÓN ----------
async function guardarEvaluacion() {
  const alumnoId = document.getElementById('eval-alumno-select').value;
  const msg = document.getElementById('eval-msg');
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  if (!alumnoId) { alert('Elige un alumno.'); return; }

  const criterios = {};
  CRITERIOS.forEach(c => { criterios[c.id] = parseFloat(document.getElementById(`crit-${c.id}`).value); });

  const checklist = {};
  CHECKLIST_ITEMS.forEach(item => { checklist[item.id] = document.getElementById(`chk-${item.id}`).checked; });

  const calificacion = actualizarScore();
  const fecha = document.getElementById('eval-fecha').value;
  const notas = document.getElementById('eval-notas').value.trim();

  await addDoc(collection(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'evaluaciones'), {
    fecha, criterios, checklist, calificacion, notas, creado: serverTimestamp(),
  });

  msg.textContent = '✓ Evaluación guardada.';
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 3000);
  resetRubricaYChecklist();
  document.getElementById('eval-alumno-select').value = '';
}

// ---------- HISTORIAL ----------
async function cargarHistorial() {
  const cont = document.getElementById('historial-lista');
  const empty = document.getElementById('historial-empty');
  const filtroAlumno = document.getElementById('hist-alumno-select').value;
  cont.innerHTML = '';

  if (!grupoActivo) { empty.hidden = false; return; }

  const alumnosAConsultar = filtroAlumno ? [filtroAlumno] : alumnosCache.map(a => a.id);
  let registros = [];

  for (const alumnoId of alumnosAConsultar) {
    const alumno = alumnosCache.find(a => a.id === alumnoId);
    if (!alumno) continue;
    const snap = await getDocs(query(collection(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'evaluaciones'), orderBy('fecha', 'desc')));
    snap.forEach(d => {
      registros.push({ id: d.id, alumnoNombre: alumno.nombre, ...d.data() });
    });
  }

  registros.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  empty.hidden = registros.length > 0;

  registros.forEach(r => {
    const div = document.createElement('div');
    div.className = 'hist-card';
    div.innerHTML = `
      <div class="hist-card-top">
        <span class="hist-card-name">${escaparHTML(r.alumnoNombre)}</span>
        <span class="hist-card-score">${r.calificacion.toFixed(1)} / 10</span>
      </div>
      <div class="hist-card-date">${r.fecha || 'sin fecha'}</div>
      ${r.notas ? `<div class="hist-card-notas">${escaparHTML(r.notas)}</div>` : ''}
    `;
    cont.appendChild(div);
  });
}

function escaparHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
    }
