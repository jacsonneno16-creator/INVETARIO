'use strict';
/**
 * PEDIDO AO VIVO (2026-10-02): "veja se tem mais alguma coisa sem
 * permissão, para isso não acontecer, e verifica no código se tem como
 * deixar em cada módulo que isso seja feito para tudo que for criado" —
 * auditoria ao vivo achou 3 páginas reais (class="page" no analista.html)
 * sem nenhum módulo de permissão correspondente em MODULOS
 * (37-usuarios-permissoes.js): page-impressoras (sem NENHUMA checagem —
 * qualquer um que abrisse Configurações conseguia mexer nas impressoras
 * de rede), page-recebimento-tempos e page-recebimento-historico (o
 * oposto: goPage() já checa temPermissao(id,'visualizar') pra qualquer
 * id, então sem módulo cadastrado ninguém — exceto admin_mestre —
 * conseguia acessar, e não tinha como liberar pela tela de permissões).
 *
 * Este teste trava que toda página real do analista.html tem, ou um
 * módulo em MODULOS com o MESMO id, ou está na lista EXPLÍCITA de
 * exceções abaixo (cada uma com o motivo documentado) — assim uma página
 * nova criada sem pensar em permissão quebra a suíte em vez de ficar
 * invisível até alguém notar em produção, como aconteceu com as 3 acima.
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const htmlPath = path.join(__dirname, '..', 'analista.html');
const permCodePath = path.join(__dirname, '..', 'js', 'analista', '37-usuarios-permissoes.js');
const html = fs.readFileSync(htmlPath, 'utf8');
const permCode = fs.readFileSync(permCodePath, 'utf8');

// Só <div class="page ..." id="page-X"> ou <div id="page-X" class="page...">
// conta como página real — exclui falsos positivos tipo id="page-title"
// (que é class="page-title", um rótulo de texto, não uma tela).
function extrairPaginasReais(htmlTexto) {
  const re = /<div class="page[" ][^>]*id="page-([a-z0-9-]+)"|<div id="page-([a-z0-9-]+)"[^>]*class="page[" ]/g;
  const ids = new Set();
  let m;
  while ((m = re.exec(htmlTexto))) ids.add(m[1] || m[2]);
  return [...ids].sort();
}

function extrairModulosIds(codigoTexto) {
  const inicio = codigoTexto.indexOf('const MODULOS=[');
  const fim = codigoTexto.indexOf('\n  ];', inicio);
  assert.ok(inicio > -1 && fim > inicio, 'não encontrei o array MODULOS em 37-usuarios-permissoes.js — ajuste este teste se ele foi renomeado/movido');
  const trecho = codigoTexto.slice(inicio, fim);
  const ids = new Set();
  const re = /id:'([a-z0-9-]+)'/g;
  let m;
  while ((m = re.exec(trecho))) ids.add(m[1]);
  return ids;
}

// Páginas que DE PROPÓSITO não têm um módulo 1:1 — cada uma com o motivo
// e ONDE no código a checagem de verdade acontece, pra quem for mexer
// aqui depois conseguir confirmar rapidamente que a exceção ainda é real.
const EXCECOES = {
  // PCP inteiro usa um único módulo guarda-chuva — ver pcpIrParaAba() em
  // 78-pcp-central.js, 1ª linha: temPermissao('pcp-central','visualizar').
  'pcp-alertas': 'pcp-central', 'pcp-compras-acompanhamento': 'pcp-central', 'pcp-cortes': 'pcp-central',
  'pcp-dashboard': 'pcp-central', 'pcp-insumo-360': 'pcp-central', 'pcp-parametros': 'pcp-central',
  'pcp-producao-insumo': 'pcp-central', 'pcp-produto-360': 'pcp-central', 'pcp-projecao-vendas': 'pcp-central',
  'pcp-relatorios': 'pcp-central', 'pcp-timeline': 'pcp-central',
  // Compras inteiro também usa um único módulo guarda-chuva — ver o tem()
  // em 79-compras-central.js/121-compras-profissional.js: temPermissao('compras-central',...).
  'compras-administracao': 'compras-central', 'compras-cotacoes': 'compras-central', 'compras-dashboard': 'compras-central',
  'compras-fornecedores': 'compras-central', 'compras-pedidos': 'compras-central', 'compras-precos': 'compras-central',
  'compras-produtos': 'compras-central', 'compras-recebimentos': 'compras-central', 'compras-relatorios': 'compras-central',
  'compras-solicitacoes': 'compras-central',
  // Não é um módulo novo, é a MESMA tela de Importar/Exportar reaberta
  // dentro do modal de Configurações — ver abrirModalConfiguracoes(),
  // pageId==='integracao': checa temPermissao('importar-exportar').
  'integracao-api': 'importar-exportar',
  // "Cargas reaproveita Transbordo/Recebimentos por ser o mesmo fluxo" —
  // caso especial DENTRO de temPermissao() (não uma entrada em MODULOS):
  // herda de recebimento-transbordo OU recebimento-operacao.
  'recebimento-cargas': 'recebimento-transbordo / recebimento-operacao (caso especial em temPermissao())',
};

test('toda página real (class="page") tem um módulo de permissão com o mesmo id, ou está na lista de exceções documentadas', () => {
  const paginas = extrairPaginasReais(html);
  assert.ok(paginas.length > 50, 'sanity: extrairPaginasReais deveria achar dezenas de páginas reais — ajuste a regex se o HTML mudou de formato');
  const modulosIds = extrairModulosIds(permCode);
  const semCobertura = paginas.filter(id => !modulosIds.has(id) && !(id in EXCECOES));
  assert.deepEqual(semCobertura, [], 'página(s) sem módulo de permissão em MODULOS nem exceção documentada — adicione uma entrada em MODULOS (37-usuarios-permissoes.js) ou documente o motivo em EXCECOES aqui');
});

test('as exceções documentadas continuam existindo de verdade como página (pra este teste não acumular lixo de páginas já removidas)', () => {
  const paginas = new Set(extrairPaginasReais(html));
  for (const id of Object.keys(EXCECOES)) {
    assert.ok(paginas.has(id), `"${id}" está em EXCECOES mas não existe mais como página — remova a entrada`);
  }
});

test('impressoras: tinha ficado sem NENHUMA checagem de permissão em abrirModalConfiguracoes — trava que o módulo e a checagem continuam existindo', () => {
  assert.match(permCode, /id:'impressoras'/, 'módulo "impressoras" precisa existir em MODULOS');
  const inicioFn = permCode.indexOf("if(pageId==='impressoras'){");
  const fimFn = permCode.indexOf("if(pageId==='integracao'){", inicioFn);
  assert.ok(inicioFn > -1 && fimFn > inicioFn, 'não encontrei o bloco pageId==="impressoras" em abrirModalConfiguracoes()');
  const trecho = permCode.slice(inicioFn, fimFn);
  assert.match(trecho, /temPermissao\('impressoras'\)/, 'abrirModalConfiguracoes() precisa checar a permissão antes de mostrar a página de impressoras');
  assert.doesNotMatch(permCode, /elImp\.style\.display=temPermissao\('coletores'\)/, 'a aba de impressoras não pode mais usar a permissão de "coletores" (cópia e cola antiga, sem relação)');
});

test('recebimento-tempos e recebimento-historico: antes não tinham módulo nem caso especial (negava acesso a todo mundo, sem jeito de liberar) — agora são módulos normais', () => {
  assert.match(permCode, /id:'recebimento-tempos'/);
  assert.match(permCode, /id:'recebimento-historico'/);
});
