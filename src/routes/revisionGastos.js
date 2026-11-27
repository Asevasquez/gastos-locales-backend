// Revisión de gastos: aprobar / rechazar (ANALISTA, GERENCIA y MASTER) y corregir lo rechazado (quien lo subió).
// La revisión es por BOLETA COMPLETA (todos sus productos juntos). Las reglas están en utils/revisionGastos.js.
//
//   GET  /api/gastos/revision/resumen          cuántas boletas hay por revisar / rechazadas / por corregir
//   GET  /api/gastos/revision/documentos       boletas (agrupadas) por estado:  ?estado=PENDIENTE,RECHAZADO&propios=1&locales=..
//   POST /api/gastos/revision                  { decision: 'APROBAR'|'RECHAZAR', documentos: [id…], motivo? }
//   POST /api/gastos/revision/reabrir          { documentos: [id…], motivo? }   vuelve a PENDIENTE lo aprobado/rechazado
//   GET  /api/gastos/documento/:id             una boleta con sus productos (para corregirla)
//   PUT  /api/gastos/documento/:id             corrige una boleta rechazada y la devuelve a revisión
//
// `id` de una boleta = su `documentoId`; en los gastos antiguos de un solo producto (sin documentoId) es el id del gasto.
const router = require('express').Router();
const mongoose = require('mongoose');
const Gasto = require('../models/Gasto');
const HistorialGasto = require('../models/HistorialGasto');
const ProductoCatalogo = require('../models/ProductoCatalogo');
const auth = require('../middleware/auth');
const checkRol = require('../middleware/checkRol');
const { resolverFiltroLocal } = require('../utils/filtroLocal');
const { validarDocumento } = require('../utils/documentoGasto');
const { construirEvento } = require('../utils/historialGastos');
const { mesDeFecha, tieneAccesoLocal } = require('../utils/gastosComunes');
const {
  ESTADOS, MOTIVO_RECHAZO_MIN, MOTIVO_MAX, MAX_DOCUMENTOS_POR_ACCION, claveDocumento, puedeRevisar, agruparDocumentos,
  evaluarRevision, camposDecision, evaluarReapertura, camposReapertura, evaluarCorreccion, camposReenvio
} = require('../utils/revisionGastos');

const idDe = (v) => (v == null ? null : v._id !== undefined ? v._id : v);
const POBLAR = [['local', 'nombre marca'], ['usuario', 'nombre rol'], ['revisadoPor', 'nombre']];
const poblar = (consulta) => POBLAR.reduce((q, [campo, campos]) => q.populate(campo, campos), consulta);

// Productos (gastos) de una boleta. Un gasto antiguo sin documentoId es una boleta de un solo producto.
async function cargarLineas(id) {
  const clave = String(id);
  let lineas = await poblar(Gasto.find({ documentoId: clave })).lean();
  if (lineas.length === 0 && mongoose.isValidObjectId(clave)) {
    const g = await poblar(Gasto.findById(clave)).lean();
    if (g && !g.documentoId) lineas = [g];
  }
  return lineas;
}

// Deja constancia en el historial. Si falla, la acción ya está hecha: se avisa en el registro del servidor.
async function registrar(eventos) {
  try {
    for (const evento of eventos) await HistorialGasto.create(evento);
  } catch (err) {
    console.error('No se pudo registrar en el historial:', err.message);
  }
}

const evento = (accion, linea, usuario, extra = {}) =>
  construirEvento({ accion, gasto: linea, subidoPor: linea.usuario, realizadoPor: usuario, localNombre: linea.local && linea.local.nombre, ...extra });

function idsDeBody(body) {
  const lista = body && Array.isArray(body.documentos) ? body.documentos : null;
  if (!lista || lista.length === 0) return { error: 'Indica al menos una boleta' };
  if (lista.length > MAX_DOCUMENTOS_POR_ACCION) return { error: `Se pueden procesar hasta ${MAX_DOCUMENTOS_POR_ACCION} boletas a la vez` };
  return { ids: [...new Set(lista.map(String))] };
}

