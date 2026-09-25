require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');
const ProductoCatalogo = require('../models/ProductoCatalogo');

const BSALE_TOKEN = process.env.BSALE_KAMVER_TOKEN;
const BSALE_BASE_URL = 'https://api.bsale.io/v1';

// AJUSTAR: mapeo de "product_type.name" en Bsale -> categoría interna del sistema de gastos.
// Completado con los 14 tipos reales de la cuenta Kamver (revisado 2026-09-22). "Sin Tipo"
// y cualquier tipo nuevo que Bsale agregue después caen en "Sin categoría" y quedan
// editables a mano desde la app.
const MAPA_CATEGORIAS = {
  DIRECTOS: 'Directo',
  Fruta: 'Directo',
  BEBIDAS: 'Directo',
  INDIRECTOS: 'Insumo',
  'PLASTICOS Y UTILES PARA SUSHI': 'Insumo',
  PAQUETERIA: 'Insumo',
  'MENAJE (INDIRECTOS)': 'Insumo',
  'USO INTERNO': 'Insumo',
  Equipos: 'Mantención',
  'MATERIAL PUBLICITARIO': 'Otro',
  PUBLICIDAD: 'Otro',
  INDUMENTARIA: 'Otro',
  UNIFORMES: 'Otro'
};

function inferirUnidad(nombreProducto) {
  const nombre = nombreProducto.toLowerCase();
  if (/\bkg\b|kilo/.test(nombre)) return 'KG';
  if (/\blt\b|litro/.test(nombre)) return 'LT';
  if (/\bgr\b|gramo/.test(nombre)) return 'GR';
  return 'UN';
}

// product_type en Bsale llega siempre como referencia ({href, id}), nunca expandido,
// así que hay que resolverlo con una llamada aparte. Como son pocos tipos distintos
// repetidos en cientos de productos, se cachean por id para no repetir la consulta.
const cacheTiposProducto = new Map();

async function resolverNombreTipoProducto(productType) {
  if (!productType?.href) return null;
  if (cacheTiposProducto.has(productType.id)) return cacheTiposProducto.get(productType.id);

  const { data } = await axios.get(productType.href, { headers: { access_token: BSALE_TOKEN } });
  const nombre = data?.name || null;
  cacheTiposProducto.set(productType.id, nombre);
  return nombre;
}

// costs en la variante también llega solo como {href} — nunca expandido — hay que
// pedirlo aparte. A diferencia de products.json, costs.json NO es una lista paginada:
// es un solo objeto con averageCost/totalCost/history directo en la raíz.
async function resolverPrecioVariante(costsHref) {
  if (!costsHref) return 0;
  const { data } = await axios.get(costsHref, { headers: { access_token: BSALE_TOKEN } });
  return data?.averageCost ?? 0;
}

async function sincronizarCatalogo() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado a MongoDB. Sincronizando catálogo Kamver...');

  let offset = 0;
  const limit = 50;
  let total = 0;
  let sinCategoria = 0;
  let sinPrecio = 0;
  let logueoDiagnostico = false;
  const tiposEncontrados = new Set();

  // Recorre products.json paginado. NOTA: no se usa expand=[product_type] porque en
  // Kami Cotización eso causó que productos desaparecieran del catálogo — se pide
  // el tipo de producto por separado si el listado no lo trae embebido.
  while (true) {
    const { data } = await axios.get(`${BSALE_BASE_URL}/products.json`, {
      headers: { access_token: BSALE_TOKEN },
      params: { limit, offset, state: 0 }
    });

    if (!data.items || data.items.length === 0) break;

    for (const producto of data.items) {
      try {
        const variantesResp = await axios.get(producto.variants.href, {
          headers: { access_token: BSALE_TOKEN }
        });
        const variante = variantesResp.data.items?.[0];
        if (!variante) continue;

        const [tipoProducto, precio] = await Promise.all([
          resolverNombreTipoProducto(producto.product_type),
          resolverPrecioVariante(variante.costs?.href)
        ]);

        // DIAGNÓSTICO — solo la primera vez, para confirmar que los campos resueltos
        // (no los crudos) tienen el valor esperado.
        if (!logueoDiagnostico) {
          console.log('--- Ejemplo de producto (diagnóstico) ---');
          console.log('nombre producto:', producto.name);
          console.log('tipo de producto resuelto:', tipoProducto);
          console.log('precio resuelto:', precio);
          console.log('-------------------------------------------');
          logueoDiagnostico = true;
        }

        if (!precio) sinPrecio += 1;

        if (tipoProducto) tiposEncontrados.add(tipoProducto);

        const categoria = MAPA_CATEGORIAS[tipoProducto] || 'Sin categoría';
        if (categoria === 'Sin categoría') sinCategoria += 1;

        const skuBsale = variante.code || `bsale-${producto.id}`;

        await ProductoCatalogo.findOneAndUpdate(
          { skuBsale },
          {
            skuBsale,
            nombre: producto.name,
            categoria,
            unidadMedida: inferirUnidad(producto.name),
            precioActual: precio,
            activo: producto.state === 0,
            ultimaSync: new Date()
          },
          { upsert: true }
        );
        total += 1;
      } catch (errProducto) {
        console.error(`Error procesando producto ${producto.id}:`, errProducto.message);
      }
    }

    offset += limit;
    if (data.items.length < limit) break;
  }

  console.log(`Sincronización terminada. ${total} productos procesados.`);
  console.log('Tipos de producto encontrados en Bsale:', [...tiposEncontrados].sort().join(', '));
  if (sinCategoria > 0) {
    console.log(
      `Aviso: ${sinCategoria} producto(s) quedaron con "Sin categoría" (tipo no incluido en MAPA_CATEGORIAS, o "Sin Tipo" en Bsale).`
    );
  }
  if (sinPrecio > 0) {
    console.log(`Aviso: ${sinPrecio} producto(s) quedaron con precio $0 (sin historial de costos en Bsale).`);
  }
  await mongoose.disconnect();
}

sincronizarCatalogo().catch((err) => {
  console.error('Error sincronizando catálogo:', err.message);
  process.exit(1);
});
