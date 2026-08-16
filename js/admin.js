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

// Total de actividades de Participación por bloque (ver data/actividades_bloqueN.json).
// 20% del bloque se reparte entre estas actividades → cada una vale 20/TOTAL puntos porcentuales.
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
  return String(Math.floor(1000 + Math.random() * 9000)); // 4 dígitos
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
  const ok = confirm(`¿Eliminar a "${alumno.nombre}"? Esto borra su registro para poder reutilizar el sistema (ej. en otro cuatrimestre o materia). No se puede deshacer.`);
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
      </div>
      <input type="range" min="0" max="10" step="1" value="10" id="crit-${c.id}">
      <div class="rubric-row-val" id="crit-${c.id}-val">10</div>
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
  // Todo arranca en el máximo y con el checklist completo: con 40 alumnos es
  // mucho más rápido bajar solo lo que falló que subir todo lo que cumplió.
  CRITERIOS.forEach(c => {
    document.getElementById(`crit-${c.id}`).value = 10;
  });
  actualizarScore();
  CHECKLIST_ITEMS.forEach(item => {
    document.getElementById(`chk-${item.id}`).checked = true;
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
    label.innerHTML = `<input type="checkbox" id="chk-${item.id}" checked><span>${item.texto}</span>`;
    grid.appendChild(label);
  });
}

// ---------- GUARDAR EVALUACIÓN ----------
async function guardarEvaluacion() {
  const alumnoId = alumnoEvaluandoId;
  const msg = document.getElementById('eval-msg');
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  if (!alumnoId) { alert('Elige un alumno de la lista.'); return; }

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
  alumnoEvaluandoId = null;
  document.getElementById('eval-form').hidden = true;
  renderListaEvaluar();
}

// ---------- HISTORIAL (resumen completo por alumno) ----------
function cargarHistorial() {
  const cont = document.getElementById('hist-lista-alumnos');
  const empty = document.getElementById('historial-empty');
  const resumen = document.getElementById('hist-resumen');
  if (!cont) return;
  cont.innerHTML = '';
  resumen.hidden = true;

  if (!grupoActivo) { empty.hidden = false; empty.textContent = 'Elige un grupo primero.'; return; }
  if (alumnosCache.length === 0) { empty.hidden = false; empty.textContent = 'Este grupo aún no tiene alumnos.'; return; }
  empty.hidden = true;

  alumnosCache.forEach(a => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'asis-row';
    row.innerHTML = `
      <span class="student-name">${escaparHTML(a.nombre)}</span>
      <span class="asis-estado-label">Ver resumen →</span>
    `;
    row.addEventListener('click', () => mostrarResumenAlumno(a));
    cont.appendChild(row);
  });
}

