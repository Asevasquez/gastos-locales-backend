const router = require('express').Router();
const HistorialGasto = require('../models/HistorialGasto');
const auth = require('../middleware/auth');
const { resolverFiltroLocal } = require('../utils/filtroLocal');

router.use(auth);

const ACCIONES = ['CREADO', 'ELIMINADO'];

// GET /api/historial-gastos
//   accion=CREADO,ELIMINADO   desde / hasta (fecha-hora ISO, sobre la fecha del evento)
//   local=id | locales=id1,id2   medioPago=A,B   limite (por defecto 2000, máximo 5000)
// Siempre se limita a los locales permitidos al usuario. Devuelve los eventos más recientes primero.
router.get('/', async (req, res) => {
  try {
    const { accion, desde, hasta, local, locales, medioPago, limite } = req.query;
    const filtro = {};

    if (accion) {
      filtro.accion = { $in: String(accion).split(',').filter((a) => ACCIONES.includes(a)) };
    }

    const filtroLocal = resolverFiltroLocal(req.usuario, {
      local: local ? String(local) : undefined,
      locales: locales ? String(locales) : undefined
    });
    if (filtroLocal !== null) filtro.local = filtroLocal;

    const rango = {};
    const d = desde ? new Date(desde) : null;
    const h = hasta ? new Date(hasta) : null;
    if (d && !Number.isNaN(d.getTime())) rango.$gte = d;
    if (h && !Number.isNaN(h.getTime())) rango.$lte = h;
    if (Object.keys(rango).length > 0) filtro.fechaEvento = rango;

    if (medioPago) filtro['gasto.medioPago'] = { $in: String(medioPago).split(',') };

    const tope = Math.min(Math.max(parseInt(limite, 10) || 2000, 1), 5000);
    const eventos = await HistorialGasto.find(filtro).sort({ fechaEvento: -1 }).limit(tope).lean();
    res.json(eventos);
  } catch (err) {
    console.error('Error al consultar el historial de gastos:', err);
    res.status(500).json({ error: 'No se pudo cargar el historial' });
  }
});

module.exports = router;
