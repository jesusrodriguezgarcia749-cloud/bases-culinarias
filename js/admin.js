// admin.js — Panel docente: grupos, alumnos, evaluación con rúbrica y checklist,
// y seguimiento de Participación (actividades digitales de Aula Virtual).
// Usa el SDK modular de Firebase.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, deleteDoc, addDoc, getDoc, getDocs,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";
import { calcularBloque } from "./calculo.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

var CRITERIOS = [
  { id: 'higiene', nombre: 'Higiene personal y uniforme', peso: 0.15 },
  { id: 'seguridad', nombre: 'Seguridad (NOM-251)', peso: 0.15 },
  { id: 'miseEnPlace', nombre: 'Mise en place y orden', peso: 0.20 },
  { id: 'tecnica', nombre: 'Técnica y ejecución', peso: 0.30 },
  { id: 'productoFinal', nombre: 'Producto final', peso: 0.20 },
];

var CHECKLIST_ITEMS = [
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

const TOTAL_ACTIVIDADES_POR_BLOQUE = { 1: 20, 2: 20, 3: 20 };

let grupoActivo = null;
let alumnosCache = [];

// Ata un listener solo si el elemento existe. Evita que una versión vieja del
// HTML (sin alguna pestaña nueva) tumbe todo el script al arrancar.
function on(id, evento, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(evento, fn);
  else console.warn(`[admin] No existe #${id} en este HTML — ¿está actualizado admin.html?`);
  return el;
}

onAuthStateChanged(auth, async user => {
  if (user) {
    document.getElementById('login-screen').hidden = true;
    document.getElementById('app-screen').hidden = false;
    await cargarGrupos();
    const select = document.getElementById('grupo-select');
    if (select.value) {
      grupoActivo = select.value;
      cargarAlumnos();
    }
  } else {
    document.getElementById('login-screen').hidden = false;
    document.getElementById('app-screen').hidden = true;
  }
});

on('login-form', 'submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errorEl = document.getElementById('login-error');
  errorEl.hidden = true;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    console.error('Error de login:', err.code, err.message);
    const MENSAJES = {
      'auth/user-not-found': 'Ese correo no está dado de alta en Firebase Authentication (Console → Authentication → Users → Add user).',
      'auth/wrong-password': 'La contraseña no coincide con la de ese usuario.',
      'auth/invalid-credential': 'Correo o contraseña incorrectos, o el usuario no existe en Firebase Authentication.',
      'auth/invalid-email': 'Ese correo no tiene un formato válido.',
      'auth/too-many-requests': 'Demasiados intentos fallidos — espera unos minutos e intenta de nuevo.',
      'auth/network-request-failed': 'Falla de conexión a internet — verifica tu señal.',
    };
    errorEl.textContent = MENSAJES[err.code] || `No se pudo entrar (${err.code || err.message}).`;
    errorEl.hidden = false;
  }
});

on('btn-logout', 'click', () => signOut(auth));

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

on('btn-nuevo-grupo', 'click', crearGrupo);
on('grupo-select', 'change', (e) => {
  grupoActivo = e.target.value || null;
  if (grupoActivo) {
    cargarAlumnos();
  } else {
    renderAlumnos([]);
  }
});

on('form-alumno', 'submit', agregarAlumno);
on('btn-guardar-eval', 'click', guardarEvaluacion);

const _hoy = new Date();
['eval-fecha','asis-fecha'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.valueAsDate = _hoy;
});
on('asis-fecha', 'change', cargarAsistencia);
on('asis-bloque', 'change', cargarAsistencia);
on('btn-guardar-asistencia', 'click', guardarAsistencia);
on('ens-semana-select', 'change', cargarEnsayos);
on('btn-guardar-ensayos', 'click', guardarEnsayos);
on('btn-publicar-aviso', 'click', publicarAviso);
on('exa-select', 'change', cargarExamenes);
on('btn-guardar-examenes', 'click', guardarExamenes);

renderRubrica();
renderChecklist();

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  if (tab === 'evaluar') renderListaEvaluar();
  if (tab === 'historial') cargarHistorial();
  if (tab === 'participacion') cargarParticipacion();
  if (tab === 'asistencia') cargarAsistencia();
  if (tab === 'ensayos') { poblarSelectSemanas(); cargarEnsayos(); }
  if (tab === 'examenes') cargarExamenes();
  if (tab === 'avisos') cargarAvisos();
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
function slugNombre(nombre) {
  return nombre
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
}

