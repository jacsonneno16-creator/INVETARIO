'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const pub=path.join(__dirname,'..');
const coletor=fs.readFileSync(path.join(pub,'js','coletor','04-auth-login.js'),'utf8');
const analista=fs.readFileSync(path.join(pub,'js','analista','37-usuarios-permissoes.js'),'utf8');
const rules=fs.readFileSync(path.join(pub,'..','firestore.rules'),'utf8');
const dash=fs.readFileSync(path.join(pub,'js','analista','22-dashboard-render-sync.js'),'utf8');
const html=fs.readFileSync(path.join(pub,'analista.html'),'utf8');
const script=fs.readFileSync(path.join(pub,'..','scripts','migrar-permissoes-granulares-v2.js'),'utf8');

function carregarPermissaoColetor(acesso){
  const ini=coletor.indexOf('window.coletorTemPermissao = function');
  const fim=coletor.indexOf('\n};',ini)+3;
  assert.ok(ini>=0&&fim>ini,'função coletorTemPermissao precisa existir');
  const window={DT_USUARIO_ACESSO_ATUAL:acesso};
  vm.runInNewContext(coletor.slice(ini,fim),{window,Object});
  return window.coletorTemPermissao;
}

test('conta Coletor legada SEM chaves novas continua visualizando/contando inventário',()=>{
  const tem=carregarPermissaoColetor({perfil:'operador',canais_acesso:{coletor:true},permissoes:{}});
  assert.equal(tem('inventarios','visualizar'),true);
  assert.equal(tem('inventarios','contar'),true);
  assert.equal(tem('auditoria','conferir'),true);
  assert.equal(tem('recontagens','executar'),true);
});

test('negação explícita vence fallback legado do Coletor',()=>{
  const tem=carregarPermissaoColetor({perfil:'operador',canais_acesso:{coletor:true},permissoes:{inventarios:{visualizar:false,contar:false},auditoria:{conferir:false},recontagens:{executar:false}}});
  assert.equal(tem('inventarios','visualizar'),false);
  assert.equal(tem('inventarios','contar'),false);
  assert.equal(tem('auditoria','conferir'),false);
  assert.equal(tem('recontagens','executar'),false);
});

test('Rules têm fallback transitório só quando a chave nova está ausente',()=>{
  assert.match(rules,/let definida = temMapa/);
  assert.match(rules,/let coletorLegado = !definida/);
  assert.match(rules,/area == 'inventarios'.*operation == 'contar'/s);
  assert.match(rules,/area == 'auditoria'.*operation == 'conferir'/s);
  assert.match(rules,/area == 'recontagens'.*operation == 'executar'/s);
});

test('compatibilidade de Recebimento antiga foi restaurada no Analista',()=>{
  assert.match(analista,/if\(modulo==='recebimento-recusas'\)/);
  assert.match(analista,/if\(modulo==='recebimento-patio-tempo-real'\)/);
  assert.match(analista,/recebimento-operacao','recebimento-transbordo','recebimento-notas','recebimento-dashboard/);
});

test('backfill é dry-run por padrão e não sobrescreve chave existente',()=>{
  assert.match(script,/const APPLY=process\.argv\.includes\('--apply'\)/);
  assert.match(script,/if\(!has\(data,pathStr\)\)updates\[pathStr\]=value/);
  assert.match(script,/permissoes\.inventarios\.contar/);
  assert.match(script,/permissoes\.auditoria\.conferir/);
  assert.match(script,/permissoes\.recontagens\.executar/);
  assert.match(script,/recebimento-patio-tempo-real\.visualizar/);
});

test('restos de UI foram corrigidos',()=>{
  assert.doesNotMatch(dash,/Ver rodadas[^\n]*onclick=/);
  assert.match(dash,/data-dashboard-go="recontagens\|nav-recontagens"[^>]*>Ver rodadas/);
  assert.match(html,/id="pft-prioridade"[^>]*value=""[^>]*placeholder="2 = padrão operacional"/);
});
