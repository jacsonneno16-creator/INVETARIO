const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const SERVICE_ACCOUNT = 'C:/Users/Daterrinha69/Downloads/daterrinha-inventario-firebase-adminsdk-fbsvc-f8aa5c734e.json';
admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });
const db = admin.firestore();

function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();}

async function main() {
  const lojas = await db.collection('lojas').get();
  const alvo = norm('INDL - BATATA PALHA DA TERRINHA EX FINA 100G CX20');
  console.log('alvo normalizado:', alvo);

  console.log('\n=== pcp_requisicoes_compra: TODAS as linhas de insumo, por loja, filtrando por nome parecido ===');
  let achouAlgo = false;
  for (const loja of lojas.docs) {
    const snap = await loja.ref.collection('pcp_requisicoes_compra').where('tipoSolicitacao','==','insumo').get().catch(()=>({docs:[]}));
    snap.docs.forEach(d => {
      const x = d.data();
      const nomeNorm = norm(x.insumo || x.produto || '');
      if (nomeNorm.includes('batata palha') || nomeNorm.includes('indl')) {
        achouAlgo = true;
        console.log('Loja', loja.id, '-', JSON.stringify(x));
      }
    });
  }
  if (!achouAlgo) console.log('Nenhuma requisição de insumo com "batata palha"/"indl" no nome, em loja nenhuma.');

  console.log('\n=== contagem geral: quantas requisições de insumo existem no total (todas as lojas)? ===');
  let totalInsumo = 0, totalGeral = 0;
  for (const loja of lojas.docs) {
    const snapTodas = await loja.ref.collection('pcp_requisicoes_compra').get().catch(()=>({docs:[]}));
    totalGeral += snapTodas.size;
    totalInsumo += snapTodas.docs.filter(d => d.data().tipoSolicitacao === 'insumo').length;
  }
  console.log('Total de requisições (todas as lojas, todos os tipos):', totalGeral, '- das quais de insumo:', totalInsumo);

  process.exit(0);
}
main().catch(e => { console.error('ERRO:', e); process.exit(1); });
