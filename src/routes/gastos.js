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
const { validarDocumento } = require('../utils/documentoGasto');
const { siguienteNumero, numeroDeDocumento } = require('../utils/correlativo');

router.use(auth);

// --- Subida de foto de boleta/factura ---
// Multipart, no base64: la app manda el archivo por FormData referenciando el uri
// local, así nunca se carga la imagen completa en memoria de JS (evita el crash
// de cámara con fotos de alta resolución). Mismo enfoque que en KamiSushi Supervisión.
const uploadsDir = path.join(__dirname, '..', '..', 'uploads', 'boletas');
fs.mkdirSync(uploadsDir, { recursive: true });

// Solo imágenes. La extensión del archivo guardado sale del TIPO real que declara la subida, nunca del nombre que
// trae (un "boleta.html" con tipo image/jpeg se guarda como .jpg), y estos archivos se sirven tal cual por /uploads.
const TIPOS_FOTO = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/pjpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};
const MAX_FOTO_MB = 8;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${TIPOS_FOTO[file.mimetype] || '.jpg'}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FOTO_MB * 1024 * 1024 }, // 8MB máx por boleta
  fileFilter: (req, file, cb) => {
    if (TIPOS_FOTO[file.mimetype]) return cb(null, true);
    const err = new Error('Formato de foto no permitido');
    err.codigo = 'FORMATO_NO_PERMITIDO';
    return cb(err);
  }
});

// Recibe la foto y, si algo falla, responde un mensaje que se pueda mostrar (antes un archivo muy pesado terminaba
// en un error 500 genérico).
function recibirFoto(req, res, next) {
  upload.single('foto')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `La foto pesa más de ${MAX_FOTO_MB} MB. Usa una imagen más liviana.` });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'No se recibió ninguna foto' });
    }
    if (err.codigo === 'FORMATO_NO_PERMITIDO') {
      return res.status(400).json({ error: 'Formato no permitido. Sube una imagen JPG, PNG o WEBP.' });
    }
    return next(err);
  });
}

