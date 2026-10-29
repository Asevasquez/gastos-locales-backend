const mongoose = require('mongoose');

// Registro de auditoría: cada vez que se SUBE o se ELIMINA un gasto se guarda un evento aquí.
// Guarda una copia (snapshot) del gasto, porque cuando se elimina el gasto original ya no existe;
// por lo mismo también se guardan los nombres (local, usuarios) tal como estaban en ese momento.
const { ObjectId } = mongoose.Schema.Types;

const historialGastoSchema = new mongoose.Schema({
  accion: { type: String, enum: ['CREADO', 'ELIMINADO'], required: true },
  fechaEvento: { type: Date, default: Date.now, required: true },

  gastoId: { type: ObjectId, required: true }, // el gasto puede ya no existir
  local: { type: ObjectId, ref: 'Local', required: true },
  localNombre: { type: String, default: null },

  // Quién realizó la acción (subir o eliminar)
  realizadoPor: {
    _id: false,
    usuario: { type: ObjectId, ref: 'Usuario', default: null },
    nombre: { type: String, default: null },
    rol: { type: String, default: null }
  },

  // Solo en ELIMINADO
  motivoEliminacion: { type: String, default: null },

  gasto: {
    _id: false,
    productoNombre: String,
    productoCatalogoId: ObjectId,
    categoria: String,
    cuentaContable: String,
    cantidad: Number,
    unidadMedida: String,
    monto: Number,
    medioPago: String,
    fecha: Date,
    mes: String,
    motivo: String,
    fotoBoletaUrl: String,
    fotosBoletaUrls: { type: [String], default: [] },
    folio: { type: String, default: null },
    numeroDocumento: { type: Number, default: null },
    documentoId: { type: String, default: null },
    subidoPor: {
      _id: false,
      usuario: { type: ObjectId, default: null },
      nombre: { type: String, default: null }
    },
    subidoEn: { type: Date, default: null }
  }
});

historialGastoSchema.index({ fechaEvento: -1 });
historialGastoSchema.index({ local: 1, fechaEvento: -1 });
historialGastoSchema.index({ gastoId: 1, accion: 1 });

module.exports = mongoose.model('HistorialGasto', historialGastoSchema);
