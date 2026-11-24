// Asigna número de documento (correlativo) a los gastos que no lo tengan, del más antiguo al más nuevo.
// Es seguro correrlo varias veces (no toca lo que ya tiene número).  Uso:  npm run documentos:numerar
require('dotenv').config();
const mongoose = require('mongoose');
const { numerarGastosExistentes } = require('../utils/correlativo');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const { numerados, documentos } = await numerarGastosExistentes();
    console.log(`Listo: ${numerados} gasto(s) numerados en ${documentos} documento(s).`);
  } catch (err) {
    console.error('No se pudo numerar:', err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
