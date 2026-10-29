// Cálculos del dashboard de gastos. Son funciones PURAS: reciben gastos y locales ya cargados
// (objetos planos) y devuelven los números listos para mostrar. Así se pueden probar sin base de
// datos, y las rutas solo se encargan de cargar los datos y filtrar por permisos.
const { listarDias, diasEntre } = require('./periodos');
const { fotosDe } = require('./fotosBoleta');

const UMBRALES = {
  efectivoPct: 70, // % de efectivo desde el cual un local se marca como alerta
  atipicoVeces: 2.5, // un gasto es atípico si supera N veces el promedio de su ítem
  atipicoMinCompras: 5, // mínimo de compras históricas del ítem para poder juzgar
  sinActividadDias: 3, // días sin registrar para considerar un local inactivo
  motivoCortoLargo: 10, // motivos con menos caracteres que esto se marcan como "muy cortos"
  historialDias: 90 // ventana para el promedio histórico por ítem
};

const COMPOSICION = {
  gasto_de_producción: 'produccion',
  gasto_de_producción_indirecto: 'indirecto',
  gastos_de_administración_y_ventas: 'admin'
};

const MEDIOS = ['EFECTIVO', 'TRANSFERENCIA', 'EFECTIVO_FLUJO'];

// ---------- utilidades ----------
const r1 = (n) => Math.round(n * 10) / 10;
const idStr = (v) => (v == null ? '' : String(v));
const esEfectivo = (g) => g.medioPago === 'EFECTIVO' || g.medioPago === 'EFECTIVO_FLUJO';
const fechaISO = (g) => (g.fecha instanceof Date ? g.fecha : new Date(g.fecha)).toISOString().slice(0, 10);
const variacion = (ahora, antes) => (antes > 0 ? r1(((ahora - antes) / antes) * 100) : null);
const porcentaje = (parte, total) => (total > 0 ? r1((parte / total) * 100) : 0);

function dividirPorPeriodo(gastos, serie) {
  const cubetas = serie.map(() => []);
  for (const g of gastos) {
    const f = fechaISO(g);
    for (let i = 0; i < serie.length; i += 1) {
      if (f >= serie[i].desde && f <= serie[i].hasta) {
        cubetas[i].push(g);
        break;
      }
    }
  }
  return cubetas;
}

function infoLocal(mapa, id) {
  const l = mapa.get(id);
  return l
    ? { _id: id, nombre: l.nombre, marca: l.marca, codigoExterno: l.codigoExterno || null }
    : { _id: id, nombre: 'Local eliminado', marca: null, codigoExterno: null };
}

function crearMapaLocales(locales) {
  return new Map(locales.map((l) => [idStr(l._id), l]));
}

// Suma de montos agrupada por una clave. Devuelve Map clave -> { total, n }.
function agrupar(gastos, clave) {
  const m = new Map();
  for (const g of gastos) {
    const k = clave(g);
    const fila = m.get(k) || { total: 0, n: 0 };
    fila.total += g.monto;
    fila.n += 1;
    m.set(k, fila);
  }
  return m;
}

