// Validación (pura) del cuerpo de POST /api/gastos/documento: una boleta o factura con uno o más productos.
const { validarFolio } = require('./folio');

const UNIDADES = ['KG', 'UN', 'LT', 'GR'];
const MEDIOS_PAGO = ['EFECTIVO', 'TRANSFERENCIA', 'EFECTIVO_FLUJO'];
const MAX_PRODUCTOS = 30;

function numeroPositivo(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Devuelve { error } o { datos } con todo ya normalizado.
function validarDocumento(body) {
  const { claveDocumento, local, folio, fecha, medioPago, fotoBoletaUrl, items } = body || {};

  if (!local || !fecha || !medioPago || !fotoBoletaUrl) {
    return { error: 'Faltan campos obligatorios (local, fecha, medio de pago y foto de la boleta)' };
  }
  if (typeof claveDocumento !== 'string' || !claveDocumento.trim()) {
    return { error: 'Falta la clave única del documento' };
  }

  const f = validarFolio(folio);
  if (!f.ok) return { error: f.error };

  if (!MEDIOS_PAGO.includes(medioPago)) return { error: 'Medio de pago inválido' };
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(fecha)) || Number.isNaN(new Date(fecha).getTime())) {
    return { error: 'Fecha inválida' };
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { error: 'El documento debe tener al menos un producto' };
  }
  if (items.length > MAX_PRODUCTOS) {
    return { error: `Un documento puede tener hasta ${MAX_PRODUCTOS} productos` };
  }

  const normalizados = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i] || {};
    const n = i + 1;
    if (!it.productoCatalogoId) return { error: `Producto ${n}: falta seleccionar el ítem` };
    const cantidad = numeroPositivo(it.cantidad);
    if (!cantidad) return { error: `Producto ${n}: ingresa una cantidad válida` };
    if (!UNIDADES.includes(it.unidadMedida)) return { error: `Producto ${n}: unidad de medida inválida` };
    const monto = numeroPositivo(it.monto);
    if (!monto) return { error: `Producto ${n}: ingresa un monto válido` };
    const motivo = typeof it.motivo === 'string' ? it.motivo.trim() : '';
    if (!motivo) return { error: `Producto ${n}: ingresa el motivo del gasto` };
    normalizados.push({ productoCatalogoId: it.productoCatalogoId, cantidad, unidadMedida: it.unidadMedida, monto, motivo });
  }

  return {
    datos: {
      claveDocumento: claveDocumento.trim().slice(0, 80),
      local,
      folio: f.folio,
      folioClave: f.clave,
      fecha,
      medioPago,
      fotoBoletaUrl,
      items: normalizados
    }
  };
}

module.exports = { validarDocumento, MAX_PRODUCTOS };
