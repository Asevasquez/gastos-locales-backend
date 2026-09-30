const mongoose = require('mongoose');

// Convierte a ObjectId real, descartando strings inválidos en vez de reventar
// la consulta entera (por ejemplo si llega un id mal formado en un query param).
function aObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

// Devuelve el valor a usar en filtro.local para una consulta, respetando siempre
// los locales asignados al usuario (MASTER no tiene restricción). Si el usuario
// pide un local o una lista de locales por query param, se intersecta con lo que
// tiene permitido — nunca se confía en el query param solo, porque eso permitiría
// a un ADMINISTRADOR/ANALISTA ver datos de un local que no le corresponde.
//
// Los valores se devuelven como ObjectId reales, no como string: Model.find()
// castea automáticamente strings a ObjectId, pero Model.aggregate() NO lo hace
// (el $match de un aggregate va directo a Mongo sin pasar por el casting de
// Mongoose), así que si esto devolviera strings, cualquier estadística agregada
// (totales, gasto por categoría, gasto por cuenta contable) compararía texto
// contra ObjectId y nunca matchearía — quedaría todo en $0 apenas se filtra por local.
//
// Retorna null cuando no hay que filtrar (MASTER sin selección específica).
function resolverFiltroLocal(usuario, { local, locales }) {
  const permitidos = usuario.rol === 'MASTER' ? null : usuario.localesAsignados.map(String);

  if (local) {
    if (permitidos && !permitidos.includes(String(local))) return { $in: [] };
    const id = aObjectId(local);
    return id ? id : { $in: [] };
  }

  if (locales) {
    const solicitados = locales.split(',');
    const filtrados = permitidos ? solicitados.filter((id) => permitidos.includes(id)) : solicitados;
    return { $in: filtrados.map(aObjectId).filter(Boolean) };
  }

  return permitidos ? { $in: permitidos.map(aObjectId).filter(Boolean) } : null;
}

module.exports = { resolverFiltroLocal };
