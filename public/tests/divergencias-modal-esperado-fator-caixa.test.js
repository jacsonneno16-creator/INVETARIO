// Bug ao vivo real (2026-10-07): a lista de Divergências mostrava "Total esperado: 960"
// para um endereço, mas o modal "Esperado e comparação das contagens" (aberto ao clicar
// em "N paletes · clique para detalhar") mostrava "Total consolidado do endereço: 48"
// para o MESMO endereço — 960 = 48 × 20, exatamente o fator da caixa do produto
// ("... UND CX 20.0"). Causa: existem duas funções locais quase idênticas que somam a
// quantidade esperada — `_qtdEsperadaItem` (linha da lista) já multiplicava por
// `fator_caixa`/`fatorCaixa` desde a correção anterior dessa mesma conta (CX/FD vs UN),
// mas `obterQtd` (usada só pelo modal de detalhe) tinha ficado de fora e somava o valor
// bruto, sem o fator. Corrigido aplicando a mesma multiplicação nas duas.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../js/analista/32-render-divergencias-recontagens.js'), 'utf8');
const src21 = fs.readFileSync(path.join(__dirname, '../js/analista/21-divergencias-recontagens.js'), 'utf8');

test('obterQtd (total do modal de detalhe) existe e multiplica pelo fator_caixa/fatorCaixa, igual à lista', () => {
  const i = src.indexOf('const obterQtd = item => {');
  assert.ok(i >= 0, 'função obterQtd não encontrada');
  const trecho = src.slice(i, i + 1200);
  assert.match(trecho, /const fator = Number\(item\?\.fator_caixa \?\? item\?\.fatorCaixa\);/);
  assert.match(trecho, /const f = Number\.isFinite\(fator\) && fator > 0 \? fator : 1;/);
  assert.match(trecho, /return Number\.isFinite\(numero\) \? numero \* f : 0;/);
});

test('a lista (_qtdEsperadaItem) continua com a mesma multiplicação, pra não voltarem a divergir', () => {
  const i = src.indexOf('const _qtdEsperadaItem = item => {');
  assert.ok(i >= 0, 'função _qtdEsperadaItem (lista) não encontrada');
  const trecho = src.slice(i, i + 1200);
  assert.match(trecho, /const fator = Number\(item\.fator_caixa \?\? item\.fatorCaixa\);/);
  assert.match(trecho, /return Number\.isFinite\(numero\) \? numero \* f : 0;/);
});

// Segundo bug, achado ao investigar o mesmo "B.O." (2026-10-07): depois de
// corrigir o total acima, a "1ª contagem" continuava mostrando o valor CRU
// bipado pelo Coletor (ex.: 48 caixas) comparado contra o esperado já
// convertido pra unidade (960) — divergência falsa, porque o Coletor grava
// `quantidade_unidades` (já convertida: qty × fator_caixa quando o código
// bipado foi um DUN de 14 dígitos) além da `quantidade` crua. O mesmo padrão
// já existia em 21-divergencias-recontagens.js (_qtdComparavel) mas faltava
// aqui. Corrigido com _qtdComparavelContagem, preferindo quantidade_unidades.
test('_qtdComparavelContagem prefere quantidade_unidades (já convertida) à quantidade crua bipada em caixas', () => {
  const i = src.indexOf('const _qtdComparavelContagem = c => {');
  assert.ok(i >= 0, 'função _qtdComparavelContagem não encontrada');
  const trecho = src.slice(i, i + 400);
  assert.match(trecho, /const un = parseFloat\(c\?\.quantidade_unidades\);/);
  assert.match(trecho, /if \(!isNaN\(un\)\) return un;/);
});

test('qtd_contada/qtd_primeira da contagem virtual e da 1ª contagem usam _qtdComparavelContagem, não a quantidade crua', () => {
  assert.doesNotMatch(src, /qtd_contada:c\.quantidade \?\? c\.qtd_caixas \?\? null/);
  assert.doesNotMatch(src, /qtd_primeira:c\.quantidade \?\? c\.qtd_caixas \?\? null/);
  assert.doesNotMatch(src, /contPrimeira\?\.quantidade \?\? contPrimeira\?\.qtd_caixas/);
  assert.match(src, /qtd_contada:_qtdComparavelContagem\(c\)/);
  assert.match(src, /qtd_primeira:_qtdComparavelContagem\(c\)/);
  assert.match(src, /_qtdComparavelContagem\(contPrimeira \|\| \{\}\)/);
});

