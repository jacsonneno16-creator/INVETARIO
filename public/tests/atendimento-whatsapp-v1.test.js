const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname,'..','..');
const read = p => fs.readFileSync(path.join(ROOT,p),'utf8');

test('Atendimento possui shell, três páginas e navegação própria',()=>{
  const html=read('public/analista.html');
  ['setor-atendimento-shell','page-atendimento-dashboard','page-atendimento-conversas','page-atendimento-config'].forEach(id=>assert.match(html,new RegExp(id)));
});

test('Permissões cobrem dashboard, conversas e configuração',()=>{
  const js=read('public/js/analista/37-usuarios-permissoes.js');
  ['atendimento-dashboard','atendimento-conversas','atendimento-config'].forEach(id=>assert.match(js,new RegExp("id:'"+id+"'")));
  assert.match(js,/assumir/); assert.match(js,/responder/); assert.match(js,/transferir/); assert.match(js,/supervisionar/);
});

test('Lazy loader carrega o módulo de Atendimento sob demanda',()=>{
  const js=read('public/js/analista/00-lazy-areas.js');
  assert.match(js,/atendimento:\s*\[/); assert.match(js,/126-atendimento-whatsapp\.js/);
});

test('Firestore deixa dados do WhatsApp somente leitura no cliente',()=>{
  const rules=read('firestore.rules');
  assert.match(rules,/match \/wa_conversas\/\{conversaId\}/);
  assert.match(rules,/hasPermission\('atendimento-conversas', 'visualizar'\)/);
  assert.match(rules,/allow write: if false/);
});

test('Backend exporta webhook e operações multiatendente',()=>{
  const js=read('functions/index.js');
  ['whatsappAssumirConversa','whatsappTransferirConversa','whatsappAtualizarStatus','whatsappAdicionarNota','whatsappListarAgentes','whatsappStatusIntegracao'].forEach(n=>assert.match(js,new RegExp('exports\\.'+n)));
  assert.match(js,/WHATSAPP_ACCESS_TOKEN/); assert.match(js,/WHATSAPP_APP_SECRET/);
});
