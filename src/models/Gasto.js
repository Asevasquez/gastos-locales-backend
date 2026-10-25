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

    editadoEn: { type: Date, default: null },

    // Clave que genera la app al crear el gasto. Si la misma clave llega dos veces (doble toque,
    // reintento de la cola offline, respuesta perdida por un timeout), el servidor devuelve el gasto
    // ya creado en vez de duplicarlo. Es única por usuario; los gastos antiguos no la tienen.
    claveUnica: { type: String, trim: true },

    // Documento (boleta o factura) al que pertenece este gasto. Un documento puede tener varios
    // productos: cada producto es un gasto, y todos comparten folio, foto y `documentoId`.
    // Los gastos antiguos (de un solo producto) no los tienen.
    folio: { type: String, trim: true, default: null }, // tal como lo escribió el usuario
    folioClave: { type: String, default: null }, // forma normalizada, para detectar folios repetidos
    documentoId: { type: String, default: null }, // identifica al documento (lo genera la app)

    // Correlativo del documento: un número por boleta o factura, compartido por todos sus productos. Es una
    // sola secuencia para todo el sistema y no se reutiliza (si se elimina un gasto, su número queda sin usar).
    numeroDocumento: { type: Number, default: null }
  },
  { timestamps: true }
);

gastoSchema.index({ fecha: 1 });
gastoSchema.index({ usuario: 1, claveUnica: 1 }, { unique: true, partialFilterExpression: { claveUnica: { $type: 'string' } } });
gastoSchema.index({ local: 1, mes: 1 });
gastoSchema.index({ local: 1, folioClave: 1 });
gastoSchema.index({ documentoId: 1 });
gastoSchema.index({ numeroDocumento: 1 });
gastoSchema.index({ mes: 1, categoria: 1 });
gastoSchema.index({ mes: 1, cuentaContable: 1 });

module.exports = mongoose.model('Gasto', gastoSchema);
