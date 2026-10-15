const assert = require('node:assert/strict');
const B = require('path').join(__dirname, '..', 'src', 'utils');
const { rangosPeriodo, hoyEnZona } = require(`${B}/periodos`);
const { calcularResumen, calcularLocales, calcularControl } = require(`${B}/dashboardCalculos`);

let pruebas = 0;
const t = (nombre, fn) => { fn(); pruebas += 1; console.log('  ✓', nombre); };

// ---------------- PERÍODOS ----------------
console.log('Períodos');
t('mes en curso: 1–14 oct contra 1–14 sept, serie de 6 meses', () => {
  const p = rangosPeriodo({ mes: '2026-10' }, '2026-10-14');
  assert.deepEqual(p.actual, { desde: '2026-10-01', hasta: '2026-10-14' });
  assert.deepEqual(p.anterior, { desde: '2026-09-01', hasta: '2026-09-14' });
  assert.deepEqual(p.serie[0], { desde: '2026-05-01', hasta: '2026-05-14' });
  assert.equal(p.serie.length, 6); assert.equal(p.dias, 14); assert.equal(p.diasMes, 31); assert.equal(p.enCurso, true);
});
t('mes pasado: mes completo contra mes completo', () => {
  const p = rangosPeriodo({ mes: '2026-09' }, '2026-10-14');
  assert.deepEqual(p.actual, { desde: '2026-09-01', hasta: '2026-09-30' });
  assert.deepEqual(p.anterior, { desde: '2026-08-01', hasta: '2026-08-31' });
  assert.equal(p.enCurso, false);
});
t('enero: el anterior es diciembre del año previo', () => {
  const p = rangosPeriodo({ mes: '2026-01' }, '2026-01-20');
  assert.deepEqual(p.anterior, { desde: '2025-12-01', hasta: '2025-12-20' });
  assert.deepEqual(p.serie[0], { desde: '2025-08-01', hasta: '2025-08-20' });
});
t('marzo en curso (día 30) se recorta a los 28 días de febrero', () => {
  const p = rangosPeriodo({ mes: '2026-03' }, '2026-03-30');
  assert.deepEqual(p.anterior, { desde: '2026-02-01', hasta: '2026-02-28' });
});
t('semana en curso: lunes 12 al domingo 18, hoy miércoles 14', () => {
  const p = rangosPeriodo({ desde: '2026-10-12', hasta: '2026-10-18' }, '2026-10-14');
  assert.deepEqual(p.actual, { desde: '2026-10-12', hasta: '2026-10-14' });
  assert.deepEqual(p.anterior, { desde: '2026-10-05', hasta: '2026-10-07' });
  assert.deepEqual(p.serie[0], { desde: '2026-09-07', hasta: '2026-09-09' });
  assert.equal(p.tipo, 'rango'); assert.equal(p.dias, 3);
});
t('semana ya terminada: 7 días contra los 7 anteriores', () => {
  const p = rangosPeriodo({ desde: '2026-10-05', hasta: '2026-10-11' }, '2026-10-14');
  assert.deepEqual(p.actual, { desde: '2026-10-05', hasta: '2026-10-11' });
  assert.deepEqual(p.anterior, { desde: '2026-09-28', hasta: '2026-10-04' });
  assert.equal(p.enCurso, false);
});
t('sin parámetros usa el mes de hoy; rango inválido lanza error', () => {
  assert.equal(rangosPeriodo({}, '2026-10-14').mes, '2026-10');
  assert.throws(() => rangosPeriodo({ desde: 'abc' }, '2026-10-14'));
});
t('hoyEnZona respeta la zona de Chile (23:00 del 14 → sigue siendo 14)', () => {
  assert.equal(hoyEnZona('America/Santiago', new Date('2026-10-15T02:00:00Z')), '2026-10-14');
});

// ---------------- DATOS DE PRUEBA ----------------
const loc = (id, nombre, marca, activo = true) => ({ _id: id, nombre, marca, activo, codigoExterno: `C-${id}` });
const locales = [loc('A', 'KAMI · Providencia', 'KAMI_SUSHI'), loc('B', 'Latin Pizza · Ñuñoa', 'LATIN_PIZZA'),
  loc('C', 'KAMI · Maipú', 'KAMI_SUSHI'), loc('D', 'KAMI · Vitacura', 'KAMI_SUSHI'), loc('E', 'KAMI · Cerrado', 'KAMI_SUSHI', false)];
let seq = 0;
const g = (local, fecha, monto, o = {}) => ({ _id: `g${++seq}`, local, fecha: new Date(fecha), monto, medioPago: 'EFECTIVO',
  categoria: 'gasto_de_producción', cuentaContable: 'compras', productoNombre: 'Arroz', productoCatalogoId: 'i1',
  cantidad: 1, unidadMedida: 'UN', motivo: 'Motivo de prueba largo', editadoEn: null, fotoBoletaUrl: 'http://x/f.jpg', ...o });

