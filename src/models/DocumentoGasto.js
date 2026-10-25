const mongoose = require('mongoose');

// Registro del número que se le asignó a cada documento (boleta o factura) nuevo. Existe para que el MISMO
// documento reciba SIEMPRE el MISMO número aunque llegue dos veces (doble toque, reintento, envíos simultáneos).
const documentoGastoSchema = new mongoose.Schema(
  {
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
    claveDocumento: { type: String, required: true },
    numero: { type: Number, required: true }
  },
  { timestamps: true }
);

documentoGastoSchema.index({ usuario: 1, claveDocumento: 1 }, { unique: true });

module.exports = mongoose.model('DocumentoGasto', documentoGastoSchema);