// ---------- Resumen para los avisos (contador de pendientes, boletas por corregir) ----------
router.get('/revision/resumen', auth, async (req, res) => {
  try {
    const filtroLocal = resolverFiltroLocal(req.usuario, {});
    const base = filtroLocal !== null ? { local: filtroLocal } : {};
    const contar = async (filtro) => new Set((await Gasto.find(filtro).select('documentoId').lean()).map(claveDocumento)).size;

    const revisor = puedeRevisar(req.usuario);
    const puedeSubir = req.usuario.rol === 'ADMINISTRADOR' || req.usuario.rol === 'MASTER';
    const [pendientes, rechazadas, porCorregir] = await Promise.all([
      revisor ? contar({ ...base, estado: 'PENDIENTE', usuario: { $ne: req.usuario._id } }) : 0, // lo propio no lo revisa uno mismo
      revisor ? contar({ ...base, estado: 'RECHAZADO' }) : 0,
      puedeSubir ? contar({ ...base, estado: 'RECHAZADO', usuario: req.usuario._id }) : 0
    ]);
    res.json({ pendientes, rechazadas, porCorregir });
  } catch (err) {
    console.error('Error en el resumen de revisión:', err);
    res.status(500).json({ error: 'No se pudo cargar el resumen de revisión' });
  }
});

// ---------- Boletas por estado ----------
router.get('/revision/documentos', auth, async (req, res) => {
  try {
    const { estado, propios, excluirPropios, local, locales } = req.query;
    const filtro = {};
    const estados = String(estado || 'PENDIENTE').split(',').filter((e) => ESTADOS.includes(e));
    filtro.estado = { $in: estados.length > 0 ? estados : ['PENDIENTE'] };

    const filtroLocal = resolverFiltroLocal(req.usuario, { local: local ? String(local) : undefined, locales: locales ? String(locales) : undefined });
    if (filtroLocal !== null) filtro.local = filtroLocal;

    // Quien no revisa (ADMINISTRADOR) solo ve lo suyo; quien revisa puede pedir solo lo propio o dejarlo fuera.
    if (!puedeRevisar(req.usuario) || propios === '1') filtro.usuario = req.usuario._id;
    else if (excluirPropios === '1') filtro.usuario = { $ne: req.usuario._id };

    const gastos = await poblar(Gasto.find(filtro).sort('createdAt').limit(5000)).lean();
    const documentos = agruparDocumentos(gastos);
    // los más antiguos primero en la cola de pendientes; lo demás, lo más reciente primero
    if (!(estados.length === 1 && estados[0] === 'PENDIENTE')) documentos.reverse();
    res.json(documentos);
  } catch (err) {
    console.error('Error al listar boletas por estado:', err);
    res.status(500).json({ error: 'No se pudieron cargar las boletas' });
  }
});

