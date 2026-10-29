// Funciones PURAS del historial de gastos y de los permisos para eliminar. No tocan la base de
// datos, así se pueden probar sin MongoDB.
const { hoyEnZona } = require('./periodos');
const { fotosDe } = require('./fotosBoleta');

const MOTIVO_ELIMINACION_MIN = 3;

function idDe(valor) {
  if (valor == null) return null;
  return valor._id !== undefined ? valor._id : valor;
}

// Arma el documento del historial a partir de un gasto (plano o de Mongoose).
//   gasto.local / gasto.usuario pueden venir como id o ya "populados" ({ _id, nombre }).
//   subidoPor: quien subió el gasto originalmente.  realizadoPor: quien hizo esta acción.
function construirEvento({ accion, gasto, localNombre, subidoPor, realizadoPor, motivoEliminacion, fechaEvento }) {
  return {
    accion,
    fechaEvento: fechaEvento || new Date(),
    gastoId: gasto._id,
    local: idDe(gasto.local),
    localNombre: localNombre || (gasto.local && gasto.local.nombre) || null,
    realizadoPor: {
      usuario: idDe(realizadoPor) || null,
      nombre: (realizadoPor && realizadoPor.nombre) || null,
      rol: (realizadoPor && realizadoPor.rol) || null
    },
    motivoEliminacion: accion === 'ELIMINADO' ? motivoEliminacion : null,
    gasto: {
      productoNombre: gasto.productoNombre,
      productoCatalogoId: gasto.productoCatalogoId,
      categoria: gasto.categoria,
      cuentaContable: gasto.cuentaContable,
      cantidad: gasto.cantidad,
      unidadMedida: gasto.unidadMedida,
      monto: gasto.monto,
      medioPago: gasto.medioPago,
      fecha: gasto.fecha,
      mes: gasto.mes,
      motivo: gasto.motivo,
      fotoBoletaUrl: gasto.fotoBoletaUrl,
      fotosBoletaUrls: fotosDe(gasto),
      folio: gasto.folio || null,
      numeroDocumento: gasto.numeroDocumento == null ? null : gasto.numeroDocumento,
      documentoId: gasto.documentoId || null,
      subidoPor: {
        usuario: idDe(subidoPor) || idDe(gasto.usuario) || null,
        nombre: (subidoPor && subidoPor.nombre) || (gasto.usuario && gasto.usuario.nombre) || null
      },
      subidoEn: gasto.createdAt || null
    }
  };
}

// ¿Puede este usuario eliminar este gasto?
//   MASTER: siempre.
//   ADMINISTRADOR: solo gastos que él subió, de locales que aún tiene asignados, y solo durante
//   el mes (en la zona horaria del negocio) en que los subió.
//   Cualquier otro rol: no.
function evaluarEliminacion(usuario, gasto, ahora = new Date()) {
  if (usuario.rol === 'MASTER') return { permitido: true };
  if (usuario.rol !== 'ADMINISTRADOR') {
    return { permitido: false, error: 'No tienes permiso para eliminar gastos' };
  }

  if (String(idDe(gasto.usuario)) !== String(usuario._id)) {
    return { permitido: false, error: 'Solo puedes eliminar los gastos que tú subiste' };
  }

  const localId = String(idDe(gasto.local));
  if (!(usuario.localesAsignados || []).some((id) => String(id) === localId)) {
    return { permitido: false, error: 'Ya no tienes acceso al local de este gasto' };
  }

  const subido = gasto.createdAt || gasto.fecha;
  const mesSubida = hoyEnZona(undefined, new Date(subido)).slice(0, 7);
  const mesActual = hoyEnZona(undefined, ahora).slice(0, 7);
  if (mesSubida !== mesActual) {
    return {
      permitido: false,
      error: 'Este gasto ya no se puede eliminar: solo se pueden eliminar durante el mes en que se subieron'
    };
  }
  return { permitido: true };
}

module.exports = { construirEvento, evaluarEliminacion, MOTIVO_ELIMINACION_MIN };
