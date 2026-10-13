const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const salvar = fs.readFileSync(path.join(root,'js/coletor/08-etapas-produto-quantidade-salvamento.js'),'utf8');
const enderecoJs = fs.readFileSync(path.join(root,'js/coletor/07-etapa-endereco.js'),'utf8');
const passos = fs.readFileSync(path.join(root,'js/coletor/06-capa-fluxo-steps.js'),'utf8');
const scanner = fs.readFileSync(path.join(root,'js/coletor/12-scanner-hardware.js'),'utf8');
const html = fs.readFileSync(path.join(root,'coletor.html'),'utf8');

// Pedido ao vivo 2026-09-29 (1ª parte): "na hora de fazer a contagem no
// coletor, ele nao ta pedindo a data de validade" — causa raiz: o campo que
// hoje pede "Lote do produto" é o MESMO campo que antes pedia validade
// (reaproveitado numa rodada anterior). Adicionada uma etapa dedicada de
// Data de validade, mantendo Lote.
//
// Pedido ao vivo 2026-09-29 (2ª e 3ª partes, ajustes de ordem): a sequência
// final é Endereço → Produto (GTIN) → Capa/Palete → Validade → Lote →
// Quantidade, e a validade ganhou máscara automática DD/MM/AAAA.
test('ordem final das etapas no HTML: Endereço → Produto → Capa → Validade → Lote → Quantidade',()=>{
  const i = id => html.indexOf(`id="${id}"`);
  const ordem = ['step-endereco','step-gtin','step-capa','step-vencimento','step-validade','step-quantidade'];
  const posicoes = ordem.map(i);
  assert.ok(posicoes.every(p=>p>0), 'algum id de etapa não foi encontrado no HTML');
  for (let k=1;k<posicoes.length;k++) assert.ok(posicoes[k]>posicoes[k-1], `esperava ${ordem[k-1]} antes de ${ordem[k]} no HTML`);
  assert.match(html,/id="f-vencimento"[^>]*placeholder="DD\/MM\/AAAA"/);
  assert.match(html,/onclick="confirmarVencimento\(\)"/);
});

test('confirmarEndereco()/_prosseguirComEndereco() avança pro Produto (etapa 2), não pra Capa',()=>{
  const corpo = enderecoJs.slice(enderecoJs.indexOf('/** Prossegue para a etapa 2 após validar o endereço */'));
  // As 3 ramificações (recontagem, virtual, física normal) devem todas
  // mirar em f-gtin/step 2 depois do endereço confirmado.
  const ocorrenciasStep2 = (corpo.match(/APP\.atual\.step\s*=\s*2/g) || []).length;
  assert.ok(ocorrenciasStep2 >= 3, `esperava pelo menos 3 ramos indo pro step 2 (recontagem/virtual/normal) — achou ${ocorrenciasStep2}`);
  assert.match(corpo,/_aplicarLabelGtin\(\)/);
});

test('confirmarGtin() (endereço físico) avança pra Capa/Palete (etapa 3), não pra Vencimento',()=>{
  const corpo = salvar.slice(salvar.indexOf('APP.atual.gtin = normProd(val);'), salvar.indexOf('//  ETAPA 5: LOTE DO PRODUTO'));
  assert.match(corpo,/APP\.atual\.step\s*=\s*3;\s*\n\s*document\.getElementById\('f-capa'\)/);
});

test('confirmarCapa() avança pra Vencimento (etapa 4), não pra GTIN',()=>{
  const corpo = salvar.slice(salvar.indexOf('function confirmarCapa('), salvar.indexOf('function confirmarCapa(')+700);
  assert.match(corpo,/APP\.atual\.step\s*=\s*4/);
  assert.match(corpo,/getElementById\('f-vencimento'\)\.focus/);
});

test('confirmarVencimento() exige e valida DD/MM/AAAA, grava em dataValidade e avança pro Lote (etapa 5)',()=>{
  assert.match(salvar,/function confirmarVencimento\(\)/);
  const corpo = salvar.slice(salvar.indexOf('function confirmarVencimento('), salvar.indexOf('function confirmarVencimento(')+700);
  assert.match(corpo,/Informe a data de validade/);
  assert.match(corpo,/APP\.atual\.dataValidade\s*=\s*val/);
  assert.match(corpo,/APP\.atual\.step\s*=\s*5/);
  assert.match(corpo,/getElementById\('f-validade'\)\.focus/);
});

test('onVencimentoInput() aplica máscara automática DD/MM/AAAA (o operador só digita números)',()=>{
  const corpo = salvar.slice(salvar.indexOf('function onVencimentoInput('), salvar.indexOf('function confirmarVencimento('));
  assert.match(corpo,/replace\(\/\\D\/g, ''\)/); // extrai só dígitos
  assert.match(corpo,/slice\(0, 8\)/); // no máximo 8 dígitos (DD+MM+AAAA)
  assert.match(corpo,/el\.value = val/); // reescreve o campo com as barras já inseridas
});

test('confirmarValidade() (etapa Lote, por último) avança pra Quantidade — é quem prepara a calculadora',()=>{
  const corpo = salvar.slice(salvar.indexOf('function confirmarValidade('), salvar.indexOf('function confirmarValidade(')+900);
  assert.match(corpo,/APP\.atual\.loteProduto\s*=\s*val/);
  assert.match(corpo,/APP\.atual\.step\s*=\s*6/);
  assert.match(corpo,/getElementById\('f-qty'\)\.focus/);
});

test('a contagem salva grava a validade REAL (dataValidade), não o campo antigo que sempre ficava vazio',()=>{
  assert.match(salvar,/validade:\s*a\.enderecoVirtual\s*\?\s*''\s*:\s*a\.dataValidade\s*\|\|\s*''/);
  assert.match(salvar,/lote_produto:\s*a\.enderecoVirtual\s*\?\s*''\s*:\s*a\.loteProduto\s*\|\|\s*''/);
});

test('a assinatura anti-duplo-disparo usa lote e validade reais, não o campo sempre-vazio',()=>{
  const corpo = salvar.slice(salvar.indexOf('function _assinaturaContagem('), salvar.indexOf('function _assinaturaContagem(')+600);
  assert.match(corpo,/atual\.loteProduto/);
  assert.match(corpo,/atual\.dataValidade/);
});

test('updateSteps()/foco do scanner conhecem a nova ordem (6 passos: Endereço, Produto, Capa, Vencimento, Lote, Quantidade)',()=>{
  assert.match(passos,/for \(let i = 1; i <= 6; i\+\+\)/);
  assert.match(passos,/'step-endereco', 'step-gtin', 'step-capa', 'step-vencimento', 'step-validade', 'step-quantidade'/);
  assert.match(passos,/'f-endereco', 'f-gtin', 'f-capa', 'f-vencimento', 'f-validade'/);
  assert.match(scanner,/'step-endereco', 'step-gtin', 'step-capa', 'step-vencimento', 'step-validade', 'step-quantidade'/);
  assert.match(scanner,/id === 'f-vencimento'[\s\S]{0,80}confirmarVencimento\(\)/);
});

test('todos os pontos de reset do fluxo (endereço/pallet/turno) limpam loteProduto e dataValidade',()=>{
  const ocorrenciasReset = (salvar.match(/dataValidade:\s*''/g) || []).length;
  assert.ok(ocorrenciasReset >= 3, `esperava pelo menos 3 resets de dataValidade (resetContagem, finalizarEnderecoAtual, _manterEnderecoAtivo) — achou ${ocorrenciasReset}`);
});
