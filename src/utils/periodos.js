// Cálculo de períodos para el dashboard: el período pedido, el anterior y los 6 últimos
// (para tendencias). Todo se maneja como días de calendario "YYYY-MM-DD" en UTC, porque así
// se guarda la fecha de cada gasto (medianoche UTC).
const DIA = 86400000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function aMs(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function aISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function diasDelMes(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12
}

// "Hoy" según la zona horaria del negocio (no la del servidor, que suele ser UTC y de noche
// ya está en el día siguiente).
function hoyEnZona(zona = process.env.TZ_NEGOCIO || 'America/Santiago', ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(ahora);
}

// Devuelve:
//   actual / anterior: { desde, hasta } (ISO, inclusivos)
//   serie: 6 períodos consecutivos, del más antiguo al actual (serie[5] === actual)
//   enCurso, dias (días transcurridos del período actual), diasMes (solo en modo mes)
// Si el período está en curso, TODOS se recortan a la misma cantidad de días, para que la
// comparación sea justa (1–14 de octubre contra 1–14 de septiembre, no contra septiembre completo).
function rangosPeriodo({ mes, desde, hasta } = {}, hoyISO) {
  const hoy = aMs(hoyISO);

  if (desde || hasta) {
    const d0 = desde && ISO_RE.test(desde) ? desde : hasta && ISO_RE.test(hasta) ? hasta : null;
    if (!d0) throw new Error('Rango de fechas inválido');
    const h0 = hasta && ISO_RE.test(hasta) ? hasta : d0;
    let ini = aMs(d0);
    let fin = aMs(h0);
    if (fin < ini) [ini, fin] = [fin, ini];
    const largo = Math.round((fin - ini) / DIA) + 1;
    const enCurso = hoy >= ini && hoy <= fin;
    const dias = enCurso ? Math.round((hoy - ini) / DIA) + 1 : largo;
    const serie = [];
    for (let i = 5; i >= 0; i -= 1) {
      const desdeI = ini - i * largo * DIA;
      serie.push({ desde: aISO(desdeI), hasta: aISO(desdeI + (dias - 1) * DIA) });
    }
    return { tipo: 'rango', enCurso, dias, diasMes: null, actual: serie[5], anterior: serie[4], serie };
  }

  const mesUsar = mes && MES_RE.test(mes) ? mes : hoyISO.slice(0, 7);
  const [y, m] = mesUsar.split('-').map(Number);
  const diasMes = diasDelMes(y, m);
  const primero = Date.UTC(y, m - 1, 1);
  const ultimo = Date.UTC(y, m - 1, diasMes);
  const enCurso = hoy >= primero && hoy <= ultimo;
  const dias = enCurso ? Math.round((hoy - primero) / DIA) + 1 : diasMes;

  const serie = [];
  for (let i = 5; i >= 0; i -= 1) {
    const dt = new Date(Date.UTC(y, m - 1 - i, 1));
    const yy = dt.getUTCFullYear();
    const mm = dt.getUTCMonth() + 1;
    const dm = diasDelMes(yy, mm);
    const tope = enCurso ? Math.min(dias, dm) : dm;
    serie.push({ desde: aISO(Date.UTC(yy, mm - 1, 1)), hasta: aISO(Date.UTC(yy, mm - 1, tope)) });
  }
  return { tipo: 'mes', mes: mesUsar, enCurso, dias, diasMes, actual: serie[5], anterior: serie[4], serie };
}

// Lista de días ISO entre dos fechas, ambas incluidas.
function listarDias(desde, hasta) {
  const out = [];
  for (let t = aMs(desde); t <= aMs(hasta); t += DIA) out.push(aISO(t));
  return out;
}

function restarDias(iso, n) {
  return aISO(aMs(iso) - n * DIA);
}

function diasEntre(desdeISO, hastaISO) {
  return Math.round((aMs(hastaISO) - aMs(desdeISO)) / DIA);
}

module.exports = { rangosPeriodo, hoyEnZona, listarDias, restarDias, diasEntre, aMs, aISO };
