const router = require('express').Router();
const Gasto = require('../models/Gasto');
const Local = require('../models/Local');
const auth = require('../middleware/auth');
const { resolverFiltroLocal } = require('../utils/filtroLocal');

router.use(auth);

function mesActual() {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
}

// Arma el filtro base compartido por los tres endpoints: local (según permisos),
// y mes O rango desde/hasta (para poder ver una semana puntual en vez del mes completo).
function filtroBase(usuario, query) {
  const filtroLocal = resolverFiltroLocal(usuario, query);
  const filtro = {};
  if (filtroLocal !== null) filtro.local = filtroLocal;

  if (query.desde || query.hasta) {
    filtro.fecha = {};
    if (query.desde) filtro.fecha.$gte = new Date(query.desde);
    if (query.hasta) filtro.fecha.$lte = new Date(query.hasta);
  } else {
    filtro.mes = query.mes || mesActual();
  }

  return filtro;
}

// GET /api/gastos/estadisticas/resumen?mes=2026-09&local=...&locales=id1,id2
// (o ?desde=...&hasta=... en vez de mes, para una semana puntual)
router.get('/resumen', async (req, res) => {
  const filtro = filtroBase(req.usuario, req.query);

  const [totales, porCategoria, localesConGasto] = await Promise.all([
    Gasto.aggregate([
      { $match: filtro },
      { $group: { _id: null, totalGastado: { $sum: '$monto' }, totalGastos: { $sum: 1 } } }
    ]),
    Gasto.aggregate([
      { $match: filtro },
      { $group: { _id: '$categoria', total: { $sum: '$monto' } } },
      { $sort: { total: -1 } }
    ]),
    Gasto.distinct('local', filtro)
  ]);

  const filtroLocal = resolverFiltroLocal(req.usuario, req.query);
  const localesFiltro = { activo: true };
  if (filtroLocal !== null) localesFiltro._id = filtroLocal;

  const todosLosLocales = await Local.find(localesFiltro).select('nombre marca');
  const localesSinRegistro = todosLosLocales.filter(
    (l) => !localesConGasto.some((id) => id.toString() === l._id.toString())
  );

  res.json({
    mes: filtro.mes || null,
    desde: req.query.desde || null,
    hasta: req.query.hasta || null,
    totalGastado: totales[0]?.totalGastado || 0,
    totalGastos: totales[0]?.totalGastos || 0,
    porCategoria,
    localesSinRegistro
  });
});

// GET /api/gastos/estadisticas/por-cuenta-contable?mes=2026-09&local=...
// Reemplaza al viejo comparativo-kamver: ya no hay precio Bsale con qué comparar,
// esto es simplemente el gasto real agrupado por cuenta contable.
router.get('/por-cuenta-contable', async (req, res) => {
  const filtro = filtroBase(req.usuario, req.query);

  const porCuenta = await Gasto.aggregate([
    { $match: filtro },
    { $group: { _id: '$cuentaContable', total: { $sum: '$monto' }, cantidadGastos: { $sum: 1 } } },
    { $sort: { total: -1 } }
  ]);

  const totalGeneral = porCuenta.reduce((acc, c) => acc + c.total, 0);

  res.json({
    porCuentaContable: porCuenta.map((c) => ({
      cuentaContable: c._id,
      total: c.total,
      cantidadGastos: c.cantidadGastos,
      porcentaje: totalGeneral ? Math.round((c.total / totalGeneral) * 1000) / 10 : 0
    }))
  });
});

module.exports = router;
