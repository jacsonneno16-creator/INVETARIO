'use strict';
// Investigação (2026-09-25): "quero que puxe de um lugar só... vá lá e olhe
// o projeto pra ver de onde cada aba puxa produto — compras, inventário,
// recebimento, PCP". Lista TODAS as coleções raiz do projeto de verdade
// (ground truth do Firestore, não só o que o código sugere), mais uma
// amostra de doc de cada uma cujo nome pareça ter a ver com "produto", pra
// eu conseguir comparar contra o que o código de cada módulo lê.
const path = require('node:path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const SERVICE_ACCOUNT = 'C:/Users/Daterrinha69/Downloads/daterrinha-inventario-firebase-adminsdk-fbsvc-f8aa5c734e.json';

async function main() {
  admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });
  const db = admin.firestore();

  const raizes = await db.listCollections();
  console.log('=== COLEÇÕES RAIZ (' + raizes.length + ') ===');
  const nomes = raizes.map(c => c.id).sort();
  nomes.forEach(n => console.log(n));

  console.log('\n=== COLEÇÕES COM "produt" NO NOME — contagem + 1 doc de amostra ===');
  for (const nome of nomes) {
    if (!/produt/i.test(nome)) continue;
    const snap = await db.collection(nome).limit(1).get();
    const countSnap = await db.collection(nome).count().get().catch(() => null);
    const total = countSnap ? countSnap.data().count : '?';
    console.log('\n--- ' + nome + ' (aprox. ' + total + ' docs) ---');
    if (!snap.empty) {
      const doc = snap.docs[0];
      console.log('doc id exemplo:', doc.id);
      console.log(JSON.stringify(doc.data(), null, 2).slice(0, 1500));
    } else {
      console.log('(vazia)');
    }
  }

  console.log('\n=== 1ª LOJA — subcoleções (pra ver o que é por-loja) ===');
  const lojasSnap = await db.collection('lojas').limit(1).get();
  if (!lojasSnap.empty) {
    const lojaDoc = lojasSnap.docs[0];
    console.log('loja exemplo:', lojaDoc.id, JSON.stringify(lojaDoc.data()).slice(0, 300));
    const subs = await lojaDoc.ref.listCollections();
    subs.map(s => s.id).sort().forEach(n => console.log(' -', n));
  }

  process.exit(0);
}

main().catch(e => { console.error('ERRO:', e); process.exit(1); });
