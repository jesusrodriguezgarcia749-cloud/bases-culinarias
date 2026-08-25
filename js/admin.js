// admin.js — Panel docente: grupos, alumnos, evaluación con rúbrica y checklist,
// y seguimiento de Participación (actividades digitales de Aula Virtual).
// Usa el SDK modular de Firebase.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut,
  EmailAuthProvider, reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, deleteDoc, addDoc, getDoc, getDocs,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";
import { calcularBloque, PTS_POR_ENSAYO } from "./calculo.js";
import { reporteGrupo, reporteAlumno } from "./reporte.js";

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
    // Recupera el último grupo elegido (guardado en este dispositivo) para no
    // tener que reseleccionarlo cada vez que se recarga la página.
    const select = document.getElementById('grupo-select');
    const guardado = localStorage.getItem('bc_grupo_activo');
    if (guardado && [...select.options].some(o => o.value === guardado)) {
      select.value = guardado;
    }
    if (select.value) {
      grupoActivo = select.value;
      localStorage.setItem('bc_grupo_activo', grupoActivo);
      await cargarAlumnos();
      cargarTabActiva();
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
on('grupo-select', 'change', async (e) => {
  grupoActivo = e.target.value || null;
  if (grupoActivo) {
    localStorage.setItem('bc_grupo_activo', grupoActivo);
    await cargarAlumnos();
    // Si ya estábamos parados en otra pestaña (Ensayos, Práctica de cocina,
    // etc.), cargarAlumnos() por sí solo NO la refresca — hay que forzarlo,
    // o se queda pegada mostrando "Elige un grupo primero" aunque ya elegiste uno.
    cargarTabActiva();
  } else {
    localStorage.removeItem('bc_grupo_activo');
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
on('ens-semana-select', 'change', () => { cargarPreguntasSemana(); cargarEnsayos(); });
on('btn-guardar-ensayos', 'click', guardarEnsayos);
on('btn-agregar-pregunta', 'click', () => {
  sincronizarPreguntasDesdeDOM();
  preguntasSemanaActual.push('');
  renderPreguntasSemana();
});
on('btn-guardar-preguntas', 'click', guardarPreguntasSemana);
on('btn-publicar-aviso', 'click', publicarAviso);
on('btn-guardar-bloques', 'click', guardarBloquesActivos);
on('btn-guardar-examenes-abiertos', 'click', guardarExamenesAbiertos);
on('enlinea-bloque', 'change', cargarIntentos);
on('btn-eliminar-grupo', 'click', eliminarGrupo);
on('btn-exportar', 'click', exportarCalificaciones);
on('btn-pdf', 'click', generarPDF);
on('hist-modo', 'change', () => {
  const esAlumno = document.getElementById('hist-modo').value === 'alumno';
  document.getElementById('hist-alumno-wrap').hidden = !esAlumno;
  renderBloquesReporte();
});

on('ajuste-alumno-select', 'change', () => {
  const tieneAlumno = !!document.getElementById('ajuste-alumno-select').value;
  document.getElementById('ajuste-form').hidden = !tieneAlumno;
  if (tieneAlumno) cargarAjusteAlumnoBloque();
});
on('ajuste-bloque-select', 'change', cargarAjusteAlumnoBloque);
['ajuste-participacion', 'ajuste-practicas', 'ajuste-ensayos', 'ajuste-asistencia', 'ajuste-examen'].forEach(id => {
  on(id, 'input', actualizarSumaAjuste);
});
on('btn-guardar-ajuste', 'click', guardarAjusteManual);
on('btn-quitar-ajuste', 'click', quitarAjusteManual);

renderRubrica();
renderChecklist();

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  cargarTabActiva();
}

// Vuelve a cargar los datos de la pestaña que esté visible en este momento.
// Se usa al cambiar de pestaña Y al cambiar de grupo (para no quedarnos con
// datos del grupo anterior, o con el mensaje "Elige un grupo primero" pegado
// aunque ya se haya elegido uno).
function cargarTabActiva() {
  const btnActivo = document.querySelector('.tab-btn.active');
  if (!btnActivo) return;
  const tab = btnActivo.dataset.tab;
  if (tab === 'evaluar') renderListaEvaluar();
  if (tab === 'historial') { renderBloquesReporte(); cargarHistorial(); }
  if (tab === 'participacion') { cargarBloquesActivos(); cargarParticipacion(); }
  if (tab === 'asistencia') cargarAsistencia();
  if (tab === 'ensayos') { poblarSelectSemanas(); cargarPreguntasSemana(); cargarEnsayos(); }
  if (tab === 'enlinea') { cargarExamenesAbiertos(); cargarIntentos(); }
  if (tab === 'avisos') cargarAvisos();
  if (tab === 'ajuste') mostrarEstadoAjusteManual();
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
  localStorage.setItem('bc_grupo_activo', grupoActivo);
  cargarAlumnos();
}

// Elimina un grupo completo. Doble verificación: confirmación + contraseña.
async function eliminarGrupo() {
  if (!grupoActivo) { alert('Elige el grupo que quieres eliminar.'); return; }
  const select = document.getElementById('grupo-select');
  const nombreGrupo = select.options[select.selectedIndex].textContent;

  const ok = confirm(
    `¿ELIMINAR el grupo "${nombreGrupo}"?\n\n` +
    `Se borrarán TODOS sus alumnos y sus calificaciones (asistencias, prácticas, ` +
    `ensayos, exámenes y actividades). Esto NO se puede deshacer.`
  );
  if (!ok) return;

  const pass = prompt('Para confirmar, escribe tu contraseña del panel docente:');
  if (!pass) return;

  try {
    const cred = EmailAuthProvider.credential(auth.currentUser.email, pass);
    await reauthenticateWithCredential(auth.currentUser, cred);
  } catch {
    alert('Contraseña incorrecta. No se eliminó nada.');
    return;
  }

  // Borrar subcolecciones de cada alumno, luego el alumno, luego el grupo.
  const alumnosSnap = await getDocs(collection(db, 'grupos', grupoActivo, 'alumnos'));
  for (const alumnoDoc of alumnosSnap.docs) {
    const base = ['grupos', grupoActivo, 'alumnos', alumnoDoc.id];
    for (const sub of ['actividades', 'evaluaciones', 'ensayos', 'asistencias', 'examenes', 'ajustes']) {
      const subSnap = await getDocs(collection(db, ...base, sub)).catch(() => null);
      if (subSnap) {
        await Promise.all(subSnap.docs.map(d => deleteDoc(doc(db, ...base, sub, d.id))));
      }
    }
    await deleteDoc(doc(db, 'grupos', grupoActivo, 'alumnos', alumnoDoc.id));
  }

  for (const sub of ['avisos', 'config', 'ensayos_preguntas']) {
    const subSnap = await getDocs(collection(db, 'grupos', grupoActivo, sub)).catch(() => null);
    if (subSnap) {
      await Promise.all(subSnap.docs.map(d => deleteDoc(doc(db, 'grupos', grupoActivo, sub, d.id))));
    }
  }

  await deleteDoc(doc(db, 'grupos', grupoActivo));

  alert(`Grupo "${nombreGrupo}" eliminado.`);
  grupoActivo = null;
  alumnosCache = [];
  localStorage.removeItem('bc_grupo_activo');
  await cargarGrupos();
  renderAlumnos([]);
}

// ---------- SELECTOR DE BLOQUES PARA EL REPORTE ----------
var bloquesReporte = [1, 2, 3];

function renderBloquesReporte() {
  const cont = document.getElementById('hist-bloques');
  if (!cont) return;
  cont.innerHTML = '';
  [1, 2, 3].forEach(b => {
    const incluido = bloquesReporte.includes(b);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'asis-row ' + (incluido ? 'asis-presente' : 'asis-falta');
    row.innerHTML = `
      <span class="asis-dot"></span>
      <span class="student-name">Bloque ${b}</span>
      <span class="asis-estado-label">${incluido ? 'Incluido' : 'Omitido'}</span>
    `;
    row.addEventListener('click', () => {
      if (incluido) {
        if (bloquesReporte.length === 1) { alert('Deja al menos un bloque incluido.'); return; }
        bloquesReporte = bloquesReporte.filter(x => x !== b);
      } else {
        bloquesReporte = [...bloquesReporte, b].sort();
      }
      renderBloquesReporte();
    });
    cont.appendChild(row);
  });
}

// Lee de Firestore todo lo necesario para calcular las calificaciones de un alumno.
async function datosDeAlumno(alumnoId) {
  const base = ['grupos', grupoActivo, 'alumnos', alumnoId];
  const [actSnap, evalSnap, ensSnap, asisSnap, exaSnap, intSnap, ajusSnap] = await Promise.all([
    getDocs(collection(db, ...base, 'actividades')).catch(() => null),
    getDocs(collection(db, ...base, 'evaluaciones')).catch(() => null),
    getDocs(collection(db, ...base, 'ensayos')).catch(() => null),
    getDocs(collection(db, ...base, 'asistencias')).catch(() => null),
    getDocs(collection(db, ...base, 'examenes')).catch(() => null),
    getDocs(collection(db, ...base, 'intentos')).catch(() => null),
    getDocs(collection(db, ...base, 'ajustes')).catch(() => null),
  ]);

  const ensayos = {};
  if (ensSnap) ensSnap.docs.forEach(d => { ensayos[d.id] = d.data(); });
  const examenes = {};
  if (exaSnap) exaSnap.docs.forEach(d => { examenes[d.id] = d.data(); });
  const intentos = {};
  if (intSnap) intSnap.docs.forEach(d => { intentos[d.id] = d.data(); });
  const ajustes = {};
  if (ajusSnap) ajusSnap.docs.forEach(d => { ajustes[d.id] = d.data(); });

  return {
    idsActividades: actSnap ? actSnap.docs.map(d => d.id) : [],
    ensayos,
    practicas: evalSnap ? evalSnap.docs.map(d => d.data()) : [],
    asistencias: asisSnap ? asisSnap.docs.map(d => d.data()) : [],
    examenes,
    intentos,
    ajustes,
  };
}

function nombreDelGrupo() {
  const select = document.getElementById('grupo-select');
  return select.options[select.selectedIndex]?.textContent || 'Sin grupo';
}

// ---------- REPORTE PDF ----------
async function generarPDF() {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  if (alumnosCache.length === 0) { alert('Este grupo no tiene alumnos.'); return; }

  const modo = document.getElementById('hist-modo').value;
  const msg = document.getElementById('export-msg');
  msg.textContent = 'Generando reporte…';
  msg.hidden = false;

  try {
    if (modo === 'alumno') {
      const alumnoId = document.getElementById('hist-alumno-select').value;
      if (!alumnoId) { alert('Elige un alumno de la lista.'); msg.hidden = true; return; }
      const alumno = alumnosCache.find(a => a.id === alumnoId);
      if (!alumno) { msg.hidden = true; return; }

      const datos = await datosDeAlumno(alumno.id);
      await reporteAlumno({ nombreGrupo: nombreDelGrupo(), alumno, datos });
    } else {
      const alumnos = [];
      for (const alumno of alumnosCache) {
        alumnos.push({ alumno, datos: await datosDeAlumno(alumno.id) });
      }
      await reporteGrupo({
        nombreGrupo: nombreDelGrupo(),
        alumnos,
        bloques: bloquesReporte,
      });
    }
    msg.textContent = '\u2713 Reporte abierto en una ventana nueva.';
    setTimeout(() => { msg.hidden = true; }, 4000);
  } catch (err) {
    console.error('Error generando el reporte:', err);
    msg.textContent = 'No se pudo generar el reporte: ' + (err.message || err);
  }
}

// ---------- EXPORTAR CALIFICACIONES ----------
async function exportarCalificaciones() {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  if (alumnosCache.length === 0) { alert('Este grupo no tiene alumnos.'); return; }

  const modo = document.getElementById('hist-modo').value;
  const select = document.getElementById('grupo-select');
  const nombreGrupo = select.options[select.selectedIndex].textContent;

  let aExportar = alumnosCache;
  if (modo === 'alumno') {
    const alumnoId = document.getElementById('hist-alumno-select').value;
    if (!alumnoId) { alert('Elige un alumno de la lista.'); return; }
    const alumno = alumnosCache.find(a => a.id === alumnoId);
    if (!alumno) return;
    aExportar = [alumno];
  }

  const msg = document.getElementById('export-msg');
  msg.textContent = 'Preparando archivo…';
  msg.hidden = false;

  const filas = [];
  // Encabezados
  filas.push([
    'Alumno', 'Bloque',
    'Participación (20)', 'Ensayos (30)', 'Prácticas (10)',
    'Asistencia (10)', 'Presentes', 'Retardos', 'Justificados', 'Faltas',
    'Examen (30)', 'TOTAL (100)',
  ]);

  const detalleAsistencia = [['Alumno', 'Fecha', 'Bloque', 'Estado', 'Puntos']];

  for (const alumno of aExportar) {
    const base = ['grupos', grupoActivo, 'alumnos', alumno.id];
    const [actSnap, evalSnap, ensSnap, asisSnap, exaSnap, ajusSnap] = await Promise.all([
      getDocs(collection(db, ...base, 'actividades')).catch(() => null),
      getDocs(collection(db, ...base, 'evaluaciones')).catch(() => null),
      getDocs(collection(db, ...base, 'ensayos')).catch(() => null),
      getDocs(collection(db, ...base, 'asistencias')).catch(() => null),
      getDocs(collection(db, ...base, 'examenes')).catch(() => null),
      getDocs(collection(db, ...base, 'ajustes')).catch(() => null),
    ]);

    const ensayos = {};
    if (ensSnap) ensSnap.docs.forEach(d => { ensayos[d.id] = d.data(); });
    const examenes = {};
    if (exaSnap) exaSnap.docs.forEach(d => { examenes[d.id] = d.data(); });
    const ajustes = {};
    if (ajusSnap) ajusSnap.docs.forEach(d => { ajustes[d.id] = d.data(); });
    const asistencias = asisSnap ? asisSnap.docs.map(d => d.data()) : [];

    const datos = {
      idsActividades: actSnap ? actSnap.docs.map(d => d.id) : [],
      ensayos,
      practicas: evalSnap ? evalSnap.docs.map(d => d.data()) : [],
      asistencias,
      examenes,
      ajustes,
    };

    [1, 2, 3].forEach(b => {
      const r = calcularBloque(b, datos);
      filas.push([
        alumno.nombre, `Bloque ${b}`,
        r.participacion.pts, r.ensayos.pts.toFixed(1), r.practicas.pts.toFixed(1),
        r.asistencia.pts.toFixed(2),
        r.asistencia.conteo.presente, r.asistencia.conteo.retardo,
        r.asistencia.conteo.justificado, r.asistencia.conteo.falta,
        r.examen.pts.toFixed(1), r.total.toFixed(1),
      ]);
    });

    // Detalle de asistencia por fecha
    asistencias
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
      .forEach(a => {
        detalleAsistencia.push([
          alumno.nombre, a.fecha || '', a.bloque || '',
          ETIQUETA_ESTADO[a.estado] || a.estado || '',
          PUNTOS_ESTADO[a.estado] ?? 0,
        ]);
      });
  }

  // Construir CSV (Excel lo abre directo). BOM para que respete los acentos.
  const csv = (arr) => arr.map(f =>
    f.map(v => {
      const s = String(v ?? '');
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  ).join('\n');

  const contenido = '\uFEFF' +
    `CALIFICACIONES — ${nombreGrupo}\n` +
    `Generado: ${new Date().toLocaleString('es-MX')}\n\n` +
    csv(filas) +
    `\n\nDETALLE DE ASISTENCIA POR FECHA\n` +
    csv(detalleAsistencia);

  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const sufijo = modo === 'alumno' ? aExportar[0].nombre.replace(/\s+/g, '-') : 'grupo-completo';
  a.href = url;
  a.download = `calificaciones-${sufijo}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  msg.textContent = '\u2713 Archivo descargado. Ábrelo con Excel.';
  setTimeout(() => { msg.hidden = true; }, 4000);
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
  const select = document.getElementById('ajuste-alumno-select');
  if (select) {
    const actual = select.value;
    select.innerHTML = '<option value="">— Elige un alumno —</option>';
    alumnosCache.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.nombre;
      select.appendChild(opt);
    });
    // Conserva la selección si el alumno sigue en la lista tras recargar.
    if (actual && alumnosCache.some(a => a.id === actual)) select.value = actual;
  }

  const selectHist = document.getElementById('hist-alumno-select');
  if (selectHist) {
    const actualHist = selectHist.value;
    selectHist.innerHTML = '<option value="">— Elige un alumno —</option>';
    alumnosCache.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.nombre;
      selectHist.appendChild(opt);
    });
    if (actualHist && alumnosCache.some(a => a.id === actualHist)) selectHist.value = actualHist;
  }
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

// ---------- LISTA DE ALUMNOS PARA EVALUAR ----------
var alumnoEvaluandoId = null;

function renderListaEvaluar() {
  const cont = document.getElementById('eval-lista-alumnos');
  const empty = document.getElementById('eval-alumnos-empty');
  const form = document.getElementById('eval-form');
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
    label.innerHTML = `<input type="checkbox" id="chk-${item.id}"><span>${item.texto}</span>`;
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

  const bloque = parseInt(document.getElementById('eval-bloque').value, 10);

  // Evita calificar dos veces la misma práctica: si ya existe una del mismo
  // alumno, misma fecha y mismo bloque, pregunta si quiere reemplazarla.
  const yaSnap = await getDocs(collection(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'evaluaciones'));
  const duplicada = yaSnap.docs.find(d => {
    const x = d.data();
    return x.fecha === fecha && Number(x.bloque) === bloque;
  });

  try {
    if (duplicada) {
      const anterior = (duplicada.data().calificacion || 0).toFixed(1);
      const alumnoNombre = (alumnosCache.find(a => a.id === alumnoId) || {}).nombre || 'este alumno';
      const reemplazar = confirm(
        `Ya calificaste a ${alumnoNombre} el ${fecha} (Bloque ${bloque}) con ${anterior}/10.\n\n` +
        `¿Quieres REEMPLAZAR esa calificación por ${calificacion.toFixed(1)}/10?\n\n` +
        `Si eliges Cancelar, no se guarda nada y se conserva la anterior.`
      );
      if (!reemplazar) return;
      await setDoc(doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'evaluaciones', duplicada.id), {
        fecha, bloque, criterios, checklist, calificacion, notas, creado: serverTimestamp(),
      });
    } else {
      await addDoc(collection(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'evaluaciones'), {
        fecha, bloque, criterios, checklist, calificacion, notas, creado: serverTimestamp(),
      });
    }
  } catch (err) {
    console.error('Error guardando evaluación:', err);
    marcarResultado('btn-guardar-eval', 'eval-msg', false, '', 'No se pudo guardar: ' + (err.message || err));
    return;
  }

  marcarResultado('btn-guardar-eval', 'eval-msg', true, '✓ Evaluación guardada.', '');
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

  // Usa la misma función que el PDF y el CSV, para que los tres SIEMPRE
  // coincidan (incluye automáticamente los ajustes manuales del docente).
  const datos = await datosDeAlumno(alumno.id);
  const bloques = [1, 2, 3].map(b => calcularBloque(b, datos));

  const fila = (etiqueta, r, extra) => `
    <div class="res-row">
      <span>${etiqueta}${extra ? ` <small class="res-extra">${extra}</small>` : ''}${r.manual ? ' <small class="res-extra">· ajuste manual</small>' : ''}</span>
      <strong>${r.pts.toFixed(1)} / ${r.tope}</strong>
    </div>`;

  resumen.innerHTML = `
    <p class="eval-alumno-activo">Resumen de: ${escaparHTML(alumno.nombre)}</p>
    ${bloques.map(x => `
      <div class="res-card">
        <h4>Bloque ${x.bloque}</h4>
        ${fila('Participación', x.participacion, `${x.participacion.hechas}/${x.participacion.deTotal} actividades`)}
        ${fila('Ensayos', x.ensayos, `${x.ensayos.entregados}/${x.ensayos.deTotal} bitácoras`)}
        ${fila('Prácticas de cocina', x.practicas, `${x.practicas.cuantas}/${x.practicas.deTotal} prácticas`)}
        ${fila('Asistencia', x.asistencia, `${x.asistencia.clases}/${x.asistencia.deTotal} clases · ${x.asistencia.conteo.falta} faltas`)}
        ${fila('Examen', x.examen, x.examen.calificacion !== null ? `${x.examen.calificacion}/10 · ${x.examen.origen}` : 'sin presentar')}
        <div class="res-row res-total">
          <span>Total Bloque ${x.bloque}</span>
          <strong>${x.total.toFixed(1)} / 100 pts</strong>
        </div>
      </div>
    `).join('')}

    <div class="score-display">
      Promedio: ${(bloques.reduce((s, x) => s + x.total, 0) / 3 / 10).toFixed(1)} / 10
    </div>
    <p class="field-hint">Promedio de los tres bloques (cada uno vale 100 puntos).</p>
  `;
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

    // Contamos por bloque leyendo los ids reales ("bN-..."), no un total global.
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

// ---------- BLOQUES ABIERTOS PARA RESPONDER ----------
// Se guarda en grupos/{id}/config/bloques como { activos: [1] }.
// actividades.html lo lee para permitir o no responder.
var bloquesActivos = [1];

async function cargarBloquesActivos() {
  const cont = document.getElementById('bloques-activos-lista');
  if (!cont) return;

  if (!grupoActivo) {
    cont.innerHTML = '<p class="empty-inline">Elige un grupo primero.</p>';
    return;
  }

  try {
    const snap = await getDoc(doc(db, 'grupos', grupoActivo, 'config', 'bloques'));
    bloquesActivos = snap.exists() && Array.isArray(snap.data().activos)
      ? snap.data().activos.map(Number)
      : [1];
  } catch {
    bloquesActivos = [1];
  }

  renderBloquesActivos();
}

function renderBloquesActivos() {
  const cont = document.getElementById('bloques-activos-lista');
  cont.innerHTML = '';
  [1, 2, 3].forEach(b => {
    const abierto = bloquesActivos.includes(b);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'asis-row ' + (abierto ? 'asis-presente' : 'asis-falta');
    row.innerHTML = `
      <span class="asis-dot"></span>
      <span class="student-name">Bloque ${b}</span>
      <span class="asis-estado-label">${abierto ? 'Abierto' : 'Solo lectura'}</span>
    `;
    row.addEventListener('click', () => {
      if (abierto) {
        bloquesActivos = bloquesActivos.filter(x => x !== b);
      } else {
        bloquesActivos = [...bloquesActivos, b].sort();
      }
      renderBloquesActivos();
    });
    cont.appendChild(row);
  });
}

async function guardarBloquesActivos() {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  try {
    await setDoc(doc(db, 'grupos', grupoActivo, 'config', 'bloques'), {
      activos: bloquesActivos,
      actualizado: serverTimestamp(),
    });
  } catch (err) {
    console.error('Error guardando bloques abiertos:', err);
    marcarResultado('btn-guardar-bloques', 'bloques-msg', false, '', 'No se pudo guardar: ' + (err.message || err));
    return;
  }
  marcarResultado('btn-guardar-bloques', 'bloques-msg', true, '\u2713 Guardado. Los alumnos solo pueden responder los bloques abiertos.', '');
}

// ---------- ASISTENCIA ----------
var asistenciaEstados = {}; // { alumnoId: 'presente' | 'retardo' | 'falta' }

// Cada clase vale 0.5 pts (20 clases por bloque = 10 pts).
var CICLO_ESTADO = { presente: 'retardo', retardo: 'justificado', justificado: 'falta', falta: 'presente' };
var ETIQUETA_ESTADO = { presente: 'Presente', retardo: 'Retardo', justificado: 'Justificado', falta: 'Falta' };
var PUNTOS_ESTADO = { presente: 0.5, retardo: 0.25, justificado: 0.5, falta: 0 };

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

  try {
    await Promise.all(alumnosCache.map(a => {
      const ref = doc(db, 'grupos', grupoActivo, 'alumnos', a.id, 'asistencias', fecha);
      const bloque = parseInt(document.getElementById('asis-bloque').value, 10);
      return setDoc(ref, { estado: asistenciaEstados[a.id] || 'presente', fecha, bloque, actualizado: serverTimestamp() });
    }));
  } catch (err) {
    console.error('Error guardando asistencia:', err);
    marcarResultado('btn-guardar-asistencia', 'asis-msg', false, '', 'No se pudo guardar: ' + (err.message || err));
    return;
  }

  marcarResultado('btn-guardar-asistencia', 'asis-msg', true, '✓ Asistencia guardada.', '');
}

// ---------- ENSAYOS (bitácoras semanales manuscritas) ----------
// Semanas 1-15 agrupadas por bloque (cada bloque cierra con un micro-ensayo
// en su última semana); la Semana 16 (proyecto final) se maneja aparte, en
// la Evaluación Final del cuatrimestre.
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

// Preguntas oficiales por semana, tomadas de "Proyecto_Ensayos_Bases_Culinarias.docx"
// (Cartografía y Deconstrucción Culinaria). Sirven como texto inicial editable
// la primera vez que se abre cada semana en un grupo — no son fijas: el
// docente puede modificarlas, agregar o quitar preguntas y guardar sus propios
// cambios por grupo.
var DEFAULT_PREGUNTAS_SEMANA = {
  1: [
    'Compara la función que cumple tu proteína principal en tus tres platillos de la región de Campeche. ¿Cómo cambia su género culinario dependiendo de la receta (ej. de guarnición a plato fuerte o sopa), y qué impacto tiene esto en el diseño del menú?',
    'Si tuvieras que integrar tus tres platillos en el "menú clásico francés" de Escoffier, ¿en qué etapa colocarías cada uno y cuál es tu argumento técnico?',
    '¿Qué rol de la brigada de cocina clásica asumirías tú al preparar cada uno de tus tres platillos, y cómo cambiaría su ejecución si tuvieras que producir 50 porciones en vez de una sola?',
  ],
  2: [
    'De tus tres platillos campechanos, identifica cuál exige la organización previa más compleja. Describe paso a paso cómo ordenarías tu mise en place para anular el riesgo de contaminación cruzada.',
    'Plantea un escenario de error en la línea (ej. saltarse la rectificación de sabor) y argumenta técnicamente cómo afectaría la textura final.',
    'Describe un hábito de higiene personal o de área de trabajo que sea especialmente crítico al manipular tu proteína principal, y qué pasaría si se omitiera.',
  ],
  3: [
    'Argumenta por qué replicar tus tres platillos a gran escala basándote en volumen y no en peso resultaría en un fracaso de consistencia.',
    'Analiza la diferencia entre el peso de compra (AP) y la porción comestible (EP) de tu proteína. ¿Cuál de las tres recetas genera mayor merma física y qué estrategia de aprovechamiento integral propondrías?',
    'Identifica qué corte de verdura estandarizado (juliana, brunoise, etc.) usarías en la guarnición de uno de tus platillos, y por qué ese corte específico y no otro.',
  ],
  4: [
    'Contrasta las reacciones físico-químicas de tus platillos por acción del calor. Argumenta en qué momento exacto de la cocción ocurre la reacción de Maillard o la gelatinización de almidones.',
    'Diseña un protocolo estricto de seguridad alimentaria para el platillo más riesgoso, identificando dónde la regla de las "dos horas acumuladas" (entre 6°C y 65°C) podría romperse en un servicio real.',
  ],
  5: [
    'Si tuvieras que escalar la receta más compleja de tus platillos de 4 a 450 porciones usando la fórmula del Factor de Conversión, ¿qué retos operativos (equipo, tiempos, termodinámica) enfrentarías que la simple matemática no resuelve?',
    '¿Alguno de tus tres platillos se basa en una salsa madre o un fondo? Si no es evidente, propón cómo una de las cinco salsas madre podría reinterpretar uno de tus platillos.',
  ],
  6: [
    'Compara la cadena de suministro de los ingredientes clave de tus tres platillos en Campeche.',
    'Si el proveedor rompe la cadena de frío del insumo principal, ¿cómo lo detectas mediante criterios organolépticos (vista, tacto, olfato) en la recepción? Describe tu protocolo de rechazo justificado.',
  ],
  7: [
    'Analiza si tus recetas tradicionales emplean huevo, harinas, almidones o lácteos como agentes de unión o espesantes. Si la receta tradicional no los utiliza, explica científicamente qué estructura retiene los jugos del platillo.',
    'Plantea cómo le integrarías un agente funcional (como un almidón puro o sustitutos de leche) para modificar drásticamente su textura sin destruir su esencia regional.',
  ],
  8: [
    'Contrasta el tipo de grasa utilizada en tus tres platillos campechanos (ej. manteca de cerdo tradicional vs. aceites vegetales neutros).',
    'Basado en el punto de humeo y su origen, justifica si es la opción más segura y adecuada para la técnica de cocción empleada, o si propondrías un cambio para mejorar el perfil de sabor.',
  ],
  9: [
    'Analiza las variedades específicas de vegetales, chiles o tubérculos en tus recetas (ej. tipo de chile local, papa cerosa vs. harinosa).',
    'Argumenta qué pasaría si intercambiaras las variedades entre los platillos (por ejemplo, alterando la escala Scoville con un chile más potente o usando un ingrediente inadecuado para cocciones largas).',
  ],
  10: [
    'Desglosa los cinco sabores básicos en tus platillos regionales e identifica qué ingredientes aportan el glutamato necesario para el quinto sabor (umami).',
    'Utilizando los principios de Food Pairing, explica si el maridaje de sabores tradicional es por contraste, afinidad aromática o intensidad relativa.',
  ],
  11: [
    'Clasifica la técnica principal de tus tres platillos (Concentración, Expansión o Mixta).',
    'Si alguno utiliza técnica mixta (como un guiso o braseado regional), explica científicamente por qué reducir el tiempo de cocción arruinaría la transformación del colágeno en gelatina suave.',
  ],
  12: [
    'Analiza el manejo de tu proteína principal (sea carne, ave o marisco). ¿Cómo aplicas el principio de "cortar contra la fibra" al momento de servir y qué impacto directo tiene en la terneza?',
    'Si trabajas con productos del mar de la región, ¿cuál es el criterio de frescura clave y cómo evitas la sobrecocción?',
  ],
  13: [
    'Identifica los cortes tradicionales de las guarniciones en tus recetas y tradúcelos al catálogo clásico francés (ej. brunoise, juliana, château).',
    'Argumenta por qué la uniformidad milimétrica de estos cortes no es solo estética, sino una exigencia termodinámica para garantizar una cocción pareja.',
  ],
  14: [
    'Si tus platillos incluyen granos o leguminosas locales, justifica la proporción exacta de grano-líquido empleada.',
    'Compara el método de cocción por expansión de un arroz tradicional contra la técnica de incorporación gradual y movimiento constante de un risotto. ¿Qué papel juega el almidón en cada caso?',
  ],
  15: [
    'Analiza el perfil aromático final de tus platillos y detalla qué especias de la región deben tostarse en seco para despertar sus aceites esenciales antes de la molienda.',
    'Argumenta en qué momento exacto de la secuencia operativa integras las hierbas frescas y por qué hacerlo al inicio arruinaría su aporte.',
  ],
};

var semanaSeleccionada = null;
var preguntasSemanaActual = [];
var cargandoPreguntas = false;

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

// ---------- PREGUNTAS DEL MICRO-ENSAYO (editor del docente) ----------
// Se guardan en grupos/{id}/ensayos_preguntas/{semana} como
// { preguntas: [...], activo: bool }. mi-progreso.js lee este mismo
// documento y, si activo === true, muestra las preguntas al alumno
// (solo lectura, junto a su calificación) dentro de un desplegable.
async function cargarPreguntasSemana() {
  const cont = document.getElementById('ens-preguntas-lista');
  if (!cont) return;

  if (!grupoActivo) {
    cont.innerHTML = '<p class="empty-inline">Elige un grupo primero.</p>';
    return;
  }

  const semana = document.getElementById('ens-semana-select').value || SEMANAS_ENSAYO[0].n;
  const chk = document.getElementById('ens-preguntas-activa');
  const defaults = DEFAULT_PREGUNTAS_SEMANA[semana] ? [...DEFAULT_PREGUNTAS_SEMANA[semana]] : [''];

  cargandoPreguntas = true;
  try {
    const snap = await getDoc(doc(db, 'grupos', grupoActivo, 'ensayos_preguntas', String(semana)));
    if (snap.exists()) {
      const d = snap.data();
      const guardadas = Array.isArray(d.preguntas) ? d.preguntas : [];
      // Si lo guardado quedó vacío (ej. por un guardado accidental antes de
      // que cargaran las precargadas), no dejamos al docente con la pantalla
      // vacía: recuperamos las preguntas oficiales del documento como respaldo.
      preguntasSemanaActual = guardadas.length > 0 ? [...guardadas] : defaults;
      if (chk) chk.checked = !!d.activo;
    } else {
      preguntasSemanaActual = defaults;
      if (chk) chk.checked = false;
    }
  } catch (err) {
    console.warn('No se pudieron cargar las preguntas de esta semana:', err);
    preguntasSemanaActual = defaults;
    if (chk) chk.checked = false;
  } finally {
    cargandoPreguntas = false;
  }

  renderPreguntasSemana();
}

function renderPreguntasSemana() {
  const cont = document.getElementById('ens-preguntas-lista');
  if (!cont) return;
  cont.innerHTML = '';

  if (preguntasSemanaActual.length === 0) {
    cont.innerHTML = '<p class="empty-inline">Sin preguntas capturadas para esta semana. Usa "+ pregunta" para agregar.</p>';
  }

  preguntasSemanaActual.forEach((texto, i) => {
    const row = document.createElement('div');
    row.className = 'ens-pregunta-row';
    row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;margin-bottom:10px;';
    row.innerHTML = `
      <textarea class="ens-pregunta-texto" data-idx="${i}" rows="3"
        placeholder="Pregunta ${i + 1}" style="flex:1;">${escaparHTML(texto)}</textarea>
      <button type="button" class="btn-icon btn-icon-peligro btn-quitar-pregunta" data-idx="${i}" title="Quitar pregunta">✕</button>
    `;
    cont.appendChild(row);
  });

  cont.querySelectorAll('.btn-quitar-pregunta').forEach(btn => {
    btn.addEventListener('click', () => {
      sincronizarPreguntasDesdeDOM();
      const idx = parseInt(btn.dataset.idx, 10);
      preguntasSemanaActual.splice(idx, 1);
      renderPreguntasSemana();
    });
  });
}

// Lee lo que el docente haya escrito/editado en los textareas visibles y lo
// vuelca a preguntasSemanaActual, para no perderlo al agregar o quitar filas.
function sincronizarPreguntasDesdeDOM() {
  const areas = document.querySelectorAll('#ens-preguntas-lista .ens-pregunta-texto');
  if (areas.length === 0) return;
  preguntasSemanaActual = [...areas].map(a => a.value);
}

async function guardarPreguntasSemana() {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  if (cargandoPreguntas) { alert('Espera un momento a que terminen de cargar las preguntas de esta semana e inténtalo de nuevo.'); return; }
  const semana = document.getElementById('ens-semana-select').value;
  if (!semana) return;

  sincronizarPreguntasDesdeDOM();
  const preguntas = preguntasSemanaActual.map(t => t.trim()).filter(t => t !== '');
  const activaEl = document.getElementById('ens-preguntas-activa');
  const activo = activaEl ? activaEl.checked : false;

  try {
    await setDoc(doc(db, 'grupos', grupoActivo, 'ensayos_preguntas', String(semana)), {
      semana: parseInt(semana, 10),
      preguntas,
      activo,
      actualizado: serverTimestamp(),
    });
  } catch (err) {
    console.error('Error guardando preguntas:', err);
    marcarResultado('btn-guardar-preguntas', 'ens-preguntas-msg', false, '', 'No se pudo guardar: ' + (err.message || err));
    return;
  }

  preguntasSemanaActual = preguntas;
  renderPreguntasSemana();

  marcarResultado('btn-guardar-preguntas', 'ens-preguntas-msg', true,
    activo ? '✓ Preguntas guardadas y activas para los alumnos.' : '✓ Preguntas guardadas (todavía no activas para los alumnos).', '');
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
      <input type="number" min="0" max="${PTS_POR_ENSAYO}" step="0.1" class="ens-calif"
        value="${d.calificacion !== '' && d.calificacion !== null && d.calificacion !== undefined ? d.calificacion : PTS_POR_ENSAYO}" placeholder="0-${PTS_POR_ENSAYO}">
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

  try {
    await Promise.all(escrituras);
  } catch (err) {
    console.error('Error guardando ensayos:', err);
    marcarResultado('btn-guardar-ensayos', 'ens-msg', false, '', 'No se pudo guardar: ' + (err.message || err));
    return;
  }
  marcarResultado('btn-guardar-ensayos', 'ens-msg', true, '✓ Ensayos guardados.', '');
}

// ---------- EXAMEN EN LÍNEA ----------
var examenesAbiertos = [];

async function cargarExamenesAbiertos() {
  const cont = document.getElementById('examenes-abiertos-lista');
  if (!cont) return;
  if (!grupoActivo) { cont.innerHTML = '<p class="empty-inline">Elige un grupo primero.</p>'; return; }
  try {
    const snap = await getDoc(doc(db, 'grupos', grupoActivo, 'config', 'examenes'));
    examenesAbiertos = snap.exists() && Array.isArray(snap.data().abiertos)
      ? snap.data().abiertos.map(Number) : [];
  } catch { examenesAbiertos = []; }
  renderExamenesAbiertos();
}

function renderExamenesAbiertos() {
  const cont = document.getElementById('examenes-abiertos-lista');
  cont.innerHTML = '';
  [1, 2, 3].forEach(b => {
    const abierto = examenesAbiertos.includes(b);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'asis-row ' + (abierto ? 'asis-presente' : 'asis-falta');
    row.innerHTML = `
      <span class="asis-dot"></span>
      <span class="student-name">Examen del Bloque ${b}</span>
      <span class="asis-estado-label">${abierto ? 'Abierto' : 'Cerrado'}</span>`;
    row.addEventListener('click', () => {
      examenesAbiertos = abierto
        ? examenesAbiertos.filter(x => x !== b)
        : [...examenesAbiertos, b].sort();
      renderExamenesAbiertos();
    });
    cont.appendChild(row);
  });
}

async function guardarExamenesAbiertos() {
  if (!grupoActivo) { alert('Elige un grupo primero.'); return; }
  try {
    await setDoc(doc(db, 'grupos', grupoActivo, 'config', 'examenes'), {
      abiertos: examenesAbiertos, actualizado: serverTimestamp(),
    });
  } catch (err) {
    console.error('Error guardando exámenes abiertos:', err);
    marcarResultado('btn-guardar-examenes-abiertos', 'abiertos-msg', false, '', 'No se pudo guardar: ' + (err.message || err));
    return;
  }
  marcarResultado('btn-guardar-examenes-abiertos', 'abiertos-msg', true, '\u2713 Guardado.', '');
}

async function cargarIntentos() {
  const cont = document.getElementById('intentos-lista');
  const empty = document.getElementById('intentos-empty');
  if (!cont) return;
  cont.innerHTML = '';

  if (!grupoActivo) { empty.hidden = false; empty.textContent = 'Elige un grupo primero.'; return; }
  if (alumnosCache.length === 0) { empty.hidden = false; empty.textContent = 'Este grupo aún no tiene alumnos.'; return; }
  empty.hidden = true;

  const bloque = document.getElementById('enlinea-bloque').value;
  cont.innerHTML = '<p class="empty-inline">Cargando…</p>';

  const filas = [];
  for (const a of alumnosCache) {
    let est = null;
    try {
      const snap = await getDoc(doc(db, 'grupos', grupoActivo, 'alumnos', a.id, 'intentos', String(bloque)));
      est = snap.exists() ? snap.data() : null;
    } catch { /* sin intento */ }
    filas.push({ alumno: a, est });
  }

  cont.innerHTML = '';
  filas.forEach(({ alumno, est }) => {
    const div = document.createElement('div');
    div.className = 'intento-card';

    if (!est) {
      div.innerHTML = `
        <div class="intento-top">
          <span class="student-name">${escaparHTML(alumno.nombre)}</span>
          <span class="intento-estado est-sin">Sin iniciar</span>
        </div>`;
    } else if (est.estado === 'entregado') {
      div.innerHTML = `
        <div class="intento-top">
          <span class="student-name">${escaparHTML(alumno.nombre)}</span>
          <span class="intento-estado est-ok">${Number(est.calificacion).toFixed(1)} / 10</span>
        </div>
        <p class="intento-detalle">${est.aciertos}/${est.total} correctas${est.automatico ? ' · se acabó el tiempo' : ''}${est.salidas ? ` · ${est.salidas} salida(s) previas` : ''}</p>`;
    } else if (est.estado === 'bloqueado') {
      div.innerHTML = `
        <div class="intento-top">
          <span class="student-name">${escaparHTML(alumno.nombre)}</span>
          <span class="intento-estado est-bloq">Bloqueado</span>
        </div>
        <p class="intento-detalle">Salió de la pantalla ${est.salidas || 1} vez(ces). Contestadas: ${Object.keys(est.respuestas || {}).length} de ${(est.ids || []).length}</p>
        <div class="intento-acciones">
          <button class="btn btn-primary btn-small" data-reabrir="${alumno.id}">Reabrir examen</button>
          <button class="btn btn-ghost-dark btn-small" data-extra="${alumno.id}">+ tiempo</button>
        </div>`;
    } else {
      const totalMin = (est.minutos || 30) + (est.minutosExtra || 0);
      const restante = Math.max(0, Math.round(totalMin - (Date.now() - est.iniciado) / 60000));
      div.innerHTML = `
        <div class="intento-top">
          <span class="student-name">${escaparHTML(alumno.nombre)}</span>
          <span class="intento-estado est-curso">En curso</span>
        </div>
        <p class="intento-detalle">Le quedan ~${restante} min · contestadas ${Object.keys(est.respuestas || {}).length} de ${(est.ids || []).length}</p>
        <div class="intento-acciones">
          <button class="btn btn-ghost-dark btn-small" data-extra="${alumno.id}">+ tiempo</button>
        </div>`;
    }
    cont.appendChild(div);
  });

  cont.querySelectorAll('[data-reabrir]').forEach(b => {
    b.addEventListener('click', () => reabrirExamen(b.dataset.reabrir, bloque));
  });
  cont.querySelectorAll('[data-extra]').forEach(b => {
    b.addEventListener('click', () => darTiempoExtra(b.dataset.extra, bloque));
  });
}

// Reabre un examen cerrado por salida de pantalla. Conserva respuestas y le
// devuelve el tiempo que estuvo bloqueado, para no castigarlo por la pausa.
async function reabrirExamen(alumnoId, bloque) {
  const alumno = alumnosCache.find(a => a.id === alumnoId);
  if (!confirm(`¿Reabrir el examen de ${alumno?.nombre || 'este alumno'}?\n\nConservará las respuestas que ya había dado y el tiempo que le quedaba.`)) return;

  const ref = doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'intentos', String(bloque));
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const est = snap.data();

  // No se regalan minutos: el examen continúa con el tiempo exacto que le
  // quedaba al bloquearse. Si el alumno merece más tiempo por una causa
  // justificada, se le da aparte con el botón "+ tiempo".
  const seg = est.segundosAlPausar ?? ((est.minutos || 30) * 60);

  await setDoc(ref, {
    ...est,
    estado: 'en_curso',
    segundosAlPausar: seg,
    minutosExtra: 0,
    reanudadoEn: Date.now(),
    reabiertoEn: new Date().toISOString(),
    actualizado: serverTimestamp(),
  });

  const m = Math.floor(seg / 60), s = seg % 60;
  alert(`Examen reabierto. Continuará con ${m}:${String(s).padStart(2, '0')} — el tiempo exacto que le quedaba.`);
  cargarIntentos();
}

async function darTiempoExtra(alumnoId, bloque) {
  const alumno = alumnosCache.find(a => a.id === alumnoId);

  const ref = doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'intentos', String(bloque));
  const snap = await getDoc(ref);
  if (!snap.exists()) { alert('Ese alumno todavía no ha iniciado el examen.'); return; }
  const est = snap.data();

  // Le mostramos cuánto le queda ahora, para decidir con criterio
  const base = est.segundosAlPausar ?? ((est.minutos || 30) * 60);
  const desde = est.reanudadoEn || est.iniciado;
  const restante = est.estado === 'bloqueado'
    ? base
    : Math.max(0, base + (est.minutosExtra || 0) * 60 - Math.floor((Date.now() - desde) / 1000));
  const rm = Math.floor(restante / 60), rs = restante % 60;

  const min = prompt(
    `${alumno?.nombre || 'Este alumno'} tiene ${rm}:${String(rs).padStart(2, '0')} restantes.\n\n` +
    `¿Cuántos minutos EXTRA le agrego?`, '10');
  const n = parseInt(min, 10);
  if (isNaN(n) || n <= 0) return;

  await setDoc(ref, {
    ...est, minutosExtra: (est.minutosExtra || 0) + n,
    actualizado: serverTimestamp(),
  });

  alert(`Se agregaron ${n} minutos.`);
  cargarIntentos();
}

// ---------- AVISOS (preguntas semanales e indicaciones para el grupo) ----------
async function cargarAvisos() {
  const cont = document.getElementById('avisos-lista');
  const empty = document.getElementById('avisos-empty');
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

  try {
    await addDoc(collection(db, 'grupos', grupoActivo, 'avisos'), {
      titulo, texto, creado: serverTimestamp(),
    });
  } catch (err) {
    console.error('Error publicando aviso:', err);
    marcarResultado('btn-publicar-aviso', 'aviso-msg', false, '', 'No se pudo publicar: ' + (err.message || err));
    return;
  }

  document.getElementById('aviso-titulo').value = '';
  document.getElementById('aviso-texto').value = '';
  marcarResultado('btn-publicar-aviso', 'aviso-msg', true, '\u2713 Aviso publicado.', '');
  cargarAvisos();
}

function escaparHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Da retroalimentación visual inmediata tras un guardado: el botón se pone
// verde un instante (éxito) o rojo (no se pudo), además del texto de siempre.
function marcarResultado(botonId, msgId, exito, textoExito, textoError) {
  const boton = document.getElementById(botonId);
  if (boton) {
    boton.style.transition = 'background-color .15s ease, color .15s ease';
    boton.style.backgroundColor = exito ? '#4A5D3C' : '#A63D2F';
    boton.style.color = '#fff';
    setTimeout(() => {
      boton.style.backgroundColor = '';
      boton.style.color = '';
    }, 1100);
  }
  const msg = document.getElementById(msgId);
  if (msg) {
    msg.textContent = exito ? textoExito : textoError;
    msg.hidden = false;
    setTimeout(() => { msg.hidden = true; }, exito ? 3000 : 6000);
  }
}

// ---------- AJUSTE MANUAL (override por alumno y bloque de cualquier rubro) ----------
// Participación, Prácticas, Ensayos y Asistencia se guardan en
// grupos/{id}/alumnos/{id}/ajustes/{bloque}. El campo Examen de esta pantalla
// NO usa esa colección: lee y escribe directamente en
// grupos/{id}/alumnos/{id}/examenes/{bloque}, el mismo dato que la pestaña
// "Exámenes" — así hay un solo lugar para ese valor, nunca dos.

function mostrarEstadoAjusteManual() {
  const empty = document.getElementById('ajuste-empty');
  const select = document.getElementById('ajuste-alumno-select');
  const form = document.getElementById('ajuste-form');
  if (!empty || !select) return;

  if (!grupoActivo) {
    empty.hidden = false; empty.textContent = 'Elige un grupo primero.';
    select.hidden = true; form.hidden = true;
    return;
  }
  empty.hidden = true;
  select.hidden = false;

  // Si ya había un alumno elegido de antes, vuelve a cargar sus datos
  // (por ejemplo, al regresar a esta pestaña tras editar otra cosa).
  if (select.value) {
    form.hidden = false;
    cargarAjusteAlumnoBloque();
  } else {
    form.hidden = true;
  }
}

// Trae el valor EFECTIVO actual (automático o ya-manual, el que esté vigente)
// de los 5 rubros para el alumno y bloque elegidos, usando la misma fórmula
// que todo el resto del sistema — así lo que se precarga aquí es idéntico a
// lo que ya se ve en Historial y en el panel del alumno.
async function cargarAjusteAlumnoBloque() {
  const alumnoId = document.getElementById('ajuste-alumno-select').value;
  const bloque = parseInt(document.getElementById('ajuste-bloque-select').value, 10);
  if (!alumnoId || !grupoActivo) return;

  document.getElementById('ajuste-bloque-num').textContent = bloque;
  const msg = document.getElementById('ajuste-msg');
  if (msg) msg.hidden = true;

  const datos = await datosDeAlumno(alumnoId);
  const r = calcularBloque(bloque, datos);

  document.getElementById('ajuste-participacion').value = r.participacion.pts;
  document.getElementById('ajuste-practicas').value = r.practicas.pts.toFixed(1);
  document.getElementById('ajuste-ensayos').value = r.ensayos.pts.toFixed(1);
  document.getElementById('ajuste-asistencia').value = r.asistencia.pts.toFixed(2);
  document.getElementById('ajuste-examen').value = r.examen.pts.toFixed(1);

  actualizarSumaAjuste();
}

// Suma en vivo de lo que esté escrito en los 5 campos, para que el docente
// vea de inmediato cómo va quedando el total mientras edita.
function actualizarSumaAjuste() {
  const ids = ['ajuste-participacion', 'ajuste-practicas', 'ajuste-ensayos', 'ajuste-asistencia', 'ajuste-examen'];
  const suma = ids.reduce((s, id) => {
    const el = document.getElementById(id);
    const v = el ? parseFloat(el.value) : NaN;
    return s + (isNaN(v) ? 0 : v);
  }, 0);
  const display = document.getElementById('ajuste-total-display');
  if (display) display.textContent = `Suma actual: ${suma.toFixed(1)} / 100 pts`;
}

// Guarda TODO lo que esté escrito en pantalla en ese momento como manual —
// aunque no lo hayas tocado. Es la forma más simple y predecible: si no
// quieres fijar un rubro, usa "Quitar ajustes" después, o simplemente no
// entres a esta pantalla para ese alumno.
async function guardarAjusteManual() {
  const alumnoId = document.getElementById('ajuste-alumno-select').value;
  if (!grupoActivo || !alumnoId) { alert('Elige un alumno primero.'); return; }
  const bloque = document.getElementById('ajuste-bloque-select').value;

  const participacion = parseFloat(document.getElementById('ajuste-participacion').value) || 0;
  const practicas = parseFloat(document.getElementById('ajuste-practicas').value) || 0;
  const ensayos = parseFloat(document.getElementById('ajuste-ensayos').value) || 0;
  const asistencia = parseFloat(document.getElementById('ajuste-asistencia').value) || 0;
  const examenPts = parseFloat(document.getElementById('ajuste-examen').value) || 0;

  try {
    await setDoc(doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'ajustes', bloque), {
      participacion, practicas, ensayos, asistencia,
      actualizado: serverTimestamp(),
    });

    // El campo Examen se guarda en su propio lugar (el mismo que usa la
    // pestaña "Exámenes"): puntos del bloque (0-30) → calificación 0-10.
    await setDoc(doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'examenes', bloque), {
      examen: bloque,
      calificacion: examenPts / 3,
      origen: 'ajuste del docente',
      actualizado: serverTimestamp(),
    });
  } catch (err) {
    console.error('Error guardando ajuste manual:', err);
    marcarResultado('btn-guardar-ajuste', 'ajuste-msg', false, '', 'No se pudo guardar: ' + (err.message || err));
    return;
  }

  marcarResultado('btn-guardar-ajuste', 'ajuste-msg', true, '\u2713 Ajustes guardados.', '');
  cargarAjusteAlumnoBloque();
}

// Borra el ajuste manual de los 5 rubros de este alumno y bloque, y regresa
// todo al cálculo automático (incluido el Examen, si tenía un ajuste ahí).
async function quitarAjusteManual() {
  const alumnoId = document.getElementById('ajuste-alumno-select').value;
  if (!grupoActivo || !alumnoId) { alert('Elige un alumno primero.'); return; }
  const bloque = document.getElementById('ajuste-bloque-select').value;

  const alumno = alumnosCache.find(a => a.id === alumnoId);
  const ok = confirm(`¿Quitar los ajustes manuales de ${alumno?.nombre || 'este alumno'} en el Bloque ${bloque}?\n\nVolverá a calcularse automáticamente en los 5 rubros, incluido el Examen.`);
  if (!ok) return;

  try {
    await deleteDoc(doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'ajustes', bloque));
    await deleteDoc(doc(db, 'grupos', grupoActivo, 'alumnos', alumnoId, 'examenes', bloque));
  } catch (err) {
    console.error('Error quitando ajustes:', err);
    marcarResultado('btn-quitar-ajuste', 'ajuste-msg', false, '', 'No se pudo quitar el ajuste: ' + (err.message || err));
    return;
  }

  marcarResultado('btn-quitar-ajuste', 'ajuste-msg', true, '\u2713 Ajustes quitados — vuelve a calcular automático.', '');
  cargarAjusteAlumnoBloque();
}
