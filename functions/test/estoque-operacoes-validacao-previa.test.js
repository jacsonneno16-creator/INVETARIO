'use strict';
// Estoque · Operações via Arquivo — validação prévia (2026-10-08). Antes,
// cada linha só era checada com Number(...)>0 na hora do POST individual:
// uma planilha de 300 linhas podia falhar na 299ª depois de já ter enviado
// 298 à BlueSoft de verdade, sem jeito de saber quais sem reconferir tudo.
// _eopValidarLote valida o lote INTEIRO antes de qualquer POST.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

function carregar() {
  delete require.cache[require.resolve('firebase-admin')];
  delete require.cache[require.resolve('../index.js')];
  const admin = require('firebase-admin');
  admin.initializeApp = () => {};
  Object.defineProperty(admin, 'firestore', {value: () => ({}), configurable: true});
  return require(path.join(__dirname, '..', 'index.js'))._estoqueBluesoftInternals;
}

test('_eopCheckNumero: inteiro exige dígitos puros; decimal aceita ponto', () => {
  const {_eopCheckNumero} = carregar();
  assert.equal(_eopCheckNumero('123'), true);
  assert.equal(_eopCheckNumero('12.5'), false, 'modo inteiro (padrão) recusa decimal');
  assert.equal(_eopCheckNumero('12.5', false), true, 'modo não-inteiro aceita decimal');
  assert.equal(_eopCheckNumero('0'), false, 'tem que ser > 0');
  assert.equal(_eopCheckNumero('-5'), false);
  assert.equal(_eopCheckNumero(''), false);
  assert.equal(_eopCheckNumero(null), false);
  assert.equal(_eopCheckNumero('abc'), false);
});

test('_eopValidarLote(modo "end"): exige paleteKey/enderecoLogisticoKey; detalhes de item (lote+qtd+gtin) são tudo-ou-nada', () => {
  const {_eopValidarLote} = carregar();
  assert.throws(() => _eopValidarLote([{enderecoLogisticoKey: 10}], 'end'), /paleteKey inválido/);
  assert.throws(() => _eopValidarLote([{paleteKey: 1, enderecoLogisticoKey: 10, logisticaLoteItemKey: 5}], 'end'), /dados de item incompletos/,
    'informou só 1 dos 3 campos de detalhe do item');
  assert.doesNotThrow(() => _eopValidarLote([{paleteKey: 1, enderecoLogisticoKey: 10}], 'end'));
  assert.doesNotThrow(() => _eopValidarLote([{paleteKey: 1, enderecoLogisticoKey: 10, logisticaLoteItemKey: 5, quantidadeEnderecar: 2, gtin: 123}], 'end'));
});

test('_eopValidarLote(modo "troca"): exige gtin/motivoTrocaKey/setorOperacionalKey + quantidade > 0; recusa GTIN com mais de 14 dígitos', () => {
  const {_eopValidarLote} = carregar();
  assert.throws(() => _eopValidarLote([{gtin: 123, motivoTrocaKey: 1, setorOperacionalKey: 1}], 'troca'), /quantidade inválida/);
  assert.throws(() => _eopValidarLote([{gtin: '123456789012345', quantidade: 1, motivoTrocaKey: 1, setorOperacionalKey: 1}], 'troca'), /GTIN inválido/);
  assert.doesNotThrow(() => _eopValidarLote([{gtin: 7891000098967, quantidade: 10, motivoTrocaKey: 1, setorOperacionalKey: 1}], 'troca'));
});

test('_eopValidarLote(modo "transf"): aceita transformacaoKey OU produtoKey; recusa origemDaTransformacao fora da lista', () => {
  const {_eopValidarLote} = carregar();
  const base = {localDeEstoqueKey: 1, quantidadeTransformacao: 10, origemDaTransformacao: 'ESTOQUE_TROCA'};
  assert.throws(() => _eopValidarLote([Object.assign({}, base, {transformacaoKey: 99, origemDaTransformacao: 'OUTRA'})], 'transf'), /origem inválida/);
  assert.throws(() => _eopValidarLote([Object.assign({}, base)], 'transf'), /transformação ou produto obrigatório/, 'sem transformacaoKey nem produtoKey');
  assert.doesNotThrow(() => _eopValidarLote([Object.assign({}, base, {transformacaoKey: 99})], 'transf'));
  assert.doesNotThrow(() => _eopValidarLote([Object.assign({}, base, {produtoKey: 12345})], 'transf'));
});

test('_eopValidarLote: pega duplicidade DENTRO da mesma remessa antes de qualquer POST (chave por modo)', () => {
  const {_eopValidarLote} = carregar();
  assert.throws(
    () => _eopValidarLote([{paleteKey: 1, enderecoLogisticoKey: 10}, {paleteKey: 1, enderecoLogisticoKey: 20}], 'end'),
    /duplicidade na remessa/
  );
  // paleteKey diferente não é duplicidade
  assert.doesNotThrow(() => _eopValidarLote([{paleteKey: 1, enderecoLogisticoKey: 10}, {paleteKey: 2, enderecoLogisticoKey: 10}], 'end'));
});

test('_eopValidarLote: mensagem de erro aponta o número da linha (1-based), útil pra planilha de centenas de linhas', () => {
  const {_eopValidarLote} = carregar();
  const linhas = [{paleteKey: 1, enderecoLogisticoKey: 10}, {paleteKey: 2, enderecoLogisticoKey: 10}, {enderecoLogisticoKey: 10}];
  assert.throws(() => _eopValidarLote(linhas, 'end'), /Linha 3:/);
});

// ═══════════════════════════════════════════════════════════════════════
// Garante que a validação prévia roda ANTES de qualquer POST nas 3 functions
// que processam arquivo — travando a ordem no próprio código-fonte, já que
// o custo de testar via harness de onCall completo (runTransaction, Bluesoft
// fake, etc.) seria desproporcional só pra provar essa ordem.
// ═══════════════════════════════════════════════════════════════════════
test('enderecarPaletesArquivo/gerarLoteTrocasArquivo/transformarProdutosArquivo chamam _eopValidarLote antes do laço de POST', () => {
  const fs = require('fs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  [
    ['exports.enderecarPaletesArquivo', 'end'],
    ['exports.gerarLoteTrocasArquivo', 'troca'],
    ['exports.transformarProdutosArquivo', 'transf'],
  ].forEach(([marcador, modo]) => {
    const i = src.indexOf(marcador);
    assert.ok(i >= 0, marcador + ' não encontrado');
    const fimFn = src.indexOf('\n});', i);
    const corpo = src.slice(i, fimFn);
    const iValidar = corpo.indexOf("_eopValidarLote(linhas,'" + modo + "')");
    // Não trava a sintaxe exata do laço (pode variar: for..of simples, .entries(), chamada
    // delegada a outra function, etc.) — só que a validação do lote vem antes de QUALQUER
    // ponto que efetivamente processe/poste a remessa à BlueSoft.
    const candidatos = ['_eopPost(', '_eopExecutarUmaVez(', '_eopExecutarTrocaAgrupadaUmaVez(']
      .map(marca => corpo.indexOf(marca)).filter(idx => idx >= 0);
    const iLoop = candidatos.length ? Math.min(...candidatos) : -1;
    assert.ok(iValidar >= 0, marcador + ' não chama _eopValidarLote(linhas,\'' + modo + '\')');
    assert.ok(iLoop >= 0, marcador + ' não tem nenhum ponto reconhecível de execução/POST');
    assert.ok(iValidar < iLoop, marcador + ' precisa validar o lote ANTES do laço que faz POST à BlueSoft');
  });
});
