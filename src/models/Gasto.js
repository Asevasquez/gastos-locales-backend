const mongoose = require('mongoose');

const gastoSchema = new mongoose.Schema(
  {
    local: { type: mongoose.Schema.Types.ObjectId, ref: 'Local', required: true },
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },

    productoNombre: { type: String, required: true, trim: true },
    // Requerido: el ítem debe existir en el catálogo cargado desde Excel — ya no se
    // acepta texto libre sin match, porque categoría y cuenta contable dependen de él.
    productoCatalogoId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductoCatalogo', required: true },

    // Ambos vienen del catálogo (RATIO y CUENTA CONTABLE de la planilla) — de solo
    // lectura en el formulario, nunca los edita el admin a mano.
    categoria: { type: String, required: true, trim: true },
    cuentaContable: { type: String, required: true, trim: true },

    cantidad: { type: Number, required: true, min: 0 },
    unidadMedida: { type: String, enum: ['KG', 'UN', 'LT', 'GR'], required: true },
    monto: { type: Number, required: true, min: 0 },

    medioPago: { type: String, enum: ['EFECTIVO', 'TRANSFERENCIA', 'EFECTIVO_FLUJO'], required: true },

    fecha: { type: Date, required: true },
    // "2026-09" — se deriva de `fecha` al guardar. Permite agrupar y aplicar la regla
    // de "solo editable dentro del mismo mes" sin lógica de fechas.
    mes: { type: String, required: true },

    fotoBoletaUrl: { type: String, required: true },
    motivo: { type: String, required: true, trim: true },

    editadoEn: { type: Date, default: null }
  },
  { timestamps: true }
);

gastoSchema.index({ fecha: 1 });
gastoSchema.index({ local: 1, mes: 1 });
gastoSchema.index({ mes: 1, categoria: 1 });
gastoSchema.index({ mes: 1, cuentaContable: 1 });

module.exports = mongoose.model('Gasto', gastoSchema);
