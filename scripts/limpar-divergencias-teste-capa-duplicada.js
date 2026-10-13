'use strict';
// Pedido ao vivo (2026-09-29): apaga de vez os dados de teste do usuário
// (bipou a capa 1234567 em 4 endereços diferentes pra achar o bug de capa
// duplicada). Primeira rodada só apagou as divergências (dt_divergencias),
// mas elas voltaram sozinhas — o motor de divergências reprocessa
// reativamente a qualquer mudança no store, e como as CONTAGENS de teste
// (dt_contagens, capa 1234567) continuam existindo e genuinamente batem
// errado contra a base, ele recria divergências legítimas (não mais
// fantasmas — esse era o bug já corrigido) toda vez. Pra sumir de vez,
// precisa apagar a raiz: as próprias contagens de teste, não só o que
// derivou delas.
//
// Dry-run por padrão; roda de verdade só com --write.
const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const SERVICE_ACCOUNT = 'C:/Users/Daterrinha69/Downloads/daterrinha-inventario-firebase-adminsdk-fbsvc-f8aa5c734e.json';
const ENDERECOS_TESTE = new Set([
  '14.1520.1.24.19.6.1',
  '14.1520.1.4.8.3.1',
  '14.1520.1.24.12.2.1',
  '14.1520.1.6.20.5.1',
]);
const CAPA_TESTE = '1234567';
const TIPOS_DIV_ALVO = new Set(['PRODUTO_NAO_IDENTIFICADO', 'PRODUTO_FORA_ENDERECO']);

async function main() {
  const write = process.argv.includes('--write');
  admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });
  const db = admin.firestore();

  const lojasSnap = await db.collection('lojas').get();
  const alvoContagens = [];
  const alvoDivergencias = [];

  for (const lojaDoc of lojasSnap.docs) {
    const contSnap = await lojaDoc.ref.collection('dt_contagens').get();
    contSnap.docs.forEach(doc => {
      const c = doc.data();
      const capa = String(c.capa || c.capa_palete || c.capaPalete || '').trim();
      const end = String(c.endereco || '').trim();
      if (capa === CAPA_TESTE && ENDERECOS_TESTE.has(end)) {
        alvoContagens.push({ ref: doc.ref, id: doc.id, loja: lojaDoc.id, c });
      }
    });

    const divSnap = await lojaDoc.ref.collection('dt_divergencias').get();
    divSnap.docs.forEach(doc => {
      const d = doc.data();
      const end = String(d.endereco || '').trim();
      const tipo = String(d.tipo_divergencia || '').trim();
      if (ENDERECOS_TESTE.has(end) && TIPOS_DIV_ALVO.has(tipo)) {
        alvoDivergencias.push({ ref: doc.ref, id: doc.id, loja: lojaDoc.id, d });
      }
    });
  }

  console.log(`Contagens de teste (capa ${CAPA_TESTE}) encontradas: ${alvoContagens.length}`);
  alvoContagens.forEach(({ id, loja, c }) => {
    console.log(` - [${loja}] ${id} | ${c.endereco} | gtin=${c.gtin || c.gtinLido || ''} | qtd=${c.quantidade}`);
  });

  console.log(`\nDivergências derivadas encontradas: ${alvoDivergencias.length}`);
  alvoDivergencias.forEach(({ id, loja, d }) => {
    console.log(` - [${loja}] ${id} | ${d.endereco} | ${d.tipo_divergencia} | status=${d.status}`);
  });

  if (!write) {
    console.log('\n[dry-run] Nada foi apagado. Rode de novo com --write pra apagar de verdade.');
    return;
  }

  const todos = [...alvoContagens, ...alvoDivergencias];
  for (let i = 0; i < todos.length; i += 300) {
    const lote = todos.slice(i, i + 300);
    const batch = db.batch();
    lote.forEach(({ ref }) => batch.delete(ref));
    await batch.commit();
  }
  console.log(`\n✅ ${alvoContagens.length} contagem(ns) + ${alvoDivergencias.length} divergência(s) apagada(s).`);
}

main().catch(err => { console.error(err); process.exit(1); });
