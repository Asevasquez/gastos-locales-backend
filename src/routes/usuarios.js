const router = require('express').Router();
const bcrypt = require('bcryptjs');
const Usuario = require('../models/Usuario');
const auth = require('../middleware/auth');
const checkRol = require('../middleware/checkRol');

// Toda la administración de usuarios es exclusiva de MASTER.
router.use(auth, checkRol('MASTER'));

router.get('/', async (req, res) => {
  const usuarios = await Usuario.find()
    .select('-passwordHash')
    .populate('localesAsignados', 'nombre marca')
    .sort('nombre');
  res.json(usuarios);
});

router.post('/', async (req, res) => {
  try {
    const { nombre, email, password, rol, localesAsignados } = req.body;

    if (!nombre || !email || !password || !rol) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const usuario = await Usuario.create({
      nombre,
      email,
      passwordHash,
      rol,
      localesAsignados: localesAsignados || []
    });

    const { passwordHash: _omit, ...usuarioSinPassword } = usuario.toObject();
    res.status(201).json(usuarioSinPassword);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    }
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

router.put('/:id', async (req, res) => {
  const { nombre, email, rol, localesAsignados, activo, password } = req.body;
  const update = { nombre, email, rol, localesAsignados, activo };

  if (password) {
    update.passwordHash = await bcrypt.hash(password, 10);
  }

  const usuario = await Usuario.findByIdAndUpdate(req.params.id, update, { new: true }).select(
    '-passwordHash'
  );
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(usuario);
});

// Pantalla dedicada de asignación de locales, igual a AsignarLocales.jsx de Supervisión.
router.put('/:id/locales', async (req, res) => {
  const { localesAsignados } = req.body;
  const usuario = await Usuario.findByIdAndUpdate(
    req.params.id,
    { localesAsignados },
    { new: true }
  )
    .select('-passwordHash')
    .populate('localesAsignados', 'nombre marca');

  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(usuario);
});

// Baja lógica, nunca se borra el usuario (preserva historial de gastos que ingresó).
router.delete('/:id', async (req, res) => {
  await Usuario.findByIdAndUpdate(req.params.id, { activo: false });
  res.json({ ok: true });
});

module.exports = router;
