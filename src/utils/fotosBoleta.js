// Fotos de una boleta o factura: de 1 a 3, compartidas por todos los productos del documento.
// `fotoBoletaUrl` (la primera foto) se mantiene en cada gasto por compatibilidad: los gastos de antes, las apps sin
// actualizar y los reportes siguen leyéndola. `fotosBoletaUrls` es la lista completa.
const MAX_FOTOS = 3;
const MAX_LARGO_URL = 500;

// Todas las fotos de un gasto, sea nuevo (lista) o antiguo (una sola).
function fotosDe(gasto) {
  if (!gasto) return [];
  if (Array.isArray(gasto.fotosBoletaUrls) && gasto.fotosBoletaUrls.length > 0) return gasto.fotosBoletaUrls;
  return gasto.fotoBoletaUrl ? [gasto.fotoBoletaUrl] : [];
}

// Lee las fotos de un envío: acepta la lista nueva (`fotosBoletaUrls`) o la foto única de las apps antiguas
// (`fotoBoletaUrl`). Si vienen las dos, manda la lista (salvo que esté vacía). Devuelve { error } o { fotos } (sin repetidas, en orden).
function normalizarFotos({ fotosBoletaUrls, fotoBoletaUrl } = {}) {
  let crudas;
  if (fotosBoletaUrls !== undefined && fotosBoletaUrls !== null && !Array.isArray(fotosBoletaUrls)) {
    return { error: 'Las fotos de la boleta deben enviarse como una lista' };
  }
  if (Array.isArray(fotosBoletaUrls) && fotosBoletaUrls.length > 0) {
    crudas = fotosBoletaUrls; // la lista nueva manda
  } else if (fotoBoletaUrl) {
    crudas = [fotoBoletaUrl]; // apps antiguas (o lista vacía acompañada de la foto única)
  } else {
    crudas = [];
  }

  const fotos = [];
  for (const cruda of crudas) {
    if (typeof cruda !== 'string' || !cruda.trim()) return { error: 'Una de las fotos de la boleta no es válida' };
    const url = cruda.trim();
    // solo direcciones web: nunca "javascript:", "data:" u otros esquemas
    if (url.length > MAX_LARGO_URL || !/^https?:\/\//i.test(url)) return { error: 'Una de las fotos de la boleta no es válida' };
    if (!fotos.includes(url)) fotos.push(url);
  }

  if (fotos.length === 0) return { error: 'Adjunta al menos una foto de la boleta o factura' };
  if (fotos.length > MAX_FOTOS) return { error: `Una boleta puede tener hasta ${MAX_FOTOS} fotos` };
  return { fotos };
}

module.exports = { MAX_FOTOS, fotosDe, normalizarFotos };
