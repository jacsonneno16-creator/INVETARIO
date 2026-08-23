const fs=require('fs');const path=require('path');const {describe,test}=require('node:test');const assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'js/analista/59-producao-ui-completa.js'),'utf8');
const css=fs.readFileSync(path.join(root,'css/producao-completa.css'),'utf8');
const html=fs.readFileSync(path.join(root,'analista.html'),'utf8');
describe('Producao etapa 7 fix - visual sem quebrar navegacao',()=>{
 test('preserva os nav originais e nao substitui innerHTML da sidebar',()=>{
  assert.ok(js.includes("document.getElementById('nav-'+id)"));
  assert.equal(js.includes('aside.innerHTML='),false);
  assert.ok(js.includes("n.classList.add('prod-tab-btn'"));
 });
 test('as 9 abas principais continuam sendo os MESMOS nós reparentados (nao clonados, sem onclick duplicado)',()=>{
  // As abas do dia a dia sao o proprio #nav-producao-* original, reaproveitado
  // (dataset.prodRoute so serve pra achar o node, nao dispara goPage sozinho).
  assert.ok(js.includes("n.dataset.prodRoute=id;"));
  assert.equal(js.includes('data-prod-route'),false);
 });
 test('PEDIDO AO VIVO (auditoria RELATORIO-COMPARACAO-PRODUCAO.md): itens do dropdown de 3-pontos chamam goPage/logout de verdade — nao sao so paginas reparentadas',()=>{
  // Auditoria seção 4: Meu Perfil/Projeção de Vendas/Configurações/Sair do
  // dropdown original SÃO botões próprios que disparam ação (switchTab/
  // openSettings/logout) — não é mais um "Mais" que só reparenta páginas.
  assert.ok(js.includes("global.goPage?.('producao-projecao')"));
  assert.ok(js.includes("global.goPage?.('producao-config')"));
  assert.ok(js.includes('global.doLogoutAnalista?.()'));
 });
 test('mantem cabecalho, loja e tema escopados a Producao',()=>{
  assert.ok(js.includes('prod-original-header'));
  assert.ok(js.includes('aplicarTrocaLojaAnalista'));
  assert.ok(css.includes('#setor-producao-shell'));
 });
 test('usa nova versao para invalidar cache do navegador',()=>{
  assert.ok(html.includes('producao-completa.css?v=20260823f-gantt-min-width-responsivo'));
  assert.ok(html.includes('59-producao-ui-completa.js?v=20260822d-config-tela-cheia'));
 });
});
