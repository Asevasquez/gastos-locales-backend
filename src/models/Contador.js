const mongoose = require('mongoose');

// Contadores del sistema. Hoy hay uno: "documento", el correlativo de las boletas/facturas.
// Se incrementa con una operación atómica de MongoDB, así dos envíos simultáneos nunca reciben el mismo número.
const contadorSchema = new mongoose.Schema({ _id: { type: String }, valor: { type: Number, default: 0 } }, { versionKey: false });

module.exports = mongoose.model('Contador', contadorSchema);
