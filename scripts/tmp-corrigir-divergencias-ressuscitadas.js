'use strict';
// Correção pontual (2026-10-07), autorizada pelo usuário: devolver status
// CANCELADA aos 2 documentos de dt_divergencias (loja_matriz) que o bug em
// _historicoConsolidadoEndereco tinha reaberto indevidamente pra 'ABERTA'
// depois de já estornados pelo Analista. Só o campo status (+status_recontagem,
// já consistente com o resto do documento que já tinha cancelada_em/cancelada_motivo).
const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const SERVICE_ACCOUNT = 'C:/Users/Daterrinha69/Downloads/daterrinha-inventario-firebase-adminsdk-fbsvc-f8aa5c734e.json';
admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });
const db = admin.firestore();

const LOJA = 'loja_matriz';
const IDS = ['DIV-1791387988337-Y82S', 'DIV-1791387988338-MS2T'];

async function main() {
  for (const id of IDS) {
    const ref = db.collection('lojas').doc(LOJA).collection('dt_divergencias').doc(id);
    const antes = await ref.get();
    if (!antes.exists) { console.log(id, 'não existe mais, pulando'); continue; }
    const v = antes.data();
    console.log(`--- ${id} antes: status=${v.status} status_recontagem=${v.status_recontagem} cancelada_motivo=${v.cancelada_motivo}`);
    await ref.set({ status: 'CANCELADA', status_recontagem: 'CANCELADA' }, { merge: true });
    const depois = await ref.get();
    console.log(`--- ${id} depois: status=${depois.data().status} status_recontagem=${depois.data().status_recontagem}`);
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
