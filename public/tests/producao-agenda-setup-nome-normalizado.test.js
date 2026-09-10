// PEDIDO AO VIVO (2026-09-07): "o setup dos produtos não está calculando
// nem aparecendo o tempo... um tinha a descrição toda do produto e o outro
// não" — causa real achada em 70-producao-setup.js: o dropdown de cadastro
// de setup usa maquina.produtosCompativeis[].produto (o rótulo CURTO
// cadastrado na máquina, só uma chave de casamento), enquanto as OPs de
// verdade (producao_registros.produto) carregam o nome/descrição CHEIO do
// produto. getSetupMin (63-producao-agenda.js) comparava os dois com
// igualdade EXATA de string, então o setup cadastrado nunca era achado —
// caía sempre no padrão da máquina (ou 0min). Corrigido pra tolerar essa
// relação de prefixo (rótulo curto × nome cheio) SÓ na busca do cadastro de
// setup; a identidade "é o mesmo produto, sem troca nenhuma" (decide se HÁ
// setup entre 2 OPs consecutivas) continua exigindo igualdade normalizada
// EXATA, pra não zerar o setup entre produtos genuinamente diferentes que
// por acaso compartilham prefixo (ex.: "Tapioca" e "Tapioca Recheada").
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../js/analista/63-producao-agenda.js'), 'utf8');

function carregar() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.window;
}

test('getSetupMin: acha o setup cadastrado com o rótulo CURTO (produtosCompativeis) mesmo passando o nome CHEIO da OP', () => {
  const win = carregar();
  const maquina = { nome: 'Extrusora 1' };
  // Cadastro de setup feito com os rótulos curtos que aparecem no dropdown
  // (vindos de maquina.produtosCompativeis[].produto).
  const setups = [{ maquina: 'Extrusora 1', produtoOrigem: 'Milho Pipoca', produtoDestino: 'Tapioca Tradicional', minutos: 45 }];
  // As OPs de verdade usam o nome/descrição cheio do cadastro de produtos.
  const min = win.getSetupMin(maquina, 'Milho Pipoca 500g - Embalagem Padrão', 'Tapioca Tradicional 500g - Pacote Novo', setups);
  assert.equal(min, 45, 'acha o setup específico mesmo com o cadastro usando o rótulo curto e a OP o nome cheio');
});

test('getSetupMin: continua achando quando os nomes batem exatamente (comportamento antigo preservado)', () => {
  const win = carregar();
  const maquina = { nome: 'Extrusora 1' };
  const setups = [{ maquina: 'Extrusora 1', produtoOrigem: 'Produto A', produtoDestino: 'Produto B', minutos: 30 }];
  assert.equal(win.getSetupMin(maquina, 'Produto A', 'Produto B', setups), 30);
});

test('getSetupMin: produtos genuinamente diferentes não casam por acidente (só por serem parecidos)', () => {
  const win = carregar();
  const maquina = { nome: 'Extrusora 1', setupPadraoMin: 15 };
  const setups = [{ maquina: 'Extrusora 1', produtoOrigem: 'Produto A', produtoDestino: 'Produto B', minutos: 30 }];
  assert.equal(win.getSetupMin(maquina, 'Produto A', 'Produto C', setups), 15, 'sem entrada específica pra Produto A → Produto C, cai no padrão da máquina');
});

test('getSetupMin: EXATAMENTE o mesmo produto (nomes idênticos após normalizar) não gera setup entre si (0min)', () => {
  const win = carregar();
  const maquina = { nome: 'Extrusora 1', setupPadraoMin: 20 };
  assert.equal(win.getSetupMin(maquina, 'Tapioca Tradicional', 'tapioca   tradicional', []), 0, 'mesmo produto (só acento/espaço/caixa diferentes) — sem troca, sem setup');
});

test('getSetupMin: produtos DIFERENTES onde um nome é prefixo do outro NÃO viram "o mesmo produto" — setup continua valendo', () => {
  const win = carregar();
  const maquina = { nome: 'Extrusora 1', setupPadraoMin: 99 };
  // "Tapioca Tradicional" é prefixo de "Tapioca Tradicional Recheada", mas
  // são produtos DIFERENTES de verdade — a guarda de identidade não pode
  // zerar o setup entre eles só por causa do prefixo.
  const setups = [{ maquina: 'Extrusora 1', produtoOrigem: 'Tapioca Tradicional', produtoDestino: 'Tapioca Tradicional Recheada', minutos: 60 }];
  assert.equal(win.getSetupMin(maquina, 'Tapioca Tradicional', 'Tapioca Tradicional Recheada', setups), 60, 'produtos diferentes com prefixo compartilhado continuam com setup de verdade, não 0');
});

test('buildProducaoSchedule: setup cadastrado com rótulo curto aparece na grade do dia mesmo com a OP usando o nome cheio', () => {
  const win = carregar();
  const weekStart = new Date(2026, 8, 7); // segunda-feira
  const maquina = { nome: 'Extrusora 1', turnos: { 1: [{ ini: '08:00', fim: '17:00', ativo: true }] } };
  const registros = [
    { produto: 'Milho Pipoca 500g - Embalagem Padrão', prodCod: '1', maquina: 'Extrusora 1', pcMin: 10, unidPorCx: 1, qntCaixas: 10, status: 'pendente', data: '2026-09-07', sortOrder: 1 },
    { produto: 'Tapioca Tradicional 500g - Pacote Novo', prodCod: '2', maquina: 'Extrusora 1', pcMin: 10, unidPorCx: 1, qntCaixas: 10, status: 'pendente', data: '2026-09-07', sortOrder: 2 },
  ];
  const setups = [{ maquina: 'Extrusora 1', produtoOrigem: 'Milho Pipoca', produtoDestino: 'Tapioca Tradicional', minutos: 45 }];
  const s = win.buildProducaoSchedule(weekStart, registros, { 'Extrusora 1': maquina }, setups);
  const eventosSetup = s.porMaquina['Extrusora 1'].porDia.flat().filter(ev => ev.tipo === 'setup');
  assert.equal(eventosSetup.length, 1, 'o setup entre as 2 OPs aparece na grade, mesmo com o cadastro usando o rótulo curto');
  assert.equal(eventosSetup[0].minutosNoDia, 45);
});
