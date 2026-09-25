const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const usuarioSchema = new mongoose.Schema(
  {
    nombre: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    rol: {
      type: String,
      enum: ['MASTER', 'ADMINISTRADOR', 'ANALISTA'],
      required: true
    },
    // Locales que este usuario puede ver/operar. Many-to-many, igual que en KamiSushi Supervisión.
    localesAsignados: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Local' }],
    activo: { type: Boolean, default: true }
  },
  { timestamps: true }
);

usuarioSchema.methods.compararPassword = function compararPassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

module.exports = mongoose.model('Usuario', usuarioSchema);
