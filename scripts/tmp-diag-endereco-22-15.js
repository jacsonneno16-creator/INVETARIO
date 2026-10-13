'use strict';
const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const SERVICE_ACCOUNT = 'C:/Users/Daterrinha69/Downloads/daterrinha-inventario-firebase-adminsdk-fbsvc-f8aa5c734e.json';
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });
const db = admin.firestore();
const ENDERECO = '14.1520.1.22.15.3.1';
async function main() {
  const lojaId = 'loja_matriz';
  for (const colName of ['dt_contagens', 'dt_divergencias', 'dt_recontagens']) {
    const snap = await db.collection('lojas').doc(lojaId).collection(colName)
      .where('endereco', '==', ENDERECO).get();
    console.log(`\n=== ${colName} (${snap.size}) ===`);
    snap.forEach(d => console.log('---', d.id, '---\n', JSON.stringify(d.data(), null, 2)));
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
