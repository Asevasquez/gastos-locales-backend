const mongoose = require('mongoose');

const localSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true },
    marca: {
      type: String,
      enum: ['KAMI_SUSHI', 'LATIN_PIZZA', 'KELVER'],
      required: true
    },
    direccion: { type: String, trim: true },
    // Igual que en Kami Cotización: código opcional, único solo cuando está presente.
    codigoExterno: { type: String, trim: true },
    activo: { type: Boolean, default: true }
  },
  { timestamps: true }
);

localSchema.index({ codigoExterno: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Local', localSchema);
