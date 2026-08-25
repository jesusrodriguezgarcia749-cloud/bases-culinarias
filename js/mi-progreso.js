// mi-progreso.js — panel personal del alumno: solo lee su propia información.
// Usa la MISMA fórmula que el panel docente (js/calculo.js), para que ambos
// paneles nunca muestren números distintos.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, getDoc, collection, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";
import { calcularBloque, SEMANAS_DE_BLOQUE, PTS_POR_ENSAYO, PUNTOS_ASISTENCIA } from "./calculo.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const SESSION_KEY = 'bc_sesion_alumno';
const NOMBRES_BLOQUE = { 1: 'Bloque 1', 2: 'Bloque 2', 3: 'Bloque 3' };

const TEMAS_SEMANA = {
  1: 'Géneros y Estructura Clásica',
  2: 'Secuencia Operativa',
  3: 'Rendimiento y Merma',
  4: 'Termodinámica y Sanidad',
  5: 'Escalabilidad — Micro-Ensayo 1',
  6: 'Aprovisionamiento',
  7: 'Propiedades Funcionales',
  8: 'Grasas y Aceites',
  9: 'Variedades Físicas y Scoville',
  10: 'Cualidades Gastronómicas — Micro-Ensayo 2',
  11: 'Técnicas de Cocción',
  12: 'Destrezas con Proteínas',
  13: 'Cortes Clásicos',
  14: 'Semillas y Cereales',
  15: 'Hierbas y Especias — Micro-Ensayo 3',
};

let sesion = null;
let datosCache = null;

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

  sesion = { grupoId, alumnoId, nombre: snap.data().nombre, pin };
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

// Carga UNA sola vez todos los datos del alumno y los deja en datosCache.
async function cargarDatos() {
  const base = ['grupos', sesion.grupoId, 'alumnos', sesion.alumnoId];
  const [actSnap, evalSnap, ensSnap, asisSnap, exaSnap, intSnap, preguntasSnap, ajusSnap] = await Promise.all([
    getDocs(collection(db, ...base, 'actividades')).catch(() => null),
    getDocs(collection(db, ...base, 'evaluaciones')).catch(() => null),
    getDocs(collection(db, ...base, 'ensayos')).catch(() => null),
    getDocs(collection(db, ...base, 'asistencias')).catch(() => null),
    getDocs(collection(db, ...base, 'examenes')).catch(() => null),
    getDocs(collection(db, ...base, 'intentos')).catch(() => null),
    // Preguntas del micro-ensayo: viven a nivel de grupo (las captura el
    // docente en el panel), no por alumno — todos los alumnos del grupo
    // ven las mismas preguntas de la semana que esté activa.
    getDocs(collection(db, 'grupos', sesion.grupoId, 'ensayos_preguntas')).catch(() => null),
    // Ajustes manuales del docente (Participación, Prácticas, Ensayos,
    // Asistencia) — el Examen manual sigue viniendo de "examenes" arriba.
    getDocs(collection(db, ...base, 'ajustes')).catch(() => null),
  ]);

  const ensayos = {};
  if (ensSnap) ensSnap.docs.forEach(d => { ensayos[d.id] = d.data(); });
  const examenes = {};
  if (exaSnap) exaSnap.docs.forEach(d => { examenes[d.id] = d.data(); });
  const intentos = {};
  if (intSnap) intSnap.docs.forEach(d => { intentos[d.id] = d.data(); });
  const ensayosPreguntas = {};
  if (preguntasSnap) preguntasSnap.docs.forEach(d => { ensayosPreguntas[d.id] = d.data(); });
  const ajustes = {};
  if (ajusSnap) ajusSnap.docs.forEach(d => { ajustes[d.id] = d.data(); });

  datosCache = {
    idsActividades: actSnap ? actSnap.docs.map(d => d.id) : [],
    ensayos,
    ensayosPreguntas,
    practicas: evalSnap ? evalSnap.docs.map(d => d.data()) : [],
    asistencias: asisSnap ? asisSnap.docs.map(d => d.data()) : [],
    examenes,
    intentos,
    ajustes,
  };
}

