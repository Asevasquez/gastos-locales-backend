// Funciones pequeñas que comparten las rutas de gastos y las de revisión.

// La fecha del gasto llega como día de calendario ("YYYY-MM-DD") y se guarda a medianoche UTC, así que el mes se
// lee en UTC: con getMonth() local, un servidor que no esté en UTC calcularía mal el mes de los gastos del día 1.
function mesDeFecha(fecha) {
  const d = new Date(fecha);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// MASTER accede a todos los locales; el resto, solo a los que tiene asignados.
function tieneAccesoLocal(usuario, localId) {
  if (usuario.rol === 'MASTER') return true;
  return (usuario.localesAsignados || []).some((id) => id.toString() === localId.toString());
}

// Los gastos RECHAZADOS no cuentan en los totales ni en las alertas hasta que se corrijan y se aprueben o queden
// pendientes otra vez. (`$ne` también deja pasar a los gastos que aún no tienen estado.)
const SOLO_VIGENTES = { estado: { $ne: 'RECHAZADO' } };

module.exports = { mesDeFecha, tieneAccesoLocal, SOLO_VIGENTES };