const gastos = [
  // período actual (1–14 oct)
  g('A', '2026-10-01', 100000, { cantidad: 100, unidadMedida: 'KG', motivo: 'Reposición de arroz' }),
  g('A', '2026-10-05', 50000, { medioPago: 'TRANSFERENCIA', productoNombre: 'Aceites', productoCatalogoId: 'i2', cantidad: 20, unidadMedida: 'LT' }),
  g('B', '2026-10-05', 80000, { medioPago: 'EFECTIVO_FLUJO', cantidad: 100, unidadMedida: 'KG', motivo: 'x' }),
  g('B', '2026-10-14', 30000, { medioPago: 'TRANSFERENCIA', categoria: 'gastos_de_administración_y_ventas', cuentaContable: 'internet', productoNombre: 'Internet', productoCatalogoId: 'i3', editadoEn: new Date('2026-10-14') }),
  g('C', '2026-10-10', 20000, { categoria: 'gasto_de_producción_indirecto', cuentaContable: 'aseo', productoNombre: 'Aseo y limpieza', productoCatalogoId: 'i4', cantidad: 4 }),
  g('E', '2026-10-02', 10000, { categoria: 'gastos_de_administración_y_ventas', cuentaContable: 'gas', productoNombre: 'Gas', productoCatalogoId: 'i5' }),
  // período anterior (1–14 sept)
  g('A', '2026-09-03', 120000), g('B', '2026-09-10', 60000),
  g('C', '2026-09-12', 20000, { categoria: 'gasto_de_producción_indirecto', cuentaContable: 'aseo', productoNombre: 'Aseo y limpieza', productoCatalogoId: 'i4' }),
  // agosto (serie[3]) y gastos FUERA de todo período (deben ignorarse)
  g('A', '2026-08-05', 40000),
  g('A', '2026-09-20', 999999), g('A', '2026-10-20', 999999), g('A', '2026-04-30', 999999)
];
const periodo = rangosPeriodo({ mes: '2026-10' }, '2026-10-14');

// ---------------- RESUMEN ----------------
console.log('Resumen');
const r = calcularResumen({ gastos, locales, periodo });
t('totales y variación vs período anterior', () => {
  assert.equal(r.total, 290000); assert.equal(r.totalAnterior, 200000); assert.equal(r.variacionPct, 45);
  assert.equal(r.gastosRegistrados, 6); assert.equal(r.ticketPromedio, 48333);
});
t('proyección de cierre (290.000 ÷ 14 × 31) y promedio diario', () => {
  assert.equal(r.proyeccionCierre, 642143); assert.equal(r.promedioDiario, 20714);
});
t('ranking de locales, mayor gasto y variación por local', () => {
  assert.deepEqual(r.ranking.map((x) => [x.local._id, x.total]), [['A', 150000], ['B', 110000], ['C', 20000], ['E', 10000]]);
  assert.equal(r.localMayorGasto.local._id, 'A'); assert.equal(r.localMayorGasto.porcentaje, 51.7);
  assert.equal(r.ranking[0].variacionPct, 25); assert.equal(r.ranking[1].variacionPct, 83.3);
  assert.equal(r.ranking[2].variacionPct, 0); assert.equal(r.ranking[3].variacionPct, null);
});
t('locales sin registro: solo activos (D sí, E cerrado no); promedio por local', () => {
  assert.deepEqual(r.localesSinRegistro.map((x) => x._id), ['D']);
  assert.equal(r.promedioPorLocal, 72500); assert.equal(r.localesConRegistro, 4); assert.equal(r.totalLocalesActivos, 4);
});
t('efectivo: % y locales sobre el umbral de 70%', () => {
  assert.equal(r.efectivo.monto, 210000); assert.equal(r.efectivo.porcentaje, 72.4); assert.equal(r.efectivo.localesSobreUmbral, 3);
});
t('evolución diaria: 14 días y suma = total', () => {
  assert.equal(r.evolucionDiaria.length, 14);
  assert.equal(r.evolucionDiaria.reduce((a, d) => a + d.total, 0), r.total);
  assert.equal(r.evolucionDiaria.find((d) => d.fecha === '2026-10-05').total, 130000);
});
t('categorías, medios de pago y marcas suman el total', () => {
  assert.deepEqual(r.porCategoria.map((x) => [x.categoria, x.total]), [['gasto_de_producción', 230000], ['gastos_de_administración_y_ventas', 40000], ['gasto_de_producción_indirecto', 20000]]);
  assert.deepEqual(r.porMedioPago.map((x) => [x.medioPago, x.total]), [['EFECTIVO', 130000], ['TRANSFERENCIA', 80000], ['EFECTIVO_FLUJO', 80000]]);
  assert.equal(r.porMarca.reduce((a, x) => a + x.total, 0), r.total);
  const kami = r.porMarca.find((x) => x.marca === 'KAMI_SUSHI');
  assert.equal(kami.total, 180000); assert.equal(kami.localesConRegistro, 3); assert.equal(kami.promedioPorLocal, 60000);
});
t('cuentas contables: serie de 6 períodos (ignora gastos fuera de rango)', () => {
  const compras = r.cuentas.find((c) => c.cuentaContable === 'compras');
  assert.deepEqual(compras.serie, [0, 0, 0, 40000, 180000, 230000]);
  assert.equal(compras.actual, 230000); assert.equal(compras.anterior, 180000); assert.equal(compras.categoria, 'gasto_de_producción');
  assert.deepEqual(r.cuentas.map((c) => c.cuentaContable), ['compras', 'internet', 'aseo', 'gas']);
});
t('top ítems', () => {
  assert.deepEqual(r.topItems.slice(0, 2).map((x) => [x.item, x.total, x.n]), [['Arroz', 180000, 2], ['Aceites', 50000, 1]]);
});

