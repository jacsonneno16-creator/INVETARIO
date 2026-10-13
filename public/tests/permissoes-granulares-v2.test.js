'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {JSDOM}=require('jsdom');
const R=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(R,p),'utf8');
const perm=read('js/analista/37-usuarios-permissoes.js');
const authCol=read('js/coletor/04-auth-login.js');
const htmlCol=read('coletor.html');
const htmlAn=read('analista.html');
const rules=fs.readFileSync(path.join(R,'..','firestore.rules'),'utf8');

test('Inventário/Auditoria/Recontagem entram no catálogo do Coletor com ações operacionais próprias',()=>{
  assert.match(perm,/id:'inventarios'.*canais:\['analista','coletor'\].*'contar'/s);
  assert.match(perm,/id:'auditoria'.*canais:\['analista','coletor'\].*'conferir'/s);
  assert.match(perm,/id:'recontagens'.*canais:\['analista','coletor'\].*'executar'/s);
});

test('ausência de permissão não vira acesso total — fallback é só para ações legadas do Coletor',()=>{
  assert.match(perm,/if\(!a\)return false/);
  assert.doesNotMatch(perm,/if\(!a\|\|!a\.permissoes\)return true/);
  assert.match(authCol,/hasOwnProperty\.call\(m,operacao\)/);
  assert.match(authCol,/modulo==='inventarios'.*operacao==='contar'/s);
  assert.match(authCol,/modulo==='auditoria'.*operacao==='conferir'/s);
  assert.match(authCol,/modulo==='recontagens'.*operacao==='executar'/s);
  assert.doesNotMatch(authCol,/canalColetor\)\s*return true/);
});

test('menus principais do Coletor são permissionados e hubs somem sem filhos liberados',()=>{
  const dom=new JSDOM(htmlCol); const d=dom.window.document;
  const menus=[...d.querySelectorAll('.menu-list-item')];
  const falhas=menus.filter(b=>!b.hasAttribute('data-perm-modulo')&&!b.hasAttribute('data-perm-grupo'));
  assert.equal(falhas.length,0,'todo item de menu do Coletor deve ter permissão/grupo: '+falhas.map(x=>x.textContent.trim()).join(', '));
  assert.ok(d.querySelector('[data-perm-grupo="inventario"]'));
  assert.ok(d.querySelector('[data-perm-grupo="recebimento"]'));
});

test('ações críticas do Coletor têm permissão explícita',()=>{
  const dom=new JSDOM(htmlCol); const d=dom.window.document;
  const checks=[
    ['#dl-btn-entrar','inventarios','contar'],
    ['[onclick*="confirmarPaletesEstoque"]','recebimento-paletes','estoque'],
    ['[onclick*="confirmarTransferenciaPaletes"]','recebimento-paletes','transferir'],
    ['[onclick*="abrirInventarioPatio"]','recebimento-recusas','identificar']
  ];
  for(const [sel,m,a] of checks){const el=d.querySelector(sel);assert.ok(el,sel);assert.equal(el.getAttribute('data-perm-modulo'),m);assert.equal(el.getAttribute('data-perm-acao'),a);}
});

test('modais de negócio do Analista carregam contexto de permissão',()=>{
  const dom=new JSDOM(htmlAn); const d=dom.window.document;
  const ids=['modal-pft','modal-pmaq','modal-recop','modal-recag','modal-rebt','modal-pprog','modal-pproj','modal-pfunc','modal-psetup','modal-coletores-lote','modal-inv','modal-end-manual','modal-fechar-inv','modal-reg-recontagem','modal-loja-cadastro'];
  for(const id of ids){const el=d.getElementById(id);assert.ok(el,id);assert.ok(el.getAttribute('data-perm-context-modulo'),id+' sem contexto');}
});

test('navegação reaplica permissões de ação ao entrar em cada página',()=>{
  const nav=read('js/analista/03-core-navigation.js');
  assert.match(nav,/setTimeout\(window\.aplicarPermissoesAnalista, 0\)/);
});

test('Firestore exige permissão operacional para leitura, contagem e recontagem do Coletor',()=>{
  assert.match(rules,/function hasPermissionAnyChannel\(area, operation\)/);
  assert.match(rules,/hasPermissionAnyChannel\('inventarios', 'contar'\)/);
  assert.match(rules,/hasPermissionAnyChannel\('recontagens', 'executar'\)/);
  const cont=rules.slice(rules.indexOf('match /dt_contagens/{docId}'),rules.indexOf('match /dt_vazios/{docId}'));
  assert.match(cont,/hasPermissionAnyChannel\('inventarios', 'visualizar'\)/);
  const vaz=rules.slice(rules.indexOf('match /dt_vazios/{docId}'),rules.indexOf('match /dt_recontagens/{docId}'));
  assert.match(vaz,/hasPermissionAnyChannel\('inventarios', 'visualizar'\)/);
  // A leitura de recontagens por loja virou podeLerRecontagensNaLoja() (um único
  // access(), para não estourar 1000 sub-expressões). Confere a função, não o texto antigo.
  const fnRec=rules.slice(rules.indexOf('function podeLerRecontagensNaLoja'),rules.indexOf('match /dt_recontagens/{docId}'));
  assert.match(fnRec,/a\.permissoes\['recontagens'\]\['visualizar'\] == true/);
  assert.match(rules,/match \/dt_recontagens\/\{docId\} \{\n\s*allow read: if podeLerRecontagensNaLoja\(lojaId\);/);
});

test('cache bust cobre todos os JS alterados desta rodada',()=>{
  const legado='20260928-permissoes-granulares-v2';
  // 03-core-navigation.js e 37-usuarios-permissoes.js receberam correções
  // legítimas em rodadas posteriores (2026-10-02: Inventários do Pátio) —
  // travar um valor exato aqui quebra a cada bump de versão real; só
  // confirma que nenhum dos dois ficou preso na versão anterior a esta
  // rodada.
  assert.doesNotMatch(htmlAn,/03-core-navigation\.js\?v=20260928-permissoes-granulares-v2"/);
  assert.doesNotMatch(htmlAn,/37-usuarios-permissoes\.js\?v=20260928-permissoes-granulares-v2"/);
  // 04-auth-login.js também recebeu correções legítimas depois (2026-10-02:
  // timeout de inatividade 60→40min) — mesmo raciocínio acima.
  assert.doesNotMatch(htmlCol,/04-auth-login\.js\?v=20260928-permissoes-granulares-v2"/);
  // 22-recebimento.js também recebeu correção legítima depois (2026-10-02:
  // bloqueio da criação ad-hoc de transbordo) — mesmo raciocínio acima.
  assert.doesNotMatch(htmlCol,/22-recebimento\.js\?v=20260928-permissoes-granulares-v2"/);
  // 05-inventarios-download.js recebeu correção legítima (2026-10-06: inventário
  // sem loja_principal some da lista do operador) — mesmo raciocínio acima.
  assert.doesNotMatch(htmlCol,/05-inventarios-download\.js\?v=20260928-permissoes-granulares-v2"/);
  for(const f of ['17-auditoria-meta.js','25-recebimento-paletes.js','26-recebimento-cargas.js','27-transferencia-paletes.js']) assert.ok(htmlCol.includes(f+'?v='+legado));
});
