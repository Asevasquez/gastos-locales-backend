// Repara el historial: crea el evento "CREADO" de cualquier gasto que no lo tenga.
// Es seguro correrlo varias veces (no duplica).  Uso:  npm run historial:rellenar
require('dotenv').config();
const mongoose = require('mongoose');
const rellenarHistorial = require('../utils/rellenarHistorial');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const { creados } = await rellenarHistorial({ soloSiVacio: false });
    console.log(`Listo: ${creados} gasto(s) sin registro se agregaron al historial.`);
  } catch (err) {
    console.error('No se pudo rellenar el historial:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
