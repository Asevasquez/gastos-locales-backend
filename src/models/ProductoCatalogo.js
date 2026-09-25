const mongoose = require('mongoose');

// Catálogo de ítems de gasto, cargado desde la planilla Excel (ITEM, DETALLE, RATIO,
// CUENTA CONTABLE) por un MASTER desde el dashboard — ya no se sincroniza con Bsale.
// El autocompletado del formulario de gastos consulta esta colección.
const productoCatalogoSchema = new mongoose.Schema(
  {
    item: { type: String, required: true, trim: true, unique: true },
    detalle: { type: String, trim: true },
    ratio: { type: String, required: true, trim: true },
    cuentaContable: { type: String, required: true, trim: true },
    activo: { type: Boolean, default: true },
    ultimaActualizacion: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

productoCatalogoSchema.index({ item: 'text' });

module.exports = mongoose.model('ProductoCatalogo', productoCatalogoSchema);
