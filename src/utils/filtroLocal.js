// Devuelve el valor a usar en filtro.local para una consulta, respetando siempre
// los locales asignados al usuario (MASTER no tiene restricción). Si el usuario
// pide un local o una lista de locales por query param, se intersecta con lo que
// tiene permitido — nunca se confía en el query param solo, porque eso permitiría
// a un ADMINISTRADOR/ANALISTA ver datos de un local que no le corresponde.
// Retorna null cuando no hay que filtrar (MASTER sin selección específica).
function resolverFiltroLocal(usuario, { local, locales }) {
  const permitidos = usuario.rol === 'MASTER' ? null : usuario.localesAsignados.map(String);

  if (local) {
    if (permitidos && !permitidos.includes(String(local))) return { $in: [] };
    return local;
  }

  if (locales) {
    const solicitados = locales.split(',');
    const filtrados = permitidos ? solicitados.filter((id) => permitidos.includes(id)) : solicitados;
    return { $in: filtrados };
  }

  return permitidos ? { $in: permitidos } : null;
}

module.exports = { resolverFiltroLocal };
