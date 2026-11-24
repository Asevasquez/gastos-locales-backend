// Al activar la revisión, los gastos que ya existían no tienen estado. Se les asigna uno una sola vez:
//   - subidos ANTES del mes de inicio de la revisión → APROBADO (ya están cerrados; sin revisor);
//   - subidos desde ese mes (por defecto, el mes en curso) → PENDIENTE, para que se revisen.
// El mes de inicio se puede cambiar con la variable REVISION_DESDE (AAAA-MM): por ejemplo, un mes futuro deja TODO lo
// existente como aprobado. Solo toca gastos sin estado, así que es seguro correrlo varias veces.
const Gasto = require('../models/Gasto');
const { hoyEnZona } = require('./periodos');
const { inicioDeMes } = require('./revisionGastos');

async function asignarEstadoInicial({ revisionDesde } = {}) {
  const mes = revisionDesde || process.env.REVISION_DESDE || hoyEnZona().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error('REVISION_DESDE debe tener el formato AAAA-MM (por ejemplo 2026-12)');
  const inicio = inicioDeMes(mes);
  const sinEstado = { estado: { $exists: false } };

  const antiguos = await Gasto.updateMany(
    { ...sinEstado, $or: [{ createdAt: { $lt: inicio } }, { createdAt: { $exists: false } }] },
    { $set: { estado: 'APROBADO' } }
  );
  const recientes = await Gasto.updateMany(sinEstado, { $set: { estado: 'PENDIENTE' } });
  return { mes, aprobados: antiguos.modifiedCount || 0, pendientes: recientes.modifiedCount || 0 };
}

module.exports = { asignarEstadoInicial };
