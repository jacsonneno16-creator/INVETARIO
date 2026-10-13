'use strict';
// Investigação (2026-09-25): comparar a chave de identidade de produto
// usada em cada lugar — PCP (cod), dt_produtos (codigoInterno/gtin),
// bi_classificacao_produtos (produtoKey) — pra saber se dá pra cruzar
// direto ou se precisa de uma tabela de tradução.
const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const SERVICE_ACCOUNT = 'C:/Users/Daterrinha69/Downloads/daterrinha-inventario-firebase-adminsdk-fbsvc-f8aa5c734e.json';

async function main() {
  admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });
  const db = admin.firestore();

  const lojasSnap = await db.collection('lojas').limit(1).get();
  const loja = lojasSnap.docs[0];
  console.log('Loja de teste:', loja.id, loja.data().nome);

  const pcpSnap = await loja.ref.collection('producao_produtos').limit(5).get();
  console.log('\n=== producao_produtos (amostra 5) ===');
  pcpSnap.docs.forEach(d => {
    const x = d.data();
    console.log(JSON.stringify({ cod: x.cod, nome: x.nome, gtin: x.gtin, bluesoftProdutoKey: x.bluesoftProdutoKey, categoria: x.categoria }));
  });

  const bluesoftSnap = await loja.ref.collection('pcp_produtos_bluesoft').limit(5).get();
  console.log('\n=== pcp_produtos_bluesoft (amostra 5) ===');
  bluesoftSnap.docs.forEach(d => {
    const x = d.data();
    console.log(JSON.stringify({ cod: x.cod, nome: x.nome, gtin: x.gtin, bluesoftProdutoKey: x.bluesoftProdutoKey, categoria: x.categoria }));
  });

  // Pega os "cod" reais da amostra PCP e procura em dt_produtos por
  // codigoInterno IGUAL, e por gtin em comum.
  console.log('\n=== Tentando casar por codigoInterno == cod (PCP) ===');
  for (const d of pcpSnap.docs) {
    const cod = String(d.data().cod || '');
    if (!cod) continue;
    const achouCodInterno = await db.collection('dt_produtos').where('codigoInterno', '==', cod).limit(1).get();
    const gtinPcp = d.data().gtin;
    let achouGtin = { empty: true };
    if (gtinPcp) achouGtin = await db.collection('dt_produtos').where('gtin', '==', String(gtinPcp)).limit(1).get();
    console.log('cod PCP', cod, '-> codigoInterno match:', !achouCodInterno.empty, '| gtin match:', !achouGtin.empty);
  }

  console.log('\n=== bi_classificacao_produtos: produtoKey bate com cod do PCP? ===');
  for (const d of pcpSnap.docs) {
    const cod = String(d.data().cod || '');
    if (!cod) continue;
    const doc = await db.collection('bi_classificacao_produtos').doc(cod).get();
    console.log('cod PCP', cod, '-> doc em bi_classificacao_produtos existe:', doc.exists, doc.exists ? JSON.stringify(doc.data()) : '');
  }

  process.exit(0);
}
main().catch(e => { console.error('ERRO:', e); process.exit(1); });