function generarPIN() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function cargarAlumnos() {
  if (!grupoActivo) return;
  const snap = await getDocs(query(collection(db, 'grupos', grupoActivo, 'alumnos'), orderBy('nombre')));
  alumnosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderAlumnos(alumnosCache);
  renderSelectAlumnos();
  renderListaEvaluar();
}

function renderAlumnos(lista) {
  const ul = document.getElementById('lista-alumnos');
  const empty = document.getElementById('alumnos-empty');
  ul.innerHTML = '';
  empty.hidden = lista.length > 0;
  lista.forEach(a => {
    const li = document.createElement('li');
    li.className = 'student-row';
    li.innerHTML = `
      <span class="student-name">${escaparHTML(a.nombre)}</span>
      <span class="student-pin" title="PIN de acceso del alumno">PIN: ${escaparHTML(a.pin || '—')}</span>
      <button type="button" class="btn-delete-student" data-id="${a.id}" title="Eliminar alumno">Eliminar</button>
    `;
    ul.appendChild(li);
  });
  ul.querySelectorAll('.btn-delete-student').forEach(btn => {
    btn.addEventListener('click', () => eliminarAlumno(btn.dataset.id));
  });
}

function renderSelectAlumnos() {
  // Los selects de alumno se eliminaron a favor de listas tocables.
}

async function agregarAlumno(e) {
  e.preventDefault();
  if (!grupoActivo) { alert('Primero elige o crea un grupo.'); return; }
  const input = document.getElementById('input-alumno-nombre');
  const nombre = input.value.trim();
  if (!nombre) return;

  let id = slugNombre(nombre);
  if (!id) { alert('Ese nombre no es válido.'); return; }

  let idFinal = id;
  let sufijo = 2;
  while ((await getDoc(doc(db, 'grupos', grupoActivo, 'alumnos', idFinal))).exists()) {
    idFinal = `${id}-${sufijo}`;
    sufijo++;
  }

  const pin = generarPIN();
  await setDoc(doc(db, 'grupos', grupoActivo, 'alumnos', idFinal), {
    nombre, pin, creado: serverTimestamp(), puntosParticipacion: 0,
  });

  input.value = '';
  await cargarAlumnos();
  alert(`Alumno agregado.\n\nDale este PIN de acceso (lo necesita para entrar a Actividades y a Mi Progreso):\n\n${nombre} → PIN ${pin}`);
}

async function eliminarAlumno(alumnoId) {
  const alumno = alumnosCache.find(a => a.id === alumnoId);
  if (!alumno) return;
  const ok = confirm(`¿Eliminar a "${alumno.nombre}"? Esto borra su registro para poder reutilizar el sistema. No se puede deshacer.`);
  if (!ok) return;
  await deleteDoc(doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId));
  await cargarAlumnos();
}

// ---------- LISTA DE ALUMNOS PARA EVALUAR ----------
var alumnoEvaluandoId = null;

function renderListaEvaluar() {
  const cont = document.getElementById('eval-lista-alumnos');
  const empty = document.getElementById('eval-alumnos-empty');
  const form = document.getElementById('eval-form');
  if (!cont) return;
  cont.innerHTML = '';

  if (!grupoActivo) {
    empty.hidden = false; empty.textContent = 'Elige un grupo primero.';
    form.hidden = true; return;
  }
  if (alumnosCache.length === 0) {
    empty.hidden = false; empty.textContent = 'Este grupo aún no tiene alumnos.';
    form.hidden = true; return;
  }
  empty.hidden = true;

  alumnosCache.forEach(a => {
    const row = document.createElement('button');
    row.type = 'button';
    const activo = a.id === alumnoEvaluandoId;
    row.className = 'asis-row' + (activo ? ' eval-activo' : '');
    row.innerHTML = `
      <span class="student-name">${escaparHTML(a.nombre)}</span>
      <span class="asis-estado-label">${activo ? 'Calificando' : 'Calificar →'}</span>
    `;
    row.addEventListener('click', () => {
      alumnoEvaluandoId = a.id;
      resetRubricaYChecklist();
      document.getElementById('eval-alumno-activo').textContent = `Calificando a: ${a.nombre}`;
      form.hidden = false;
      renderListaEvaluar();
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    cont.appendChild(row);
  });
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