// ---------- Aprobar o rechazar ----------
router.post('/revision', auth, async (req, res) => {
  try {
    if (!puedeRevisar(req.usuario)) return res.status(403).json({ error: 'No tienes permiso para aprobar o rechazar gastos' });
    const { decision, motivo } = req.body || {};
    if (decision !== 'APROBAR' && decision !== 'RECHAZAR') return res.status(400).json({ error: 'La decisión debe ser APROBAR o RECHAZAR' });
    const motivoLimpio = String(motivo || '').trim();
    if (decision === 'RECHAZAR' && motivoLimpio.length < MOTIVO_RECHAZO_MIN) {
      return res.status(400).json({ error: `Debes indicar el motivo del rechazo (mínimo ${MOTIVO_RECHAZO_MIN} caracteres), para que quien subió la boleta sepa qué corregir` });
    }
    if (motivoLimpio.length > MOTIVO_MAX) return res.status(400).json({ error: `El motivo es demasiado largo (máximo ${MOTIVO_MAX} caracteres)` });
    const { ids, error } = idsDeBody(req.body);
    if (error) return res.status(400).json({ error });

    const ahora = new Date();
    const omitidos = [];
    let documentos = 0;
    let gastos = 0;
    for (const id of ids) {
      const lineas = await cargarLineas(id);
      if (lineas.length === 0) { omitidos.push({ id, error: 'La boleta no existe' }); continue; }
      const eval1 = evaluarRevision(req.usuario, lineas);
      if (!eval1.permitido) { omitidos.push({ id, error: eval1.error }); continue; }

      // La condición `estado: PENDIENTE` evita que dos personas decidan la misma boleta a la vez: gana la primera.
      const idsGastos = eval1.pendientes.map((l) => l._id);
      await Gasto.updateMany({ _id: { $in: idsGastos }, estado: 'PENDIENTE' }, camposDecision(decision, req.usuario, motivoLimpio, ahora));
      const aplicadas = await Gasto.find({ _id: { $in: idsGastos }, revisadoPor: req.usuario._id, revisadoEn: ahora }).select('_id').lean();
      if (aplicadas.length === 0) { omitidos.push({ id, error: 'Otra persona revisó esta boleta antes que tú' }); continue; }

      documentos += 1;
      gastos += aplicadas.length;
      const aplicadasIds = new Set(aplicadas.map((g) => String(g._id)));
      const accion = decision === 'APROBAR' ? 'APROBADO' : 'RECHAZADO';
      await registrar(
        eval1.pendientes.filter((l) => aplicadasIds.has(String(l._id))).map((l) =>
          evento(accion, { ...l, estado: accion }, req.usuario, { motivoRevision: decision === 'RECHAZAR' ? motivoLimpio : null })
        )
      );
    }
    res.json({ decision, documentos, gastos, omitidos });
  } catch (err) {
    console.error('Error al revisar los gastos:', err);
    res.status(500).json({ error: 'No se pudo completar la revisión' });
  }
});

// ---------- Reabrir la revisión ----------
router.post('/revision/reabrir', auth, async (req, res) => {
  try {
    if (!puedeRevisar(req.usuario)) return res.status(403).json({ error: 'No tienes permiso para reabrir la revisión de un gasto' });
    const { ids, error } = idsDeBody(req.body);
    if (error) return res.status(400).json({ error });
    const motivo = String((req.body && req.body.motivo) || '').trim().slice(0, MOTIVO_MAX);

    const omitidos = [];
    let documentos = 0;
    let gastos = 0;
    for (const id of ids) {
      const lineas = await cargarLineas(id);
      if (lineas.length === 0) { omitidos.push({ id, error: 'La boleta no existe' }); continue; }
      const permiso = evaluarReapertura(req.usuario, lineas);
      if (!permiso.permitido) { omitidos.push({ id, error: permiso.error }); continue; }
      await Gasto.updateMany({ _id: { $in: permiso.decididas.map((l) => l._id) } }, camposReapertura());
      documentos += 1;
      gastos += permiso.decididas.length;
      await registrar(permiso.decididas.map((l) => evento('REABIERTO', { ...l, estado: 'PENDIENTE' }, req.usuario, { motivoRevision: motivo || null })));
    }
    res.json({ documentos, gastos, omitidos });
  } catch (err) {
    console.error('Error al reabrir la revisión:', err);
    res.status(500).json({ error: 'No se pudo reabrir la revisión' });
  }
});

// ---------- Una boleta (para corregirla) ----------
router.get('/documento/:id', auth, async (req, res) => {
  try {
    const lineas = await cargarLineas(req.params.id);
    if (lineas.length === 0) return res.status(404).json({ error: 'Boleta no encontrada' });
    const propia = lineas.every((l) => String(idDe(l.usuario)) === String(req.usuario._id));
    const puede = propia || (puedeRevisar(req.usuario) && tieneAccesoLocal(req.usuario, idDe(lineas[0].local)));
    if (!puede) return res.status(403).json({ error: 'No tienes acceso a esta boleta' });
    res.json(agruparDocumentos(lineas)[0]);
  } catch (err) {
    console.error('Error al cargar la boleta:', err);
    res.status(500).json({ error: 'No se pudo cargar la boleta' });
  }
});