// ---------- RESUMEN ----------
function calcularResumen({ gastos, locales, periodo }) {
  const mapa = crearMapaLocales(locales);
  const activos = locales.filter((l) => l.activo !== false);
  const cubetas = dividirPorPeriodo(gastos, periodo.serie);
  const actual = cubetas[5];
  const anterior = cubetas[4];

  const total = actual.reduce((a, g) => a + g.monto, 0);
  const totalAnterior = anterior.reduce((a, g) => a + g.monto, 0);

  // por local
  const porLocal = agrupar(actual, (g) => idStr(g.local));
  const porLocalAnt = agrupar(anterior, (g) => idStr(g.local));
  const ranking = [...porLocal.entries()]
    .map(([id, f]) => ({
      local: infoLocal(mapa, id),
      total: f.total,
      porcentaje: porcentaje(f.total, total),
      n: f.n,
      anterior: (porLocalAnt.get(id) || { total: 0 }).total,
      variacionPct: variacion(f.total, (porLocalAnt.get(id) || { total: 0 }).total)
    }))
    .sort((a, b) => b.total - a.total);

  const idsConRegistro = new Set(porLocal.keys());
  const localesSinRegistro = activos
    .filter((l) => !idsConRegistro.has(idStr(l._id)))
    .map((l) => ({ _id: idStr(l._id), nombre: l.nombre, marca: l.marca }));

  // efectivo
  const montoEfectivo = actual.filter(esEfectivo).reduce((a, g) => a + g.monto, 0);
  const efectivoPorLocal = new Map();
  for (const g of actual) {
    const k = idStr(g.local);
    const f = efectivoPorLocal.get(k) || { total: 0, ef: 0 };
    f.total += g.monto;
    if (esEfectivo(g)) f.ef += g.monto;
    efectivoPorLocal.set(k, f);
  }
  const localesSobreUmbral = [...efectivoPorLocal.values()].filter(
    (f) => f.total > 0 && (f.ef / f.total) * 100 > UMBRALES.efectivoPct
  ).length;

  // evolución diaria
  const porDia = agrupar(actual, fechaISO);
  const evolucionDiaria = listarDias(periodo.actual.desde, periodo.actual.hasta).map((fecha) => ({
    fecha,
    total: (porDia.get(fecha) || { total: 0 }).total
  }));
  const diasConDatos = Math.max(1, periodo.dias);

  // categorías, medios de pago, marcas
  const porCategoria = [...agrupar(actual, (g) => g.categoria).entries()]
    .map(([categoria, f]) => ({ categoria, total: f.total, porcentaje: porcentaje(f.total, total), n: f.n }))
    .sort((a, b) => b.total - a.total);

  const porMedio = agrupar(actual, (g) => g.medioPago);
  const porMedioPago = MEDIOS.map((medioPago) => {
    const f = porMedio.get(medioPago) || { total: 0, n: 0 };
    return { medioPago, total: f.total, porcentaje: porcentaje(f.total, total), n: f.n };
  });

  const porMarcaMapa = new Map();
  for (const r of ranking) {
    const marca = r.local.marca || 'SIN MARCA';
    const f = porMarcaMapa.get(marca) || { total: 0, locales: 0, n: 0 };
    f.total += r.total;
    f.locales += 1;
    f.n += r.n;
    porMarcaMapa.set(marca, f);
  }
  const porMarca = [...porMarcaMapa.entries()]
    .map(([marca, f]) => ({
      marca,
      total: f.total,
      porcentaje: porcentaje(f.total, total),
      localesConRegistro: f.locales,
      promedioPorLocal: f.locales ? Math.round(f.total / f.locales) : 0
    }))
    .sort((a, b) => b.total - a.total);

  // cuentas contables: 6 períodos + categoría predominante
  const cuentasMapa = new Map();
  cubetas.forEach((cubeta, i) => {
    for (const g of cubeta) {
      const c = cuentasMapa.get(g.cuentaContable) || { serie: [0, 0, 0, 0, 0, 0], porCategoria: new Map() };
      c.serie[i] += g.monto;
      c.porCategoria.set(g.categoria, (c.porCategoria.get(g.categoria) || 0) + g.monto);
      cuentasMapa.set(g.cuentaContable, c);
    }
  });
  const cuentas = [...cuentasMapa.entries()]
    .map(([cuentaContable, c]) => {
      const categoria = [...c.porCategoria.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return { cuentaContable, categoria, actual: c.serie[5], anterior: c.serie[4], serie: c.serie };
    })
    .filter((c) => c.serie.some((v) => v > 0))
    .sort((a, b) => b.actual - a.actual || b.anterior - a.anterior);

  // ítems
  const topItems = [...agrupar(actual, (g) => g.productoNombre).entries()]
    .map(([item, f]) => ({ item, total: f.total, n: f.n, porcentaje: porcentaje(f.total, total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const proyeccionCierre =
    periodo.tipo === 'mes' && periodo.enCurso ? Math.round((total / periodo.dias) * periodo.diasMes) : null;

  return {
    total,
    totalAnterior,
    variacionPct: variacion(total, totalAnterior),
    proyeccionCierre,
    gastosRegistrados: actual.length,
    ticketPromedio: actual.length ? Math.round(total / actual.length) : 0,
    localMayorGasto: ranking[0] || null,
    totalLocalesActivos: activos.length,
    localesConRegistro: ranking.length,
    promedioPorLocal: ranking.length ? Math.round(total / ranking.length) : 0,
    localesSinRegistro,
    efectivo: { monto: montoEfectivo, porcentaje: porcentaje(montoEfectivo, total), localesSobreUmbral, umbral: UMBRALES.efectivoPct },
    evolucionDiaria,
    promedioDiario: Math.round(total / diasConDatos),
    ranking,
    porCategoria,
    porMedioPago,
    porMarca,
    cuentas,
    topItems
  };
}

// ---------- LOCALES ----------
function calcularLocales({ gastos, locales, periodo, ultimaPorLocal = {} }) {
  const mapa = crearMapaLocales(locales);
  const activos = locales.filter((l) => l.activo !== false);
  const cubetas = dividirPorPeriodo(gastos, periodo.serie);
  const actual = cubetas[5];
  const anterior = cubetas[4];
  const total = actual.reduce((a, g) => a + g.monto, 0);

  const porLocalAnt = agrupar(anterior, (g) => idStr(g.local));
  const filas = new Map();
  for (const g of actual) {
    const k = idStr(g.local);
    const f = filas.get(k) || { total: 0, n: 0, ef: 0, comp: { produccion: 0, indirecto: 0, admin: 0, otros: 0 } };
    f.total += g.monto;
    f.n += 1;
    if (esEfectivo(g)) f.ef += g.monto;
    f.comp[COMPOSICION[g.categoria] || 'otros'] += g.monto;
    filas.set(k, f);
  }

  const ids = new Set([...filas.keys(), ...activos.map((l) => idStr(l._id))]);
  const rows = [...ids].map((id) => {
    const f = filas.get(id);
    const ant = (porLocalAnt.get(id) || { total: 0 }).total;
    const ultima = ultimaPorLocal[id] || null;
    const base = { local: infoLocal(mapa, id), ultimoRegistro: ultima };
    if (!f) return { ...base, total: 0, porcentaje: 0, n: 0, ticket: 0, pctEfectivo: 0, composicion: null, anterior: ant, variacionPct: null, sinRegistro: true };
    const comp = {};
    for (const k of Object.keys(f.comp)) comp[k] = porcentaje(f.comp[k], f.total);
    return {
      ...base,
      total: f.total,
      porcentaje: porcentaje(f.total, total),
      n: f.n,
      ticket: Math.round(f.total / f.n),
      pctEfectivo: porcentaje(f.ef, f.total),
      composicion: comp,
      anterior: ant,
      variacionPct: variacion(f.total, ant),
      sinRegistro: false
    };
  });
  rows.sort((a, b) => b.total - a.total || a.local.nombre.localeCompare(b.local.nombre, 'es'));

  return { total, filas: rows, umbrales: UMBRALES };
}

// ---------- CONTROL ----------
// promediosItem: { [productoCatalogoId]: { promedio, n } }  (últimos 90 días, calculado en la base)
// ultimaPorLocal: { [localId]: 'YYYY-MM-DD' | null }  (último gasto de todos los tiempos)
function calcularControl({ gastos, locales, periodo, hoyISO, ultimaPorLocal = {}, promediosItem = {} }) {
  const mapa = crearMapaLocales(locales);
  const activos = locales.filter((l) => l.activo !== false);
  const actual = dividirPorPeriodo(gastos, periodo.serie)[5];
  const total = actual.reduce((a, g) => a + g.monto, 0);

  const idsConRegistro = new Set(actual.map((g) => idStr(g.local)));
  const sinRegistro = activos
    .filter((l) => !idsConRegistro.has(idStr(l._id)))
    .map((l) => ({ _id: idStr(l._id), nombre: l.nombre, marca: l.marca }));

  const sinActividad = activos
    .map((l) => {
      const ultimo = ultimaPorLocal[idStr(l._id)] || null;
      return { local: infoLocal(mapa, idStr(l._id)), ultimo, dias: ultimo ? diasEntre(ultimo, hoyISO) : null };
    })
    .filter((x) => x.dias === null || x.dias >= UMBRALES.sinActividadDias)
    .sort((a, b) => (b.dias === null ? 1e9 : b.dias) - (a.dias === null ? 1e9 : a.dias))
    .slice(0, 30);

  const atipicos = [];
  for (const g of actual) {
    const ref = promediosItem[idStr(g.productoCatalogoId)];
    if (!ref || ref.n < UMBRALES.atipicoMinCompras || !(ref.promedio > 0)) continue;
    const veces = g.monto / ref.promedio;
    if (veces >= UMBRALES.atipicoVeces) {
      atipicos.push({
        gastoId: idStr(g._id),
        fecha: fechaISO(g),
        local: infoLocal(mapa, idStr(g.local)),
        item: g.productoNombre,
        monto: g.monto,
        veces: r1(veces),
        promedio: Math.round(ref.promedio),
        fotoBoletaUrl: g.fotoBoletaUrl || null,
        fotosBoletaUrls: fotosDe(g)
      });
    }
  }
  atipicos.sort((a, b) => b.veces - a.veces);

  const motivosCortos = actual.filter((g) => String(g.motivo || '').trim().length < UMBRALES.motivoCortoLargo).length;
  const editados = actual.filter((g) => g.editadoEn).length;

  // precio unitario del mismo ítem entre locales (misma unidad)
  const grupos = new Map();
  for (const g of actual) {
    if (!(g.cantidad > 0)) continue;
    const clave = `${idStr(g.productoCatalogoId) || g.productoNombre}|${g.unidadMedida}`;
    const grupo = grupos.get(clave) || { item: g.productoNombre, unidad: g.unidadMedida, monto: 0, cantidad: 0, locales: new Map(), gastos: [] };
    grupo.monto += g.monto;
    grupo.cantidad += g.cantidad;
    const lk = idStr(g.local);
    const lf = grupo.locales.get(lk) || { monto: 0, cantidad: 0 };
    lf.monto += g.monto;
    lf.cantidad += g.cantidad;
    grupo.locales.set(lk, lf);
    grupo.gastos.push(g);
    grupos.set(clave, grupo);
  }
  const precios = [];
  let ahorroPotencial = 0;
  for (const grupo of grupos.values()) {
    if (grupo.locales.size < 2) continue;
    const porLocal = [...grupo.locales.entries()].map(([id, f]) => ({ id, precio: f.monto / f.cantidad }));
    porLocal.sort((a, b) => a.precio - b.precio);
    const min = porLocal[0];
    const max = porLocal[porLocal.length - 1];
    if (max.precio <= min.precio) continue;
    precios.push({
      item: grupo.item,
      unidad: grupo.unidad,
      minimo: { precio: Math.round(min.precio), local: infoLocal(mapa, min.id) },
      maximo: { precio: Math.round(max.precio), local: infoLocal(mapa, max.id) },
      brechaPct: r1((max.precio / min.precio - 1) * 100),
      localesComparados: porLocal.length
    });
    const precioPromedio = grupo.monto / grupo.cantidad;
    for (const g of grupo.gastos) {
      const exceso = g.monto - g.cantidad * precioPromedio;
      if (exceso > 0) ahorroPotencial += exceso;
    }
  }
  precios.sort((a, b) => b.brechaPct - a.brechaPct);

  // efectivo por local
  const ef = new Map();
  for (const g of actual) {
    const k = idStr(g.local);
    const f = ef.get(k) || { total: 0, ef: 0 };
    f.total += g.monto;
    if (esEfectivo(g)) f.ef += g.monto;
    ef.set(k, f);
  }
  const efectivoPorLocal = [...ef.entries()]
    .map(([id, f]) => ({ local: infoLocal(mapa, id), pct: porcentaje(f.ef, f.total), total: f.total }))
    .sort((a, b) => b.pct - a.pct);

  return {
    umbrales: UMBRALES,
    totalGastos: actual.length,
    sinRegistro,
    sinActividad,
    atipicos: atipicos.slice(0, 20),
    totalAtipicos: atipicos.length,
    motivosCortos,
    motivosCortosPct: porcentaje(motivosCortos, actual.length),
    editados,
    editadosPct: porcentaje(editados, actual.length),
    precios: precios.slice(0, 10),
    ahorroPotencial: Math.round(ahorroPotencial),
    efectivoPorLocal,
    total
  };
}

module.exports = { calcularResumen, calcularLocales, calcularControl, UMBRALES, dividirPorPeriodo };