// Terceiro bug, achado investigando o mesmo "B.O." (2026-10-07): o "esperado"
// e a "1ª contagem" batiam entre a lista e o modal, mas o modal ainda abria
// mostrando o valor de uma divergência JÁ ESTORNADA pelo Analista (status
// CANCELADA), porque o filtro que escolhe qual registro é a "1ª contagem" do
// endereço não excluía CANCELADA/EXCLUIDA — igual ao que "recs" (recontagens)
// já fazia logo abaixo, mas "divs" (divergências) não fazia. Isso também fazia
// processarDivergencias() REABRIR a divergência cancelada pra 'ABERTA' de
// novo, misturando a quantidade dela com a de outra divergência ativa no
// mesmo endereço (produto diferente) — daí o endereço aparecer "2x" na lista.
test('32-render: divsEndereco (escolha da "1ª contagem" do modal) exclui CANCELADA/EXCLUIDA, igual a "recs"', () => {
  const i = src.indexOf('const divsEndereco = (state().divergencias || []).filter(obj => {');
  assert.ok(i >= 0, 'filtro de divsEndereco não encontrado (ou voltou a ser um .filter(mesmoEndereco) direto)');
  const trecho = src.slice(i, i + 400);
  assert.match(trecho, /!\['CANCELADA','EXCLUIDA'\]\.includes\(status\)/);
});

test('21-divergencias: _historicoConsolidadoEndereco exclui divergências CANCELADA/EXCLUIDA do consolidado do endereço', () => {
  const i = src21.indexOf('function _historicoConsolidadoEndereco(div){');
  assert.ok(i >= 0, 'função _historicoConsolidadoEndereco não encontrada');
  const trecho = src21.slice(i, i + 2800);
  assert.match(trecho, /const divs = \(state\(\)\.divergencias \|\| \[\]\)\.filter\(obj => \{/);
  assert.match(trecho, /!\['CANCELADA','EXCLUIDA'\]\.includes\(status\)/);
});

// Quarto bug, achado investigando o mesmo "B.O." (2026-10-07): clicar em "✓
// Resolver" numa divergência mostrava o toast "Divergência resolvida e salva
// no Firestore" (a gravação realmente acontecia), mas a tela voltava a
// mostrar ABERTA segundos depois, e o inventário continuava bloqueado pra
// fechar com "divergência(s) abertas". Causa: processarDivergencias() roda
// de novo a cada dispatch e tem DUAS varreduras que reabrem divergências cuja
// avaliação fresca não fecha "RESOLVIDA" — pensadas pra consertar registros
// LEGADOS fechados errado pelo próprio sistema, mas sem nenhuma exceção pra
// uma resolução MANUAL do Analista (resolucao_manual:true, gravada por
// _marcarDivResolvida em 32-render-divergencias-recontagens.js). A varredura
// reabria a divergência que acabara de ser resolvida na hora, no mesmo ciclo.
test('21-divergencias: as duas varreduras de reabertura (consolidação + "dados legados") não reabrem uma divergência com resolucao_manual:true', () => {
  const iConsolidacao = src21.indexOf("hist._divergencias.forEach(item => {");
  assert.ok(iConsolidacao >= 0, 'laço de consolidação (hist._divergencias.forEach) não encontrado');
  const trechoConsolidacao = src21.slice(iConsolidacao, iConsolidacao + 1000);
  assert.match(trechoConsolidacao, /if \(item\.resolucao_manual === true\) \{/);

  const iRevalidadas = src21.indexOf('const divsRevalidadas = state().divergencias.map(div => {');
  assert.ok(iRevalidadas >= 0, 'varredura de "dados legados" (divsRevalidadas) não encontrada');
  const trechoRevalidadas = src21.slice(iRevalidadas, iRevalidadas + 1200);
  assert.match(trechoRevalidadas, /if \(div\.resolucao_manual === true\) return div;/);
});