async function mostrarResumenAlumno(alumno) {
  const resumen = document.getElementById('hist-resumen');
  resumen.hidden = false;
  resumen.innerHTML = `<p class="eval-alumno-activo">Resumen de: ${escaparHTML(alumno.nombre)}</p><p class="empty-inline">Cargando…</p>`;
  resumen.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const base = ['grupos', grupoActivo, 'alumnos', alumno.id];

  const [actSnap, evalSnap, ensSnap, asisSnap] = await Promise.all([
    getDocs(collection(db, ...base, 'actividades')).catch(() => null),
    getDocs(collection(db, ...base, 'evaluaciones')).catch(() => null),
    getDocs(collection(db, ...base, 'ensayos')).catch(() => null),
    getDocs(collection(db, ...base, 'asistencias')).catch(() => null),
  ]);

  const idsAct = actSnap ? actSnap.docs.map(d => d.id) : [];
  const partPorBloque = [1, 2, 3].map(b => {
    const total = TOTAL_ACTIVIDADES_POR_BLOQUE[b];
    const hechas = idsAct.filter(id => id.startsWith(`b${b}-`)).length;
    return { b, total, hechas, pct: total ? Math.round(hechas / total * 100) : 0 };
  });
  const partGlobalPct = Math.round(
    partPorBloque.reduce((s, x) => s + x.hechas, 0) /
    Math.max(1, partPorBloque.reduce((s, x) => s + x.total, 0)) * 100
  );

  const practicas = evalSnap ? evalSnap.docs.map(d => d.data()) : [];
  const promPractica = practicas.length
    ? practicas.reduce((s, p) => s + (p.calificacion || 0), 0) / practicas.length : null;

  const ensayos = ensSnap ? ensSnap.docs.map(d => d.data()) : [];
  const entregados = ensayos.filter(e => e.entregado).length;
  const conCalif = ensayos.filter(e => e.calificacion !== null && e.calificacion !== undefined && e.calificacion !== '');
  const promEnsayo = conCalif.length
    ? conCalif.reduce((s, e) => s + Number(e.calificacion), 0) / conCalif.length : null;

  const asis = asisSnap ? asisSnap.docs.map(d => d.data()) : [];
  const presentes = asis.filter(a => a.estado === 'presente').length;
  const retardos = asis.filter(a => a.estado === 'retardo').length;
  const faltas = asis.filter(a => a.estado === 'falta').length;
  const pctAsis = asis.length ? Math.round((presentes + retardos * 0.5) / asis.length * 100) : null;

  const partes = [];
  if (pctAsis !== null) partes.push({ n: 'Asistencia', peso: 10, pct: pctAsis });
  partes.push({ n: 'Participación', peso: 20, pct: partGlobalPct });
  if (promPractica !== null) partes.push({ n: 'Prácticas', peso: 20, pct: promPractica * 10 });
  if (promEnsayo !== null) partes.push({ n: 'Ensayos', peso: 20, pct: promEnsayo * 10 });
  const pesoCubierto = partes.reduce((s, p) => s + p.peso, 0);
  const puntosLogrados = partes.reduce((s, p) => s + p.pct / 100 * p.peso, 0);

  resumen.innerHTML = `
    <p class="eval-alumno-activo">Resumen de: ${escaparHTML(alumno.nombre)}</p>

    <div class="res-card">
      <h4>Participación (20%)</h4>
      ${partPorBloque.map(x => `
        <div class="part-bloque-row">
          <span class="part-bloque-nombre">Bloque ${x.b}</span>
          <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${x.pct}%"></div></div>
          <span class="part-bloque-stat">${x.hechas}/${x.total} · ${x.pct}%</span>
        </div>
      `).join('')}
    </div>

    <div class="res-card">
      <h4>Prácticas de cocina (20%)</h4>
      ${practicas.length === 0 ? '<p class="empty-inline">Sin prácticas evaluadas.</p>' :
        practicas.sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')).map(p => `
          <div class="res-row"><span>${p.fecha || 'sin fecha'}</span><strong>${(p.calificacion||0).toFixed(1)} / 10</strong></div>
        `).join('') + `<div class="res-row res-total"><span>Promedio</span><strong>${promPractica.toFixed(1)} / 10</strong></div>`}
    </div>

    <div class="res-card">
      <h4>Ensayos (20%)</h4>
      ${ensayos.length === 0 ? '<p class="empty-inline">Sin bitácoras registradas.</p>' : `
        <div class="res-row"><span>Bitácoras entregadas</span><strong>${entregados} / 15</strong></div>
        ${promEnsayo !== null ? `<div class="res-row res-total"><span>Promedio</span><strong>${promEnsayo.toFixed(1)} / 10</strong></div>` : ''}
      `}
    </div>

    <div class="res-card">
      <h4>Asistencia (10%)</h4>
      ${asis.length === 0 ? '<p class="empty-inline">Sin registros de asistencia.</p>' : `
        <div class="res-row"><span>Presentes</span><strong>${presentes}</strong></div>
        <div class="res-row"><span>Retardos</span><strong>${retardos}</strong></div>
        <div class="res-row"><span>Faltas</span><strong>${faltas}</strong></div>
        <div class="res-row res-total"><span>Porcentaje</span><strong>${pctAsis}%</strong></div>
      `}
    </div>

    <div class="score-display">
      ${puntosLogrados.toFixed(1)} / ${pesoCubierto} pts capturados
    </div>
    <p class="field-hint">Sobre 100 puntos totales. Falta el Examen (30%), que se captura al cierre de cada bloque.</p>
  `;
}

