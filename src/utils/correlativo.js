// Correlativo de documentos: un número por boleta o factura, que comparten todos sus productos.
// Es una sola secuencia para todo el sistema (1, 2, 3…). Los números nunca se reutilizan: si se elimina un
// gasto, su número queda sin usar; por eso puede haber saltos.
const Contador = require('../models/Contador');
const DocumentoGasto = require('../models/DocumentoGasto');
const Gasto = require('../models/Gasto');
const HistorialGasto = require('../models/HistorialGasto');

const CONTADOR = 'documento';
const TAMANO_LOTE = 500;

// Entrega el siguiente número, de forma atómica.
async function siguienteNumero() {
  const c = await Contador.findOneAndUpdate({ _id: CONTADOR }, { $inc: { valor: 1 } }, { upsert: true, new: true });
  return c.valor;
}

// Número de un documento nuevo. Si ese mismo documento (usuario + clave) ya tenía número, devuelve el mismo.
// Si dos envíos simultáneos compiten, gana uno y ambos usan su número (el del otro queda sin usar).
async function numeroDeDocumento({ usuario, claveDocumento }) {
  const existente = await DocumentoGasto.findOne({ usuario, claveDocumento });
  if (existente) return existente.numero;

  const candidato = await siguienteNumero();
  try {
    const doc = await DocumentoGasto.findOneAndUpdate(
      { usuario, claveDocumento },
      { $setOnInsert: { numero: candidato } },
      { upsert: true, new: true }
    );
    return doc.numero;
  } catch (err) {
    if (err && err.code === 11000) {
      const ganador = await DocumentoGasto.findOne({ usuario, claveDocumento });
      if (ganador) return ganador.numero;
    }
    throw err;
  }
}

// Numera los gastos que existían antes del correlativo, del más antiguo al más nuevo. Los productos que
// pertenecen a una misma boleta (mismo documentoId) reciben el mismo número; un gasto suelto es un documento.
// Es seguro correrlo varias veces: solo toca lo que no tiene número.
async function numerarGastosExistentes() {
  const pendientes = await Gasto.find({ numeroDocumento: null }).select('usuario documentoId createdAt').lean();
  if (pendientes.length === 0) return { numerados: 0, documentos: 0 };

  // El contador nunca debe quedar por debajo del mayor número ya asignado.
  const mayor = await Gasto.findOne({ numeroDocumento: { $ne: null } }).sort({ numeroDocumento: -1 }).select('numeroDocumento').lean();
  if (mayor) await Contador.updateOne({ _id: CONTADOR }, { $max: { valor: mayor.numeroDocumento } }, { upsert: true });

  const grupos = new Map();
  for (const g of pendientes) {
    const clave = g.documentoId ? `doc|${g.usuario}|${g.documentoId}` : `solo|${g._id}`;
    const grupo = grupos.get(clave) || { ids: [], desde: Infinity, ordenId: String(g._id) };
    grupo.ids.push(g._id);
    grupo.desde = Math.min(grupo.desde, new Date(g.createdAt || 0).getTime());
    grupos.set(clave, grupo);
  }
  const ordenados = [...grupos.values()].sort((a, b) => a.desde - b.desde || a.ordenId.localeCompare(b.ordenId));

  // Se reserva de una vez el bloque de números (atómico) y se asignan en orden.
  const fin = (await Contador.findOneAndUpdate({ _id: CONTADOR }, { $inc: { valor: ordenados.length } }, { upsert: true, new: true })).valor;
  const inicio = fin - ordenados.length + 1;

  for (let i = 0; i < ordenados.length; i += TAMANO_LOTE) {
    const lote = ordenados.slice(i, i + TAMANO_LOTE);
    await Gasto.bulkWrite(
      lote.map((g, j) => ({ updateMany: { filter: { _id: { $in: g.ids }, numeroDocumento: null }, update: { $set: { numeroDocumento: inicio + i + j } } } }))
    );
    // El historial guarda una copia del gasto: se le agrega el número para poder identificar también los eliminados.
    await HistorialGasto.bulkWrite(
      lote.map((g, j) => ({ updateMany: { filter: { gastoId: { $in: g.ids } }, update: { $set: { 'gasto.numeroDocumento': inicio + i + j } } } }))
    );
  }
  return { numerados: pendientes.length, documentos: ordenados.length };
}

module.exports = { siguienteNumero, numeroDeDocumento, numerarGastosExistentes, CONTADOR };
