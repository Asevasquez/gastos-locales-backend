const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Gasto = require('../models/Gasto');
const Local = require('../models/Local');
const HistorialGasto = require('../models/HistorialGasto');
const ProductoCatalogo = require('../models/ProductoCatalogo');
const auth = require('../middleware/auth');
const checkRol = require('../middleware/checkRol');
const { resolverFiltroLocal } = require('../utils/filtroLocal');
const { hoyEnZona } = require('../utils/periodos');
const { construirEvento, evaluarEliminacion, MOTIVO_ELIMINACION_MIN } = require('../utils/historialGastos');

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

// Mes en curso según la zona horaria del negocio (America/Santiago), no la del servidor: así el
// "mes cerrado" cambia a medianoche de Chile y no a las 21:00.
function mesActual() {
  return hoyEnZona().slice(0, 7);
}

// La fecha del gasto llega como día de calendario ("YYYY-MM-DD") y se guarda a medianoche
// UTC, así que el mes se lee en UTC: con getMonth() local, un servidor que no esté en UTC
// calcularía mal el mes de los gastos del día 1.
function mesDeFecha(fecha) {
  const d = new Date(fecha);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
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

    // Historial: queda registrado quién subió el gasto y cuándo. Si esto falla no se pierde el
    // gasto (ya está guardado); `npm run historial:rellenar` repara los que se queden sin registro.
    try {
      const localDoc = await Local.findById(gasto.local).select('nombre').lean();
      await HistorialGasto.create(
        construirEvento({
          accion: 'CREADO',
          gasto,
          localNombre: localDoc ? localDoc.nombre : null,
          subidoPor: req.usuario,
          realizadoPor: req.usuario
        })
      );
    } catch (errHistorial) {
      console.error(`No se pudo registrar en el historial el gasto ${gasto._id}:`, errHistorial.message);
    }

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
    .populate('local', 'nombre marca codigoExterno')
    .populate('usuario', 'nombre')
    .sort('-fecha');

  res.json(gastos);
});

router.get('/:id', async (req, res) => {
  const gasto = await Gasto.findById(req.params.id)
    .populate('local', 'nombre marca codigoExterno')
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

// DELETE /api/gastos/:id   (body: { motivo })
//   MASTER: cualquier gasto.  ADMINISTRADOR: solo los que él subió, y solo durante el mes en que
//   los subió.  Siempre exige un motivo y deja constancia en el historial ANTES de eliminar: si el
//   registro falla, el gasto NO se elimina.  La foto de la boleta se conserva en disco a propósito,
//   para que el historial pueda seguir mostrándola.
router.delete('/:id', checkRol('MASTER', 'ADMINISTRADOR'), async (req, res) => {
  try {
    const motivo = String((req.body && req.body.motivo) || '').trim();
    if (motivo.length < MOTIVO_ELIMINACION_MIN) {
      return res.status(400).json({
        error: `Debes indicar el motivo de la eliminación (mínimo ${MOTIVO_ELIMINACION_MIN} caracteres)`
      });
    }

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ error: 'Gasto no encontrado' });
    }
    const gasto = await Gasto.findById(req.params.id)
      .populate('local', 'nombre')
      .populate('usuario', 'nombre rol');
    if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado' });

    const permiso = evaluarEliminacion(req.usuario, gasto);
    if (!permiso.permitido) return res.status(403).json({ error: permiso.error });

    await HistorialGasto.create(
      construirEvento({
        accion: 'ELIMINADO',
        gasto,
        subidoPor: gasto.usuario,
        realizadoPor: req.usuario,
        motivoEliminacion: motivo
      })
    );
    await Gasto.deleteOne({ _id: gasto._id });

    res.json({ ok: true });
  } catch (err) {
    console.error('Error al eliminar el gasto:', err);
    res.status(500).json({ error: 'No se pudo eliminar el gasto' });
  }
});

module.exports = router;
