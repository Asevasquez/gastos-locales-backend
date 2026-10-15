const assert = require('node:assert/strict');
const path = require('path');
const mongoose = require('mongoose');
const express = require('express');

const RAIZ = path.join(__dirname, '..', 'src');
const OID = (c) => new mongoose.Types.ObjectId(c.repeat(24));
const [A, B, C, D, E] = ['a', 'b', 'c', 'd', 'e'].map(OID);

// ---------- datos simulados ----------
const localesDB = [
  { _id: A, nombre: 'KAMI · Providencia', marca: 'KAMI_SUSHI', activo: true },
  { _id: B, nombre: 'Latin Pizza · Ñuñoa', marca: 'LATIN_PIZZA', activo: true },
  { _id: C, nombre: 'KAMI · Maipú', marca: 'KAMI_SUSHI', activo: true },
  { _id: D, nombre: 'KAMI · Vitacura', marca: 'KAMI_SUSHI', activo: true },
  { _id: E, nombre: 'KAMI · Cerrado', marca: 'KAMI_SUSHI', activo: false }
];
let n = 0;
const g = (local, fecha, monto, o = {}) => ({ _id: OID('f'.concat('')) , _n: ++n, local, fecha: new Date(fecha), monto, medioPago: 'EFECTIVO',
  categoria: 'gasto_de_producción', cuentaContable: 'compras', productoNombre: 'Arroz', productoCatalogoId: OID('1'),
  cantidad: 1, unidadMedida: 'UN', motivo: 'Motivo largo de prueba', editadoEn: null, fotoBoletaUrl: 'http://x/f.jpg', ...o });
const aceites = { productoNombre: 'Aceites', productoCatalogoId: OID('2') };
const gastosDB = [
  g(A, '2026-10-01', 100000, { cantidad: 100, unidadMedida: 'KG' }),
  g(A, '2026-10-05', 50000, { medioPago: 'TRANSFERENCIA', ...aceites, cantidad: 20, unidadMedida: 'LT' }),
  g(B, '2026-10-05', 80000, { medioPago: 'EFECTIVO_FLUJO', cantidad: 100, unidadMedida: 'KG' }),
  g(B, '2026-10-14', 30000, { medioPago: 'TRANSFERENCIA', categoria: 'gastos_de_administración_y_ventas', cuentaContable: 'internet', productoNombre: 'Internet', productoCatalogoId: OID('3') }),
  g(C, '2026-10-10', 20000, { categoria: 'gasto_de_producción_indirecto', cuentaContable: 'aseo', productoNombre: 'Aseo', productoCatalogoId: OID('4') }),
  g(E, '2026-10-02', 10000, { categoria: 'gastos_de_administración_y_ventas', cuentaContable: 'gas', productoNombre: 'Gas', productoCatalogoId: OID('5') }),
  g(A, '2026-09-03', 120000), g(B, '2026-09-10', 60000),
  g(C, '2026-09-12', 20000, { categoria: 'gasto_de_producción_indirecto', cuentaContable: 'aseo', productoNombre: 'Aseo', productoCatalogoId: OID('4') }),
  // historial de Aceites (fuera de los períodos de comparación, dentro de los 90 días): 6 compras de $10.000
  ...[20, 21, 22, 23, 24, 25].map((d) => g(A, `2026-09-${d}`, 10000, { ...aceites, cantidad: 10, unidadMedida: 'LT' }))
];

// ---------- modelos simulados ----------
const ids = (f) => (f.$in ? f.$in.map(String) : [String(f)]);
const pasa = (d, f) => {
  if (f.$or && !f.$or.some((c) => d.fecha >= c.fecha.$gte && d.fecha <= c.fecha.$lte)) return false;
  if (f.local && !ids(f.local).includes(String(d.local))) return false;
  if (f.medioPago && !f.medioPago.$in.includes(d.medioPago)) return false;
  return true;
};
const cadena = (docs) => ({ select() { return this; }, lean() { return Promise.resolve(docs); } });
const GastoFake = {
  find: (f) => cadena(gastosDB.filter((d) => pasa(d, f))),
  aggregate: async (p) => {
    const m = p[0].$match, gr = p[1].$group;
    const docs = gastosDB.filter((d) => (!m.local || ids(m.local).includes(String(d.local))) && (!m.fecha || (d.fecha >= m.fecha.$gte && d.fecha <= m.fecha.$lte)));
    const campo = gr._id.slice(1);
    const grupos = new Map();
    for (const d of docs) { const k = String(d[campo]); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(d); }
    return [...grupos.values()].map((arr) => {
      const out = { _id: arr[0][campo] };
      for (const [nombre, acc] of Object.entries(gr)) {
        if (nombre === '_id') continue;
        const [op, expr] = Object.entries(acc)[0]; const campoAcc = typeof expr === 'string' ? expr.slice(1) : null;
        if (op === '$max') out[nombre] = new Date(Math.max(...arr.map((x) => +x[campoAcc])));
        if (op === '$avg') out[nombre] = arr.reduce((a, x) => a + x[campoAcc], 0) / arr.length;
        if (op === '$sum') out[nombre] = arr.length;
      }
      return out;
    });
  }
};
const LocalFake = { find: (f) => cadena(localesDB.filter((l) => !f._id || ids(f._id).includes(String(l._id)))) };
const authFake = (req, res, next) => {
  req.usuario = req.headers['x-user'] === 'admin'
    ? { rol: 'ADMINISTRADOR', localesAsignados: [A, B] }
    : { rol: 'MASTER', localesAsignados: [] };
  next();
};

