'use strict';
// Diagnóstico ao vivo (2026-09-25): "00001 TAPIOCA DA TERRINHA 1 KG - FD 12"
// (produto_key 27745) mostra Estoque 159.794 na tela de Planejamento, mas
// o arquivo produtos_estoque.json só tem 2 linhas pra esse produto_key,
// somando 15.949. Roda a lógica REAL de 78-pcp-central.js (construirVisao +
// _juntarEstoqueBi, via vm, não reimplementada) com os dados reais das 8
// lojas + o arquivo local de verdade, pra achar onde o número inflado
// nasce (alias colidindo com outro produto_key, provavelmente).
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const SERVICE_ACCOUNT = 'C:/Users/Daterrinha69/Downloads/daterrinha-inventario-firebase-adminsdk-fbsvc-f8aa5c734e.json';
const ARQUIVO_ESTOQUE = 'C:/Users/Daterrinha69/daterrinhaalimentos.com.br/DT - BI DADOS - extracao_dados_planejamento_estoque/produtos_estoque.json';

async function main() {
  admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });
  const db = admin.firestore();

  // Carrega o código REAL do arquivo (não reimplementa).
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'analista', '78-pcp-central.js'), 'utf8');
  const document = { addEventListener: () => {}, getElementById: () => null };
  const window = { calcularProjecaoComRisco: () => [], getParametrosProducaoProjecao: () => ({}), temPermissao: () => true, PCPDemandEngine: null, PCP_DEMANDA_PARAMETROS: {} };
  vm.runInNewContext(codigo, { window, document, console, Date, Math, Number, String, Array, Object, Set, Map, JSON, confirm: () => true, prompt: () => null });
  const h = window._pcpInternals;

  // Carrega produtos reais das 8 lojas (producao_produtos + pcp_produtos_bluesoft).
  const lojasSnap = await db.collection('lojas').get();
  let produtos = [];
  for (const lojaDoc of lojasSnap.docs) {
    for (const colecao of ['producao_produtos', 'pcp_produtos_bluesoft']) {
      const snap = await lojaDoc.ref.collection(colecao).get();
      snap.docs.forEach(d => produtos.push({ ...d.data(), lojaId: lojaDoc.id }));
    }
  }
  console.log('Total de docs producao_produtos+pcp_produtos_bluesoft (todas as lojas):', produtos.length);

  // Arquivo real de estoque.
  const dadosEstoque = JSON.parse(fs.readFileSync(ARQUIVO_ESTOQUE, 'utf8'));

  // codsValidos = mesmo critério de buscarEstoqueBi (exclui variante UN quando duplicada).
  const estoqueBiMap = h._juntarEstoqueBi(dadosEstoque, null, null, null, null);
  const entradaBruta = estoqueBiMap.get('27745');
  console.log('\n_juntarEstoqueBi (sem filtro de loja) para cod 27745:', entradaBruta ? JSON.stringify(entradaBruta) : 'NÃO ENCONTRADO');

  // Roda construirVisao de verdade, igual a tela faz.
  h.setProdutos(produtos);
  const visao = h.construirVisao({ produtos, estoqueBi: estoqueBiMap });
  const linhaTapioca = visao.filter(v => v.produto && v.produto.includes('TAPIOCA DA TERRINHA 1 KG'));
  console.log('\n=== Linhas na visão final com "TAPIOCA DA TERRINHA 1 KG" ===');
  linhaTapioca.forEach(v => console.log(JSON.stringify({ key: v.key, cod: v.cod, produto: v.produto, estoqueDisponivel: v.estoqueDisponivel, estoqueAtual: v.estoqueAtual })));

  // Investiga alias: quais produtos (Firestore) têm ALGUM campo de alias == '27745' ou apontam pra outro cod?
  console.log('\n=== Docs do Firestore com cod, prodCod, prodKey, bluesoftProdutoKey, produtoUnitarioKey ou produtoUnitarioKeyBluesoft == "27745" ===');
  const camposAlias = ['cod', 'prodCod', 'prodKey', 'bluesoftProdutoKey', 'produtoUnitarioKey', 'produtoUnitarioKeyBluesoft', 'canonicalKey'];
  produtos.forEach(p => {
    camposAlias.forEach(c => {
      if (String(p[c] ?? '').trim() === '27745') {
        console.log('loja', p.lojaId, '| campo', c, '| doc:', JSON.stringify({ cod: p.cod, nome: p.nome, bluesoftProdutoKey: p.bluesoftProdutoKey, produtoUnitarioKey: p.produtoUnitarioKey, produtoUnitarioKeyBluesoft: p.produtoUnitarioKeyBluesoft }));
      }
    });
  });

  // Quais OUTROS produto_key do arquivo de estoque canonicalizam pro MESMO cod 27745?
  console.log('\n=== Todos os produto_key do arquivo de estoque que a lógica agrupa junto com 27745 ===');
  const linhasArquivo = Array.isArray(dadosEstoque) ? dadosEstoque : (dadosEstoque.produtos || dadosEstoque.dados || dadosEstoque.linhas || []);
  const porProdutoKey = new Map();
  linhasArquivo.forEach(l => {
    const key = String(l.produto_key || '').trim();
    if (!key) return;
    const atual = porProdutoKey.get(key) || 0;
    porProdutoKey.set(key, atual + (Number(l.quantidade_estoque) || 0));
  });
  console.log('produto_key únicos no arquivo:', porProdutoKey.size);
  console.log('soma por produto_key == 27745 (direto no arquivo, sem lógica de alias):', porProdutoKey.get('27745'));

  process.exit(0);
}
main().catch(e => { console.error('ERRO:', e); process.exit(1); });