router.post('/foto', checkRol('MASTER', 'ADMINISTRADOR'), recibirFoto, (req, res) => {
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

// Apps antiguas no mandan `claveUnica`. Para ellas, un gasto idéntico (mismo ítem, cantidad, monto,
// fecha, medio de pago y motivo) que el mismo usuario subió hace menos de esto se rechaza como duplicado.
const VENTANA_DUPLICADO_MINUTOS = 15;

function tieneAccesoLocal(usuario, localId) {
  if (usuario.rol === 'MASTER') return true;
  return usuario.localesAsignados.some((id) => id.toString() === localId.toString());
}

// POST /api/gastos — ADMINISTRADOR (sobre sus locales) o MASTER.
// El ítem DEBE existir en el catálogo (productoCatalogoId): categoría y cuenta
// contable se toman de ahí, nunca se reciben editadas desde el cliente.
router.post('/', checkRol('MASTER', 'ADMINISTRADOR'), async (req, res) => {
  let clave = null;
  try {
    const {
      claveUnica,
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

    // Anti-duplicados. Con clave: si ya existe un gasto con esa clave de este usuario, se devuelve ese
    // mismo gasto (200) y no se crea otro: el reintento es inofensivo.
    clave = typeof claveUnica === 'string' && claveUnica.trim() ? claveUnica.trim().slice(0, 100) : null;
    if (clave) {
      const existente = await Gasto.findOne({ usuario: req.usuario._id, claveUnica: clave });
      if (existente) return res.status(200).json(existente);
    } else {
      const desde = new Date(Date.now() - VENTANA_DUPLICADO_MINUTOS * 60000);
      const parecido = await Gasto.findOne({
        usuario: req.usuario._id,
        local,
        productoCatalogoId,
        cantidad,
        unidadMedida,
        monto,
        medioPago,
        fecha: new Date(fecha),
        motivo: motivo.trim(),
        createdAt: { $gte: desde }
      });
      if (parecido) {
        return res.status(409).json({
          error: `Ya registraste un gasto idéntico (mismo ítem, cantidad, monto, fecha y motivo) hace menos de ${VENTANA_DUPLICADO_MINUTOS} minutos. Si es otra compra distinta, cambia el motivo para distinguirla.`
        });
      }
    }

    const producto = await ProductoCatalogo.findById(productoCatalogoId);
    if (!producto || !producto.activo) {
      return res.status(400).json({ error: 'El ítem seleccionado no existe o ya no está activo en el catálogo' });
    }

    // Un gasto de un solo producto es un documento de una línea: recibe su propio número correlativo.
    const numeroDocumento = await siguienteNumero();

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
      motivo: motivo.trim(),
      claveUnica: clave || undefined,
      numeroDocumento
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
    // Dos envíos con la misma clave llegaron a la vez: el índice único dejó pasar solo uno. Al otro
    // se le devuelve el gasto que sí se creó, en vez de un error.
    if (err && err.code === 11000 && clave) {
      try {
        const existente = await Gasto.findOne({ usuario: req.usuario._id, claveUnica: clave });
        if (existente) return res.status(200).json(existente);
      } catch (errBusqueda) {
        console.error('Error al buscar el gasto duplicado:', errBusqueda.message);
      }
    }
    res.status(500).json({ error: 'Error al crear el gasto' });
  }
});

// POST /api/gastos/documento — una boleta o factura con UNO O MÁS productos.
//   Body: { claveDocumento, local, folio, fecha, medioPago, fotoBoletaUrl, items: [{ productoCatalogoId,
//   cantidad, unidadMedida, monto, motivo }], confirmarFolioRepetido? }
// Cada producto se guarda como un gasto (con su categoría y cuenta contable del catálogo); todos comparten
// folio, foto, fecha, medio de pago y `documentoId`.
// Anti-duplicados: cada producto lleva la clave `${claveDocumento}:${posición}`. Si el documento llega otra
// vez (doble toque, reintento de la cola offline, respuesta perdida), se devuelven los productos que ya
// existen y solo se crean los que falten — por eso un fallo a la mitad se arregla reintentando.
// Folio repetido: si OTRO documento del mismo local ya usó ese folio, se responde 409 (FOLIO_REPETIDO) a
// menos que se confirme con `confirmarFolioRepetido: true` (puede ser un documento distinto de otro proveedor).
router.post('/documento', checkRol('MASTER', 'ADMINISTRADOR'), async (req, res) => {
  try {
    const { error, datos } = validarDocumento(req.body);
    if (error) return res.status(400).json({ error });

    if (!tieneAccesoLocal(req.usuario, datos.local)) {
      return res.status(403).json({ error: 'No tienes acceso a este local' });
    }

    const claves = datos.items.map((_, i) => `${datos.claveDocumento}:${i}`);
    const existentes = await Gasto.find({ usuario: req.usuario._id, claveUnica: { $in: claves } });
    const porClave = new Map(existentes.map((g) => [g.claveUnica, g]));

    // Folio ya usado por otro documento de este local (no aplica a un reintento del mismo documento).
    if (existentes.length === 0 && req.body.confirmarFolioRepetido !== true) {
      const otro = await Gasto.findOne({
        local: datos.local,
        folioClave: datos.folioClave,
        documentoId: { $ne: datos.claveDocumento }
      }).populate('usuario', 'nombre');
      if (otro) {
        const quien = otro.usuario && otro.usuario.nombre ? ` por ${otro.usuario.nombre}` : '';
        return res.status(409).json({
          codigo: 'FOLIO_REPETIDO',
          error: `Ya hay un documento con el folio ${datos.folio} en este local (ingresado el ${new Date(otro.createdAt || otro.fecha).toISOString().slice(0, 10).split('-').reverse().join('-')}${quien}). Si es un documento distinto, confírmalo para registrarlo igual.`,
          existente: { fecha: otro.fecha, ingresadoEn: otro.createdAt, ingresadoPor: otro.usuario ? otro.usuario.nombre : null }
        });
      }
    }

    const ids = [...new Set(datos.items.map((it) => String(it.productoCatalogoId)))];
    const productos = new Map((await ProductoCatalogo.find({ _id: { $in: ids } })).map((p) => [String(p._id), p]));
    for (let i = 0; i < datos.items.length; i += 1) {
      const p = productos.get(String(datos.items[i].productoCatalogoId));
      if (!p || !p.activo) {
        return res.status(400).json({ error: `Producto ${i + 1}: el ítem no existe o ya no está activo en el catálogo` });
      }
    }

    // Número del documento: el mismo para todos sus productos. Si el documento ya tenía productos guardados
    // (reintento), se reutiliza su número; si no, se asigna uno (estable aunque el envío llegue dos veces).
    let numeroDocumento = existentes.map((g) => g.numeroDocumento).find((n) => Number.isInteger(n));
    if (numeroDocumento === undefined) {
      numeroDocumento = await numeroDeDocumento({ usuario: req.usuario._id, claveDocumento: datos.claveDocumento });
      if (existentes.length > 0) {
        // productos guardados antes de que existiera el correlativo: se les pone el mismo número
        await Gasto.updateMany(
          { usuario: req.usuario._id, documentoId: datos.claveDocumento, numeroDocumento: null },
          { $set: { numeroDocumento } }
        );
      }
    }

    const mes = mesDeFecha(datos.fecha);
    const creados = [];
    const gastos = [];
    for (let i = 0; i < datos.items.length; i += 1) {
      if (porClave.has(claves[i])) {
        gastos.push(porClave.get(claves[i]));
        continue;
      }
      const it = datos.items[i];
      const producto = productos.get(String(it.productoCatalogoId));
      try {
        const gasto = await Gasto.create({
          local: datos.local,
          usuario: req.usuario._id,
          productoNombre: producto.item,
          productoCatalogoId: producto._id,
          categoria: producto.ratio,
          cuentaContable: producto.cuentaContable,
          cantidad: it.cantidad,
          unidadMedida: it.unidadMedida,
          monto: it.monto,
          medioPago: datos.medioPago,
          fecha: datos.fecha,
          mes,
          fotoBoletaUrl: datos.fotoBoletaUrl,
          motivo: it.motivo,
          claveUnica: claves[i],
          folio: datos.folio,
          folioClave: datos.folioClave,
          documentoId: datos.claveDocumento,
          numeroDocumento
        });
        creados.push(gasto);
        gastos.push(gasto);
      } catch (err) {
        // Mismo producto enviado dos veces a la vez: el índice único dejó pasar solo uno; se usa el que sí se creó.
        if (err && err.code === 11000) {
          const ya = await Gasto.findOne({ usuario: req.usuario._id, claveUnica: claves[i] });
          if (ya) {
            gastos.push(ya);
            continue;
          }
        }
        throw err;
      }
    }

    // Historial: un registro de "subido" por cada producto. Si falla no se pierde nada (ya está guardado).
    if (creados.length > 0) {
      try {
        const localDoc = await Local.findById(datos.local).select('nombre').lean();
        for (const gasto of creados) {
          await HistorialGasto.create(
            construirEvento({
              accion: 'CREADO',
              gasto,
              localNombre: localDoc ? localDoc.nombre : null,
              subidoPor: req.usuario,
              realizadoPor: req.usuario
            })
          );
        }
      } catch (errHistorial) {
        console.error(`No se pudo registrar en el historial el documento ${datos.claveDocumento}:`, errHistorial.message);
      }
    }

    res.status(creados.length > 0 ? 201 : 200).json({
      documentoId: datos.claveDocumento,
      numeroDocumento,
      folio: datos.folio,
      total: gastos.reduce((a, g) => a + g.monto, 0),
      gastos
    });
  } catch (err) {
    console.error('Error al crear el documento de gastos:', err);
    res.status(500).json({ error: 'Error al crear el documento' });
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