// ---------- PARTICIPACIÓN ----------
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

    let completadas = [];
    try {
      const snap = await getDocs(collection(db, 'grupos', grupoActivo, 'alumnos', alumno.id, 'actividades'));
      completadas = snap.docs.map(d => d.id);
    } catch (err) {
      console.warn('No se pudieron leer las actividades de', alumno.nombre, err);
    }

    const porBloque = [1, 2, 3].map(b => {
      const total = TOTAL_ACTIVIDADES_POR_BLOQUE[b];
      const hechas = completadas.filter(id => id.startsWith(`b${b}-`)).length;
      const pct = total ? Math.round((hechas / total) * 100) : 0;
      return { b, total, hechas, pct };
    });

    const totalGeneral = porBloque.reduce((s, x) => s + x.hechas, 0);
    const totalPosible = porBloque.reduce((s, x) => s + x.total, 0);

    detalle.innerHTML = `
      <summary>
        <span class="student-name">${escaparHTML(alumno.nombre)}</span>
        <span class="part-summary-stat">${totalGeneral}/${totalPosible} actividades en total</span>
      </summary>
      <div class="part-detail">
        ${porBloque.map(x => `
          <div class="part-bloque-row">
            <span class="part-bloque-nombre">Bloque ${x.b}</span>
            <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${x.pct}%"></div></div>
            <span class="part-bloque-stat">${x.hechas}/${x.total} · ${x.pct}%</span>
          </div>
        `).join('')}
        ${completadas.length === 0 ? '<p class="empty-inline">Todavía no completa ninguna actividad.</p>' : ''}
      </div>
    `;
    cont.appendChild(detalle);
  }
}

// ---------- ASISTENCIA ----------
var asistenciaEstados = {};

var CICLO_ESTADO = { presente: 'retardo', retardo: 'falta', falta: 'presente' };
var ETIQUETA_ESTADO = { presente: 'Presente', retardo: 'Retardo', falta: 'Falta' };

