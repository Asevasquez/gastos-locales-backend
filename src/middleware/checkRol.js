// Uso: router.use(checkRol('MASTER')) o checkRol('MASTER', 'ADMINISTRADOR') en una ruta puntual.
module.exports = function checkRol(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario || !rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
};
