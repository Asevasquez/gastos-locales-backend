require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const conectarDB = require('./src/config/db');

const authRoutes = require('./src/routes/auth');
const usuariosRoutes = require('./src/routes/usuarios');
const localesRoutes = require('./src/routes/locales');
const catalogoRoutes = require('./src/routes/catalogo');
const gastosRoutes = require('./src/routes/gastos');
const estadisticasRoutes = require('./src/routes/estadisticas');
const dashboardRoutes = require('./src/routes/dashboard');
const historialGastosRoutes = require('./src/routes/historialGastos');
const rellenarHistorial = require('./src/utils/rellenarHistorial');
const { numerarGastosExistentes } = require('./src/utils/correlativo');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Al conectar:
//  1. Se numera (correlativo de documento) lo que no tenga número: los gastos anteriores a esta función.
//  2. Si el historial está vacío, se crea el registro de "subido" de los gastos que ya existían (solo la primera vez).
// Cada paso es independiente: si uno falla, no afecta al resto de la API ni al otro paso.
conectarDB()
  .then(() =>
    numerarGastosExistentes()
      .then((r) => {
        if (r.numerados > 0) console.log(`Correlativo asignado: ${r.numerados} gastos en ${r.documentos} documentos`);
      })
      .catch((err) => console.error('No se pudo asignar el correlativo:', err.message))
  )
  .then(() => rellenarHistorial({ soloSiVacio: true }))
  .then((r) => {
    if (r && !r.omitido) console.log(`Historial inicial creado para ${r.creados} gastos`);
  })
  .catch((err) => console.error('No se pudo crear el historial inicial:', err.message));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/locales', localesRoutes);
app.use('/api/catalogo', catalogoRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/historial-gastos', historialGastosRoutes);
app.use('/api/gastos/estadisticas', estadisticasRoutes); // antes de /api/gastos por especificidad de ruta
app.use('/api/gastos', gastosRoutes);

app.get('/', (req, res) => res.send('API Gastos de Locales OK'));

// Red de seguridad: si alguna ruta lanza un error sin capturarlo, esto responde
// 500 en vez de dejar que Express reviente sin contestar nada.
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Desde Node 15+, una promesa rechazada sin capturar tumba el proceso completo
// por defecto — eso hace que Dockploy reinicie el contenedor y el proxy devuelva
// 502 mientras tanto. Mejor loguearlo y seguir vivo; el try/catch de cada ruta
// ya debería evitar que esto se dispare, esto es la última red de contención.
process.on('unhandledRejection', (reason) => {
  console.error('Promesa rechazada sin capturar:', reason);
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
