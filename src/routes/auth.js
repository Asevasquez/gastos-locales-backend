const router = require('express').Router();
const jwt = require('jsonwebtoken');
const Usuario = require('../models/Usuario');
const auth = require('../middleware/auth');

const DURACION_TOKEN = '7d';

function firmarToken(usuario) {
  return jwt.sign({ id: usuario._id, rol: usuario.rol }, process.env.JWT_SECRET, { expiresIn: DURACION_TOKEN });
}

function datosUsuario(usuario) {
  return {
    id: usuario._id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    localesAsignados: usuario.localesAsignados
  };
}

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const usuario = await Usuario.findOne({ email: email.toLowerCase(), activo: true }).populate(
      'localesAsignados',
      'nombre marca'
    );
    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const passwordOk = await usuario.compararPassword(password);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    res.json({ token: firmarToken(usuario), usuario: datosUsuario(usuario) });
  } catch (err) {
    console.error('Error en /auth/login:', err);
    res.status(500).json({ error: 'Error interno al iniciar sesión' });
  }
});

// GET /api/auth/me — la app lo llama al abrirse. Sirve para tres cosas:
//   1. Comprobar que la sesión sigue válida (el middleware responde 401 si el token venció o el usuario
//      fue desactivado), en vez de que la app falle en silencio.
//   2. Traer los datos al día (por ejemplo, los locales asignados, que pueden haber cambiado).
//   3. Renovar el token: mientras la app se use al menos una vez cada 7 días, no hay que volver a iniciar sesión.
router.get('/me', auth, async (req, res) => {
  try {
    const usuario = await Usuario.findById(req.usuario._id).populate('localesAsignados', 'nombre marca');
    if (!usuario || !usuario.activo) return res.status(401).json({ error: 'Usuario no válido' });
    res.json({ token: firmarToken(usuario), usuario: datosUsuario(usuario) });
  } catch (err) {
    console.error('Error en /auth/me:', err);
    res.status(500).json({ error: 'No se pudo validar la sesión' });
  }
});

module.exports = router;
