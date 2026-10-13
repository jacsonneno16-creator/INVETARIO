'use strict';
// Correção pontual (2026-10-07), autorizada pelo usuário: o registro de
// contagem e a divergência da capa 7984662 (endereço 14.1520.1.22.15.3.1,
// produto 141995 bipado por engano) foram gravados ANTES da correção do
// fator de caixa do produto bipado, com fator_caixa:1 (deveria ser 20, o
// fator real do produto 141995 confirmado em dt_produtos).
const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const SERVICE_ACCOUNT = 'C:/Users/Daterrinha69/Downloads/daterrinha-inventario-firebase-adminsdk-fbsvc-f8aa5c734e.json';
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });
const db = admin.firestore();
const LOJA = 'loja_matriz';

async function main() {
  const refContagem = db.collection('lojas').doc(LOJA).collection('dt_contagens').doc('b52c422f-1081-4322-9381-a6dbda7e36e7');
  const antes1 = await refContagem.get();
  console.log('contagem antes:', JSON.stringify({ fator_caixa: antes1.data().fator_caixa, quantidade_unidades: antes1.data().quantidade_unidades }));
  await refContagem.set({ fator_caixa: 20, quantidade_unidades: 960 }, { merge: true });
  const depois1 = await refContagem.get();
  console.log('contagem depois:', JSON.stringify({ fator_caixa: depois1.data().fator_caixa, quantidade_unidades: depois1.data().quantidade_unidades }));

  const refDiv = db.collection('lojas').doc(LOJA).collection('dt_divergencias').doc('DIV-1791389683170-91VU');
  const antes2 = await refDiv.get();
  console.log('divergência antes:', JSON.stringify({ qtd_contada: antes2.data().qtd_contada, qtd_primeira: antes2.data().qtd_primeira }));
  await refDiv.set({ qtd_contada: 960, qtd_primeira: 960 }, { merge: true });
  const depois2 = await refDiv.get();
  console.log('divergência depois:', JSON.stringify({ qtd_contada: depois2.data().qtd_contada, qtd_primeira: depois2.data().qtd_primeira }));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
