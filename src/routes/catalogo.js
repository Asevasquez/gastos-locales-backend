const router = require('express').Router();
const multer = require('multer');
const XLSX = require('xlsx');
const ProductoCatalogo = require('../models/ProductoCatalogo');
const Gasto = require('../models/Gasto');
const auth = require('../middleware/auth');
const checkRol = require('../middleware/checkRol');

router.use(auth);

// Quita tildes y pasa a minúsculas, para que "cebollin" encuentre "Cebollín".
function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// GET /api/catalogo/buscar?q=cebollin
// Consulta el cache local (cargado desde el Excel vía /importar-excel), nunca un
// archivo en vivo — así el autocompletado responde rápido y funciona aunque la app
// esté ingresando el gasto sin buena señal. El catálogo es chico (decenas de ítems),
// así que se trae completo y se filtra en JS — evita los problemas de acentos que
// tiene el regex de Mongo por defecto.
router.get('/buscar', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);

  const qNormalizada = normalizar(q);
  const todos = await ProductoCatalogo.find({ activo: true }).sort('item');
  const coincidencias = todos.filter((p) => normalizar(p.item).includes(qNormalizada)).slice(0, 10);

  res.json(coincidencias);
});

// GET /api/catalogo/completo — todos los ítems activos. La app los guarda en el teléfono: así se puede
// elegir un producto aunque falle la conexión con el servidor.
router.get('/completo', async (req, res) => {
  try {
    const items = await ProductoCatalogo.find({ activo: true }).sort('item').select('item detalle ratio cuentaContable');
    res.json(items);
  } catch (err) {
    console.error('Error en /catalogo/completo:', err);
    res.status(500).json({ error: 'No se pudo cargar el catálogo' });
  }
});

// GET /api/catalogo/categorias — valores de RATIO
// Combina lo que trae el catálogo con lo que ya se haya usado en gastos, y un set
// base para que nunca desaparezca una categoría por falta de datos.
const CATEGORIAS_BASE = ['gasto_de_producción', 'gasto_de_producción_indirecto', 'gastos_de_administración_y_ventas'];

router.get('/categorias', async (req, res) => {
  const [deCatalogo, deGastos] = await Promise.all([
    ProductoCatalogo.distinct('ratio', { activo: true }),
    Gasto.distinct('categoria')
  ]);

  const categorias = Array.from(new Set([...CATEGORIAS_BASE, ...deCatalogo, ...deGastos])).sort();
  res.json(categorias);
});

// GET /api/catalogo/cuentas-contables — valores de CUENTA CONTABLE
router.get('/cuentas-contables', async (req, res) => {
  const [deCatalogo, deGastos] = await Promise.all([
    ProductoCatalogo.distinct('cuentaContable', { activo: true }),
    Gasto.distinct('cuentaContable')
  ]);

  const cuentas = Array.from(new Set([...deCatalogo, ...deGastos])).sort();
  res.json(cuentas);
});

// POST /api/catalogo/importar-excel — solo MASTER
// Reemplaza el catálogo desde una planilla con columnas ITEM, DETALLE (opcional),
// RATIO, CUENTA CONTABLE (encabezados no distinguen mayúsculas/acentos). Los ítems
// que ya existen se actualizan (por nombre); los que no vienen en la planilla nueva
// NO se borran automáticamente, solo se desactivan si faltan, para no perder
// referencias de gastos históricos que apuntan a ellos.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function normalizarEncabezado(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // saca tildes
    .trim()
    .toUpperCase();
}

router.post('/importar-excel', checkRol('MASTER'), upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

  try {
    const libro = XLSX.read(req.file.buffer, { type: 'buffer' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });

    if (filas.length === 0) {
      return res.status(400).json({ error: 'La planilla está vacía' });
    }

    // Mapea encabezados reales -> claves esperadas, sin importar tildes/mayúsculas.
    const clavesFila = Object.keys(filas[0]);
    const mapaClaves = {};
    for (const clave of clavesFila) {
      const normalizada = normalizarEncabezado(clave);
      if (normalizada === 'ITEM') mapaClaves.item = clave;
      if (normalizada === 'DETALLE') mapaClaves.detalle = clave;
      if (normalizada === 'RATIO') mapaClaves.ratio = clave;
      if (normalizada === 'CUENTA CONTABLE') mapaClaves.cuentaContable = clave;
    }

    if (!mapaClaves.item || !mapaClaves.ratio || !mapaClaves.cuentaContable) {
      return res.status(400).json({
        error: 'La planilla debe tener las columnas ITEM, RATIO y CUENTA CONTABLE (DETALLE es opcional)'
      });
    }

    const itemsDeLaPlanilla = [];
    let procesados = 0;
    let omitidos = 0;

    for (const fila of filas) {
      const item = String(fila[mapaClaves.item] || '').trim();
      const ratio = String(fila[mapaClaves.ratio] || '').trim();
      const cuentaContable = String(fila[mapaClaves.cuentaContable] || '').trim();
      const detalle = mapaClaves.detalle ? String(fila[mapaClaves.detalle] || '').trim() : '';

      if (!item || !ratio || !cuentaContable) {
        omitidos += 1;
        continue;
      }

      itemsDeLaPlanilla.push(item);

      await ProductoCatalogo.findOneAndUpdate(
        { item },
        { item, detalle, ratio, cuentaContable, activo: true, ultimaActualizacion: new Date() },
        { upsert: true }
      );
      procesados += 1;
    }

    // Desactiva (no borra) los ítems que ya no vienen en la planilla nueva.
    const { modifiedCount: desactivados } = await ProductoCatalogo.updateMany(
      { item: { $nin: itemsDeLaPlanilla }, activo: true },
      { activo: false }
    );

    res.json({ procesados, omitidos, desactivados });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo procesar el Excel: ' + err.message });
  }
});

module.exports = router;
