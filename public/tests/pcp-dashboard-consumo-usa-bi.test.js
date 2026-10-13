// PEDIDO AO VIVO (2026-09-02): "maior consumo diário tá calculando errado"
// — diagnosticado via console real do usuário (window._pcpInternals no
// navegador): o Dashboard só usa o BI (plano da escadinha, fonte certa,
// somada corretamente por loja) quando _estoqueBi já estava em memória —
// se ninguém tinha clicado em "Buscar do BI" na aba Estoque/Pedidos x
// Estoque NESTA sessão, caía no fallback (venda_m1/m2/m3 de
// producao_projecao), que fica desatualizado quando ninguém reimporta.
// Caso real confirmado pelo usuário: CANJICA mostrava 55,1/dia (calculado
// a partir de venda_m1/m2/m3 antigos, editados manualmente/via Excel tempos
// atrás) contra 200/dia do plano do BI atual pro mesmo produto — quase 4x
// de diferença. Fix: o Dashboard busca o BI sozinho ao abrir, quando ainda
// não tinha sido buscado nesta sessão (DTBiPastaLocal.lerJson chama uma
// Cloud Function/Graph API, não pede permissão de pasta local — seguro
// disparar sem gesto do usuário).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const codeCentral = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '78-pcp-central.js'), 'utf8');
const codeDashboard = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '82-pcp-dashboard.js'), 'utf8');

function colecaoVazia() { return { get: async () => ({ docs: [] }), where: () => ({ get: async () => ({ docs: [] }) }), orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }), get: async () => ({ docs: [] }) }) }; }

async function montarAmbiente(opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><html><body><div id="page-pcp-central"></div><div id="page-pcp-dashboard"></div><div id="pcp-modal-host"></div></body></html>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const win = dom.window;
  win.temPermissao = () => true;
  win.calcularProjecaoComRisco = () => [];
  win.getParametrosProducaoProjecao = () => ({});
  win.getDTLojaAtiva = () => 'loja1';
  win.showToast = () => {};
  win.confirm = () => true;
  win._currentAnalistaUser = { email: 'pcp@teste.com' };
  const colProdutos = { get: async () => ({ docs: (opts.produtos || []).map((p, i) => ({ id: 'p' + i, data: () => p })) }) };
  const colProjecao = { get: async () => ({ docs: (opts.projecao || []).map((p, i) => ({ id: 'j' + i, data: () => p })) }) };
  const colSnapshots = { get: async () => ({ docs: [] }) };
  const snapshotDoc = { get: async () => ({ exists: false }), set: async () => {} };
  win.getDTFirestore = () => ({
    collection: (nome) => ({
      producao_produtos: colProdutos,
      producao_projecao: colProjecao,
      pcp_snapshots_diarios: { ...colecaoVazia(), doc: () => snapshotDoc },
    }[nome] || colecaoVazia()),
  });
  win.getDTRawFirestore = () => win.getDTFirestore();
  let chamouBuscarEstoqueBi = 0;
  win.DTBiPastaLocal = opts.biIndisponivel ? undefined : {
    suportado: () => true,
    status: async () => 'conectado',
    conectar: async () => ({ ok: true }),
    lerJson: async (nome) => {
      chamouBuscarEstoqueBi++;
      if (nome.includes('estoque')) return opts.arquivoEstoque || [];
      if (nome.includes('escadinha')) return opts.arquivoEscadinha || { produtos: [] };
      return null;
    },
  };
  vm.runInContext(codeCentral, dom.getInternalVMContext(), { filename: '78-pcp-central.js' });
  vm.runInContext(codeDashboard, dom.getInternalVMContext(), { filename: '82-pcp-dashboard.js' });
  await win.renderPCPDashboard();
  return { win, chamadasLerJson: () => chamouBuscarEstoqueBi };
}

test('Dashboard sem BI ainda buscado nesta sessão: busca sozinho (DTBiPastaLocal.lerJson chama Cloud Function, não pede permissão de pasta)', async () => {
  const { win, chamadasLerJson } = await montarAmbiente({
    produtos: [{ cod: '80605', nome: '01614 CANJICA BRANCA DA TERRINHA 400 G - CX 12' }],
    projecao: [{ cod: '80605', produto: '01614 CANJICA BRANCA DA TERRINHA 400 G - CX 12', venda_m1: 1966.17, venda_m2: 1716.42, venda_m3: 861.92, estoqueAtual: 10.25 }],
    arquivoEstoque: [{ loja: 'MATRIZ', loja_key: 1, produto_key: 80605, produto: 'CANJICA BRANCA DA TERRINHA 400 G - CX 12', quantidade_estoque: 2194.75, quantidadePedidos: 1567 }],
    arquivoEscadinha: { produtos: [{ cod: 80605, produto: 'CANJICA BRANCA DA TERRINHA 400 G - CX 12', plano: [1596, 2500, 3000, 4000, 10000, 30000, 15000, 6000, 6000, 6000, 6000, 6000], real: [1596, 2303, 3891, 5680, 21658, 30705, 11408, 4547, 200, 0, 0, 0] }] },
  });
  assert.ok(chamadasLerJson() >= 2, 'buscou os 2 arquivos do BI (estoque + escadinha) sozinho, sem esperar clique manual');
  assert.equal(win._pcpInternals.getEstoqueBi().size, 1, '_estoqueBi ficou populado depois do render do Dashboard');
  const html = win.document.getElementById('page-pcp-dashboard').innerHTML;
  // consumoDia do BI pro mês corrente do teste (mesIndice=null vira o mês
  // atual real da máquina rodando o teste) não é fixo — a asserção robusta
  // é que NÃO usa mais o fallback stale (55,1, calculado a partir de
  // venda_m1/m2/m3 antigos passados em `projecao`).
  assert.doesNotMatch(html, />55,1</, 'não caiu mais no fallback desatualizado de producao_projecao (venda_m1/m2/m3 velhos)');
});

test('Dashboard sem DTBiPastaLocal disponível: não quebra, mantém o fallback de producao_projecao', async () => {
  const { win } = await montarAmbiente({
    biIndisponivel: true,
    produtos: [{ cod: '80605', nome: '01614 CANJICA BRANCA DA TERRINHA 400 G - CX 12' }],
    projecao: [{ cod: '80605', produto: '01614 CANJICA BRANCA DA TERRINHA 400 G - CX 12', venda_m1: 1966.17, venda_m2: 1716.42, venda_m3: 861.92, estoqueAtual: 10.25 }],
  });
  assert.equal(win._pcpInternals.getEstoqueBi?.(), null, 'sem suporte a BI, nunca tenta preencher _estoqueBi');
  const html = win.document.getElementById('page-pcp-dashboard').innerHTML;
  assert.match(html, /Ações prioritárias/, 'dashboard continua funcionando como cockpit quando o BI não está disponível');
  const visao=win._pcpInternals.construirVisao({estoqueBi:null});
  assert.ok(visao.some(x=>/CANJICA/.test(x.produto)), 'fallback de producao_projecao continua disponível no motor, só não é repetido como tabela no Dashboard');
});
