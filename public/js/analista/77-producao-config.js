// Produção — Configurações V341: jornada geral e categorias.
(function(global){'use strict';
const CCAT='producao_categorias', CCFG='producao_config', CCFG_LEGACY='configuracoes', KEY_BASE='dt_producao_jornada_v341';
const DL=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];let cats=[],jornada=lerJornada(),carregado=false,catBusca='';
function fs(){return global.getDTFirestore();}function jornadaKey(){const l=global.getDTLojaAtiva?.()||'sem_loja';return KEY_BASE+'_'+l;}function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}function padrao(){return [0,9,9,9,9,8,0];}function normalizarDias(v){if(Array.isArray(v))return DL.map((_,i)=>Math.max(0,Number(v[i]??padrao()[i])||0));if(v&&typeof v==='object')return [v.dom,v.seg,v.ter,v.qua,v.qui,v.sex,v.sab].map((x,i)=>Math.max(0,Number(x??padrao()[i])||0));return null;}function lerJornada(){try{const x=normalizarDias(JSON.parse(localStorage.getItem(jornadaKey())||'null'));return x||padrao();}catch(e){return padrao();}}function persistirLocal(){localStorage.setItem(jornadaKey(),JSON.stringify(jornada));global.PRODUCAO_JORNADA=[...jornada];}global.PRODUCAO_JORNADA=[...jornada];
async function carregar(force){if(carregado&&!force)return;const [c,j,legacy]=await Promise.all([fs().collection(CCAT).get(),fs().collection(CCFG).doc('jornada').get().catch(()=>null),fs().collection(CCFG_LEGACY).doc('jornada').get().catch(()=>null)]);cats=c.docs.map(d=>({_id:d.id,...d.data()})).sort((a,b)=>(Number(a.ordem)||0)-(Number(b.ordem)||0)||(a.nome||'').localeCompare(b.nome||''));const atual=j?.exists?normalizarDias(j.data().horas??j.data().dias):null;const antigo=legacy?.exists?normalizarDias(legacy.data().dias??legacy.data().horas):null;if(atual||antigo){jornada=atual||antigo;persistirLocal();}carregado=true;}
async function render(){const p=document.getElementById('page-producao-config');if(!p)return;p.innerHTML='<div class="empty">Carregando configurações...</div>';try{await carregar();desenhar();}catch(e){p.innerHTML='<div class="empty">Falha: '+esc(e.message||e)+'</div>';}}
// PEDIDO AO VIVO (auditoria RELATORIO-COMPARACAO-PRODUCAO.md, seção 7.10 e
// item 13 da execução): o original tem uma barra LATERAL com grupos
// expansíveis (Máquinas → Cadastro/Turnos/Setup; Produtos → Cadastro/
// Ficha/Categorias) + itens soltos (Funcionários/Processos/Jornada/
// Importação/Importar ZIP) + seção Administração — não a fileira de
// botões horizontais que existia aqui antes (rejeitada pelo usuário com
// print lado a lado). Reescrito para bater com essa hierarquia exata
// (index.html:996-1076). Duas seções não têm tela própria neste projeto
// ainda (Turnos por Máquina, Processos como cadastro, Importar ZIP) —
// aparecem no menu do jeito certo, mas mostram um aviso honesto de "ainda
// não implementado" em vez de fingir uma tela que não existe.
const NAV_CFG=[
  {tipo:'grupo',id:'maquinas',icone:'🏭',titulo:'Máquinas',itens:[
    {id:'cadastro-maquinas',titulo:'Cadastro de Máquinas'},
    {id:'turnos',titulo:'Turnos por Máquina'},
    {id:'setup-maquinas',titulo:'Tempos de Setup'},
  ]},
  {tipo:'grupo',id:'produtos',icone:'📦',titulo:'Produtos',itens:[
    {id:'cadastro-produtos',titulo:'Cadastro de Produtos'},
    {id:'ficha-tecnica-cfg',titulo:'Ficha Técnica'},
    {id:'categorias-cfg',titulo:'Categorias'},
  ]},
  {tipo:'item',id:'funcionarios',icone:'👷',titulo:'Funcionários'},
  {tipo:'item',id:'processos',icone:'📈',titulo:'Processos'},
  {tipo:'item',id:'jornada',icone:'🕐',titulo:'Jornada'},
  {tipo:'item',id:'importacao',icone:'🔄',titulo:'Importação / API'},
  {tipo:'item',id:'importzip',icone:'🔄',titulo:'Importar ZIP'},
];
// Fora da hierarquia do original (recursos que só existem nesta integração
// — Mapa da Fábrica era código morto no original, Estoque via Bluesoft é
// exclusivo deste projeto) — mantidos alcançáveis mas claramente separados,
// não misturados com os itens que existem de verdade no original.
const NAV_CFG_EXTRAS=[
  {id:'producao-mapa-fabrica',icone:'🗺️',titulo:'Mapa da Fábrica'},
  {id:'producao-estoque',icone:'📦',titulo:'Estoque (Bluesoft)'},
];
// Seções que ainda não têm implementação própria neste projeto.
const SEM_TELA=new Set(['turnos','processos','importzip']);
const RENDER_EMBED={
  'cadastro-maquinas':()=>global.renderProducaoMaquinas?.('pcfg-embed-host'),
  'cadastro-produtos':()=>global.renderProducaoFichaTecnica?.('pcfg-embed-host'),
  'ficha-tecnica-cfg':()=>global.renderProducaoFichaTecnica?.('pcfg-embed-host'),
  'funcionarios':()=>global.renderProducaoFuncionarios?.('pcfg-embed-host'),
  'setup-maquinas':()=>global.renderProducaoSetup?.('pcfg-embed-host'),
  'importacao':()=>global.renderProducaoImportacao?.('pcfg-embed-host'),
  'producao-estoque':()=>global.renderProducaoEstoque?.('pcfg-embed-host'),
  'producao-mapa-fabrica':()=>global.renderProducaoMapaFabrica?.('pcfg-embed-host'),
};
let secaoAtiva='jornada';
let gruposAbertos={maquinas:false,produtos:false};
function _grupoDaSecao(id){const g=NAV_CFG.find(n=>n.tipo==='grupo'&&n.itens.some(i=>i.id===id));return g?g.id:null;}
function _navCfgHtml(){
  const itemHtml=(id,icone,titulo,indent)=>`<button type="button" class="pcfg-snav-btn${secaoAtiva===id?' pcfg-snav-active':''}" data-pcfg-secao="${id}" style="width:100%;text-align:left;background:${secaoAtiva===id?'var(--surface-3)':'none'};border:1px solid ${secaoAtiva===id?'var(--orange)':'transparent'};border-radius:7px;padding:${indent?'6px 10px':'8px 10px'};margin-bottom:1px;color:${secaoAtiva===id?'var(--orange)':'var(--muted)'};font-size:${indent?'.72rem':'.78rem'};font-weight:${indent?'400':'600'};cursor:pointer;display:flex;align-items:center;gap:7px;padding-left:${indent?'22px':'10px'}">${icone?`<span>${icone}</span>`:''}${esc(titulo)}</button>`;
  const grupoHtml=g=>{
    const aberto=gruposAbertos[g.id]||g.itens.some(i=>i.id===secaoAtiva);
    return `<div>
      <button type="button" class="pcfg-snav-grupo" data-pcfg-grupo="${g.id}" style="width:100%;text-align:left;background:none;border:1px solid transparent;border-radius:7px;padding:8px 10px;color:var(--muted);font-size:.78rem;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span style="display:flex;align-items:center;gap:8px"><span>${g.icone}</span>${esc(g.titulo)}</span>
        <span style="transition:transform .2s;transform:rotate(${aberto?90:0}deg);font-size:.65rem">▶</span>
      </button>
      ${aberto?`<div style="display:flex;flex-direction:column;gap:1px;margin-top:2px">${g.itens.map(i=>itemHtml(i.id,'',i.titulo,true)).join('')}</div>`:''}
    </div>`;
  };
  const corpo=NAV_CFG.map(n=>n.tipo==='grupo'?grupoHtml(n):itemHtml(n.id,n.icone,n.titulo,false)).join('');
  const extras=`<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px">
    <div style="font-size:.6rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding:2px 10px 6px">Extras desta integração</div>
    ${NAV_CFG_EXTRAS.map(n=>itemHtml(n.id,n.icone,n.titulo,false)).join('')}
  </div>`;
  return `<div class="tc" style="padding:8px;width:210px;min-width:210px;max-width:210px;flex:0 0 210px;align-self:flex-start">${corpo}${extras}</div>`;
}
function _conteudoSemTelaHtml(titulo){
  return `<div class="tc" style="padding:40px 24px;text-align:center">
    <div style="font-size:2rem;margin-bottom:10px">🚧</div>
    <div style="font-weight:700;margin-bottom:6px">${esc(titulo)} ainda não foi implementado nesta integração</div>
    <div style="font-size:.78rem;color:var(--muted);max-width:420px;margin:0 auto">Esse item existe no menu porque existe no sistema original — a tela em si ainda precisa ser construída aqui.</div>
  </div>`;
}
function _jornadaHtml(){return `<div class="tc" style="padding:16px;margin-bottom:16px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div><b>🕐 Jornada geral da fábrica</b><div style="font-size:.72rem;color:var(--muted)">Usada como capacidade padrão quando a máquina não possui turno próprio configurado.</div></div><div style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" data-pcfg-jornada-reset>Restaurar padrão</button><button class="btn btn-primary btn-sm" data-pcfg-jornada-save>💾 Salvar jornada</button></div></div><div style="display:grid;grid-template-columns:repeat(7,minmax(80px,1fr));gap:8px;margin-top:14px;overflow:auto">${DL.map((d,i)=>`<label style="text-align:center;font-size:.72rem"><b>${d}</b><input class="field" type="number" min="0" max="24" step=".5" value="${jornada[i]}" data-pcfg-dia="${i}" style="text-align:center;margin-top:5px"><small style="display:block;color:var(--muted);margin-top:3px">horas</small></label>`).join('')}</div></div>`;}
function _categoriasHtml(){const termo=catBusca.trim().toLowerCase(),visiveis=termo?cats.filter(c=>String(c.nome||'').toLowerCase().includes(termo)):cats;return `<div class="tc" style="padding:16px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px"><div><b>🏷️ Categorias de Produção</b><div style="font-size:.72rem;color:var(--muted)">Organização de máquinas e produtos, com ordem e status.</div></div><button class="btn btn-primary btn-sm" data-pcfg-cat-new>+ Categoria</button></div><div style="margin-bottom:10px"><input class="field" type="search" placeholder="Buscar categoria..." value="${esc(catBusca)}" data-pcfg-cat-busca style="max-width:320px"></div><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Ordem</th><th>Categoria</th><th>Status</th><th></th></tr></thead><tbody>${visiveis.length?visiveis.map(c=>`<tr><td>${Number(c.ordem)||0}</td><td><b>${esc(c.nome)}</b></td><td><span class="badge ${c.ativo===false?'b-orange':'b-green'}">${c.ativo===false?'Inativa':'Ativa'}</span></td><td style="text-align:right"><button class="acao-lapis" data-pcfg-cat-edit="${esc(c._id)}">✏️</button><button class="acao-lapis" data-pcfg-cat-del="${esc(c._id)}">🗑️</button></td></tr>`).join(''):`<tr><td colspan="4">${termo?'Nenhuma categoria encontrada.':'Nenhuma categoria cadastrada.'}</td></tr>`}</tbody></table></div></div>`;}
function desenhar(){
  const p=document.getElementById('page-producao-config');if(!p)return;
  const conteudo=secaoAtiva==='jornada'?_jornadaHtml()
    :secaoAtiva==='categorias-cfg'?_categoriasHtml()
    :SEM_TELA.has(secaoAtiva)?_conteudoSemTelaHtml((NAV_CFG.flatMap(n=>n.tipo==='grupo'?n.itens:[n]).find(i=>i.id===secaoAtiva)||{}).titulo||'Esta seção')
    :'<div id="pcfg-embed-host"><div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div></div>';
  p.innerHTML=`<button type="button" class="prod-config-voltar" data-pcfg-voltar>‹ Voltar</button>
    <div style="margin-bottom:16px"><div class="page-title" style="font-size:1.1rem">⚙️ Configurações de Produção</div><div style="font-size:.74rem;color:var(--muted)">Máquinas, produtos, funcionários, jornada e demais cadastros da produção.</div></div>
    <div style="display:flex;gap:16px;align-items:flex-start">${_navCfgHtml()}<div style="flex:1;min-width:0">${conteudo}</div></div>`;
  if(RENDER_EMBED[secaoAtiva])RENDER_EMBED[secaoAtiva]();
}
async function salvarJornada(){jornada=DL.map((_,i)=>Math.max(0,Number(document.querySelector(`[data-pcfg-dia="${i}"]`)?.value)||0));persistirLocal();const agora=new Date().toISOString(),por=global._currentAnalistaUser?.email||'',diasObj={dom:jornada[0],seg:jornada[1],ter:jornada[2],qua:jornada[3],qui:jornada[4],sex:jornada[5],sab:jornada[6]};await Promise.all([fs().collection(CCFG).doc('jornada').set({horas:jornada,dias:diasObj,atualizadoEm:agora,atualizadoPor:por},{merge:true}),fs().collection(CCFG_LEGACY).doc('jornada').set({dias:diasObj,horas:jornada,atualizadoEm:agora,atualizadoPor:por},{merge:true})]);global.showToast?.('Jornada salva e aplicada ao planejamento.','success');global.AnalistaNavigation?.renderCurrentPage?.();}
async function catEditar(id){const c=cats.find(x=>x._id===id)||{},nome=prompt('Nome da categoria:',c.nome||'');if(nome==null||!nome.trim())return;const ordem=Number(prompt('Ordem:',String(c.ordem??0)))||0,ativo=confirm('OK = categoria ativa. Cancelar = inativa.');const dup=cats.find(x=>x._id!==id&&String(x.nome||'').trim().toLowerCase()===nome.trim().toLowerCase());if(dup){global.showToast?.('Categoria já cadastrada.','error');return;}const payload={nome:nome.trim(),ordem,ativo,atualizadoEm:new Date().toISOString()};if(id)await fs().collection(CCAT).doc(id).set(payload,{merge:true});else await fs().collection(CCAT).add({...payload,criadoEm:new Date().toISOString()});await carregar(true);desenhar();}
async function catDel(id){const c=cats.find(x=>x._id===id);if(!c||!confirm('Excluir categoria "'+c.nome+'"?'))return;await fs().collection(CCAT).doc(id).delete();await carregar(true);desenhar();}
global.renderProducaoConfig=render;document.addEventListener('input',e=>{if(e.target.matches('[data-pcfg-dia]'))jornada[Number(e.target.dataset.pcfgDia)]=Math.max(0,Number(e.target.value)||0);if(e.target.matches('[data-pcfg-cat-busca]')){catBusca=e.target.value||'';desenhar();const i=document.querySelector('[data-pcfg-cat-busca]');if(i){i.focus();i.setSelectionRange?.(i.value.length,i.value.length);}}});document.addEventListener('click',e=>{if(e.target.closest('[data-pcfg-jornada-save]'))salvarJornada();if(e.target.closest('[data-pcfg-jornada-reset]')&&confirm('Restaurar a jornada padrão da fábrica?')){jornada=padrao();persistirLocal();desenhar();}if(e.target.closest('[data-pcfg-cat-new]'))catEditar('');const ed=e.target.closest('[data-pcfg-cat-edit]');if(ed)catEditar(ed.dataset.pcfgCatEdit);const dl=e.target.closest('[data-pcfg-cat-del]');if(dl)catDel(dl.dataset.pcfgCatDel);const sec=e.target.closest('[data-pcfg-secao]');if(sec){secaoAtiva=sec.getAttribute('data-pcfg-secao');const g=_grupoDaSecao(secaoAtiva);if(g)gruposAbertos[g]=true;desenhar();return;}const grp=e.target.closest('[data-pcfg-grupo]');if(grp){const id=grp.getAttribute('data-pcfg-grupo');gruposAbertos[id]=!gruposAbertos[id];desenhar();return;}if(e.target.closest('[data-pcfg-voltar]')){const pid=global._prodPaginaAntesConfig||'producao-dashboard';global.goPage?.(pid,document.getElementById('nav-'+pid));}});
global.DTProducao?.registrarInvalidacao?.(()=>{carregado=false;cats=[];catBusca='';jornada=lerJornada();global.PRODUCAO_JORNADA=[...jornada];});
})(window);
