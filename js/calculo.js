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
//
// AJUSTE MANUAL (pestaña "Ajuste manual" del panel docente):
// Participación, Prácticas, Ensayos y Asistencia se pueden sobreescribir por
// alumno y bloque desde grupos/{id}/alumnos/{id}/ajustes/{bloque}. Un valor
// manual ahí SIEMPRE tiene prioridad sobre el cálculo automático de ese
// rubro. El Examen NO usa esta colección — sigue su propio mecanismo ya
// existente (grupos/{id}/alumnos/{id}/examenes/{bloque}), el mismo que usa
// la pestaña "Exámenes"; así hay un solo lugar para ese dato, no dos.

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

// Si hay un valor manual capturado (no null/undefined/''), gana sobre el
// automático — siempre respetando el tope del rubro. Devuelve también si
// el valor final es manual, por si algún panel quiere mostrar un indicador.
function conAjusteManual(valorAutomatico, valorManual, max) {
  const hayManual = valorManual !== null && valorManual !== undefined && valorManual !== '';
  const valor = tope(hayManual ? Number(valorManual) : valorAutomatico, max);
  return { valor, manual: hayManual };
}

// Calcula los puntos de UN bloque a partir de los datos crudos de Firestore.
// datos = {
//   idsActividades: ['b1-1.1-a', ...],
//   ensayos:   { '1': {entregado, calificacion}, ... },
//   practicas: [ {bloque, calificacion}, ... ],
//   asistencias: [ {bloque, estado}, ... ],
//   examenes:  { '1': {calificacion}, ... },   ajuste manual del docente (examen)
//   intentos:  { '1': {estado, calificacion, aciertos, total}, ... },  examen en línea
//   ajustes:   { '1': {participacion, practicas, ensayos, asistencia}, ... },  ajuste manual (los otros 4 rubros)
// }
export function calcularBloque(bloque, datos) {
  const ajuste = (datos.ajustes || {})[String(bloque)] || {};

  // --- Participación: 1 punto por actividad correcta de ESE bloque ---
  const hechas = (datos.idsActividades || []).filter(id => id.startsWith(`b${bloque}-`)).length;
  const participacionCalc = conAjusteManual(hechas * 1, ajuste.participacion, TOPES.participacion);

  // --- Ensayos: suma directa de los puntos (0-6) de las 5 semanas del bloque ---
  const semanas = SEMANAS_DE_BLOQUE[bloque] || [];
  let ptsEnsayosAuto = 0;
  let ensayosEntregados = 0;
  semanas.forEach(n => {
    const e = (datos.ensayos || {})[String(n)];
    if (!e) return;
    if (e.entregado) ensayosEntregados++;
    if (e.calificacion !== null && e.calificacion !== undefined && e.calificacion !== '') {
      ptsEnsayosAuto += Number(e.calificacion);
    }
  });
  const ensayosCalc = conAjusteManual(ptsEnsayosAuto, ajuste.ensayos, TOPES.ensayos);

  // --- Prácticas: la rúbrica da 0-10; cada práctica vale 2 pts ---
  const practicasBloque = (datos.practicas || []).filter(p => Number(p.bloque) === bloque);
  let ptsPracticasAuto = 0;
  practicasBloque.forEach(p => {
    ptsPracticasAuto += (Number(p.calificacion) || 0) / 10 * PTS_POR_PRACTICA;
  });
  const practicasCalc = conAjusteManual(ptsPracticasAuto, ajuste.practicas, TOPES.practicas);

  // --- Asistencia: 0.5 por clase (justificado también cuenta 0.5) ---
  const asisBloque = (datos.asistencias || []).filter(a => Number(a.bloque) === bloque);
  let ptsAsistenciaAuto = 0;
  const conteo = { presente: 0, retardo: 0, justificado: 0, falta: 0 };
  asisBloque.forEach(a => {
    const estado = a.estado || 'presente';
    ptsAsistenciaAuto += (PUNTOS_ASISTENCIA[estado] ?? 0);
    if (conteo[estado] !== undefined) conteo[estado]++;
  });
  const asistenciaCalc = conAjusteManual(ptsAsistenciaAuto, ajuste.asistencia, TOPES.asistencia);

  // --- Examen: calificación 0-10 × 3 ---
  // Puede venir de dos fuentes (sin relación con la colección "ajustes"):
  //   1. El intento del examen en línea (se califica solo al entregarse).
  //   2. Un ajuste manual del docente en grupos/.../examenes/{bloque}, que
  //      SIEMPRE manda sobre lo automático — es el mismo dato que usan tanto
  //      la pestaña "Exámenes" como el campo "Examen" de "Ajuste manual".
  const exaManual = (datos.examenes || {})[String(bloque)];
  const intento = (datos.intentos || {})[String(bloque)];

  const hayExamenManual = exaManual
    && exaManual.calificacion !== null
    && exaManual.calificacion !== undefined
    && exaManual.calificacion !== '';

  const hayEnLinea = intento
    && intento.estado === 'entregado'
    && intento.calificacion !== null
    && intento.calificacion !== undefined;

  let califExamen = null;
  let origenExamen = null;

  if (hayExamenManual) {
    califExamen = Number(exaManual.calificacion);
    origenExamen = 'ajuste del docente';
  } else if (hayEnLinea) {
    califExamen = Number(intento.calificacion);
    origenExamen = 'examen en línea';
  }

  const ptsExamen = califExamen !== null ? tope(califExamen * 3, TOPES.examen) : 0;

  const total = participacionCalc.valor + ensayosCalc.valor + practicasCalc.valor + asistenciaCalc.valor + ptsExamen;

  return {
    bloque,
    participacion: {
      pts: participacionCalc.valor, tope: TOPES.participacion, manual: participacionCalc.manual,
      hechas, deTotal: ACTIVIDADES_POR_BLOQUE,
    },
    ensayos: {
      pts: ensayosCalc.valor, tope: TOPES.ensayos, manual: ensayosCalc.manual,
      entregados: ensayosEntregados, deTotal: semanas.length,
    },
    practicas: {
      pts: practicasCalc.valor, tope: TOPES.practicas, manual: practicasCalc.manual,
      cuantas: practicasBloque.length, deTotal: 5, lista: practicasBloque,
    },
    asistencia: {
      pts: asistenciaCalc.valor, tope: TOPES.asistencia, manual: asistenciaCalc.manual,
      conteo, clases: asisBloque.length, deTotal: 20,
    },
    examen: {
      pts: ptsExamen, tope: TOPES.examen, manual: hayExamenManual, calificacion: califExamen, origen: origenExamen,
      aciertos: hayEnLinea ? intento.aciertos : null,
      deTotal: hayEnLinea ? intento.total : null,
    },
    total,
  };
}

// Convierte puntos (0-100) a calificación sobre 10, como la pide la escuela.
export function aCalificacion10(puntos) {
  return Math.round(puntos) / 10;
}
