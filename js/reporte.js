// reporte.js — Genera el reporte de calificaciones en una ventana nueva, lista
// para imprimir o guardar como PDF desde el navegador ("Imprimir → Guardar
// como PDF"). Formatos:
//   - GRUPO:  tabla compacta de todos los alumnos, uno o varios bloques.
//   - ALUMNO: concentrado de los 3 bloques + calendario de asistencia +
//             detalle de bitácoras de ensayo.
//   - EXAMEN: examen resuelto completo de un alumno (o de todo el grupo),
//             pregunta por pregunta, con su respuesta y la correcta — para
//             revisiones de examen en Coordinación Académica.

import { calcularBloque, SEMANAS_DE_BLOQUE, PUNTOS_ASISTENCIA } from "./calculo.js";

export const ESCUELA = {
  nombre: 'Instituto Tecnológico de Estudios Superiores René Descartes',
  carrera: 'Licenciatura en Artes Culinarias y Negocios Gastronómicos',
  asignatura: 'Bases Culinarias · Clave 0101 · Primer cuatrimestre',
  docente: 'Chef Jesús Rodríguez García',
  logo: 'assets/escudo.png',
};

const NOMBRES_BLOQUE = {
  1: 'Bloque 1 — Conceptos y definiciones de cocina',
  2: 'Bloque 2 — Conocimiento y manipulación de materias primas',
  3: 'Bloque 3 — Desarrollo de habilidades para la cocina',
};

const TEMAS_SEMANA = {
  1: 'Géneros y Estructura Clásica', 2: 'Secuencia Operativa',
  3: 'Rendimiento y Merma', 4: 'Termodinámica y Sanidad',
  5: 'Escalabilidad — Micro-Ensayo 1', 6: 'Aprovisionamiento',
  7: 'Propiedades Funcionales', 8: 'Grasas y Aceites',
  9: 'Variedades Físicas y Scoville', 10: 'Cualidades Gastronómicas — Micro-Ensayo 2',
  11: 'Técnicas de Cocción', 12: 'Destrezas con Proteínas',
  13: 'Cortes Clásicos', 14: 'Semillas y Cereales',
  15: 'Hierbas y Especias — Micro-Ensayo 3',
};

const ETIQUETA_TIPO_REACTIVO = {
  opcion_multiple: 'Opción múltiple',
  completar: 'Completa la frase',
  relacionar: 'Relaciona columnas',
  ordenar: 'Ordena la secuencia',
};

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

