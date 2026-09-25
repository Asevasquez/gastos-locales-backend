require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Usuario = require('../models/Usuario');

// Uso: npm run crear:master -- "Nombre Apellido" email@pcm.cl contraseña
async function crear() {
  const [, , nombre, email, password] = process.argv;

  if (!nombre || !email || !password) {
    console.log('Uso: npm run crear:master -- "Nombre Apellido" email@pcm.cl contraseña');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const existente = await Usuario.findOne({ email: email.toLowerCase() });
  if (existente) {
    console.log(`Ya existe un usuario con el email ${email}.`);
    await mongoose.disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await Usuario.create({ nombre, email: email.toLowerCase(), passwordHash, rol: 'MASTER' });

  console.log(`Usuario MASTER creado: ${email}`);
  await mongoose.disconnect();
}

crear().catch((err) => {
  console.error('Error creando el usuario MASTER:', err.message);
  process.exit(1);
});
