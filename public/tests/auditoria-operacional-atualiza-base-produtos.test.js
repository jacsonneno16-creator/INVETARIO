// PEDIDO AO VIVO: um produto foi bipado na Auditoria antes de existir no
// cadastro (Base de Produtos) e ficou "Produto não identificado". Depois de
// cadastrar o produto e clicar em "Atualizar" na Auditoria, o nome
// continuava sem aparecer — normalizarItem() já resolve o DUN lido contra
// DTProdutos.buscarSync() toda vez que roda, mas "Atualizar"
// (atualizarListaAuditorias, exposta como atualizarAuditoriaOperacionalManual)
// só relia os documentos da auditoria; nunca recarregava o CADASTRO em si,
// então a comparação continuava rodando contra o cache antigo de produtos.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/38-auditoria-operacional-v22.js'), 'utf8');

function carregarAuditoria() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.eval(code);
  return win;
}

test('"Atualizar" na Auditoria recarrega a base de produtos (DTProdutos.carregar) antes de reler os itens da auditoria', async () => {
  const win = carregarAuditoria();
  let chamadasCarregar = 0;
  win.DTProdutos = { carregar: async () => { chamadasCarregar++; return []; } };
  await win.atualizarAuditoriaOperacionalManual();
  assert.equal(chamadasCarregar, 1, 'clicar em Atualizar precisa recarregar a base de produtos, senão um produto recém-cadastrado nunca aparece resolvido');
});

test('"Atualizar" na Auditoria não quebra quando DTProdutos ainda não carregou (sem window.DTProdutos)', async () => {
  const win = carregarAuditoria();
  // Sem window.DTProdutos nenhum — a função precisa checar antes de chamar.
  await assert.doesNotReject(win.atualizarAuditoriaOperacionalManual());
});

test('"Atualizar" na Auditoria não trava a tela se a base de produtos falhar ao recarregar (ex.: rede fora do ar)', async () => {
  const win = carregarAuditoria();
  win.DTProdutos = { carregar: async () => { throw new Error('offline'); } };
  await assert.doesNotReject(win.atualizarAuditoriaOperacionalManual(), 'uma falha ao atualizar produtos não pode impedir a auditoria de atualizar o resto');
});

// PEDIDO AO VIVO (2ª rodada): o botão "🔄 Atualizar" ficava escondido pra
// qualquer conta que não fosse admin — aplicarPermissoesAnalista()
// (37-usuarios-permissoes.js) esconde todo onclick que contenha
// "atualizar"/"refresh" atrás de uma ação "atualizar" que não existe na
// árvore de permissões de NENHUM módulo, então a permissão nunca podia ser
// concedida. Em vez de corrigir a árvore de permissões, o botão foi
// removido e a tela passou a se atualizar sozinha ao ser aberta.
test('entrar na tela de Auditoria (renderAuditoriaOperacional) dispara a mesma atualização automática que o botão "Atualizar" fazia antes de ser removido', async () => {
  const win = carregarAuditoria();
  let chamadasCarregar = 0;
  win.DTProdutos = { carregar: async () => { chamadasCarregar++; return []; } };
  win.renderAuditoriaOperacional();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(chamadasCarregar, 1, 'entrar na tela precisa recarregar a base de produtos automaticamente, sem precisar de botão');
});

test('saída e volta pra tela de Auditoria (renderAuditoriaOperacional chamado de novo) atualiza de novo, não só na primeira entrada', async () => {
  const win = carregarAuditoria();
  let chamadasCarregar = 0;
  win.DTProdutos = { carregar: async () => { chamadasCarregar++; return []; } };
  win.renderAuditoriaOperacional();
  await new Promise(r => setTimeout(r, 0));
  win.renderAuditoriaOperacional();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(chamadasCarregar, 2, 'cada entrada na tela precisa disparar uma nova atualização');
});

test('REGRESSÃO: o botão "🔄 Atualizar" foi removido do topo da tela de Auditoria em analista.html (dependia de uma permissão que não existia)', () => {
  const html = fs.readFileSync(path.join(__dirname, '../analista.html'), 'utf8');
  const inicio = html.indexOf('Auditoria Operacional</div><div class="sec-sub">Compare o DUN importado');
  assert.ok(inicio > -1, 'não achei o cabeçalho da tela de Auditoria em analista.html — o teste precisa ser atualizado se o texto mudou');
  const trecho = html.slice(inicio, inicio + 600);
  assert.doesNotMatch(trecho, /atualizarTresAbasAuditoria/, 'o botão "Atualizar" não pode voltar pro topo da Auditoria — ele fica escondido pra contas não-admin (bug de permissão) e foi substituído por atualização automática ao entrar na tela');
});
