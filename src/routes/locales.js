const router = require('express').Router();
const Local = require('../models/Local');
const auth = require('../middleware/auth');
const checkRol = require('../middleware/checkRol');

router.use(auth);

// MASTER ve todos los locales; ADMINISTRADOR/ANALISTA solo los que tiene asignados.
router.get('/', async (req, res) => {
  const filtro = { activo: true };
  if (req.usuario.rol !== 'MASTER') {
    filtro._id = { $in: req.usuario.localesAsignados };
  }
  const locales = await Local.find(filtro).sort('nombre');
  res.json(locales);
});

router.post('/', checkRol('MASTER'), async (req, res) => {
  try {
    const local = await Local.create(req.body);
    res.status(201).json(local);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Código externo ya en uso' });
    }
    res.status(500).json({ error: 'Error al crear local' });
  }
});

router.put('/:id', checkRol('MASTER'), async (req, res) => {
  const local = await Local.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!local) return res.status(404).json({ error: 'Local no encontrado' });
  res.json(local);
});

router.delete('/:id', checkRol('MASTER'), async (req, res) => {
  await Local.findByIdAndUpdate(req.params.id, { activo: false });
  res.json({ ok: true });
});

module.exports = router;
