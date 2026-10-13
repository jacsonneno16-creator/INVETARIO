'use strict';
// Diagnóstico ao vivo (2026-10-07): localizar TODAS as divergências que foram
// estornadas (cancelada_motivo/cancelada_em gravados) mas cujo status voltou
// a ser 'ABERTA' por causa do bug em _historicoConsolidadoEndereco (divs sem
// filtro de CANCELADA), corrigido em 21-divergencias-recontagens.js hoje.
const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const SERVICE_ACCOUNT = 'C:/Users/Daterrinha69/Downloads/daterrinha-inventario-firebase-adminsdk-fbsvc-f8aa5c734e.json';
admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });
const db = admin.firestore();

async function main() {
  const lojasSnap = await db.collection('lojas').get();
  let total = 0;
  for (const lojaDoc of lojasSnap.docs) {
    const lojaId = lojaDoc.id;
    const snap = await db.collection('lojas').doc(lojaId).collection('dt_divergencias')
      .where('cancelada_motivo', '==', 'CONTAGEM_ESTORNADA_ANALISTA').get().catch(() => null);
    if (!snap || snap.empty) continue;
    const ressuscitadas = snap.docs.filter(d => {
      const v = d.data();
      return String(v.status || '').toUpperCase() !== 'CANCELADA';
    });
    if (ressuscitadas.length) {
      console.log(`loja=${lojaId}: ${ressuscitadas.length} divergência(s) estornada(s) mas com status != CANCELADA`);
      ressuscitadas.forEach(d => {
        const v = d.data();
        console.log(`  - ${d.id} | endereco=${v.endereco} | status atual=${v.status} | cancelada_em=${v.cancelada_em}`);
      });
      total += ressuscitadas.length;
    }
  }
  console.log(`\nTOTAL geral: ${total}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
