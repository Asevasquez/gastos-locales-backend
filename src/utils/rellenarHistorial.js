const Gasto = require('../models/Gasto');
const Local = require('../models/Local');
const Usuario = require('../models/Usuario');
const HistorialGasto = require('../models/HistorialGasto');
const { construirEvento } = require('./historialGastos');

// Crea el evento "CREADO" de los gastos que existían antes de que hubiera historial (o a los que
// les falte), usando la fecha en que se subieron. Es seguro correrlo varias veces: nunca duplica.
//   soloSiVacio: true  -> al iniciar el servidor, solo actúa la primera vez (historial vacío).
//   soloSiVacio: false -> repara cualquier gasto que no tenga su evento (script manual).
async function rellenarHistorial({ soloSiVacio = false } = {}) {
  if (soloSiVacio && (await HistorialGasto.estimatedDocumentCount()) > 0) {
    return { omitido: true, creados: 0 };
  }

  const [gastos, locales, usuarios, registrados] = await Promise.all([
    Gasto.find({}).lean(),
    Local.find({}).select('nombre').lean(),
    Usuario.find({}).select('nombre rol').lean(),
    HistorialGasto.find({ accion: 'CREADO' }).select('gastoId').lean()
  ]);

  const nombreLocal = new Map(locales.map((l) => [String(l._id), l.nombre]));
  const usuarioPorId = new Map(usuarios.map((u) => [String(u._id), u]));
  const yaRegistrados = new Set(registrados.map((e) => String(e.gastoId)));

  const eventos = gastos
    .filter((g) => !yaRegistrados.has(String(g._id)))
    .map((g) => {
      const quien = usuarioPorId.get(String(g.usuario)) || { _id: g.usuario };
      return construirEvento({
        accion: 'CREADO',
        gasto: g,
        localNombre: nombreLocal.get(String(g.local)),
        subidoPor: quien,
        realizadoPor: quien,
        fechaEvento: g.createdAt || g.fecha
      });
    });

  if (eventos.length > 0) await HistorialGasto.insertMany(eventos, { ordered: false });
  return { omitido: false, creados: eventos.length };
}

module.exports = rellenarHistorial;
