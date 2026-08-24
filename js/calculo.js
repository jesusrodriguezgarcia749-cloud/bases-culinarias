// calculo.js — Fórmula única de calificación, compartida por el panel docente
// y el panel del alumno. Si algún día cambian los pesos, se cambian AQUÍ y
// ambos paneles quedan consistentes automáticamente.
//
// ESQUEMA POR BLOQUE (cada bloque = 100 puntos):
//   Participación   20 pts → 20 actividades × 1 pt
//   Ensayos         30 pts → 5 bitácoras × 6 pts
//   Prácticas       10 pts → 5 prácticas × 2 pts
//   Asistencia      10 pts → 20 clases × 0.5 pts
//   Examen          30 pts → calificación 0-10 × 3

export const TOPES = {
  participacion: 20,
  ensayos: 30,
  practicas: 10,
  asistencia: 10,
  examen: 30,
};

export const ACTIVIDADES_POR_BLOQUE = 20;   // 1 pt cada una
export const PTS_POR_ENSAYO = 6;            // 5 bitácoras
export const PTS_POR_PRACTICA = 2;          // 5 prácticas
export const PTS_POR_CLASE = 0.5;           // 20 clases

export const PUNTOS_ASISTENCIA = {
  presente: 0.5,
  justificado: 0.5,
  retardo: 0.25,
  falta: 0,
};

export const SEMANAS_DE_BLOQUE = {
  1: [1, 2, 3, 4, 5],
  2: [6, 7, 8, 9, 10],
  3: [11, 12, 13, 14, 15],
};

function tope(valor, max) {
  return Math.min(valor, max);
}

// Calcula los puntos de UN bloque a partir de los datos crudos de Firestore.
// datos = {
//   idsActividades: ['b1-1.1-a', ...],
//   ensayos:   { '1': {entregado, calificacion}, ... },
//   practicas: [ {bloque, calificacion}, ... ],
//   asistencias: [ {bloque, estado}, ... ],
//   examenes:  { '1': {calificacion}, ... },   ajuste manual del docente
//   intentos:  { '1': {estado, calificacion, aciertos, total}, ... },  examen en línea
// }
export function calcularBloque(bloque, datos) {
  // --- Participación: 1 punto por actividad correcta de ESE bloque ---
  const hechas = (datos.idsActividades || []).filter(id => id.startsWith(`b${bloque}-`)).length;
  const ptsParticipacion = tope(hechas * 1, TOPES.participacion);

  // --- Ensayos: suma directa de los puntos (0-6) de las 5 semanas del bloque ---
  const semanas = SEMANAS_DE_BLOQUE[bloque] || [];
  let ptsEnsayos = 0;
  let ensayosEntregados = 0;
  semanas.forEach(n => {
    const e = (datos.ensayos || {})[String(n)];
    if (!e) return;
    if (e.entregado) ensayosEntregados++;
    if (e.calificacion !== null && e.calificacion !== undefined && e.calificacion !== '') {
      ptsEnsayos += Number(e.calificacion);
    }
  });
  ptsEnsayos = tope(ptsEnsayos, TOPES.ensayos);

  // --- Prácticas: la rúbrica da 0-10; cada práctica vale 2 pts ---
  const practicasBloque = (datos.practicas || []).filter(p => Number(p.bloque) === bloque);
  let ptsPracticas = 0;
  practicasBloque.forEach(p => {
    ptsPracticas += (Number(p.calificacion) || 0) / 10 * PTS_POR_PRACTICA;
  });
  ptsPracticas = tope(ptsPracticas, TOPES.practicas);

  // --- Asistencia: 0.5 por clase (justificado también cuenta 0.5) ---
  const asisBloque = (datos.asistencias || []).filter(a => Number(a.bloque) === bloque);
  let ptsAsistencia = 0;
  const conteo = { presente: 0, retardo: 0, justificado: 0, falta: 0 };
  asisBloque.forEach(a => {
    const estado = a.estado || 'presente';
    ptsAsistencia += (PUNTOS_ASISTENCIA[estado] ?? 0);
    if (conteo[estado] !== undefined) conteo[estado]++;
  });
  ptsAsistencia = tope(ptsAsistencia, TOPES.asistencia);

  // --- Examen: calificación 0-10 × 3 ---
  // Puede venir de dos fuentes:
  //   1. El intento del examen en línea (se califica solo al entregarse).
  //   2. Un ajuste manual del docente, que SIEMPRE manda sobre lo automático
  //      (por si el alumno hizo un trabajo extra o hay que subirle puntos).
  const exaManual = (datos.examenes || {})[String(bloque)];
  const intento = (datos.intentos || {})[String(bloque)];

  const hayManual = exaManual
    && exaManual.calificacion !== null
    && exaManual.calificacion !== undefined
    && exaManual.calificacion !== '';

  const hayEnLinea = intento
    && intento.estado === 'entregado'
    && intento.calificacion !== null
    && intento.calificacion !== undefined;

  let califExamen = null;
  let origenExamen = null;

  if (hayManual) {
    califExamen = Number(exaManual.calificacion);
    origenExamen = 'ajuste del docente';
  } else if (hayEnLinea) {
    califExamen = Number(intento.calificacion);
    origenExamen = 'examen en línea';
  }

  const ptsExamen = califExamen !== null ? tope(califExamen * 3, TOPES.examen) : 0;

  const total = ptsParticipacion + ptsEnsayos + ptsPracticas + ptsAsistencia + ptsExamen;

  return {
    bloque,
    participacion: { pts: ptsParticipacion, tope: TOPES.participacion, hechas, deTotal: ACTIVIDADES_POR_BLOQUE },
    ensayos:       { pts: ptsEnsayos, tope: TOPES.ensayos, entregados: ensayosEntregados, deTotal: semanas.length },
    practicas:     { pts: ptsPracticas, tope: TOPES.practicas, cuantas: practicasBloque.length, deTotal: 5, lista: practicasBloque },
    asistencia:    { pts: ptsAsistencia, tope: TOPES.asistencia, conteo, clases: asisBloque.length, deTotal: 20 },
    examen:        { pts: ptsExamen, tope: TOPES.examen, calificacion: califExamen, origen: origenExamen,
                     aciertos: hayEnLinea ? intento.aciertos : null,
                     deTotal: hayEnLinea ? intento.total : null },
    total,
  };
}

// Convierte puntos (0-100) a calificación sobre 10, como la pide la escuela.
export function aCalificacion10(puntos) {
  return Math.round(puntos) / 10;
}
