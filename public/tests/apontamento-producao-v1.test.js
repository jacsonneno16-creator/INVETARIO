const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('módulo entra em Logística > Estoque e tem página/permissão',()=>{
  const html=read('analista.html'), perms=read('js/analista/37-usuarios-permissoes.js'), nav=read('js/analista/03-core-navigation.js'), lazy=read('js/analista/00-lazy-areas.js');
  assert.match(html,/nav-estoque-rel-apontamento/);
  assert.match(html,/page-estoque-rel-apontamento/);
  // 'configurar' foi acrescentada depois (2026-10-07: painel de Integração WMS),
  // então o teste confere as ações originais presentes, não a lista exata.
  assert.match(perms,/id:'estoque-rel-apontamento'[^}]*acoes:\[[^\]]*\]/s);
  ['visualizar','criar','conferir','cancelar','reprocessar','configurar'].forEach(acao=>{
    const trecho=perms.match(/id:'estoque-rel-apontamento'[^}]*acoes:\[([^\]]*)\]/s);
    assert.ok(trecho&&trecho[1].includes("'"+acao+"'"),'ação ausente no catálogo: '+acao);
  });
  assert.match(nav,/case 'estoque-rel-apontamento':\s+return _callPage\('renderEstoqueRelApontamento'\)/);
  assert.match(lazy,/127-estoque-apontamento\.js\?v=[0-9A-Za-z-]+/);
});

test('coletor separa apontar e conferir por permissões',()=>{
  const html=read('coletor.html'), auth=read('js/coletor/04-auth-login.js');
  assert.match(html,/data-perm-grupo="estoque"/);
  assert.match(html,/data-perm-acao="criar"[^>]+>.*Apontar produção/s);
  assert.match(html,/data-perm-acao="conferir"[^>]+>.*Conferir pallets/s);
  assert.match(auth,/\['estoque-rel-apontamento','criar'\]/);
  assert.match(auth,/\['estoque-rel-apontamento','conferir'\]/);
});

test('fluxo não envia BlueSoft na criação e só envia após conferência',()=>{
  const fn=fs.readFileSync(path.join(root,'..','functions','index.js'),'utf8');
  const criar=fn.slice(fn.indexOf('exports.apontamentoCriarPre'),fn.indexOf('exports.apontamentoObter'));
  assert.match(criar,/AGUARDANDO_CONFERENCIA/);
  assert.doesNotMatch(criar,/_apBluesoftPost/);
  const conf=fn.slice(fn.indexOf('exports.apontamentoConferirEnviar'),fn.indexOf('exports.apontamentoConsultarStatusBluesoft'));
  assert.match(conf,/_apEnviarParaBluesoft/);
  assert.match(conf,/CONFERENCIA_DIVERGENTE/);
});

test('backend trava duplicidade e resultado incerto',()=>{
  const fn=fs.readFileSync(path.join(root,'..','functions','index.js'),'utf8');
  assert.match(fn,/integracao\.status':'ENVIANDO|integracao\.status':'ENVIANDO'/);
  assert.match(fn,/ERRO_INCERTO/);
  assert.match(fn,/Não reenvie: confira a BlueSoft para evitar duplicidade/);
  assert.match(fn,/payloadHash/);
});

test('integração usa endpoints oficiais de apontamento e monitoramento assíncrono',()=>{
  const fn=fs.readFileSync(path.join(root,'..','functions','index.js'),'utf8');
  assert.match(fn,/\/api\/pcp\/apontamento-producao\/ficha-tecnica/);
  assert.match(fn,/\/api\/pcp\/apontamento-producao'/);
  assert.match(fn,/\/api\/monitoramento\/async\//);
  assert.match(fn,/\/api\/comercial\/produtos\/gtin-plu/);
  assert.match(fn,/\/api\/pcp\/ficha-tecnica\?/);
});

test('criação da capa é idempotente contra duplo clique/reenvio',()=>{
  const fn=fs.readFileSync(path.join(root,'..','functions','index.js'),'utf8');
  const col=read('js/coletor/31-apontamento-producao.js');
  assert.match(col,/requisicaoId:garantirRequisicaoId\(\)/);
  assert.match(fn,/dt_apontamento_idempotencia/);
  assert.match(fn,/if\(reqSnap\.exists\)\{capa=String/);
});

test('divergência somente de quantidade exige aprovação explícita e justificativa',()=>{
  const fn=fs.readFileSync(path.join(root,'..','functions','index.js'),'utf8');
  const col=read('js/coletor/31-apontamento-producao.js');
  const html=read('coletor.html');
  assert.match(fn,/exports\.apontamentoAprovarDivergenciaQuantidade/);
  assert.match(fn,/Só é possível aprovar por esta ação quando a única divergência é a quantidade/);
  assert.match(fn,/Informe uma justificativa para aprovar a quantidade divergente/);
  assert.match(fn,/DIVERGENCIA_QUANTIDADE_APROVADA/);
  assert.match(html,/id="ap-conf-aprovar-qtd"/);
  assert.match(col,/podeAprovarQuantidade/);
  assert.match(col,/apontamentoAprovarDivergenciaQuantidade/);
});

test('consulta de ficha técnica não falha silenciosamente para escolher outro tipo de apontamento',()=>{
  const fn=fs.readFileSync(path.join(root,'..','functions','index.js'),'utf8');
  const ini=fn.indexOf('async function _apBuscarProdutoPorGtin');
  const fim=fn.indexOf('function _apAdicionarDiasIso',ini);
  const trecho=fn.slice(ini,fim);
  assert.match(trecho,/\/api\/pcp\/ficha-tecnica\?/);
  assert.doesNotMatch(trecho,/ficha[^\n]*catch\([^\n]*=>\s*null/);
});
