'use strict';
// Diagnóstico ao vivo (2026-10-07): endereço 14.1520.1.27.22.1.1, produto
// 141992/12701 (AMENDOIM TORRADO... CX 20.0) continua mostrando "1ª
// contagem: 48 / Divergente" mesmo depois da correção de
// _qtdComparavelContagem (que deveria preferir quantidade_unidades).
// Em vez de adivinhar de novo, ler os documentos REAIS (dt_contagens e
// dt_divergencias) desse endereço pra ver os campos exatos gravados.
const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const SERVICE_ACCOUNT = 'C:/Users/Daterrinha69/Downloads/daterrinha-inventario-firebase-adminsdk-fbsvc-f8aa5c734e.json';
admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });
const db = admin.firestore();

const ENDERECO = '14.1520.1.27.22.1.1';

async function main() {
  const lojasSnap = await db.collection('lojas').get();
  for (const lojaDoc of lojasSnap.docs) {
    const lojaId = lojaDoc.id;
    for (const colName of ['dt_contagens', 'dt_divergencias', 'dt_recontagens']) {
      const snap = await db.collection('lojas').doc(lojaId).collection(colName)
        .where('endereco', '==', ENDERECO).get().catch(() => null);
      if (!snap || snap.empty) continue;
      console.log(`\n=== loja=${lojaId} colecao=${colName} (${snap.size} doc(s)) ===`);
      snap.forEach(d => {
        console.log('--- doc', d.id, '---');
        console.log(JSON.stringify(d.data(), null, 2));
      });
    }
  }
  console.log('\nFIM');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
