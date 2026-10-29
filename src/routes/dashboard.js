const router = require('express').Router();
const Gasto = require('../models/Gasto');
const Local = require('../models/Local');
const auth = require('../middleware/auth');
const { resolverFiltroLocal } = require('../utils/filtroLocal');
const { rangosPeriodo, hoyEnZona, restarDias } = require('../utils/periodos');
const { calcularResumen, calcularLocales, calcularControl, UMBRALES } = require('../utils/dashboardCalculos');

router.use(auth);

const CAMPOS =
  'local fecha monto cantidad unidadMedida medioPago categoria cuentaContable productoNombre productoCatalogoId motivo editadoEn fotoBoletaUrl fotosBoletaUrls';

// Parámetros (todos opcionales): mes=YYYY-MM  ó  desde=YYYY-MM-DD&hasta=YYYY-MM-DD,
// locales=id1,id2 (se intersecta SIEMPRE con los locales permitidos al usuario) y medioPago=A,B.
// Carga los gastos de los 6 períodos de una sola vez (el actual, el anterior y 4 más para tendencias).
async function cargarContexto(req) {
  const { mes, desde, hasta, local, locales, medioPago } = req.query;
  const hoyISO = hoyEnZona();
  const periodo = rangosPeriodo({ mes, desde, hasta }, hoyISO);
  const filtroLocal = resolverFiltroLocal(req.usuario, {
    local: local ? String(local) : undefined,
    locales: locales ? String(locales) : undefined
  });

  const filtroLocales = {};
  if (filtroLocal !== null) filtroLocales._id = filtroLocal;
  const docsLocales = await Local.find(filtroLocales).select('nombre marca codigoExterno activo').lean();

  const filtro = {
    $or: periodo.serie.map((r) => ({ fecha: { $gte: new Date(r.desde), $lte: new Date(r.hasta) } }))
  };
  if (filtroLocal !== null) filtro.local = filtroLocal;
  if (medioPago) filtro.medioPago = { $in: String(medioPago).split(',') };

  const gastos = await Gasto.find(filtro).select(CAMPOS).lean();
  return { hoyISO, periodo, filtroLocal, locales: docsLocales, gastos };
}

function infoPeriodo(contexto) {
  const { periodo, hoyISO } = contexto;
  return {
    tipo: periodo.tipo,
    mes: periodo.mes || null,
    enCurso: periodo.enCurso,
    dias: periodo.dias,
    diasMes: periodo.diasMes,
    actual: periodo.actual,
    anterior: periodo.anterior,
    serie: periodo.serie,
    hoy: hoyISO
  };
}

function manejarError(res, err) {
  if (err && err.message === 'Rango de fechas inválido') {
    return res.status(400).json({ error: err.message });
  }
  console.error('Error en dashboard:', err);
  return res.status(500).json({ error: 'No se pudieron calcular las estadísticas' });
}

// GET /api/dashboard/resumen
router.get('/resumen', async (req, res) => {
  try {
    const ctx = await cargarContexto(req);
    res.json({ periodo: infoPeriodo(ctx), ...calcularResumen(ctx) });
  } catch (err) {
    manejarError(res, err);
  }
});

// GET /api/dashboard/locales
router.get('/locales', async (req, res) => {
  try {
    const ctx = await cargarContexto(req);
    const ultimas = await Gasto.aggregate([
      { $match: ctx.filtroLocal !== null ? { local: ctx.filtroLocal } : {} },
      { $group: { _id: '$local', ultima: { $max: '$fecha' } } }
    ]);
    const ultimaPorLocal = {};
    for (const u of ultimas) ultimaPorLocal[String(u._id)] = u.ultima.toISOString().slice(0, 10);
    res.json({ periodo: infoPeriodo(ctx), ...calcularLocales({ ...ctx, ultimaPorLocal }) });
  } catch (err) {
    manejarError(res, err);
  }
});

// GET /api/dashboard/control
router.get('/control', async (req, res) => {
  try {
    const ctx = await cargarContexto(req);
    const matchLocal = ctx.filtroLocal !== null ? { local: ctx.filtroLocal } : {};

    const ultimas = await Gasto.aggregate([
      { $match: matchLocal },
      { $group: { _id: '$local', ultima: { $max: '$fecha' } } }
    ]);
    const ultimaPorLocal = {};
    for (const u of ultimas) ultimaPorLocal[String(u._id)] = u.ultima.toISOString().slice(0, 10);

    // promedio histórico por ítem (últimos 90 días hasta el fin del período), para detectar montos atípicos
    const desdeHistorial = new Date(restarDias(ctx.periodo.actual.hasta, UMBRALES.historialDias));
    const promedios = await Gasto.aggregate([
      { $match: { ...matchLocal, fecha: { $gte: desdeHistorial, $lte: new Date(ctx.periodo.actual.hasta) } } },
      { $group: { _id: '$productoCatalogoId', promedio: { $avg: '$monto' }, n: { $sum: 1 } } }
    ]);
    const promediosItem = {};
    for (const p of promedios) promediosItem[String(p._id)] = { promedio: p.promedio, n: p.n };

    res.json({
      periodo: infoPeriodo(ctx),
      ...calcularControl({ ...ctx, ultimaPorLocal, promediosItem })
    });
  } catch (err) {
    manejarError(res, err);
  }
});

module.exports = router;