function renderParticipacion(bloques) {
  const cont = document.getElementById('prog-participacion');
  cont.innerHTML = bloques.map(x => {
    const pct = x.participacion.tope ? x.participacion.pts / x.participacion.tope * 100 : 0;
    return `
      <div class="prog-bloque-row">
        <span class="prog-bloque-nombre">${NOMBRES_BLOQUE[x.bloque]}</span>
        <div class="prog-bloque-bar-track"><div class="prog-bloque-bar-fill" style="width:${pct}%"></div></div>
        <span class="prog-bloque-stat">${x.participacion.pts} / ${x.participacion.tope} pts</span>
      </div>
    `;
  }).join('') +
    `<p style="margin-top:14px;"><a href="actividades.html" class="btn btn-ghost-dark btn-small">Ir a Actividades</a></p>`;
}

function renderPracticas(bloques) {
  const cont = document.getElementById('prog-practicas');
  const empty = document.getElementById('prog-practicas-empty');
  const hay = bloques.some(x => x.practicas.cuantas > 0);
  empty.hidden = hay;
  if (!hay) { cont.innerHTML = ''; return; }

  cont.innerHTML = bloques.map(x => `
    <h3 class="prog-ens-bloque">Bloque ${x.bloque}</h3>
    ${x.practicas.lista.length === 0
      ? '<p class="empty-inline">Sin prácticas evaluadas todavía.</p>'
      : x.practicas.lista
          .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''))
          .map(p => {
            const pts = (Number(p.calificacion) || 0) / 10 * 2;
            return `
              <div class="prog-ensayo-row">
                <span class="prog-ensayo-tema">${p.fecha || 'sin fecha'}</span>
                <span class="prog-ensayo-calif">${(p.calificacion || 0).toFixed(1)}/10 · ${pts.toFixed(1)} pts</span>
              </div>`;
          }).join('')}
    <div class="prog-ens-subtotal">
      <span>Subtotal Bloque ${x.bloque}</span>
      <strong>${x.practicas.pts.toFixed(1)} / ${x.practicas.tope} pts</strong>
    </div>
  `).join('');
}

// Ensayos: cada semana va en su propio desplegable (<details>) para que la
// lista no crezca sin control conforme avanza el cuatrimestre. Las preguntas
// solo se muestran si el docente las activó desde el panel — son de solo
// lectura, el alumno las responde a mano en su libreta.
function renderEnsayos(bloques) {
  const cont = document.getElementById('prog-ensayos');
  const empty = document.getElementById('prog-ensayos-empty');
  const hay = Object.keys(datosCache.ensayos).length > 0;
  empty.hidden = hay;
  if (!hay) { cont.innerHTML = ''; return; }

  cont.innerHTML = bloques.map(x => {
    const semanas = SEMANAS_DE_BLOQUE[x.bloque];
    return `
      <h3 class="prog-ens-bloque">Bloque ${x.bloque}</h3>
      ${semanas.map(n => {
        const d = datosCache.ensayos[String(n)] || {};
        const entregado = d.entregado === true;
        const tiene = d.calificacion !== null && d.calificacion !== undefined && d.calificacion !== '';
        const pts = tiene ? Number(d.calificacion) : null;
        const derecha = pts !== null
          ? `${pts.toFixed(1)} / ${PTS_POR_ENSAYO} pts`
          : (entregado ? 'Entregada' : 'Pendiente');

        const pInfo = datosCache.ensayosPreguntas[String(n)];
        const preguntasActivas = pInfo && pInfo.activo && Array.isArray(pInfo.preguntas) && pInfo.preguntas.length > 0
          ? pInfo.preguntas
          : null;

        return `
          <details class="prog-detalle-bloque">
            <summary>${entregado ? '✓' : '○'} Sem. ${n} — ${escaparHTML(TEMAS_SEMANA[n] || '')} — ${derecha}</summary>
            <div class="prog-ens-preguntas-body">
              ${preguntasActivas
                ? `<p class="field-hint">Preguntas de esta semana — respóndelas a mano en tu libreta:</p>
                   <ol>${preguntasActivas.map(p => `<li>${escaparHTML(p)}</li>`).join('')}</ol>`
                : '<p class="empty-inline">Tu docente todavía no publica las preguntas de esta semana.</p>'}
            </div>
          </details>`;
      }).join('')}
      <div class="prog-ens-subtotal">
        <span>Subtotal Bloque ${x.bloque}</span>
        <strong>${x.ensayos.pts.toFixed(1)} / ${x.ensayos.tope} pts</strong>
      </div>
    `;
  }).join('') + renderAcumuladoEnsayos(bloques);
}

