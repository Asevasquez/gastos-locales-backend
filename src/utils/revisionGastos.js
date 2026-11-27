// Reglas PURAS de la revisión de gastos (aprobar / rechazar / reabrir) y de la corrección de lo rechazado.
// No tocan la base de datos, así se prueban sin MongoDB.
//
// La revisión es por BOLETA COMPLETA: todos los productos de una misma boleta (mismo `documentoId`) se aprueban o se
// rechazan juntos, porque comparten folio, foto, fecha y medio de pago. Un gasto antiguo sin `documentoId` es una
// boleta de un solo producto.
const { fotosDe } = require('./fotosBoleta');

const ESTADOS = ['PENDIENTE', 'APROBADO', 'RECHAZADO'];
const ROLES_REVISORES = ['MASTER', 'ANALISTA', 'GERENCIA'];
const MOTIVO_RECHAZO_MIN = 5;
const MOTIVO_MAX = 500; // el motivo puede combinar varias respuestas rápidas y un comentario
const MAX_DOCUMENTOS_POR_ACCION = 200;

const idDe = (v) => (v == null ? null : v._id !== undefined ? v._id : v);
const igual = (a, b) => a != null && b != null && String(idDe(a)) === String(idDe(b));

// Identifica la boleta de un gasto.
function claveDocumento(gasto) {
  return gasto.documentoId || String(gasto._id);
}

function puedeRevisar(usuario) {
  return !!usuario && ROLES_REVISORES.includes(usuario.rol);
}

function tieneLocal(usuario, localId) {
  if (usuario.rol === 'MASTER') return true;
  return (usuario.localesAsignados || []).some((id) => igual(id, localId));
}

// Estado de la boleta: basta un producto rechazado para que lo esté; si no, pendiente mientras quede alguno por revisar.
function estadoDeDocumento(lineas) {
  if (lineas.some((l) => l.estado === 'RECHAZADO')) return 'RECHAZADO';
  if (lineas.some((l) => !l.estado || l.estado === 'PENDIENTE')) return 'PENDIENTE';
  return 'APROBADO';
}

function nombreDe(valor) {
  return valor && typeof valor === 'object' ? valor.nombre || null : null;
}

// Junta los gastos (uno por producto) en boletas, manteniendo el orden de aparición.
function agruparDocumentos(gastos) {
  const porClave = new Map();
  for (const g of gastos) {
    const clave = claveDocumento(g);
    if (!porClave.has(clave)) porClave.set(clave, []);
    porClave.get(clave).push(g);
  }
  return [...porClave.entries()].map(([id, lineas]) => {
    const p = lineas[0];
    const rechazada = lineas.find((l) => l.estado === 'RECHAZADO');
    const decidida = lineas.find((l) => l.revisadoEn);
    return {
      id,
      documentoId: p.documentoId || null,
      numeroDocumento: p.numeroDocumento == null ? null : p.numeroDocumento,
      folio: p.folio || null,
      local: p.local,
      fecha: p.fecha,
      medioPago: p.medioPago,
      fotosBoletaUrls: fotosDe(p),
      subidoPor: p.usuario,
      subidoEn: p.createdAt || null,
      estado: estadoDeDocumento(lineas),
      total: lineas.reduce((a, l) => a + (l.monto || 0), 0),
      motivoRechazo: rechazada ? rechazada.motivoRechazo || null : null,
      revisadoPor: decidida ? decidida.revisadoPor || null : null,
      revisadoEn: decidida ? decidida.revisadoEn : null,
      vecesRechazado: Math.max(...lineas.map((l) => l.vecesRechazado || 0)),
      reenviadoEn: lineas.map((l) => l.reenviadoEn).filter(Boolean).sort().pop() || null,
      rechazoAnterior: (lineas.find((l) => l.rechazoAnterior && l.rechazoAnterior.motivo) || {}).rechazoAnterior || null,
      lineas: lineas.map((l) => ({
        _id: l._id,
        productoNombre: l.productoNombre,
        productoCatalogoId: l.productoCatalogoId,
        categoria: l.categoria,
        cuentaContable: l.cuentaContable,
        cantidad: l.cantidad,
        unidadMedida: l.unidadMedida,
        monto: l.monto,
        motivo: l.motivo,
        estado: l.estado || 'PENDIENTE'
      }))
    };
  });
}

// ---------- Aprobar / rechazar ----------
// Devuelve { permitido, error, pendientes }: `pendientes` son los productos de la boleta que aún se pueden decidir.
function evaluarRevision(usuario, lineas) {
  if (!puedeRevisar(usuario)) return { permitido: false, error: 'No tienes permiso para aprobar o rechazar gastos' };
  if (!tieneLocal(usuario, lineas[0].local)) return { permitido: false, error: 'No tienes acceso al local de este gasto' };
  if (lineas.some((l) => igual(l.usuario, usuario._id))) {
    return { permitido: false, error: 'No puedes aprobar ni rechazar un gasto que subiste tú: debe revisarlo otra persona' };
  }
  const pendientes = lineas.filter((l) => !l.estado || l.estado === 'PENDIENTE');
  if (pendientes.length === 0) {
    const decidido = estadoDeDocumento(lineas) === 'RECHAZADO' ? 'rechazada' : 'aprobada';
    return { permitido: false, error: `Esta boleta ya fue revisada (${decidido})` };
  }
  return { permitido: true, pendientes };
}

