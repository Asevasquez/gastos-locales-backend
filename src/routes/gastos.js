const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Gasto = require('../models/Gasto');
const ProductoCatalogo = require('../models/ProductoCatalogo');
const auth = require('../middleware/auth');
const checkRol = require('../middleware/checkRol');
const { resolverFiltroLocal } = require('../utils/filtroLocal');

router.use(auth);

// --- Subida de foto de boleta/factura ---
// Multipart, no base64: la app manda el archivo por FormData referenciando el uri
// local, así nunca se carga la imagen completa en memoria de JS (evita el crash
// de cámara con fotos de alta resolución). Mismo enfoque que en KamiSushi Supervisión.
const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'boletas');
fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 8 * 1024 * 1024 } }); // 8MB máx por boleta

router.post('/foto', checkRol('MASTER', 'ADMINISTRADOR'), upload.single('foto'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna foto' });
  const base = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 5001}`;
  res.json({ url: `${base}/uploads/boletas/${req.file.filename}` });
});

function mesActual() {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
}

function mesDeFecha(fecha) {
  const d = new Date(fecha);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function tieneAccesoLocal(usuario, localId) {
  if (usuario.rol === 'MASTER') return true;
  return usuario.localesAsignados.some((id) => id.toString() === localId.toString());
}

// POST /api/gastos — ADMINISTRADOR (sobre sus locales) o MASTER.
// El ítem DEBE existir en el catálogo (productoCatalogoId): categoría y cuenta
// contable se toman de ahí, nunca se reciben editadas desde el cliente.
router.post('/', checkRol('MASTER', 'ADMINISTRADOR'), async (req, res) => {
  try {
    const {
      local,
      productoCatalogoId,
      cantidad,
      unidadMedida,
      monto,
      medioPago,
      fecha,
      fotoBoletaUrl,
      motivo
    } = req.body;

    if (
      !local ||
      !productoCatalogoId ||
      !cantidad ||
      !unidadMedida ||
      !monto ||
      !medioPago ||
      !fecha ||
      !fotoBoletaUrl ||
      !motivo ||
      !motivo.trim()
    ) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (motivo y foto son obligatorios)' });
    }

    if (!tieneAccesoLocal(req.usuario, local)) {
      return res.status(403).json({ error: 'No tienes acceso a este local' });
    }

    const producto = await ProductoCatalogo.findById(productoCatalogoId);
    if (!producto || !producto.activo) {
      return res.status(400).json({ error: 'El ítem seleccionado no existe o ya no está activo en el catálogo' });
    }

    const gasto = await Gasto.create({
      local,
      usuario: req.usuario._id,
      productoNombre: producto.item,
      productoCatalogoId: producto._id,
      categoria: producto.ratio,
      cuentaContable: producto.cuentaContable,
      cantidad,
      unidadMedida,
      monto,
      medioPago,
      fecha,
      mes: mesDeFecha(fecha),
      fotoBoletaUrl,
      motivo: motivo.trim()
    });

    res.status(201).json(gasto);
  } catch (err) {
    res.status(500).json({ error: 'Error al crear el gasto' });
  }
});

// GET /api/gastos?local=...&locales=id1,id2&mes=2026-09&desde=2026-09-15&hasta=2026-09-21&categoria=...&cuentaContable=...&medioPago=...
// desde/hasta permiten filtrar por semana (o cualquier rango) además del filtro por mes.
router.get('/', async (req, res) => {
  const { local, locales, mes, desde, hasta, categoria, cuentaContable, medioPago } = req.query;
  const filtro = {};

  const filtroLocal = resolverFiltroLocal(req.usuario, { local, locales });
  if (filtroLocal !== null) filtro.local = filtroLocal;
  if (mes) filtro.mes = mes;
  if (desde || hasta) {
    filtro.fecha = {};
    if (desde) filtro.fecha.$gte = new Date(desde);
    if (hasta) filtro.fecha.$lte = new Date(hasta);
  }
  if (categoria) filtro.categoria = { $in: categoria.split(',') };
  if (cuentaContable) filtro.cuentaContable = { $in: cuentaContable.split(',') };
  if (medioPago) filtro.medioPago = { $in: medioPago.split(',') };

  const gastos = await Gasto.find(filtro)
    .populate('local', 'nombre marca')
    .populate('usuario', 'nombre')
    .sort('-fecha');

  res.json(gastos);
});

router.get('/:id', async (req, res) => {
  const gasto = await Gasto.findById(req.params.id)
    .populate('local', 'nombre marca')
    .populate('usuario', 'nombre');

  if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });
  if (!tieneAccesoLocal(req.usuario, gasto.local._id)) {
    return res.status(403).json({ error: 'No tienes acceso a este gasto' });
  }
  res.json(gasto);
});

// PUT /api/gastos/:id — ADMINISTRADOR solo puede editar sus propios gastos del mes en curso.
router.put('/:id', checkRol('MASTER', 'ADMINISTRADOR'), async (req, res) => {
  const gasto = await Gasto.findById(req.params.id);
  if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });

  if (req.usuario.rol === 'ADMINISTRADOR') {
    if (gasto.usuario.toString() !== req.usuario._id.toString()) {
      return res.status(403).json({ error: 'Solo puedes editar tus propios gastos' });
    }
    if (gasto.mes !== mesActual()) {
      return res.status(403).json({ error: 'Este gasto ya no se puede editar, el mes está cerrado' });
    }
  }

  const { productoCatalogoId, cantidad, unidadMedida, monto, medioPago, fecha, fotoBoletaUrl, motivo } = req.body;

  if (!motivo || !motivo.trim()) {
    return res.status(400).json({ error: 'El motivo es obligatorio' });
  }
  if (!fotoBoletaUrl) {
    return res.status(400).json({ error: 'La foto de la boleta es obligatoria' });
  }

  let datosProducto = {
    productoNombre: gasto.productoNombre,
    productoCatalogoId: gasto.productoCatalogoId,
    categoria: gasto.categoria,
    cuentaContable: gasto.cuentaContable
  };

  if (productoCatalogoId && productoCatalogoId.toString() !== String(gasto.productoCatalogoId)) {
    const producto = await ProductoCatalogo.findById(productoCatalogoId);
    if (!producto || !producto.activo) {
      return res.status(400).json({ error: 'El ítem seleccionado no existe o ya no está activo en el catálogo' });
    }
    datosProducto = {
      productoNombre: producto.item,
      productoCatalogoId: producto._id,
      categoria: producto.ratio,
      cuentaContable: producto.cuentaContable
    };
  }

  Object.assign(gasto, {
    ...datosProducto,
    cantidad,
    unidadMedida,
    monto,
    medioPago,
    fecha,
    mes: mesDeFecha(fecha),
    fotoBoletaUrl,
    motivo: motivo.trim(),
    editadoEn: new Date()
  });

  await gasto.save();
  res.json(gasto);
});

// DELETE /api/gastos/:id — solo MASTER. Borra también el archivo de la foto en
// disco (si existe); si falla al borrarlo (ya no está, permisos, etc.) igual
// borra el registro del gasto, solo queda un warning en el log.
router.delete('/:id', checkRol('MASTER'), async (req, res) => {
  const gasto = await Gasto.findByIdAndDelete(req.params.id);
  if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });

  if (gasto.fotoBoletaUrl) {
    const nombreArchivo = gasto.fotoBoletaUrl.split('/').pop();
    const rutaArchivo = path.join(uploadsDir, nombreArchivo);
    fs.unlink(rutaArchivo, (err) => {
      if (err && err.code !== 'ENOENT') {
        console.error(`No se pudo borrar la foto del gasto ${gasto._id}:`, err.message);
      }
    });
  }

  res.json({ ok: true });
});

module.exports = router;
