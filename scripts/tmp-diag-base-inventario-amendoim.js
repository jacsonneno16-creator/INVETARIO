'use strict';
const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const SERVICE_ACCOUNT = 'C:/Users/Daterrinha69/Downloads/daterrinha-inventario-firebase-adminsdk-fbsvc-f8aa5c734e.json';
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });
const db = admin.firestore();
async function main() {
  const doc = await db.collection('lojas').doc('loja_matriz').collection('dt_inventarios').doc('INV-1791385106410-WZK3').get();
  if (!doc.exists) { console.log('inventário não encontrado'); return; }
  const v = doc.data();
  console.log('inventário:', v.nome, '- base length:', (v.base||[]).length);
  const itens141995 = (v.base||[]).filter(i => String(i.codigo_produto||i.codigoProduto||'') === '141995');
  console.log('itens com codigo_produto 141995:', JSON.stringify(itens141995, null, 2));
  const itens141992 = (v.base||[]).filter(i => String(i.codigo_produto||i.codigoProduto||'') === '141992');
  console.log('itens com codigo_produto 141992 (amostra):', JSON.stringify(itens141992.slice(0,2), null, 2));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