// Cambios que se aplican a cada producto al decidir. Rechazar exige un motivo.
function camposDecision(decision, usuario, motivo, ahora) {
  if (decision === 'APROBAR') {
    return { $set: { estado: 'APROBADO', revisadoPor: usuario._id, revisadoEn: ahora, motivoRechazo: null } };
  }
  return {
    $set: { estado: 'RECHAZADO', revisadoPor: usuario._id, revisadoEn: ahora, motivoRechazo: motivo },
    $inc: { vecesRechazado: 1 }
  };
}

// ---------- Reabrir la revisión ----------
// Sirve para corregir un error al revisar (por ejemplo, aprobar la boleta equivocada). Lo puede hacer MASTER, o quien
// tomó la decisión. Las boletas aprobadas de antes de existir la revisión (sin revisor) solo las reabre un MASTER.
function evaluarReapertura(usuario, lineas) {
  if (!puedeRevisar(usuario)) return { permitido: false, error: 'No tienes permiso para reabrir la revisión de un gasto' };
  if (!tieneLocal(usuario, lineas[0].local)) return { permitido: false, error: 'No tienes acceso al local de este gasto' };
  const decididas = lineas.filter((l) => l.estado === 'APROBADO' || l.estado === 'RECHAZADO');
  if (decididas.length === 0) return { permitido: false, error: 'Esta boleta ya está pendiente de revisión' };
  if (usuario.rol !== 'MASTER' && !decididas.every((l) => igual(l.revisadoPor, usuario._id))) {
    return { permitido: false, error: 'Solo puede reabrir la revisión quien la hizo, o un MASTER' };
  }
  return { permitido: true, decididas };
}

function camposReapertura() {
  return { $set: { estado: 'PENDIENTE', revisadoPor: null, revisadoEn: null, motivoRechazo: null } };
}

// ---------- Corregir una boleta rechazada ----------
// ADMINISTRADOR: solo boletas que él subió, de un local que tiene asignado y que estén RECHAZADAS. MASTER: cualquiera.
// `claveEdicion` identifica un intento de corrección: si ya se aplicó (reintento tras perder la respuesta), no es un error.
function evaluarCorreccion(usuario, lineas, claveEdicion) {
  if (usuario.rol !== 'ADMINISTRADOR' && usuario.rol !== 'MASTER') {
    return { permitido: false, error: 'No tienes permiso para corregir boletas' };
  }
  if (usuario.rol === 'ADMINISTRADOR') {
    if (!tieneLocal(usuario, lineas[0].local)) return { permitido: false, error: 'No tienes acceso al local de esta boleta' };
    if (!lineas.every((l) => igual(l.usuario, usuario._id))) {
      return { permitido: false, error: 'Solo puedes corregir las boletas que tú subiste' };
    }
  }
  const yaAplicada = !!claveEdicion && lineas.every((l) => l.ultimaEdicion === claveEdicion);
  if (yaAplicada) return { permitido: true, yaAplicada: true };
  if (usuario.rol === 'ADMINISTRADOR' && !lineas.every((l) => l.estado === 'RECHAZADO' || (claveEdicion && l.ultimaEdicion === claveEdicion))) {
    return { permitido: false, error: 'Esta boleta no está rechazada, por eso no se puede corregir' };
  }
  return { permitido: true, yaAplicada: false };
}

// Cambios comunes a cada producto de una boleta corregida: vuelve a revisión, recordando por qué se había rechazado.
function camposReenvio(linea, ahora, claveEdicion) {
  const estabaRechazada = linea.estado === 'RECHAZADO';
  return {
    estado: 'PENDIENTE',
    revisadoPor: null,
    revisadoEn: null,
    motivoRechazo: null,
    reenviadoEn: ahora,
    editadoEn: ahora,
    ultimaEdicion: claveEdicion,
    rechazoAnterior: estabaRechazada
      ? { motivo: linea.motivoRechazo || null, por: nombreDe(linea.revisadoPor), en: linea.revisadoEn || null }
      : linea.rechazoAnterior || null
  };
}

// ---------- Gastos que ya existían al activar la revisión ----------
// Los subidos antes del mes de inicio de la revisión quedan APROBADOS (ya están cerrados: ni el administrador puede
// eliminarlos); los del mes en curso quedan PENDIENTES para revisarlos.
function inicioDeMes(mes) {
  const [anio, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(anio, m - 1, 1, 4, 0, 0)); // 00:00 en Chile (UTC-4); la diferencia de una hora con el horario de verano no importa
}

module.exports = {
  ESTADOS, ROLES_REVISORES, MOTIVO_RECHAZO_MIN, MOTIVO_MAX, MAX_DOCUMENTOS_POR_ACCION,
  claveDocumento, puedeRevisar, tieneLocal, estadoDeDocumento, agruparDocumentos,
  evaluarRevision, camposDecision, evaluarReapertura, camposReapertura, evaluarCorreccion, camposReenvio, inicioDeMes
};