// ---------- Corregir una boleta rechazada ----------
// Body: igual que al crearla, más `claveEdicion` (identifica este intento: si se repite no duplica nada) y, en cada
// producto que ya existía, su `gastoId`. Los productos sin gastoId son nuevos; los que ya no vengan se quitan (queda
// constancia en el historial). Al terminar, TODA la boleta vuelve a PENDIENTE para que se revise de nuevo.
router.put('/documento/:id', auth, checkRol('MASTER', 'ADMINISTRADOR'), async (req, res) => {
  try {
    const lineas = await cargarLineas(req.params.id);
    if (lineas.length === 0) return res.status(404).json({ error: 'Boleta no encontrada' });

    const claveEdicion = String((req.body && req.body.claveEdicion) || '').trim().slice(0, 80);
    if (!claveEdicion) return res.status(400).json({ error: 'Falta la clave de la corrección' });

    const permiso = evaluarCorreccion(req.usuario, lineas, claveEdicion);
    if (!permiso.permitido) return res.status(403).json({ error: permiso.error });

    const docId = lineas[0].documentoId || String(lineas[0]._id);
    const localId = idDe(lineas[0].local);
    const uploaderId = idDe(lineas[0].usuario);
    const respuesta = (gastos) => ({
      documentoId: docId,
      numeroDocumento: gastos.map((g) => g.numeroDocumento).find((n) => Number.isInteger(n)) ?? null,
      folio: gastos[0] ? gastos[0].folio : null,
      estado: 'PENDIENTE',
      total: gastos.reduce((a, g) => a + g.monto, 0),
      gastos
    });
    if (permiso.yaAplicada) return res.json(respuesta(lineas)); // reintento de una corrección que ya se había guardado

    const { error, datos } = validarDocumento({ ...req.body, claveDocumento: claveEdicion, local: String(localId) });
    if (error) return res.status(400).json({ error });

    // Cada producto indica a qué producto existente corresponde (gastoId) o es nuevo.
    const porId = new Map(lineas.map((l) => [String(l._id), l]));
    const usados = new Set();
    for (let i = 0; i < datos.items.length; i += 1) {
      const gid = datos.items[i].gastoId;
      if (!gid) continue;
      if (!porId.has(gid)) return res.status(400).json({ error: `Producto ${i + 1}: no pertenece a esta boleta` });
      if (usados.has(gid)) return res.status(400).json({ error: `Producto ${i + 1}: está repetido` });
      usados.add(gid);
    }
    const clavesNuevas = datos.items.map((it, i) => (it.gastoId ? null : `${claveEdicion}:${i}`));
    const clavesSet = new Set(clavesNuevas.filter(Boolean));
    // Quitados: los que ya no vienen. (Los creados por un intento anterior de esta misma corrección no cuentan.)
    const quitados = lineas.filter((l) => !usados.has(String(l._id)) && !clavesSet.has(l.claveUnica));

    // Folio ya usado por otro documento del mismo local (solo si el folio cambió).
    if (datos.folioClave !== lineas[0].folioClave && req.body.confirmarFolioRepetido !== true) {
      const otro = await Gasto.findOne({
        local: localId,
        folioClave: datos.folioClave,
        documentoId: { $ne: docId },
        _id: { $nin: lineas.map((l) => l._id) },
        estado: { $ne: 'RECHAZADO' }
      }).populate('usuario', 'nombre');
      if (otro) {
        const quien = otro.usuario && otro.usuario.nombre ? ` por ${otro.usuario.nombre}` : '';
        return res.status(409).json({
          codigo: 'FOLIO_REPETIDO',
          error: `Ya hay un documento con el folio ${datos.folio} en este local (ingresado${quien}). Si es un documento distinto, confírmalo para guardarlo igual.`
        });
      }
    }

    // Productos del catálogo: los nuevos o cambiados deben estar activos; uno que no cambió se acepta aunque ya esté inactivo.
    const idsProductos = [...new Set(datos.items.map((it) => String(it.productoCatalogoId)))];
    const productos = new Map((await ProductoCatalogo.find({ _id: { $in: idsProductos } })).map((p) => [String(p._id), p]));
    for (let i = 0; i < datos.items.length; i += 1) {
      const it = datos.items[i];
      const p = productos.get(String(it.productoCatalogoId));
      const existente = it.gastoId ? porId.get(it.gastoId) : null;
      const sinCambio = existente && String(idDe(existente.productoCatalogoId)) === String(it.productoCatalogoId);
      if (!p || (!p.activo && !sinCambio)) return res.status(400).json({ error: `Producto ${i + 1}: el ítem no existe o ya no está activo en el catálogo` });
    }

    const ahora = new Date();
    const numeroDocumento = lineas.map((l) => l.numeroDocumento).find((n) => Number.isInteger(n)) ?? null;
    const comunes = {
      documentoId: docId, numeroDocumento, folio: datos.folio, folioClave: datos.folioClave, fecha: datos.fecha, mes: mesDeFecha(datos.fecha),
      medioPago: datos.medioPago, fotoBoletaUrl: datos.fotoBoletaUrl, fotosBoletaUrls: datos.fotos
    };

    // 1) Quitar productos (con constancia ANTES de borrar: si el registro falla, no se borra nada).
    for (const l of quitados) {
      await HistorialGasto.create(evento('ELIMINADO', l, req.usuario, { motivoEliminacion: 'Quitado al corregir la boleta' }));
    }
    for (const l of quitados) await Gasto.deleteOne({ _id: l._id });

    // 2) Actualizar los que siguen y crear los nuevos.
    const eventos = [];
    const creados = [];
    for (let i = 0; i < datos.items.length; i += 1) {
      const it = datos.items[i];
      const p = productos.get(String(it.productoCatalogoId));
      const producto = { productoNombre: p.item, productoCatalogoId: p._id, categoria: p.ratio, cuentaContable: p.cuentaContable };
      const detalle = { cantidad: it.cantidad, unidadMedida: it.unidadMedida, monto: it.monto, motivo: it.motivo };
      if (it.gastoId) {
        const l = porId.get(it.gastoId);
        const cambios = { ...producto, ...detalle, ...comunes, ...camposReenvio(l, ahora, claveEdicion) };
        await Gasto.updateOne({ _id: l._id }, { $set: cambios });
        eventos.push(evento('EDITADO', { ...l, ...cambios }, req.usuario));
      } else {
        try {
          const nuevo = await Gasto.create({
            ...producto, ...detalle, ...comunes, local: localId, usuario: uploaderId, claveUnica: clavesNuevas[i],
            estado: 'PENDIENTE', reenviadoEn: ahora, ultimaEdicion: claveEdicion
          });
          creados.push(nuevo);
          eventos.push(evento('CREADO', { ...(nuevo.toObject ? nuevo.toObject() : nuevo), local: lineas[0].local, usuario: lineas[0].usuario }, req.usuario));
        } catch (err) {
          if (!(err && err.code === 11000)) throw err; // la creó un intento anterior de esta misma corrección
        }
      }
    }
    await registrar(eventos);

    const finales = await Gasto.find({ documentoId: docId }).lean();
    res.json(respuesta(finales));
  } catch (err) {
    console.error('Error al corregir la boleta:', err);
    res.status(500).json({ error: 'No se pudo guardar la corrección' });
  }
});

module.exports = router;