// Los 90 pts de bitácoras del cuatrimestre (15 semanas × 6 pts) alimentan el
// 35% de la Evaluación Final. El docente puede ajustar puntos al cierre por
// la presentación del compendio digitalizado.
function renderAcumuladoEnsayos(bloques) {
  const acumulado = bloques.reduce((s, x) => s + x.ensayos.pts, 0);
  const pctFinal = acumulado / 90 * 35;
  return `
    <div class="prog-ens-total">
      <span>Acumulado del cuatrimestre</span>
      <strong>${acumulado.toFixed(1)} / 90 pts</strong>
    </div>
    <div class="prog-ens-subtotal" style="margin-top:8px;">
      <span>Equivale hoy en tu Evaluación Final</span>
      <strong>${pctFinal.toFixed(1)}% de 35%</strong>
    </div>
    <p class="field-hint">Tus 15 bitácoras suman 90 puntos, que se convierten en el 35% de "entrega de ensayos" de tu Evaluación Final. Tu docente puede ajustar puntos al cierre según la presentación del compendio final.</p>
  `;
}

// Asistencia: resumen compacto + calendario desplegable con colores.
function renderAsistencia(bloques) {
  const cont = document.getElementById('prog-asistencia');
  const empty = document.getElementById('prog-asistencia-empty');
  if (!cont) return;

  const todas = datosCache.asistencias || [];
  empty.hidden = todas.length > 0;
  if (todas.length === 0) { cont.innerHTML = ''; return; }

  const ETIQUETAS = {
    presente: 'Presente', justificado: 'Justificado',
    retardo: 'Retardo', falta: 'Falta',
  };

  cont.innerHTML = bloques.map(x => {
    const delBloque = todas
      .filter(a => Number(a.bloque) === x.bloque)
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));

    const c = x.asistencia.conteo;
    const resumen = [
      c.presente ? `${c.presente} asistencia${c.presente !== 1 ? 's' : ''}` : null,
      c.justificado ? `${c.justificado} justificada${c.justificado !== 1 ? 's' : ''}` : null,
      c.retardo ? `${c.retardo} retardo${c.retardo !== 1 ? 's' : ''}` : null,
      c.falta ? `${c.falta} falta${c.falta !== 1 ? 's' : ''}` : null,
    ].filter(Boolean).join(' · ') || 'Sin registros';

    return `
      <h3 class="prog-ens-bloque">Bloque ${x.bloque}</h3>
      <div class="prog-asis-resumen">
        <span>${resumen}</span>
        <strong>${x.asistencia.pts.toFixed(2)} / ${x.asistencia.tope} pts</strong>
      </div>
      ${delBloque.length === 0 ? '' : `
        <details class="prog-detalle-bloque">
          <summary>Ver días registrados (${delBloque.length})</summary>
          <div class="prog-cal-leyenda">
            <span><i class="cal-dot cal-presente"></i> Presente</span>
            <span><i class="cal-dot cal-justificado"></i> Justificado</span>
            <span><i class="cal-dot cal-retardo"></i> Retardo</span>
            <span><i class="cal-dot cal-falta"></i> Falta</span>
          </div>
          <div class="prog-calendario">
            ${delBloque.map(a => {
              const estado = a.estado || 'presente';
              const f = (a.fecha || '').split('-');
              const dia = f.length === 3 ? `${f[2]}/${f[1]}` : (a.fecha || '?');
              return `
                <div class="cal-dia cal-${estado}" title="${a.fecha} — ${ETIQUETAS[estado] || estado}">
                  <span class="cal-fecha">${dia}</span>
                  <span class="cal-pts">${PUNTOS_ASISTENCIA[estado] ?? 0}</span>
                </div>`;
            }).join('')}
          </div>
        </details>
      `}
    `;
  }).join('');
}