async function cargarAsistencia() {
  const cont = document.getElementById('asistencia-lista');
  const empty = document.getElementById('asistencia-empty');
  if (!cont) return;
  cont.innerHTML = '';

  if (!grupoActivo) { empty.hidden = false; empty.textContent = 'Elige un grupo primero.'; return; }
  if (alumnosCache.length === 0) { empty.hidden = false; empty.textContent = 'Este grupo aún no tiene alumnos.'; return; }
  empty.hidden = true;

  const fecha = document.getElementById('asis-fecha').value;
  asistenciaEstados = {};

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

// ---------- ENSAYOS ----------
var SEMANAS_ENSAYO = [
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

var semanaSeleccionada = null;

function poblarSelectSemanas() {
  const select = document.getElementById('ens-semana-select');
  if (!select || select.options.length > 0) return;
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
  if (!cont) return;
  cont.innerHTML = '';

  if (!grupoActivo) { empty.hidden = false; empty.textContent = 'Elige un grupo primero.'; return; }
  if (alumnosCache.length === 0) { empty.hidden = false; empty.textContent = 'Este grupo aún no tiene alumnos.'; return; }
  empty.hidden = true;

  semanaSeleccionada = document.getElementById('ens-semana-select').value || SEMANAS_ENSAYO[0].n;

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

// ---------- EXÁMENES ----------
async function cargarExamenes() {
  const cont = document.getElementById('examenes-lista');
  const empty = document.getElementById('examenes-empty');
  if (!cont) return;
  cont.innerHTML = '';

  if (!grupoActivo) { empty.hidden = false; empty.textContent = 'Elige un grupo primero.'; return; }
  if (alumnosCache.length === 0) { empty.hidden = false; empty.textContent = 'Este grupo aún no tiene alumnos.'; return; }
  empty.hidden = true;

  const cual = document.getElementById('exa-select').value;

  const datos = {};
  await Promise.all(alumnosCache.map(async (a) => {
    try {
      const snap = await getDoc(doc(db, 'grupos', grupoActivo, 'alumnos', a.id, 'examenes', String(cual)));
      datos[a.id] = snap.exists() ? snap.data() : { calificacion: '' };
    } catch { datos[a.id] = { calificacion: '' }; }
  }));

  alumnosCache.forEach(a => {
    const d = datos[a.id] || {};
    const val = (d.calificacion !== null && d.calificacion !== undefined && d.calificacion !== '') ? d.calificacion : '';
    const row = document.createElement('div');
    row.className = 'ens-row';
    row.dataset.alumnoId = a.id;
    row.innerHTML = `
      <span class="ens-check"><span class="student-name">${escaparHTML(a.nombre)}</span></span>
      <input type="number" min="0" max="10" step="0.1" class="exa-calif" value="${val}" placeholder="Calif.">
    `;
    cont.appendChild(row);
  });
}

async function guardarExamenes() {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  const cual = document.getElementById('exa-select').value;

  const filas = document.querySelectorAll('#examenes-lista .ens-row');
  await Promise.all([...filas].map(row => {
    const alumnoId = row.dataset.alumnoId;
    const num = row.querySelector('.exa-calif');
    const calificacion = num.value === '' ? null : parseFloat(num.value);
    return setDoc(doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'examenes', String(cual)), {
      examen: cual, calificacion, actualizado: serverTimestamp(),
    });
  }));

  const msg = document.getElementById('exa-msg');
  msg.textContent = '✓ Calificaciones guardadas.';
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 3000);
}

// ---------- AVISOS ----------
async function cargarAvisos() {
  const cont = document.getElementById('avisos-lista');
  const empty = document.getElementById('avisos-empty');
  if (!cont) return;
  cont.innerHTML = '';

  if (!grupoActivo) { empty.hidden = false; empty.textContent = 'Elige un grupo primero.'; return; }

  const snap = await getDocs(query(collection(db, 'grupos', grupoActivo, 'avisos'), orderBy('creado', 'desc')));
  empty.hidden = !snap.empty;
  if (snap.empty) { empty.textContent = 'Aún no has publicado avisos en este grupo.'; return; }

  snap.forEach(d => {
    const a = d.data();
    const div = document.createElement('div');
    div.className = 'aviso-card';
    div.innerHTML = `
      <div class="aviso-card-top">
        <span class="aviso-card-titulo">${escaparHTML(a.titulo || 'Sin título')}</span>
        <button type="button" class="btn-delete-student" data-id="${d.id}">Eliminar</button>
      </div>
      <div class="aviso-card-texto">${escaparHTML(a.texto || '')}</div>
    `;
    div.querySelector('.btn-delete-student').addEventListener('click', async () => {
      if (!confirm('¿Eliminar este aviso? Los alumnos dejarán de verlo.')) return;
      await deleteDoc(doc(db, 'grupos', grupoActivo, 'avisos', d.id));
      cargarAvisos();
    });
    cont.appendChild(div);
  });
}

async function publicarAviso() {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  const titulo = document.getElementById('aviso-titulo').value.trim();
  const texto = document.getElementById('aviso-texto').value.trim();
  if (!titulo && !texto) { alert('Escribe al menos un título o contenido.'); return; }

  await addDoc(collection(db, 'grupos', grupoActivo, 'avisos'), {
    titulo, texto, creado: serverTimestamp(),
  });

  document.getElementById('aviso-titulo').value = '';
  document.getElementById('aviso-texto').value = '';
  const msg = document.getElementById('aviso-msg');
  msg.textContent = '✓ Aviso publicado.';
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 3000);
  cargarAvisos();
}

function escaparHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
