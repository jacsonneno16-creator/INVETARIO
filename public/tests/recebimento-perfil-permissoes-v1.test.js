const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(ROOT,p),'utf8');

// Nota: a rolagem do Recebimento NÃO usa mais a técnica de altura fixa +
// overflow:hidden no shell (essa é a mesma técnica que já tinha quebrado a
// rolagem antes, corrigida em configuracoes-globais-v1.test.js). Este
// arquivo cobre só as mudanças de catálogo de permissões e do Meu Perfil.

test('Devolucoes e Indicadores de Devolucoes (antigos) continuam no catalogo de permissoes, inertes',()=>{
  const s=read('js/analista/37-usuarios-permissoes.js');
  assert.match(s,/id:'recebimento-consulta-notas',nome:'Recebimento · Devoluções \(BI\) \[antigo\]'/);
  assert.match(s,/id:'recebimento-devolucoes-indicadores',nome:'Recebimento · Indicadores de Devoluções \[antigo\]'/);
  assert.match(s,/RECEBIMENTO_MODULOS=MODULOS\.filter\(function\(m\)\{return m\.id\.indexOf\('recebimento-'\)===0;\}\)/);
});

// Devoluções unificadas (2026-10-13): substitui as 2 telas acima por uma só.
test('Devolucoes unificadas tem modulo proprio no catalogo de permissoes',()=>{
  const s=read('js/analista/37-usuarios-permissoes.js');
  assert.match(s,/id:'recebimento-devolucoes',nome:'Recebimento · Devoluções'/);
  assert.match(s,/acoes:\['visualizar','importar','confirmar','relatorio_criar','relatorio_finalizar','exportar','estornar','excluir'\]/);
});

test('Indicadores de Devolucoes usam permissao propria na janela Permissoes desta tela',()=>{
  const s=read('js/analista/123-configuracoes-sistema.js');
  assert.doesNotMatch(s,/'recebimento-devolucoes-indicadores':'recebimento-recusas-indicadores'/);
});

test('Meu perfil possui Sair, confirma antes e aciona logout real com fallback',()=>{
  const s=read('js/analista/123-configuracoes-sistema.js');
  assert.match(s,/data-dt-profile-logout/);
  assert.match(s,/confirm\('Sair da conta\?'\)/,'saída disruptiva deve confirmar antes');
  assert.match(s,/typeof global\.doLogoutAnalista==='function'/);
  assert.match(s,/AUTH_AN\.signOut/,'precisa de fallback se doLogoutAnalista não existir ainda');
});

test('cache e referencias foram atualizados para a correcao',()=>{
  // Não trava o sufixo exato — os dois arquivos já receberam bump legítimo
  // em rodadas posteriores (inventario-v4-final, config só no menu do
  // perfil). Só confirma que nenhum ficou preso nas versões anteriores a
  // esta correção.
  const html=read('analista.html');
  assert.match(html,/37-usuarios-permissoes\.js\?v=\S+/,'sanity: ainda tem cache bust');
  assert.doesNotMatch(html,/37-usuarios-permissoes\.js\?v=20260928-permissoes-granulares-v2"/,'37-usuarios-permissoes.js precisa ter recebido cache bust desde esta correção');
  assert.doesNotMatch(html,/123-configuracoes-sistema\.js\?v=20260928-add-botao-sair/);
});