// Tarjeta propia para los exámenes de cada bloque.
function renderExamenes(bloques) {
  const cont = document.getElementById('prog-examenes');
  const empty = document.getElementById('prog-examenes-empty');
  if (!cont) return;

  const hay = bloques.some(x => x.examen.calificacion !== null);
  empty.hidden = hay;
  if (!hay) { cont.innerHTML = ''; return; }

  cont.innerHTML = bloques.map(x => {
    const e = x.examen;
    if (e.calificacion === null) {
      return `
        <div class="prog-examen-row">
          <span class="prog-examen-bloque">${NOMBRES_BLOQUE[x.bloque]}</span>
          <span class="prog-examen-pendiente">Sin presentar</span>
        </div>`;
    }
    const detalle = e.aciertos !== null && e.aciertos !== undefined
      ? `${e.aciertos} de ${e.deTotal} correctas`
      : (e.origen === 'ajuste del docente' ? 'Registrado por tu docente' : '');
    return `
      <div class="prog-examen-row hecho">
        <div class="prog-examen-info">
          <span class="prog-examen-bloque">${NOMBRES_BLOQUE[x.bloque]}</span>
          ${detalle ? `<span class="prog-examen-detalle">${detalle}</span>` : ''}
        </div>
        <div class="prog-examen-nums">
          <span class="prog-examen-calif">${e.calificacion.toFixed(1)} / 10</span>
          <span class="prog-examen-pts">${e.pts.toFixed(1)} / ${e.tope} pts</span>
        </div>
      </div>`;
  }).join('') +
  `<p style="margin-top:14px;"><a href="examen.html" class="btn btn-ghost-dark btn-small">Ir a Exámenes</a></p>`;
}

function renderBloques(bloques) {
  const cont = document.getElementById('prog-bloques');
  if (!cont) return;

  cont.innerHTML = bloques.map(x => `
    <div class="prog-bloque-row">
      <span class="prog-bloque-nombre">${NOMBRES_BLOQUE[x.bloque]}</span>
      <div class="prog-bloque-bar-track"><div class="prog-bloque-bar-fill" style="width:${Math.min(100, x.total)}%"></div></div>
      <span class="prog-bloque-stat">${x.total.toFixed(1)} / 100 pts</span>
    </div>
  `).join('') + `
    <div class="prog-desglose">
      ${bloques.map(x => `
        <details class="prog-detalle-bloque">
          <summary>Ver desglose del Bloque ${x.bloque}</summary>
          <div class="prog-ensayo-row"><span class="prog-ensayo-tema">Participación</span><span class="prog-ensayo-calif">${x.participacion.pts} / ${x.participacion.tope}</span></div>
          <div class="prog-ensayo-row"><span class="prog-ensayo-tema">Ensayos</span><span class="prog-ensayo-calif">${x.ensayos.pts.toFixed(1)} / ${x.ensayos.tope}</span></div>
          <div class="prog-ensayo-row"><span class="prog-ensayo-tema">Prácticas de cocina</span><span class="prog-ensayo-calif">${x.practicas.pts.toFixed(1)} / ${x.practicas.tope}</span></div>
          <div class="prog-ensayo-row"><span class="prog-ensayo-tema">Asistencia (${x.asistencia.clases}/${x.asistencia.deTotal} clases)</span><span class="prog-ensayo-calif">${x.asistencia.pts.toFixed(2)} / ${x.asistencia.tope}</span></div>
          <div class="prog-ensayo-row"><span class="prog-ensayo-tema">Examen${x.examen.calificacion !== null ? ` (${x.examen.calificacion}/10)` : ' — sin presentar'}</span><span class="prog-ensayo-calif">${x.examen.pts.toFixed(1)} / ${x.examen.tope}</span></div>
        </details>
      `).join('')}
    </div>
  `;
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

async function iniciarApp() {
  document.getElementById('alumno-login').hidden = true;
  document.getElementById('progreso-app').hidden = false;
  document.getElementById('act-whoami-nombre').textContent = `Hola, ${sesion.nombre}`;

  await cargarDatos();
  const bloques = [1, 2, 3].map(b => calcularBloque(b, datosCache));

  renderParticipacion(bloques);
  renderPracticas(bloques);
  renderEnsayos(bloques);
  renderAsistencia(bloques);
  renderExamenes(bloques);
  renderBloques(bloques);
  await renderAvisos();
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
    } catch { /* sesión inválida */ }
    sessionStorage.removeItem(SESSION_KEY);
  }
});
