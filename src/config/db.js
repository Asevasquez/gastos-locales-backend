const mongoose = require('mongoose');

module.exports = async function conectarDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB conectado');
  } catch (err) {
    console.error('Error al conectar MongoDB:', err.message);
    process.exit(1);
  }
};
