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

// Total de actividades de Participación por bloque (ver data/actividades_bloqueN.json).
// 20% del bloque se reparte entre estas actividades → cada una vale 20/TOTAL puntos porcentuales.
const TOTAL_ACTIVIDADES_POR_BLOQUE = { 1: 20, 2: 20, 3: 20 };

let grupoActivo = null;
let alumnosCache = [];

onAuthStateChanged(auth, async user => {
  if (user) {
    document.getElementById('login-screen').hidden = true;
    document.getElementById('app-screen').hidden = false;
    await cargarGrupos();
    // Si el navegador restauró una opción de grupo ya seleccionada (sin
    // disparar 'change'), forzamos la carga de alumnos igual.
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

document.getElementById('login-form').addEventListener('submit', async (e) => {
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
document.getElementById('asis-fecha').valueAsDate = new Date();
document.getElementById('asis-fecha').addEventListener('change', cargarAsistencia);
document.getElementById('btn-guardar-asistencia').addEventListener('click', guardarAsistencia);
document.getElementById('ens-semana-select').addEventListener('change', cargarEnsayos);
document.getElementById('btn-guardar-ensayos').addEventListener('click', guardarEnsayos);

renderRubrica();
renderChecklist();

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  if (tab === 'historial') cargarHistorial();
  if (tab === 'participacion') cargarParticipacion();
  if (tab === 'asistencia') cargarAsistencia();
  if (tab === 'ensayos') { poblarSelectSemanas(); cargarEnsayos(); }
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

// Convierte un nombre en un ID de documento estable y legible, sin acentos ni
// espacios (ej. "María López" → "maria-lopez"). El alumno usa este mismo
// nombre para entrar a Actividades / Mi Progreso — por eso el ID se deriva
// del nombre y no es aleatorio: así el sitio público puede leer su propio
// documento sin necesidad de "listar" alumnos (ver reglas de Firestore).
function slugNombre(nombre) {
  return nombre
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
}

function generarPIN() {
  return String(Math.floor(1000 + Math.random() * 9000)); // 4 dígitos
}

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

  let id = slugNombre(nombre);
  if (!id) { alert('Ese nombre no es válido.'); return; }

  // Evita chocar con un alumno existente con el mismo nombre (agrega -2, -3…)
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
  const ok = confirm(`¿Eliminar a "${alumno.nombre}"? Esto borra su registro para poder reutilizar el sistema (ej. en otro cuatrimestre o materia). No se puede deshacer.`);
  if (!ok) return;
  await deleteDoc(doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId));
  await cargarAlumnos();
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

// ---------- HISTORIAL (prácticas de cocina) ----------
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

// ---------- PARTICIPACIÓN (actividades digitales, tipo lista con desplegables) ----------
async function cargarParticipacion() {
  const cont = document.getElementById('participacion-lista');
  const empty = document.getElementById('participacion-empty');
  cont.innerHTML = '';

  if (!grupoActivo) { empty.hidden = false; empty.textContent = 'Elige un grupo primero.'; return; }
  if (alumnosCache.length === 0) { empty.hidden = false; empty.textContent = 'Este grupo aún no tiene alumnos.'; return; }
  empty.hidden = true;

  for (const alumno of alumnosCache) {
    const detalle = document.createElement('details');
    detalle.className = 'part-row';

    const totalBloque1 = TOTAL_ACTIVIDADES_POR_BLOQUE[1];
    const puntos = alumno.puntosParticipacion || 0;
    const pct = totalBloque1 ? Math.round((puntos / totalBloque1) * 100) : 0;

    detalle.innerHTML = `
      <summary>
        <span class="student-name">${escaparHTML(alumno.nombre)}</span>
        <span class="part-summary-stat">${puntos}/${totalBloque1} actividades · ${pct}% de Participación (Bloque 1)</span>
      </summary>
      <div class="part-detail" data-loading="1">Cargando actividades…</div>
    `;
    cont.appendChild(detalle);

    detalle.addEventListener('toggle', async () => {
      if (!detalle.open) return;
      const box = detalle.querySelector('.part-detail');
      if (box.dataset.loaded) return;
      const snap = await getDocs(collection(db, 'grupos', grupoActivo, 'alumnos', alumno.id, 'actividades'));
      box.dataset.loaded = '1';
      box.innerHTML = snap.empty
        ? '<p class="empty-inline">Todavía no completa ninguna actividad.</p>'
        : `<ul class="part-activity-list">${snap.docs
            .sort((a, b) => a.id.localeCompare(b.id))
            .map(d => `<li>✓ ${escaparHTML(d.id)}</li>`)
            .join('')}</ul>`;
    });
  }
}

// ---------- ASISTENCIA ----------
let asistenciaEstados = {}; // { alumnoId: 'presente' | 'retardo' | 'falta' }

const CICLO_ESTADO = { presente: 'retardo', retardo: 'falta', falta: 'presente' };
const ETIQUETA_ESTADO = { presente: 'Presente', retardo: 'Retardo', falta: 'Falta' };

async function cargarAsistencia() {
  const cont = document.getElementById('asistencia-lista');
  const empty = document.getElementById('asistencia-empty');
  cont.innerHTML = '';

  if (!grupoActivo) { empty.hidden = false; empty.textContent = 'Elige un grupo primero.'; return; }
  if (alumnosCache.length === 0) { empty.hidden = false; empty.textContent = 'Este grupo aún no tiene alumnos.'; return; }
  empty.hidden = true;

  const fecha = document.getElementById('asis-fecha').value;
  asistenciaEstados = {};

  // Carga lo ya guardado ese día (si existe); si no, todos quedan 'presente'.
  await Promise.all(alumnosCache.map(async (a) => {
    try {
      const ref = doc(db, 'grupos', grupoActivo, 'alumnos', a.id, 'asistencias', fecha);
      const snap = await getDoc(ref);
      asistenciaEstados[a.id] = snap.exists() ? snap.data().estado : 'presente';
    } catch {
      asistenciaEstados[a.id] = 'presente';
    }
  }));

  renderAsistenciaLista();
}

function renderAsistenciaLista() {
  const cont = document.getElementById('asistencia-lista');
  cont.innerHTML = '';
  alumnosCache.forEach(a => {
    const estado = asistenciaEstados[a.id] || 'presente';
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `asis-row asis-${estado}`;
    row.innerHTML = `
      <span class="asis-dot"></span>
      <span class="student-name">${escaparHTML(a.nombre)}</span>
      <span class="asis-estado-label">${ETIQUETA_ESTADO[estado]}</span>
    `;
    row.addEventListener('click', () => {
      asistenciaEstados[a.id] = CICLO_ESTADO[estado];
      renderAsistenciaLista();
    });
    cont.appendChild(row);
  });
}

async function guardarAsistencia() {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  const fecha = document.getElementById('asis-fecha').value;
  if (!fecha) { alert('Elige una fecha.'); return; }

  const msg = document.getElementById('asis-msg');
  await Promise.all(alumnosCache.map(a => {
    const ref = doc(db, 'grupos', grupoActivo, 'alumnos', a.id, 'asistencias', fecha);
    return setDoc(ref, { estado: asistenciaEstados[a.id] || 'presente', fecha, actualizado: serverTimestamp() });
  }));

  msg.textContent = '✓ Asistencia guardada.';
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 3000);
}

// ---------- ENSAYOS (bitácoras semanales manuscritas) ----------
// Semanas 1-15 agrupadas por bloque (cada bloque cierra con un micro-ensayo
// en su última semana); la Semana 16 (proyecto final) se maneja aparte, en
// la Evaluación Final del cuatrimestre.
const SEMANAS_ENSAYO = [
  { n: 1, bloque: 1, tema: 'Géneros y Estructura Clásica' },
  { n: 2, bloque: 1, tema: 'Secuencia Operativa' },
  { n: 3, bloque: 1, tema: 'Rendimiento y Merma' },
  { n: 4, bloque: 1, tema: 'Termodinámica y Sanidad' },
  { n: 5, bloque: 1, tema: 'Escalabilidad y Cierre — Micro-Ensayo 1', cierre: true },
  { n: 6, bloque: 2, tema: 'Aprovisionamiento' },
  { n: 7, bloque: 2, tema: 'Propiedades Funcionales' },
  { n: 8, bloque: 2, tema: 'Grasas y Aceites' },
  { n: 9, bloque: 2, tema: 'Variedades Físicas y Scoville' },
  { n: 10, bloque: 2, tema: 'Cualidades Gastronómicas — Micro-Ensayo 2', cierre: true },
  { n: 11, bloque: 3, tema: 'Técnicas de Cocción' },
  { n: 12, bloque: 3, tema: 'Destrezas con Proteínas' },
  { n: 13, bloque: 3, tema: 'Cortes Clásicos' },
  { n: 14, bloque: 3, tema: 'Semillas y Cereales' },
  { n: 15, bloque: 3, tema: 'Hierbas y Especias — Micro-Ensayo 3', cierre: true },
];

let semanaSeleccionada = null;

function poblarSelectSemanas() {
  const select = document.getElementById('ens-semana-select');
  if (select.options.length > 0) return; // ya poblado
  SEMANAS_ENSAYO.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.n;
    opt.textContent = `Semana ${s.n} (Bloque ${s.bloque}) — ${s.tema}`;
    select.appendChild(opt);
  });
  semanaSeleccionada = SEMANAS_ENSAYO[0].n;
}

async function cargarEnsayos() {
  const cont = document.getElementById('ensayos-lista');
  const empty = document.getElementById('ensayos-empty');
  cont.innerHTML = '';

  if (!grupoActivo) { empty.hidden = false; empty.textContent = 'Elige un grupo primero.'; return; }
  if (alumnosCache.length === 0) { empty.hidden = false; empty.textContent = 'Este grupo aún no tiene alumnos.'; return; }
  empty.hidden = true;

  semanaSeleccionada = document.getElementById('ens-semana-select').value || SEMANAS_ENSAYO[0].n;

  // Carga lo ya guardado esa semana para cada alumno del grupo.
  const datos = {};
  await Promise.all(alumnosCache.map(async (a) => {
    try {
      const ref = doc(db, 'grupos', grupoActivo, 'alumnos', a.id, 'ensayos', String(semanaSeleccionada));
      const snap = await getDoc(ref);
      datos[a.id] = snap.exists() ? snap.data() : { entregado: false, calificacion: '' };
    } catch {
      datos[a.id] = { entregado: false, calificacion: '' };
    }
  }));

  alumnosCache.forEach(a => {
    const d = datos[a.id] || { entregado: false, calificacion: '' };
    const row = document.createElement('div');
    row.className = 'ens-row';
    row.dataset.alumnoId = a.id;
    row.innerHTML = `
      <label class="ens-check">
        <input type="checkbox" class="ens-entregado" ${d.entregado ? 'checked' : ''}>
        <span class="student-name">${escaparHTML(a.nombre)}</span>
      </label>
      <input type="number" min="0" max="10" step="0.1" class="ens-calif"
        value="${d.calificacion !== '' && d.calificacion !== null && d.calificacion !== undefined ? d.calificacion : ''}" placeholder="Calif.">
    `;
    cont.appendChild(row);
  });
}

async function guardarEnsayos() {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  const semana = document.getElementById('ens-semana-select').value;
  if (!semana) return;

  const filas = document.querySelectorAll('#ensayos-lista .ens-row');
  const escrituras = [];
  filas.forEach(row => {
    const alumnoId = row.dataset.alumnoId;
    const chk = row.querySelector('.ens-entregado');
    const num = row.querySelector('.ens-calif');
    const calificacion = num.value === '' ? null : parseFloat(num.value);
    const ref = doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'ensayos', semana);
    escrituras.push(setDoc(ref, {
      semana: parseInt(semana, 10),
      entregado: chk.checked,
      calificacion,
      actualizado: serverTimestamp(),
    }));
  });

  await Promise.all(escrituras);
  const msg = document.getElementById('ens-msg');
  msg.textContent = '✓ Ensayos guardados.';
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 3000);
}

function escaparHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
      }
