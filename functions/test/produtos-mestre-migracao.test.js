'use strict';
// Testa as funções PURAS de scripts/produtos-mestre-merge.js, usadas pela
// migração única scripts/migrar-produtos-mestre.js (cadastro único de
// produtos, pedido ao vivo 2026-09-21). Não precisa de credencial/Firestore
// — só a lógica de merge/prioridade.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  categoriaDoNome,
  nomeMaisCompleto,
  categoriaManualParaConfianca,
  escolherCategoria,
  mesclarRegistrosPorCodigo,
  escolherFichaTecnica,
  decidirAtivo,
} = require('../../scripts/produtos-mestre-merge');

test('nomeMaisCompleto: fica com o nome mais longo entre os dois, nunca o mais curto', () => {
  assert.equal(nomeMaisCompleto('TAPIOCA', 'TAPIOCA DA TERRINHA 500G'), 'TAPIOCA DA TERRINHA 500G');
  assert.equal(nomeMaisCompleto('TAPIOCA DA TERRINHA 500G', 'TAPIOCA'), 'TAPIOCA DA TERRINHA 500G');
});
test('nomeMaisCompleto: nome vazio de um lado não vence o preenchido do outro', () => {
  assert.equal(nomeMaisCompleto('', 'CANELA EM PO'), 'CANELA EM PO');
  assert.equal(nomeMaisCompleto('CANELA EM PO', ''), 'CANELA EM PO');
});

test('categoriaManualParaConfianca: categoria igual ao que _categoriaDoNome geraria não conta como manual real', () => {
  assert.equal(categoriaManualParaConfianca('CANELA', 'CANELA EM PO DA TERRINHA'), '', 'bate com a 1ª palavra do nome — provável fallback antigo persistido, não correção humana');
});
test('categoriaManualParaConfianca: categoria diferente da 1ª palavra do nome é tratada como correção real', () => {
  assert.equal(categoriaManualParaConfianca('ESPECIARIAS', 'CANELA EM PO DA TERRINHA'), 'ESPECIARIAS');
});
test('categoriaManualParaConfianca: sem valor nenhum, não inventa categoria', () => {
  assert.equal(categoriaManualParaConfianca('', 'CANELA EM PO'), '');
});

test('escolherCategoria: categoria revisada à mão (planilha 2026-09-25) sempre vence, até sobre a Bluesoft', () => {
  const r = escolherCategoria({ categoriaRevisada: 'okker', categoriaBluesoft: 'ALHO MARCA PROPRIA', categoriaManualExistente: '', nome: '11102 ALHO FRITO GRANULADO OKKER 90 GR' });
  assert.equal(r.categoria, 'OKKER');
  assert.equal(r.origem, 'revisado-2026-09-25');
});
test('escolherCategoria: classificação real da Bluesoft sempre vence, mesmo com categoria manual e nome disponíveis', () => {
  const r = escolherCategoria({ categoriaBluesoft: 'temperos e condimentos', categoriaManualExistente: 'ESPECIARIAS', nome: 'CANELA EM PO' });
  assert.equal(r.categoria, 'TEMPEROS E CONDIMENTOS');
  assert.equal(r.origem, 'bluesoft');
});
test('escolherCategoria: sem Bluesoft, cai pra categoria manual de confiança', () => {
  const r = escolherCategoria({ categoriaBluesoft: '', categoriaManualExistente: 'ESPECIARIAS', nome: 'CANELA EM PO' });
  assert.equal(r.categoria, 'ESPECIARIAS');
  assert.equal(r.origem, 'manual');
});
test('escolherCategoria: sem Bluesoft e sem manual de confiança, cai pro fallback da 1ª palavra do nome', () => {
  const r = escolherCategoria({ categoriaBluesoft: '', categoriaManualExistente: '', nome: 'BOBINA CANELA PO DA TERRINHA' });
  assert.equal(r.categoria, 'BOBINA');
  assert.equal(r.origem, 'nome-fallback');
});

