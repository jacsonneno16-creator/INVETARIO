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
 test('nao cria listener concorrente que chama goPage',()=>{
  assert.equal(js.includes("global.goPage("),false);
  assert.equal(js.includes('data-prod-route'),false);
 });
 test('mantem cabecalho, loja e tema escopados a Producao',()=>{
  assert.ok(js.includes('prod-original-header'));
  assert.ok(js.includes('trocarLojaInventario'));
  assert.ok(css.includes('#setor-producao-shell'));
 });
 test('usa nova versao para invalidar cache do navegador',()=>{
  assert.ok(html.includes('producao-completa.css?v=20260817-menu-mais'));
  assert.ok(html.includes('59-producao-ui-completa.js?v=20260817-menu-mais'));
 });
});
