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

    // Primera foto de la boleta (compatibilidad: la leen los gastos de antes, las apps sin actualizar y los reportes).
    fotoBoletaUrl: { type: String, required: true },
    // Todas las fotos de la boleta (de 1 a 3, compartidas por los productos del documento). Los gastos antiguos
    // no la tienen: se leen como una lista de una sola foto (utils/fotosBoleta.js → fotosDe).
    fotosBoletaUrls: { type: [String], default: [], validate: [(v) => v.length <= 3, 'Una boleta puede tener hasta 3 fotos'] },
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
    numeroDocumento: { type: Number, default: null },

    // ----- Revisión (aprobar / rechazar) -----
    // Todo gasto nuevo queda PENDIENTE hasta que un ANALISTA, GERENCIA o MASTER lo revise. La revisión se hace por
    // boleta completa (todos sus productos juntos). Un gasto RECHAZADO lo corrige quien lo subió y vuelve a PENDIENTE.
    estado: { type: String, enum: ['PENDIENTE', 'APROBADO', 'RECHAZADO'], default: 'PENDIENTE' },
    revisadoPor: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', default: null }, // null en los aprobados de antes de existir la revisión
    revisadoEn: { type: Date, default: null },
    motivoRechazo: { type: String, default: null }, // solo mientras está RECHAZADO
    vecesRechazado: { type: Number, default: 0 },
    reenviadoEn: { type: Date, default: null }, // cuándo se corrigió y volvió a revisión
    // Lo último por lo que se rechazó, para que quien revisa de nuevo vea qué se pidió corregir.
    rechazoAnterior: {
      _id: false,
      motivo: { type: String, default: null },
      por: { type: String, default: null },
      en: { type: Date, default: null }
    },
    // Clave de la última corrección aplicada: permite reintentar una corrección sin duplicar nada.
    ultimaEdicion: { type: String, default: null }
  },
  { timestamps: true }
);

gastoSchema.index({ fecha: 1 });
gastoSchema.index({ usuario: 1, claveUnica: 1 }, { unique: true, partialFilterExpression: { claveUnica: { $type: 'string' } } });
gastoSchema.index({ local: 1, mes: 1 });
gastoSchema.index({ local: 1, folioClave: 1 });
gastoSchema.index({ documentoId: 1 });
gastoSchema.index({ numeroDocumento: 1 });
gastoSchema.index({ estado: 1, local: 1 });
gastoSchema.index({ mes: 1, categoria: 1 });
gastoSchema.index({ mes: 1, cuentaContable: 1 });

module.exports = mongoose.model('Gasto', gastoSchema);
