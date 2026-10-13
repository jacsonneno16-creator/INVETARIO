'use strict';
// BUG AO VIVO REAL (2026-10-03): abrir "Estoque › Transformação" antes do
// script 125-estoque-relatorios.js ter carregado (lazy-load por setor)
// caía direto em "[Navegação] Função ausente: renderEstoqueRelTransformacao"
// — a tela nunca se recuperava, nem tentando carregar o script. Causa:
// _areaLazyPorFuncao() (03-core-navigation.js) reconhece os prefixos
// renderProducao/renderPCP/renderCompras/renderRecebimento pra essa
// recuperação automática, mas esqueceu renderEstoqueRel. Mesmo padrão já
// teria sido pego se analista-router-navegacao.test.js checasse a CHAMADA
// da função de render (ele só confere troca de shell/URL, nunca assert em
// cima do retorno de _callPage — por isso o bug passou batido ali).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const CODIGO = fs.readFileSync(path.join(__dirname, '..', 'js', 'analista', '03-core-navigation.js'), 'utf8');

function montarAmbiente() {
  const dom = new JSDOM('<!doctype html><html><body><div class="page" id="page-estoque-rel-transformacao"></div></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.eval(CODIGO);
  return win;
}

test('_areaLazyPorFuncao: reconhece renderEstoqueRel* igual já reconhece renderRecebimento*/renderProducao*', () => {
  const win = montarAmbiente();
  ['renderEstoqueRelInventario', 'renderEstoqueRelDescarte', 'renderEstoqueRelRequisicao', 'renderEstoqueRelTransformacao'].forEach(fn => {
    assert.equal(win._areaLazyPorFuncao(fn), 'estoque');
  });
});

test('_callPage: função de Estoque ausente (script ainda não carregado) chama carregarScriptsDeArea("estoque") e tenta de novo — não desiste direto', async () => {
  const win = montarAmbiente();
  const chamadas = [];
  win.carregarScriptsDeArea = async (area) => {
    chamadas.push(area);
    // Simula o script real terminando de carregar e se registrando.
    win.renderEstoqueRelTransformacao = () => { win.document.getElementById('page-estoque-rel-transformacao').textContent = 'renderizado'; };
  };
  const resultado = win._callPage('renderEstoqueRelTransformacao');
  await resultado;
  assert.deepEqual(chamadas, ['estoque']);
  assert.equal(win.document.getElementById('page-estoque-rel-transformacao').textContent, 'renderizado');
});

test('_callPage: Estoque continua "Função ausente" (não trava, não lança) se carregarScriptsDeArea falhar', async () => {
  const win = montarAmbiente();
  win.carregarScriptsDeArea = async () => { throw new Error('rede fora'); };
  const resultado = win._callPage('renderEstoqueRelTransformacao');
  await assert.doesNotReject(resultado);
});
