'use strict';
// Diagnóstico ao vivo (2026-09-25): reproduz EXATAMENTE o que a tela
// Planejamento faz — carregar() real (Firestore real) + buscarEstoqueBi()
// real (arquivo local real) + visaoFiltrada() real (a função que a aba
// 'planejamento' realmente usa, NÃO construirVisao isolada — essa era a
// pista que faltava nos diagnósticos anteriores).
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const SERVICE_ACCOUNT = 'C:/Users/Daterrinha69/Downloads/daterrinha-inventario-firebase-adminsdk-fbsvc-f8aa5c734e.json';
const PASTA_BI = 'C:/Users/Daterrinha69/daterrinhaalimentos.com.br/DT - BI DADOS - extracao_dados_planejamento_estoque';

async function main() {
  admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });
  const db = admin.firestore();

  const codigo = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'analista', '78-pcp-central.js'), 'utf8');
  const document = { addEventListener: () => {}, getElementById: () => null };
  const window = {
    calcularProjecaoComRisco: () => [],
    getParametrosProducaoProjecao: () => ({}),
    temPermissao: () => true,
    PCPDemandEngine: null,
    PCP_DEMANDA_PARAMETROS: {},
    getDTRawFirestore: () => db,
    getDTFirestore: () => db,
    getDTLojaAtiva: () => '',
    showToast: () => {},
    DTBiPastaLocal: {
      suportado: () => true,
      status: async () => 'conectado',
      lerJson: async (nome) => JSON.parse(fs.readFileSync(path.join(PASTA_BI, nome), 'utf8')),
    },
  };
  vm.runInNewContext(codigo, { window, document, console, Date, Math, Number, String, Array, Object, Set, Map, JSON, Promise, confirm: () => true, prompt: () => null }, { filename: '78-pcp-central.js' });
  const h = window._pcpInternals;

  console.log('Carregando dados reais (carregar() de verdade, Firestore real)...');
  await h.carregar(true);
  console.log('produtos carregados:', h.getProdutos().length, '| projecao:', h.getProjecao().length);

  console.log('\nBuscando estoque BI real (buscarEstoqueBi() de verdade, arquivo local real)...');
  h.setAba('planejamento');
  await h.buscarEstoqueBi();
  const estoqueBi = h.getEstoqueBi();
  console.log('_estoqueBi tamanho:', estoqueBi ? estoqueBi.size : 0);
  console.log('_estoqueBi.get("27745"):', estoqueBi ? JSON.stringify(estoqueBi.get('27745')) : null);

  console.log('\nChamando visaoFiltrada() de verdade (a função REAL que a aba Planejamento usa)...');
  const v = h.visaoFiltrada();
  const linhas = v.filter(x => (x.produto || '').includes('TAPIOCA DA TERRINHA 1 KG'));
  linhas.forEach(x => console.log(JSON.stringify({ key: x.key, cod: x.cod, produto: x.produto, estoqueAtual: x.estoqueAtual, estoqueDisponivel: x.estoqueDisponivel, saldo: x.saldo })));

  process.exit(0);
}
main().catch(e => { console.error('ERRO:', e, e.stack); process.exit(1); });
