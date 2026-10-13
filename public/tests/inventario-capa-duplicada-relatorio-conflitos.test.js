const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const relatorios = fs.readFileSync(path.join(root,'js/analista/40-relatorios-produtividade.js'),'utf8');
const divergencias = fs.readFileSync(path.join(root,'js/analista/21-divergencias-recontagens.js'),'utf8');

// Pedido ao vivo 2026-09-29: o operador testou o fluxo bipando a MESMA capa
// (1234567) em 4 endereços diferentes (em datas diferentes) e achou 4
// problemas reais no lado Analista, todos na mesma investigação:

test('1) Capas Duplicadas ganhou ação de resolver — antes só listava (bloqueava export sem saída)',()=>{
  assert.match(relatorios,/function\(docId, capaAtual\)/);
  assert.match(relatorios,/data-cd-renomear="/);
  // Não pode usar onclick="" inline — o sanitizador global remove esse
  // atributo de todo HTML atribuído via innerHTML (ver 32-render-
  // divergencias-recontagens.js, mesmo bug já corrigido lá nesta sessão).
  assert.doesNotMatch(relatorios,/onclick="renomearCapaOcorrencia/);
  assert.match(relatorios,/closest\('\[data-cd-renomear\]'\)/);
  assert.match(relatorios,/collection\(col\)\.doc\(String\(docId\)\)\.set\(\{capa:valor\}/);
});

test('2) Relatório de Conflitos: "quando" (when) agora lê criada_em (campo real) antes de atualizado_em',()=>{
  const corpo = relatorios.slice(relatorios.indexOf('const when = function'), relatorios.indexOf('const when = function')+400);
  // criada_em precisa vir ANTES de atualizado_em na cadeia de fallback —
  // atualizado_em é regravado em TODO reprocessamento (mesmo em
  // divergências antigas intocadas), colapsando todas as datas pro
  // horário do último "Processar Contagens".
  const iCriada = corpo.indexOf('x.criada_em');
  const iAtualizado = corpo.indexOf('x.atualizado_em');
  assert.ok(iCriada >= 0, 'criada_em precisa estar na cadeia de fallback');
  assert.ok(iAtualizado < 0 || iCriada < iAtualizado, 'criada_em precisa vir antes de atualizado_em');
});

test('3) Relatório de Conflitos: produto() mostra o nome resolvido antes do código cru',()=>{
  const corpo = relatorios.slice(relatorios.indexOf('const produto = function'), relatorios.indexOf('const produto = function')+250);
  const iDescricao = corpo.indexOf('x.descricao');
  const iProduto = corpo.search(/x\.produto\b/);
  assert.ok(iDescricao >= 0 && iProduto >= 0, 'esperava descricao e produto na cadeia');
  assert.ok(iDescricao < iProduto, 'descricao (nome resolvido) precisa vir antes de produto (código cru)');
});

test('4) Divergência "PRODUTO_FORA_ENDERECO" só é criada quando existe mesmo um outro endereço — não mais só por o produto existir no catálogo geral',()=>{
  const inicio = divergencias.indexOf('// ── 1c. Produto cadastrado, porém fora do endereço correto ──');
  const corpo = divergencias.slice(inicio, divergencias.indexOf('// ── 1d.'));
  assert.match(corpo,/if \(!itemEmOutroEndereco\) return;/);
  assert.doesNotMatch(corpo,/if \(!itemEmOutroEndereco && !info\.geral\) return;/);
});