// ---------------- LOCALES ----------------
console.log('Locales');
const l = calcularLocales({ gastos, locales, periodo, ultimaPorLocal: { A: '2026-10-14', B: '2026-10-14', C: '2026-10-10' } });
t('una fila por local activo + los que tienen gastos, orden por total', () => {
  assert.deepEqual(l.filas.map((f) => f.local._id), ['A', 'B', 'C', 'E', 'D']);
  assert.equal(l.filas[4].sinRegistro, true);
});
t('métricas por local', () => {
  const [a, b, c] = l.filas;
  assert.equal(a.porcentaje, 51.7); assert.equal(a.n, 2); assert.equal(a.ticket, 75000); assert.equal(a.pctEfectivo, 66.7);
  assert.deepEqual([a.composicion.produccion, a.composicion.admin], [100, 0]);
  assert.equal(b.pctEfectivo, 72.7); assert.equal(b.composicion.produccion, 72.7); assert.equal(b.composicion.admin, 27.3);
  assert.equal(c.composicion.indirecto, 100); assert.equal(c.variacionPct, 0);
  assert.equal(a.ultimoRegistro, '2026-10-14');
});

// ---------------- CONTROL ----------------
console.log('Control');
const promediosItem = { i1: { promedio: 60000, n: 10 }, i2: { promedio: 15000, n: 8 }, i3: { promedio: 30000, n: 3 }, i4: { promedio: 20000, n: 9 } };
const c = calcularControl({ gastos, locales, periodo, hoyISO: '2026-10-14', promediosItem,
  ultimaPorLocal: { A: '2026-10-14', B: '2026-10-14', C: '2026-10-10' } });
t('gastos atípicos: solo los ≥ 2,5× con historial suficiente', () => {
  assert.equal(c.totalAtipicos, 1);
  assert.deepEqual([c.atipicos[0].item, c.atipicos[0].veces, c.atipicos[0].promedio], ['Aceites', 3.3, 15000]);
});
t('motivos cortos y gastos editados', () => {
  assert.equal(c.motivosCortos, 1); assert.equal(c.motivosCortosPct, 16.7);
  assert.equal(c.editados, 1); assert.equal(c.editadosPct, 16.7);
});
t('precio unitario del mismo ítem entre locales + ahorro potencial', () => {
  assert.equal(c.precios.length, 1);
  const p = c.precios[0];
  assert.deepEqual([p.item, p.unidad, p.minimo.precio, p.minimo.local._id, p.maximo.precio, p.maximo.local._id, p.brechaPct],
    ['Arroz', 'KG', 800, 'B', 1000, 'A', 25]);
  assert.equal(c.ahorroPotencial, 10000);
});
t('sin actividad: nunca registró primero, luego por días; el local cerrado no cuenta', () => {
  assert.deepEqual(c.sinActividad.map((x) => [x.local._id, x.dias]), [['D', null], ['C', 4]]);
  assert.deepEqual(c.sinRegistro.map((x) => x._id), ['D']);
});
t('efectivo por local ordenado de mayor a menor', () => {
  assert.deepEqual(c.efectivoPorLocal.map((x) => [x.local._id, x.pct]), [['C', 100], ['E', 100], ['B', 72.7], ['A', 66.7]]);
});

// ---------------- SIN DATOS ----------------
console.log('Sin datos');
t('período vacío no revienta y devuelve ceros', () => {
  const vacio = calcularResumen({ gastos: [], locales, periodo });
  assert.equal(vacio.total, 0); assert.equal(vacio.localMayorGasto, null); assert.equal(vacio.variacionPct, null);
  assert.equal(vacio.efectivo.porcentaje, 0); assert.equal(vacio.localesSinRegistro.length, 4);
  const lv = calcularLocales({ gastos: [], locales, periodo });
  assert.equal(lv.filas.length, 4);
  const cv = calcularControl({ gastos: [], locales, periodo, hoyISO: '2026-10-14' });
  assert.equal(cv.totalAtipicos, 0); assert.equal(cv.ahorroPotencial, 0);
});

console.log(`\n${pruebas} pruebas OK`);
