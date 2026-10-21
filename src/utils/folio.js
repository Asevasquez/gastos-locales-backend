// Folio (número de documento) de una boleta o factura.
const FOLIO_MAX = 30;

// Forma comparable de un folio: mayúsculas, sin espacios ni símbolos y sin ceros a la izquierda.
// Así "N° 001234", "Folio 1234" y "1.234" cuentan como el mismo folio.
function normalizarFolio(texto) {
  return String(texto == null ? '' : texto)
    .toUpperCase()
    .trim()
    // prefijos que solo rotulan el número: "N° 123", "Nº 123", "Nro 123", "Folio: 123"
    .replace(/^N\s*[°º]\s*/, '')
    .replace(/^NRO(\.\s*|\s+)/, '')
    .replace(/^FOLIO[\s:.]+/, '')
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^0+(?=.)/, '');
}

function validarFolio(texto) {
  const folio = String(texto == null ? '' : texto).trim().replace(/\s+/g, ' ');
  if (!folio) {
    return { ok: false, error: 'Ingresa el número de documento o folio de la boleta o factura' };
  }
  if (folio.length > FOLIO_MAX) {
    return { ok: false, error: `El folio no puede tener más de ${FOLIO_MAX} caracteres` };
  }
  const clave = normalizarFolio(folio);
  if (!clave || /^0+$/.test(clave)) {
    return { ok: false, error: 'El folio no es válido: debe incluir el número del documento' };
  }
  return { ok: true, folio, clave };
}

module.exports = { normalizarFolio, validarFolio, FOLIO_MAX };