test('mesclarRegistrosPorCodigo: junta campos de vários registros por-loja do mesmo código, nome mais completo vence', () => {
  const r = mesclarRegistrosPorCodigo([
    { cod: '44353', nome: 'FAROFA', ativo: true },
    { cod: '44353', nome: 'MP - PREPARACAO FAROFA TRADICIONAL KG', unidade: 'kg', categoria: 'FAROFA' },
  ]);
  assert.equal(r.cod, '44353');
  assert.equal(r.nome, 'MP - PREPARACAO FAROFA TRADICIONAL KG');
  assert.equal(r.unidade, 'kg');
  assert.equal(r.categoriaExistente, 'FAROFA');
});
test('mesclarRegistrosPorCodigo: ativo:false em qualquer registro marca o produto como inativo (nunca reativa sozinho)', () => {
  const r = mesclarRegistrosPorCodigo([
    { cod: '1', nome: 'X', ativo: true },
    { cod: '1', nome: 'X', ativo: false },
  ]);
  assert.equal(r.ativo, false);
});

test('escolherFichaTecnica: só 1 loja com ficha, usa ela sem marcar conflito', () => {
  const { ficha, conflito } = escolherFichaTecnica([{ cod: '1', insumos: [{ cod: 'A', quantidade: 10 }] }]);
  assert.ok(ficha);
  assert.equal(conflito, false);
});
test('escolherFichaTecnica: BOM igual em lojas diferentes não é conflito', () => {
  const { conflito } = escolherFichaTecnica([
    { cod: '1', insumos: [{ cod: 'A', quantidade: 10 }], atualizadoEm: '2026-01-01' },
    { cod: '1', insumos: [{ cod: 'A', quantidade: 10 }], atualizadoEm: '2026-02-01' },
  ]);
  assert.equal(conflito, false);
});
test('escolherFichaTecnica: BOM DIFERENTE entre lojas é sinalizado como conflito, e a mais recente é a escolhida', () => {
  const { ficha, conflito } = escolherFichaTecnica([
    { cod: '1', insumos: [{ cod: 'A', quantidade: 10 }], atualizadoEm: '2026-01-01' },
    { cod: '1', insumos: [{ cod: 'A', quantidade: 20 }], atualizadoEm: '2026-03-01' },
  ]);
  assert.equal(conflito, true, 'quantidades diferentes pro mesmo insumo é um BOM realmente divergente');
  assert.equal(ficha.atualizadoEm, '2026-03-01');
});
test('escolherFichaTecnica: sem ficha nenhuma, devolve null sem quebrar', () => {
  const { ficha, conflito } = escolherFichaTecnica([]);
  assert.equal(ficha, null);
  assert.equal(conflito, false);
});

test('categoriaDoNome continua idêntica à de 78-pcp-central.js (mesma regra, primeira palavra do nome)', () => {
  assert.equal(categoriaDoNome('00007 TAPIOCA DA TERRINHA TRADICIONAL 240 G'), 'TAPIOCA');
  assert.equal(categoriaDoNome(''), '');
});

// BUG AO VIVO REAL (2026-09-25): 1ª gravação da migração deixou 1.672 de
// 1.970 produtos inativos, quando deveria ser só os 714 removidos da
// planilha — um `ativo:false` antigo gravado em producao_produtos/
// pcp_produtos_bluesoft de outra época estava vencendo a revisão manual.
// decidirAtivo() é a correção: com a planilha carregada, ELA decide.
test('decidirAtivo: código PRESENTE na planilha revisada fica ativo, MESMO com ativo:false antigo gravado', () => {
  assert.equal(decidirAtivo({ ativoExistente: false, codigoRevisado: true, planilhaCarregada: true }), true);
});
test('decidirAtivo: código AUSENTE da planilha revisada fica inativo, MESMO com ativo:true antigo gravado', () => {
  assert.equal(decidirAtivo({ ativoExistente: true, codigoRevisado: false, planilhaCarregada: true }), false);
});
test('decidirAtivo: sem planilha carregada (arquivo não encontrado), preserva o valor existente — nunca desativa tudo à toa', () => {
  assert.equal(decidirAtivo({ ativoExistente: true, codigoRevisado: false, planilhaCarregada: false }), true);
  assert.equal(decidirAtivo({ ativoExistente: false, codigoRevisado: false, planilhaCarregada: false }), false);
});
