'use strict';
const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const SERVICE_ACCOUNT = 'C:/Users/Daterrinha69/Downloads/daterrinha-inventario-firebase-adminsdk-fbsvc-f8aa5c734e.json';
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });
const db = admin.firestore();
async function main() {
  const snap = await db.collection('dt_produtos').where('codigoInterno','==','141995').get();
  snap.forEach(d => console.log(d.id, JSON.stringify(d.data(), null, 2)));
  if (snap.empty) console.log('não encontrado em dt_produtos (raiz) — tentando dentro da loja');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