function hoy() {
  return new Date().toLocaleDateString('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function badge(calif) {
  const c = Number(calif);
  const clase = c >= 8 ? 'b-ok' : (c >= 6 ? 'b-riesgo' : 'b-repro');
  return `<span class="badge ${clase}">${c.toFixed(1)}</span>`;
}

// Baraja con semilla fija — misma lógica que examen.js, duplicada aquí a
// propósito (cada módulo se mantiene independiente, siguiendo el patrón ya
// usado en el proyecto) para reconstruir exactamente el orden de opciones
// que vio el alumno al presentar su examen.
function barajarConSemilla(arr, semilla) {
  const copia = [...arr];
  let s = semilla;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function semillaDe(texto) {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) % 233280;
  return h || 1;
}

const ESTILOS = `
  @page { size: letter; margin: 12mm; }
  *{box-sizing:border-box;}
  body{font-family:'Public Sans',-apple-system,Arial,sans-serif; color:#231F1A; margin:0; padding:20px; background:#F4EFE4;}
  .hoja{background:#fff; max-width:840px; margin:0 auto 28px; padding:34px 38px; box-shadow:0 2px 14px rgba(0,0,0,.08);}
  .encabezado{display:flex; align-items:center; gap:18px; border-bottom:3px solid #A63D2F; padding-bottom:16px;}
  .encabezado img{width:70px; height:70px; object-fit:contain; flex-shrink:0;}
  .enc-texto{flex:1;}
  .escuela{font-family:'Fraunces',Georgia,serif; font-size:1rem; font-weight:700; line-height:1.25; margin:0 0 3px;}
  .carrera{font-size:.75rem; color:#5C544A; margin:0 0 2px;}
  .asignatura{font-size:.8rem; font-weight:600; color:#A63D2F; margin:0;}
  .enc-sello{text-align:right; font-size:.6rem; color:#8A8177; text-transform:uppercase; letter-spacing:.08em; line-height:1.6;}
  h1{font-family:'Fraunces',Georgia,serif; font-size:1.25rem; margin:20px 0 3px;}
  .subtitulo{font-size:.78rem; color:#5C544A; margin:0 0 20px;}
  .datos{display:grid; grid-template-columns:repeat(4,1fr); border:1px solid #E0D9CB; border-radius:6px; overflow:hidden; margin-bottom:24px;}
  .dato{padding:9px 11px; border-right:1px solid #E0D9CB;}
  .dato:last-child{border-right:0;}
  .dato-etq{font-size:.58rem; text-transform:uppercase; letter-spacing:.07em; color:#8A8177; margin-bottom:3px;}
  .dato-val{font-size:.82rem; font-weight:600;}
  h2{font-family:'Fraunces',Georgia,serif; font-size:.95rem; margin:24px 0 9px; padding-bottom:5px; border-bottom:1.5px solid #C98A2C;}
  table{width:100%; border-collapse:collapse; font-size:.72rem;}
  thead th{background:#231F1A; color:#F7F3EA; padding:7px; text-align:left; font-weight:600; font-size:.64rem; text-transform:uppercase; letter-spacing:.03em;}
  thead th.num{text-align:center;}
  tbody td{padding:6px 7px; border-bottom:1px solid #EDE7DA;}
  tbody td.num{text-align:center; font-variant-numeric:tabular-nums;}
  tbody tr:nth-child(even){background:#FBF8F1;}
  tbody td.alumno{font-weight:600;}
  .total-col{font-weight:700; color:#4A5D3C;}
  tr.fila-total td{background:#F0EADC; font-weight:700; border-top:2px solid #231F1A;}
  .badge{display:inline-block; padding:2px 7px; border-radius:99px; font-size:.64rem; font-weight:700;}
  .b-ok{background:rgba(74,93,60,.14); color:#4A5D3C;}
  .b-riesgo{background:rgba(201,138,44,.18); color:#8A5E12;}
  .b-repro{background:rgba(166,61,47,.14); color:#A63D2F;}
  .asis-grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(60px,1fr)); gap:5px; margin-top:8px;}
  .asis-dia{border-radius:5px; padding:6px 3px; text-align:center; color:#fff; font-size:.62rem; font-weight:700;}
  .a-presente{background:#6B7A5E;} .a-justificado{background:#4A7FA5;}
  .a-retardo{background:#C9A22C;} .a-falta{background:#A63D2F;}
  .leyenda{display:flex; gap:14px; font-size:.64rem; color:#5C544A; margin:9px 0 4px; flex-wrap:wrap;}
  .leyenda span{display:flex; align-items:center; gap:5px;}
  .lg{width:9px; height:9px; border-radius:2px; display:inline-block;}
  .firmas{display:flex; gap:56px; margin-top:46px; justify-content:center;}
  .firma{text-align:center; flex:1; max-width:230px;}
  .firma-linea{border-top:1px solid #231F1A; margin-bottom:5px;}
  .firma-nombre{font-size:.75rem; font-weight:700;}
  .firma-cargo{font-size:.64rem; color:#5C544A;}
  .pie{margin-top:32px; padding-top:11px; border-top:1px solid #E0D9CB; display:flex; justify-content:space-between; font-size:.6rem; color:#8A8177;}
  .barra-imprimir{
    position:sticky; top:0; z-index:10; background:#231F1A; color:#F7F3EA;
    padding:12px 20px; display:flex; justify-content:space-between; align-items:center;
    max-width:840px; margin:0 auto 16px; border-radius:8px; font-size:.85rem;
  }
  .barra-imprimir button{
    background:#C98A2C; color:#231F1A; border:0; padding:9px 20px;
    border-radius:99px; font-weight:700; font-size:.85rem; cursor:pointer;
  }
  /* ---- Detalle de examen resuelto (pregunta por pregunta) ---- */
  .ex-reactivo{border:1.5px solid #E0D9CB; border-radius:8px; padding:14px 16px; margin-bottom:14px;}
  .ex-reactivo-ok{border-left:5px solid #4A5D3C;}
  .ex-reactivo-mal{border-left:5px solid #A63D2F;}
  .ex-reactivo-head{display:flex; align-items:center; gap:10px; margin-bottom:8px;}
  .ex-num{font-family:'Fraunces',Georgia,serif; font-weight:700; font-size:.85rem; color:#8A8177;}
  .ex-tipo{font-size:.62rem; text-transform:uppercase; letter-spacing:.05em; color:#8A8177; background:#F0EADC; padding:2px 8px; border-radius:99px;}
  .ex-resultado{margin-left:auto; font-size:.72rem; font-weight:700;}
  .ex-reactivo-ok .ex-resultado{color:#4A5D3C;}
  .ex-reactivo-mal .ex-resultado{color:#A63D2F;}
  .ex-pregunta{font-size:.85rem; font-weight:600; margin:0 0 8px;}
  .ex-opciones{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:5px;}
  .ex-opciones li{font-size:.78rem; padding:6px 10px; border-radius:6px; border:1px solid #E0D9CB;}
  .ex-opcion-correcta{border-color:#4A5D3C !important; background:rgba(74,93,60,.10);}
  .ex-opcion-elegida-ok{border-color:#4A5D3C !important; background:rgba(74,93,60,.18); font-weight:700;}
  .ex-opcion-elegida-mal{border-color:#A63D2F !important; background:rgba(166,61,47,.10); font-weight:700;}
  .ex-explicacion{font-size:.74rem; color:#5C544A; margin:8px 0 0; padding-top:8px; border-top:1px dashed #E0D9CB;}
  .ex-tabla-relacionar{margin-top:4px;}
  .ex-tabla-relacionar th, .ex-tabla-relacionar td{font-size:.72rem;}
  .ex-ok{color:#4A5D3C; font-weight:700;}
  .ex-mal{color:#A63D2F; font-weight:700;}
  .ex-sin-entregar{padding:14px 16px; border:1.5px dashed #E0D9CB; border-radius:8px; color:#8A8177; font-size:.8rem; text-align:center; margin-bottom:14px;}
  @media print{
    body{background:#fff; padding:0;}
    .hoja{box-shadow:none; margin:0; padding:0; max-width:none;}
    .barra-imprimir{display:none;}
    .salto{page-break-before:always;}
  }
`;

function encabezado(logoDataUrl) {
  return `<div class="encabezado">
    <img src="${logoDataUrl || ESCUELA.logo}" alt="Escudo institucional">
    <div class="enc-texto">
      <p class="escuela">${esc(ESCUELA.nombre)}</p>
      <p class="carrera">${esc(ESCUELA.carrera)}</p>
      <p class="asignatura">${esc(ESCUELA.asignatura)}</p>
    </div>
    <div class="enc-sello">Aula Virtual<br>LudoMente<br>Studio</div>
  </div>`;
}

const FIRMAS = `<div class="firmas">
    <div class="firma"><div class="firma-linea"></div>
      <div class="firma-nombre">${esc(ESCUELA.docente)}</div>
      <div class="firma-cargo">Docente de la asignatura</div></div>
    <div class="firma"><div class="firma-linea"></div>
      <div class="firma-nombre">Coordinación Académica</div>
      <div class="firma-cargo">Sello y firma</div></div>
  </div>`;

function pie() {
  return `<div class="pie">
    <span>Aula Virtual · Bases Culinarias — LudoMente Studio</span>
    <span>Emitido el ${hoy()}</span>
  </div>`;
}

function abrirVentana(titulo, cuerpo) {
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>${esc(titulo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Public+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>${ESTILOS}</style></head><body>
<div class="barra-imprimir">
  <span>Revisa el reporte y usa el botón para imprimirlo o guardarlo como PDF.</span>
  <button onclick="window.print()">Imprimir / Guardar PDF</button>
</div>
${cuerpo}
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) {
    alert('Tu navegador bloqueó la ventana emergente. Permite las ventanas emergentes para este sitio e intenta de nuevo.');
    return;
  }
  w.document.write(html);
  w.document.close();
}

// Convierte el escudo a data URL para que se vea aunque la ventana nueva no
// tenga la misma ruta base.
async function logoComoDataUrl() {
  try {
    const res = await fetch(ESCUELA.logo);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise(r => {
      const fr = new FileReader();
      fr.onload = () => r(fr.result);
      fr.onerror = () => r(null);
      fr.readAsDataURL(blob);
    });
  } catch { return null; }
}

// ---------- REPORTE POR GRUPO ----------
export async function reporteGrupo({ nombreGrupo, alumnos, bloques }) {
  const logo = await logoComoDataUrl();
  let secciones = '';

  bloques.forEach((b, i) => {
    let filas = '';
    const acum = { p: 0, e: 0, pr: 0, a: 0, f: 0, ex: 0, t: 0 };

    alumnos.forEach(({ alumno, datos }) => {
      const r = calcularBloque(b, datos);
      const calif = r.total / 10;
      filas += `<tr>
        <td class="alumno">${esc(alumno.nombre)}</td>
        <td class="num">${r.participacion.pts}</td>
        <td class="num">${r.ensayos.pts.toFixed(1)}</td>
        <td class="num">${r.practicas.pts.toFixed(1)}</td>
        <td class="num">${r.asistencia.pts.toFixed(2)}</td>
        <td class="num">${r.asistencia.conteo.falta}</td>
        <td class="num">${r.examen.pts.toFixed(1)}</td>
        <td class="num total-col">${r.total.toFixed(1)}</td>
        <td class="num">${badge(calif)}</td>
      </tr>`;
      acum.p += r.participacion.pts; acum.e += r.ensayos.pts;
      acum.pr += r.practicas.pts;    acum.a += r.asistencia.pts;
      acum.f += r.asistencia.conteo.falta; acum.ex += r.examen.pts;
      acum.t += r.total;
    });

    const k = Math.max(1, alumnos.length);
    filas += `<tr class="fila-total">
      <td>Promedio del grupo (${alumnos.length} alumno${alumnos.length !== 1 ? 's' : ''})</td>
      <td class="num">${(acum.p / k).toFixed(1)}</td>
      <td class="num">${(acum.e / k).toFixed(1)}</td>
      <td class="num">${(acum.pr / k).toFixed(1)}</td>
      <td class="num">${(acum.a / k).toFixed(2)}</td>
      <td class="num">${(acum.f / k).toFixed(1)}</td>
      <td class="num">${(acum.ex / k).toFixed(1)}</td>
      <td class="num">${(acum.t / k).toFixed(1)}</td>
      <td class="num">${(acum.t / k / 10).toFixed(1)}</td>
    </tr>`;

    secciones += `
      <div class="hoja${i > 0 ? ' salto' : ''}">
        ${encabezado(logo)}
        <h1>Concentrado de calificaciones por grupo</h1>
        <p class="subtitulo">Evaluación parcial — ${esc(NOMBRES_BLOQUE[b])}</p>

        <div class="datos">
          <div class="dato"><div class="dato-etq">Grupo</div><div class="dato-val">${esc(nombreGrupo)}</div></div>
          <div class="dato"><div class="dato-etq">Docente</div><div class="dato-val">${esc(ESCUELA.docente)}</div></div>
          <div class="dato"><div class="dato-etq">Alumnos</div><div class="dato-val">${alumnos.length}</div></div>
          <div class="dato"><div class="dato-etq">Emitido</div><div class="dato-val">${hoy()}</div></div>
        </div>

        <h2>Desglose por rubro</h2>
        <table>
          <thead><tr>
            <th>Alumno</th>
            <th class="num">Particip.<br>/20</th><th class="num">Ensayos<br>/30</th>
            <th class="num">Prácticas<br>/10</th><th class="num">Asist.<br>/10</th>
            <th class="num">Faltas</th><th class="num">Examen<br>/30</th>
            <th class="num">Total<br>/100</th><th class="num">Calif.</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>

        <div class="leyenda" style="margin-top:14px;">
          <span><i class="lg" style="background:#4A5D3C"></i> 8.0 o más</span>
          <span><i class="lg" style="background:#C9A22C"></i> Entre 6.0 y 7.9 — en riesgo</span>
          <span><i class="lg" style="background:#A63D2F"></i> Menor a 6.0 — reprobado</span>
        </div>

        ${FIRMAS}
        ${pie()}
      </div>`;
  });

  abrirVentana(`Reporte de grupo — ${nombreGrupo}`, secciones);
}

// ---------- REPORTE POR ALUMNO ----------
export async function reporteAlumno({ nombreGrupo, alumno, datos }) {
  const logo = await logoComoDataUrl();
  const bloques = [1, 2, 3].map(b => calcularBloque(b, datos));

  const sinDato = '<td class="num">—</td>';
  const filasBloque = bloques.map(r => {
    const vacio = r.total === 0;
    if (vacio) {
      return `<tr><td class="alumno">Bloque ${r.bloque}</td>
        ${sinDato.repeat(6)}<td class="num">—</td></tr>`;
    }
    return `<tr>
      <td class="alumno">Bloque ${r.bloque}</td>
      <td class="num">${r.participacion.pts}</td>
      <td class="num">${r.ensayos.pts.toFixed(1)}</td>
      <td class="num">${r.practicas.pts.toFixed(1)}</td>
      <td class="num">${r.asistencia.pts.toFixed(2)}</td>
      <td class="num">${r.examen.pts.toFixed(1)}</td>
      <td class="num total-col">${r.total.toFixed(1)}</td>
      <td class="num">${badge(r.total / 10)}</td>
    </tr>`;
  }).join('');

  // Asistencia por bloque
  const ETIQ = { presente: 'Presente', justificado: 'Justificado', retardo: 'Retardo', falta: 'Falta' };
  let asistenciaHTML = '';
  bloques.forEach(r => {
    const dias = (datos.asistencias || [])
      .filter(a => Number(a.bloque) === r.bloque)
      .sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
    if (dias.length === 0) return;

    const c = r.asistencia.conteo;
    const resumen = [
      c.presente ? `${c.presente} asistencia${c.presente !== 1 ? 's' : ''}` : null,
      c.justificado ? `${c.justificado} justificada${c.justificado !== 1 ? 's' : ''}` : null,
      c.retardo ? `${c.retardo} retardo${c.retardo !== 1 ? 's' : ''}` : null,
      c.falta ? `${c.falta} falta${c.falta !== 1 ? 's' : ''}` : null,
    ].filter(Boolean).join(' · ');

    asistenciaHTML += `
      <p style="font-size:.74rem; margin:14px 0 2px;"><strong>Bloque ${r.bloque}: ${resumen}</strong> — ${r.asistencia.pts.toFixed(2)} / 10 pts</p>
      <div class="asis-grid">
        ${dias.map(a => {
          const estado = a.estado || 'presente';
          const f = (a.fecha || '').split('-');
          const dia = f.length === 3 ? `${f[2]}/${f[1]}` : (a.fecha || '?');
          return `<div class="asis-dia a-${estado}" title="${esc(a.fecha)} — ${ETIQ[estado] || estado}">${dia}</div>`;
        }).join('')}
      </div>`;
  });

  // Bitácoras de ensayo
  let ensayosHTML = '';
  bloques.forEach(r => {
    const semanas = SEMANAS_DE_BLOQUE[r.bloque];
    const filas = semanas.map(n => {
      const d = (datos.ensayos || {})[String(n)] || {};
      const tiene = d.calificacion !== null && d.calificacion !== undefined && d.calificacion !== '';
      return `<tr>
        <td class="num">${n}</td>
        <td>${esc(TEMAS_SEMANA[n] || '')}</td>
        <td class="num">${d.entregado ? 'Sí' : 'No'}</td>
        <td class="num">${tiene ? Number(d.calificacion).toFixed(1) : '0.0'}</td>
      </tr>`;
    }).join('');
    ensayosHTML += `
      <h2>Bitácoras de ensayo — Bloque ${r.bloque}</h2>
      <table>
        <thead><tr><th class="num">Semana</th><th>Tema</th><th class="num">Entregada</th><th class="num">Puntos /6</th></tr></thead>
        <tbody>${filas}
          <tr class="fila-total"><td colspan="3">Subtotal Bloque ${r.bloque}</td>
          <td class="num">${r.ensayos.pts.toFixed(1)} / 30</td></tr>
        </tbody>
      </table>`;
  });

  const cursados = bloques.filter(r => r.total > 0).length;

  const cuerpo = `
    <div class="hoja">
      ${encabezado(logo)}
      <h1>Reporte individual de evaluación</h1>
      <p class="subtitulo">${esc(alumno.nombre)}</p>

      <div class="datos">
        <div class="dato"><div class="dato-etq">Grupo</div><div class="dato-val">${esc(nombreGrupo)}</div></div>
        <div class="dato"><div class="dato-etq">Docente</div><div class="dato-val">${esc(ESCUELA.docente)}</div></div>
        <div class="dato"><div class="dato-etq">Bloques con registro</div><div class="dato-val">${cursados} de 3</div></div>
        <div class="dato"><div class="dato-etq">Emitido</div><div class="dato-val">${hoy()}</div></div>
      </div>

      <h2>Concentrado por bloque</h2>
      <table>
        <thead><tr>
          <th>Bloque</th>
          <th class="num">Particip.<br>/20</th><th class="num">Ensayos<br>/30</th>
          <th class="num">Prácticas<br>/10</th><th class="num">Asist.<br>/10</th>
          <th class="num">Examen<br>/30</th><th class="num">Total<br>/100</th><th class="num">Calif.</th>
        </tr></thead>
        <tbody>${filasBloque}</tbody>
      </table>

      ${asistenciaHTML ? `
        <h2>Detalle de asistencia</h2>
        <div class="leyenda">
          <span><i class="lg a-presente"></i> Presente (0.5)</span>
          <span><i class="lg a-justificado"></i> Justificado (0.5)</span>
          <span><i class="lg a-retardo"></i> Retardo (0.25)</span>
          <span><i class="lg a-falta"></i> Falta (0)</span>
        </div>
        ${asistenciaHTML}` : ''}

      ${ensayosHTML}

      ${FIRMAS}
      ${pie()}
    </div>`;

  abrirVentana(`Reporte — ${alumno.nombre}`, cuerpo);
}

// ---------- DETALLE DE UN REACTIVO RESUELTO (usado por el examen en PDF) ----------
// Reconstruye exactamente lo que el alumno vio (mismo orden de opciones, vía
// la semilla guardada en su intento) y marca su respuesta contra la correcta.
function detalleReactivoHTML(r, numero, intento) {
  const g = intento.respuestas ? intento.respuestas[r.id] : undefined;
  const semilla = semillaDe(r.id + intento.semilla);
  let cuerpo = '';
  let correcto;

  if (r.tipo === 'relacionar') {
    correcto = r.pares.every((_, i) => g && g[i] === i);
    const derechas = barajarConSemilla(r.pares.map((p, i) => ({ t: p.derecha, i })), semilla);
    cuerpo = `<table class="ex-tabla-relacionar">
      <thead><tr><th>Columna</th><th>Respuesta del alumno</th><th>Respuesta correcta</th></tr></thead>
      <tbody>${r.pares.map((p, i) => {
        const elegidoIdx = g ? g[i] : undefined;
        const elegido = elegidoIdx !== undefined ? (derechas.find(d => d.i === elegidoIdx)?.t ?? '—') : '— sin responder —';
        const ok = elegidoIdx === i;
        return `<tr>
          <td>${esc(p.izquierda)}</td>
          <td class="${ok ? 'ex-ok' : 'ex-mal'}">${esc(elegido)}</td>
          <td>${esc(p.derecha)}</td>
        </tr>`;
      }).join('')}</tbody></table>`;

  } else if (r.tipo === 'ordenar') {
    correcto = r.pasos.every((_, i) => g && g[i] === i);
    cuerpo = `<table class="ex-tabla-relacionar">
      <thead><tr><th>Paso</th><th>Orden del alumno</th><th>Orden correcto</th></tr></thead>
      <tbody>${r.pasos.map((p, i) => {
        const elegido = g ? g[i] : undefined;
        const ok = elegido === i;
        return `<tr>
          <td>${esc(p)}</td>
          <td class="${ok ? 'ex-ok' : 'ex-mal'}">${elegido !== undefined ? (elegido + 1) : '— sin responder —'}</td>
          <td>${i + 1}</td>
        </tr>`;
      }).join('')}</tbody></table>`;

  } else {
    // opcion_multiple y completar comparten formato
    correcto = g === r.correcta;
    const ops = barajarConSemilla(r.opciones.map((o, i) => ({ t: o, i })), semilla);
    cuerpo = `<ul class="ex-opciones">${ops.map(o => {
      const esElegida = g === o.i;
      const esCorrecta = o.i === r.correcta;
      let clase = '';
      if (esCorrecta) clase = 'ex-opcion-correcta';
      if (esElegida && !esCorrecta) clase = 'ex-opcion-elegida-mal';
      if (esElegida && esCorrecta) clase = 'ex-opcion-elegida-ok';
      return `<li class="${clase}">${esc(o.t)}${esElegida ? ' <strong>(elegida por el alumno)</strong>' : ''}${esCorrecta ? ' ✓ correcta' : ''}</li>`;
    }).join('')}</ul>`;
    if (g === undefined || g === null) {
      cuerpo = `<p class="ex-mal" style="font-size:.78rem;">— El alumno no contestó esta pregunta —</p>` + cuerpo;
    }
  }

  return `<div class="ex-reactivo ${correcto ? 'ex-reactivo-ok' : 'ex-reactivo-mal'}">
    <div class="ex-reactivo-head">
      <span class="ex-num">${numero}</span>
      <span class="ex-tipo">${ETIQUETA_TIPO_REACTIVO[r.tipo] || ''}</span>
      <span class="ex-resultado">${correcto ? '✓ Correcta' : '✗ Incorrecta'}</span>
    </div>
    <p class="ex-pregunta">${esc(r.pregunta)}</p>
    ${cuerpo}
    ${r.explicacion ? `<p class="ex-explicacion"><strong>Explicación:</strong> ${esc(r.explicacion)}</p>` : ''}
  </div>`;
}

// Construye el bloque de "hoja" con el examen completo de un alumno —
// reutilizado tanto por el reporte individual como por el reporte grupal.
function hojaExamenAlumno({ logo, nombreGrupo, alumno, bloque, intento, banco, conSalto }) {
  if (!intento || intento.estado !== 'entregado') {
    return `<div class="hoja${conSalto ? ' salto' : ''}">
      ${encabezado(logo)}
      <h1>Examen resuelto — Bloque ${bloque}</h1>
      <p class="subtitulo">${esc(alumno.nombre)}</p>
      <div class="ex-sin-entregar">Este alumno todavía no ha entregado el examen del Bloque ${bloque}.</div>
      ${pie()}
    </div>`;
  }

  const reactivos = (intento.ids || [])
    .map(id => (banco.reactivos || []).find(r => r.id === id))
    .filter(Boolean);

  const detalleHTML = reactivos.map((r, i) => detalleReactivoHTML(r, i + 1, intento)).join('');

  return `<div class="hoja${conSalto ? ' salto' : ''}">
    ${encabezado(logo)}
    <h1>Examen resuelto — Bloque ${bloque}</h1>
    <p class="subtitulo">${esc(alumno.nombre)}</p>

    <div class="datos">
      <div class="dato"><div class="dato-etq">Grupo</div><div class="dato-val">${esc(nombreGrupo)}</div></div>
      <div class="dato"><div class="dato-etq">Calificación</div><div class="dato-val">${Number(intento.calificacion ?? 0).toFixed(1)} / 10</div></div>
      <div class="dato"><div class="dato-etq">Aciertos</div><div class="dato-val">${intento.aciertos ?? 0} / ${intento.total ?? reactivos.length}</div></div>
      <div class="dato"><div class="dato-etq">Emitido</div><div class="dato-val">${hoy()}</div></div>
    </div>

    <h2>Detalle de respuestas</h2>
    ${detalleHTML || '<p class="empty-inline">No se encontraron los reactivos de este intento en el banco actual.</p>'}

    ${FIRMAS}
    ${pie()}
  </div>`;
}

// ---------- EXAMEN RESUELTO — UN ALUMNO ----------
export async function reporteExamenAlumno({ nombreGrupo, alumno, bloque, intento, banco }) {
  const logo = await logoComoDataUrl();
  const cuerpo = hojaExamenAlumno({ logo, nombreGrupo, alumno, bloque, intento, banco, conSalto: false });
  abrirVentana(`Examen — ${alumno.nombre} — Bloque ${bloque}`, cuerpo);
}

// ---------- EXAMEN RESUELTO — TODO EL GRUPO ----------
// entregas: [{ alumno, intento }] — uno por cada alumno del grupo (aunque no
// haya entregado, se incluye para dejar constancia de que no presentó).
export async function reporteExamenGrupo({ nombreGrupo, bloque, entregas, banco }) {
  const logo = await logoComoDataUrl();
  const secciones = entregas.map(({ alumno, intento }, i) =>
    hojaExamenAlumno({ logo, nombreGrupo, alumno, bloque, intento, banco, conSalto: i > 0 })
  ).join('');
  abrirVentana(`Exámenes — Bloque ${bloque} — ${nombreGrupo}`, secciones);
}
