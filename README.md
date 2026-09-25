# Gastos de Locales — Backend

API para el registro de gastos mensuales de los locales (KAMI Sushi, Latin Pizza, Kelver).
Arquitectura y patrones reutilizados de KamiSushi Supervisión (Node/Express/MongoDB, JWT, roles).

**El catálogo de ítems ya NO se sincroniza con Bsale** — se carga subiendo un Excel
(columnas ITEM, DETALLE opcional, RATIO, CUENTA CONTABLE) desde el dashboard.

## Setup

```bash
npm install
cp .env.example .env   # completar MONGODB_URI, JWT_SECRET, PUBLIC_URL
npm run dev
```

Crear el primer usuario MASTER:

```bash
npm run crear:master -- "Tu Nombre" tu@pcm.cl tu-contraseña
```

## Cargar el catálogo de ítems

Sin script de terminal — se sube el Excel directo desde el dashboard (pantalla
"Catálogo"), que llama a `POST /api/catalogo/importar-excel` (multipart, campo
`archivo`, solo MASTER). Los ítems que ya existen se actualizan por nombre; los que
faltan en la planilla nueva se desactivan (no se borran, para no romper gastos
históricos que ya los referencian).

## Endpoints

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/api/auth/login` | — | Login |
| GET/POST/PUT/DELETE | `/api/usuarios` | MASTER | CRUD de usuarios |
| PUT | `/api/usuarios/:id/locales` | MASTER | Asignar locales a un usuario |
| GET/POST/PUT/DELETE | `/api/locales` | MASTER (write), todos (read filtrado) | CRUD de locales |
| GET | `/api/catalogo/buscar?q=` | todos | Autocompletado de ítems (cache local) |
| GET | `/api/catalogo/categorias` | todos | Valores de RATIO disponibles |
| GET | `/api/catalogo/cuentas-contables` | todos | Valores de CUENTA CONTABLE disponibles |
| POST | `/api/catalogo/importar-excel` | MASTER | Sube/reemplaza el catálogo desde un Excel |
| GET/POST/PUT | `/api/gastos` | ADMINISTRADOR/MASTER (write), todos (read filtrado) | CRUD de gastos. Filtros: `local`, `locales`, `mes`, `desde`/`hasta` (rango de fechas, para exportar por semana), `categoria`, `cuentaContable`, `medioPago` |
| POST | `/api/gastos/foto` | ADMINISTRADOR/MASTER | Sube la foto de boleta/factura (multipart) |
| GET | `/api/gastos/estadisticas/resumen` | todos | Totales, gasto por categoría, locales sin registro. Acepta `mes` o `desde`/`hasta` |
| GET | `/api/gastos/estadisticas/por-cuenta-contable` | todos | Gasto agrupado por cuenta contable. Acepta `mes` o `desde`/`hasta` |

Todas las rutas (salvo `/login`) requieren `Authorization: Bearer <token>`.
Los roles ADMINISTRADOR y ANALISTA solo ven/operan sobre `localesAsignados`; MASTER ve todo.

## Reglas del formulario de gastos

- **Foto y motivo son obligatorios** — el backend rechaza el `POST`/`PUT` si falta
  cualquiera de los dos, no es solo una validación del lado de la app.
- **El ítem debe existir en el catálogo** (`productoCatalogoId` requerido) — ya no se
  acepta un producto libre sin match; categoría y cuenta contable siempre vienen del
  catálogo, nunca se reciben editadas desde el cliente.
- El administrador solo puede editar sus propios gastos dentro del mismo mes en que
  los ingresó.

## Pendiente

1. **Puerto**: por defecto `5001` para no chocar con el backend de Supervisión (`5000`)
   si conviven en el mismo VPS/Dockploy.
2. **Primer usuario MASTER**: no hay ruta de registro pública a propósito; se crea con
   `npm run crear:master`.
3. **`/uploads` sigue siendo estático público** (nombre de archivo no adivinable, pero
   sin requerir sesión para verlo) — pendiente si se necesita restringir a usuarios
   autenticados.