const inyectar = (ruta, exports) => { const p = require.resolve(path.join(RAIZ, ruta)); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
inyectar('models/Gasto.js', GastoFake);
inyectar('models/Local.js', LocalFake);
inyectar('middleware/auth.js', authFake);
const periodos = require(path.join(RAIZ, 'utils/periodos.js'));
inyectar('utils/periodos.js', { ...periodos, hoyEnZona: () => '2026-10-14' }); // "hoy" fijo

const app = express();
app.use('/api/dashboard', require(path.join(RAIZ, 'routes/dashboard.js')));

(async () => {
  const servidor = app.listen(0);
  const base = `http://127.0.0.1:${servidor.address().port}/api/dashboard`;
  const pedir = async (ruta, usuario = 'master') => { const r = await fetch(base + ruta, { headers: { 'x-user': usuario } }); return { status: r.status, cuerpo: await r.json() }; };
  let pruebas = 0;
  const t = async (nombre, fn) => { await fn(); pruebas += 1; console.log('  ✓', nombre); };

  console.log('Rutas del dashboard');
  await t('MASTER ve todo: totales, ranking y período con "hoy" en zona Chile', async () => {
    const { status, cuerpo } = await pedir('/resumen?mes=2026-10');
    assert.equal(status, 200);
    assert.equal(cuerpo.total, 290000); assert.equal(cuerpo.totalAnterior, 200000); assert.equal(cuerpo.variacionPct, 45);
    assert.equal(cuerpo.ranking[0].local.nombre, 'KAMI · Providencia');
    assert.equal(cuerpo.periodo.hoy, '2026-10-14'); assert.equal(cuerpo.periodo.enCurso, true); assert.equal(cuerpo.periodo.dias, 14);
    assert.deepEqual(cuerpo.localesSinRegistro.map((x) => x.nombre), ['KAMI · Vitacura']);
  });
  await t('ADMINISTRADOR solo ve sus locales (A y B): no aparecen C, D ni E', async () => {
    const { cuerpo } = await pedir('/resumen?mes=2026-10', 'admin');
    assert.equal(cuerpo.total, 260000);
    assert.deepEqual(cuerpo.ranking.map((x) => x.local._id).sort(), [String(A), String(B)].sort());
    assert.equal(cuerpo.localesSinRegistro.length, 0);
  });
  await t('ADMINISTRADOR pidiendo un local ajeno (?locales=C) no obtiene nada', async () => {
    const { status, cuerpo } = await pedir(`/resumen?mes=2026-10&locales=${C}`, 'admin');
    assert.equal(status, 200); assert.equal(cuerpo.total, 0); assert.equal(cuerpo.ranking.length, 0);
  });
  await t('MASTER filtra por locales (A y C) y por medio de pago', async () => {
    assert.equal((await pedir(`/resumen?mes=2026-10&locales=${A},${C}`)).cuerpo.total, 170000);
    assert.equal((await pedir('/resumen?mes=2026-10&medioPago=TRANSFERENCIA')).cuerpo.total, 80000);
  });
  await t('rango de fechas (semana) en vez de mes', async () => {
    const { cuerpo } = await pedir('/resumen?desde=2026-10-05&hasta=2026-10-11');
    assert.equal(cuerpo.total, 150000); // 50.000 + 80.000 (5 oct) + 20.000 (10 oct)
    assert.equal(cuerpo.periodo.tipo, 'rango');
  });
  await t('rango inválido responde 400 (no 500)', async () => {
    const { status, cuerpo } = await pedir('/resumen?desde=abc');
    assert.equal(status, 400); assert.match(cuerpo.error, /inválido/);
  });
  await t('/locales: una fila por local, con último registro de todos los tiempos', async () => {
    const { cuerpo } = await pedir('/locales?mes=2026-10');
    assert.deepEqual(cuerpo.filas.map((f) => f.local.nombre), ['KAMI · Providencia', 'Latin Pizza · Ñuñoa', 'KAMI · Maipú', 'KAMI · Cerrado', 'KAMI · Vitacura']);
    assert.equal(cuerpo.filas[0].ultimoRegistro, '2026-10-05');
    assert.equal(cuerpo.filas[4].sinRegistro, true);
  });
  await t('/control: atípico por promedio histórico (3,2× el promedio de Aceites) y locales sin actividad', async () => {
    const { cuerpo } = await pedir('/control?mes=2026-10');
    assert.equal(cuerpo.totalAtipicos, 1);
    assert.deepEqual([cuerpo.atipicos[0].item, cuerpo.atipicos[0].veces], ['Aceites', 3.2]);
    assert.equal(cuerpo.sinActividad[0].local.nombre, 'KAMI · Vitacura'); assert.equal(cuerpo.sinActividad[0].dias, null);
    assert.ok(cuerpo.umbrales.efectivoPct === 70);
  });
  await t('/control del ADMINISTRADOR respeta sus locales', async () => {
    const { cuerpo } = await pedir('/control?mes=2026-10', 'admin');
    assert.ok(cuerpo.efectivoPorLocal.every((x) => [String(A), String(B)].includes(x.local._id)));
  });

  servidor.close();
  console.log(`\n${pruebas} pruebas de rutas OK`);
})().catch((e) => { console.error('FALLÓ:', e); process.exit(1); });
