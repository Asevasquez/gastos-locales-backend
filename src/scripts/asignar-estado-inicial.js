// Asigna estado (aprobado / pendiente) a los gastos que existían antes de activar la revisión.
// Es seguro correrlo varias veces (solo toca gastos sin estado).
// Uso:  npm run gastos:estado-inicial               → el mes de inicio es el mes en curso
//       npm run gastos:estado-inicial -- --desde=2026-12   → lo subido antes de ese mes queda aprobado
require('dotenv').config();
const mongoose = require('mongoose');
const { asignarEstadoInicial } = require('../utils/estadoInicial');

const arg = process.argv.find((a) => a.startsWith('--desde='));

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const r = await asignarEstadoInicial({ revisionDesde: arg ? arg.split('=')[1] : undefined });
    console.log(`Listo: ${r.aprobados} gasto(s) aprobados (anteriores a ${r.mes}) y ${r.pendientes} pendientes de revisión.`);
  } catch (err) {
    console.error('No se pudo asignar el estado:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
