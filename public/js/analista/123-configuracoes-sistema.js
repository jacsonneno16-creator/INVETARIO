(function(global){
'use strict';
var origens=new Map(),secaoAtual='visao-geral';
function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c];});}
function master(){return typeof global.ehMasterAtual==='function'&&global.ehMasterAtual();}
function pode(mod,acao){return typeof global.temPermissao==='function'?global.temPermissao(mod,acao||'visualizar'):true;}
function shell(){
  var el=document.getElementById('dt-settings-shell');
  if(el)return el;
  el=document.createElement('div');el.id='dt-settings-shell';el.className='dt-settings-shell';
  el.innerHTML='<div class="dt-settings-top"><button class="btn btn-ghost btn-sm" data-dt-settings-close>‹ Voltar</button><div><b>⚙️ Configurações do Sistema</b><div class="dt-settings-sub">Administração geral e atalhos para parâmetros por módulo</div></div><div class="dt-settings-top-spacer"></div><input class="field dt-settings-search" type="search" placeholder="Buscar configuração..." data-dt-settings-search></div><div class="dt-settings-layout"><aside class="dt-settings-nav" data-dt-settings-nav></aside><main class="dt-settings-content" data-dt-settings-content></main></div>';
  document.body.appendChild(el);return el;
}
var secoes=[
 {grupo:'Geral',id:'visao-geral',icon:'🏠',nome:'Visão geral'},
 {grupo:'Acesso e segurança',id:'usuarios',icon:'👥',nome:'Usuários e acessos',mod:'operadores'},
 {grupo:'Acesso e segurança',id:'permissoes',icon:'🔐',nome:'Catálogo de permissões',master:true},
 {grupo:'Acesso e segurança',id:'coletores',icon:'📱',nome:'Coletores',mod:'coletores'},
 {grupo:'Acesso e segurança',id:'lojas',icon:'🏪',nome:'Lojas',mod:'lojas'},
 {grupo:'Inventário',id:'enderecos-inventario',icon:'📍',nome:'Endereços',mod:'enderecos'},
 {grupo:'Inventário',id:'produtos-inventario',icon:'📦',nome:'Base de Produtos',mod:'produtos'},
 {grupo:'Inventário',id:'dados-inventario',icon:'🔄',nome:'Importar / Exportar',mod:'importar-exportar'},
 {grupo:'Sistema',id:'integracoes',icon:'🔗',nome:'Integrações e API',mod:'importar-exportar'},
 {grupo:'Sistema',id:'impressoras',icon:'🖨️',nome:'Impressoras',mod:'coletores'},
 {grupo:'Sistema',id:'diagnostico',icon:'🩺',nome:'Diagnóstico'},
 {grupo:'Parâmetros dos módulos',id:'pcp',icon:'📋',nome:'PCP'},
 {grupo:'Parâmetros dos módulos',id:'producao',icon:'🏭',nome:'Produção'},
 {grupo:'Parâmetros dos módulos',id:'recebimento',icon:'🚚',nome:'Recebimento'}
];
function visivel(s){if(s.master&&!master())return false;if(s.mod&&!pode(s.mod))return false;return true;}
function nav(){var el=shell().querySelector('[data-dt-settings-nav]'),last='';el.innerHTML=secoes.filter(visivel).map(function(s){var g='';if(s.grupo!==last){last=s.grupo;g='<div class="dt-settings-group">'+esc(s.grupo)+'</div>';}return g+'<button type="button" class="dt-settings-nav-item '+(secaoAtual===s.id?'on':'')+'" data-dt-settings-section="'+s.id+'"><span>'+s.icon+'</span>'+esc(s.nome)+'</button>';}).join('');}
function card(icon,titulo,desc,action,label){return '<button type="button" class="dt-settings-card" '+action+'><span class="dt-settings-card-icon">'+icon+'</span><span><b>'+esc(titulo)+'</b><small>'+esc(desc)+'</small><em>'+esc(label||'Abrir')+' →</em></span></button>';}
function visao(){return '<div class="dt-settings-page-title"><h2>Configurações do Sistema</h2><p>Configurações gerais ficam aqui. Parâmetros que mudam regra de negócio continuam no módulo responsável, mas podem ser acessados deste hub.</p></div><div class="dt-settings-grid">'+
 (pode('operadores')?card('👥','Usuários e acessos','Contas, lojas, canais, setores e permissões por ação.','data-dt-settings-section="usuarios"','Gerenciar'):'')+
 (master()?card('🔐','Permissões','Consulte o número e o nome de cada permissão, por tela e ação.','data-dt-settings-section="permissoes"','Consultar'):'')+
 (pode('coletores')?card('📱','Coletores','Aprovação, bloqueio, dispositivos e códigos de acesso.','data-dt-settings-section="coletores"','Gerenciar'):'')+
 (pode('lojas')?card('🏪','Lojas','Ambientes, códigos e escopo de acesso.','data-dt-settings-section="lojas"','Gerenciar'):'')+
 card('📋','Parâmetros do PCP','Cobertura, lead time, mínimos, múltiplos e parâmetros de planejamento.','data-dt-settings-section="pcp"','Abrir PCP')+
 card('🏭','Parâmetros da Produção','Jornada, categorias, processos, máquinas e regras produtivas.','data-dt-settings-section="producao"','Abrir Produção')+
 card('🚚','Configurações do Recebimento','Docas, operação e parâmetros próprios do recebimento.','data-dt-settings-section="recebimento"','Abrir Recebimento')+
 '</div>';}
function catalogo(filtro){
  var cat=Array.isArray(global.DT_CATALOGO_PERMISSOES)?global.DT_CATALOGO_PERMISSOES:[];
  var mods=Array.isArray(global.DT_MODULOS_PERMISSOES)?global.DT_MODULOS_PERMISSOES:[];
  var ordem=new Map();mods.forEach(function(m,i){ordem.set(m.id,i);});
  var q=String(filtro||'').trim().toLowerCase();
  if(q)cat=cat.filter(function(x){return String(x.codigo+' '+x.moduloNome+' '+x.nome+' '+x.modulo+' '+x.acao).toLowerCase().indexOf(q)>=0;});
  function grupoDe(id){id=String(id||'');if(id.indexOf('recebimento-')===0)return 'Recebimento';if(id.indexOf('producao-')===0)return 'Produção';if(id.indexOf('pcp-')===0)return 'PCP';if(id.indexOf('compras-')===0)return 'Compras';return 'Inventário / Logística';}
  var grupos=['Inventário / Logística','Recebimento','Produção','PCP','Compras'];
  var corpo=grupos.map(function(g){
    var itens=cat.filter(function(x){return grupoDe(x.modulo)===g;}).sort(function(a,b){var oa=ordem.has(a.modulo)?ordem.get(a.modulo):9999,ob=ordem.has(b.modulo)?ordem.get(b.modulo):9999;return oa-ob;});
    if(!itens.length)return '';
    return '<div class="dt-settings-group">'+esc(g)+'</div><div class="dt-perm-catalog"><table><thead><tr><th>Número</th><th>Tela / módulo</th><th>Ação</th></tr></thead><tbody>'+itens.map(function(x){return '<tr><td><b class="dt-perm-num">'+x.codigo+'</b></td><td>'+esc(x.moduloNome)+'</td><td>'+esc(x.nome)+'</td></tr>';}).join('')+'</tbody></table></div>';
  }).join('');
  return '<div class="dt-settings-page-title"><h2>🔐 Catálogo de permissões</h2><p>Informe ao TI o número da permissão. Só administradores/master visualizam este catálogo completo.</p></div><div class="dt-perm-catalog-toolbar"><input class="field" data-dt-perm-search value="'+esc(filtro||'')+'" placeholder="Buscar por número, tela ou ação..."><span>'+cat.length+' permissões</span></div>'+corpo;
}
function mover(id){var el=document.getElementById(id),host=shell().querySelector('[data-dt-settings-content]');if(!el||!host)return null;if(!origens.has(el))origens.set(el,{parent:el.parentNode,next:el.nextSibling});host.innerHTML='';host.appendChild(el);el.classList.add('on','dt-settings-embedded-page');el.style.display='flex';return el;}
function restaurar(){origens.forEach(function(o,el){el.classList.remove('dt-settings-embedded-page');el.style.display='';el.classList.remove('on');if(o.parent){if(o.next&&o.next.parentNode===o.parent)o.parent.insertBefore(el,o.next);else o.parent.appendChild(el);}});origens.clear();}
function moduloHtml(nome,desc,button){return '<div class="dt-settings-page-title"><h2>'+esc(nome)+'</h2><p>'+esc(desc)+'</p></div><div class="tc" style="padding:18px"><div class="alert info">Parâmetros operacionais ficam na tela do próprio módulo para existir uma única fonte de gravação. Este hub é o ponto central para chegar neles.</div><div style="margin-top:16px">'+button+'</div></div>';}
async function render(id){secaoAtual=id||'visao-geral';
 // Guarda de autorização: nav() já esconde os itens que o usuário não pode
 // ver, mas abrirConfiguracoesSistema()/render() são funções globais — dá
 // pra chamar direto com qualquer id (console, elemento perdido no DOM).
 // Sem reconferir aqui, isso contornava o filtro visual e mostrava seções
 // como o catálogo de permissões (master-only) pra qualquer usuário.
 var alvoSecao=secoes.find(function(s){return s.id===secaoAtual;});
 if(alvoSecao&&!visivel(alvoSecao))secaoAtual='visao-geral';
 var pedido=secaoAtual,el=shell(),host=el.querySelector('[data-dt-settings-content]');restaurar();nav();
 if(secaoAtual==='visao-geral'){host.innerHTML=visao();return;}
 if(secaoAtual==='usuarios'){mover('page-operadores');if(typeof global.listarOperadores==='function')global.listarOperadores();return;}
 if(secaoAtual==='coletores'){mover('page-coletores');if(typeof global.atualizarAbaColetores==='function')global.atualizarAbaColetores();else if(typeof global.renderColetores==='function')global.renderColetores();return;}
 if(secaoAtual==='lojas'){mover('page-lojas');if(typeof global.renderGestaoLojas==='function')global.renderGestaoLojas();return;}
 if(secaoAtual==='enderecos-inventario'){mover('page-enderecos');if(typeof global.atualizarEnderecos==='function')global.atualizarEnderecos();return;}
 if(secaoAtual==='produtos-inventario'){mover('page-produtos');if(typeof global.renderBaseProdutos==='function')global.renderBaseProdutos();return;}
 if(secaoAtual==='dados-inventario'){mover('page-importar-exportar');if(typeof global.ieAbrirPagina==='function')global.ieAbrirPagina();return;}
 if(secaoAtual==='permissoes'){host.innerHTML=catalogo('');return;}
 if(secaoAtual==='integracoes'){mover('page-integracao-api');if(typeof global.ieSetTab==='function')global.ieSetTab('api');return;}
 if(secaoAtual==='impressoras'){mover('page-impressoras');if(typeof global.renderImpressorasRede==='function')global.renderImpressorasRede();return;}
 if(secaoAtual==='diagnostico'){host.innerHTML=moduloHtml('🩺 Diagnóstico','Verifique sincronização, loja ativa e publicação das bases.','<button class="btn btn-primary" data-run-diagnostic>Executar diagnóstico</button>');return;}
 if(secaoAtual==='pcp'){host.innerHTML='<div class="empty">Carregando parâmetros do PCP...</div>';try{if(typeof global.carregarScriptsDeArea==='function')await global.carregarScriptsDeArea('pcp');}catch(e){if(secaoAtual===pedido)host.innerHTML='<div class="empty">Falha ao carregar PCP: '+esc(e.message||e)+'</div>';return;}if(secaoAtual!==pedido)return;mover('page-pcp-parametros');if(typeof global.renderPCPParametros==='function')global.renderPCPParametros();return;}
 if(secaoAtual==='producao'){host.innerHTML='<div class="empty">Carregando configurações da Produção...</div>';try{if(typeof global.carregarScriptsDeArea==='function')await global.carregarScriptsDeArea('producao');}catch(e){if(secaoAtual===pedido)host.innerHTML='<div class="empty">Falha ao carregar Produção: '+esc(e.message||e)+'</div>';return;}if(secaoAtual!==pedido)return;mover('page-producao-config');if(typeof global.renderProducaoConfig==='function')global.renderProducaoConfig();return;}
 if(secaoAtual==='recebimento'){host.innerHTML='<div class="empty">Carregando configurações do Recebimento...</div>';try{if(typeof global.carregarScriptsDeArea==='function')await global.carregarScriptsDeArea('recebimento');}catch(e){if(secaoAtual===pedido)host.innerHTML='<div class="empty">Falha ao carregar Recebimento: '+esc(e.message||e)+'</div>';return;}if(secaoAtual!==pedido)return;mover('page-recebimento-config');if(typeof global.renderRecebimentoConfig==='function')global.renderRecebimentoConfig();return;}
}
function abrirConfiguracoesSistema(id){var el=shell();el.classList.add('open');render(id||'visao-geral');document.body.classList.add('dt-system-overlay-open');}
function fecharConfiguracoesSistema(){var el=document.getElementById('dt-settings-shell');if(!el)return;restaurar();el.classList.remove('open');document.body.classList.remove('dt-system-overlay-open');}
// PEDIDO AO VIVO (2026-10-01): "quero que essas opções... seja uma do lado
// da outra, menores e não sejam coloridas" — as 4 ações viram todas
// btn-ghost btn-sm (mesmo padrão neutro/pequeno já usado no resto do
// sistema, ex. botão "Limpar"), numa linha só, sem moldura (ver
// .dt-profile-actions .btn em analista.css). "As configurações já estão
// ali em cima... tirar de lá, deixar só aqui" — a engrenagem do topo
// (setor-btn-config) foi removida de _htmlFlyoutConfiguracoes
// (37-usuarios-permissoes.js); este botão agora é o único jeito de abrir
// Configurações, por isso ganha a MESMA checagem de permissão (podeConfig)
// que decidia se aquele botão aparecia — sem isso, quem não tem nenhuma
// permissão de config veria um botão que só abriria um painel vazio.
// CORREÇÃO (2026-10-01, mesmo dia): "não falei para tirar minha foto de
// lá quando eu clicasse" — a foto/.dt-profile-avatar (clicável, abre o
// seletor de arquivo) tinha sido removida por engano numa leitura errada
// de "sem esse quadradinho ao redor" (que era sobre a MOLDURA dos botões,
// não sobre a foto) — restaurada.
function abrirPerfilSistema(){var u=global._currentAnalistaUser||{},a=global.DT_USUARIO_ACESSO_ATUAL||{},nome=u.displayName||a.nome||u.email||'Usuário',email=u.email||a.email||'',foto='';try{foto=localStorage.getItem('dt_user_photo_'+(u.uid||u.email||'local'))||'';}catch(_e){}
 var podeConfig=pode('operadores')||pode('coletores')||pode('lojas')||pode('importar-exportar')||pode('impressoras')||pode('pcp-central')||pode('producao-config')||pode('recebimento-config');
 var velho=document.getElementById('dt-profile-shell');if(velho)velho.remove();var el=document.createElement('div');el.id='dt-profile-shell';el.className='dt-profile-shell open';el.innerHTML='<div class="dt-profile-card"><div class="dt-profile-head"><div><b>Meu perfil</b><small>Conta conectada ao DT Produção</small></div><button class="btn btn-ghost btn-sm" data-dt-profile-close>✕</button></div><div class="dt-profile-body"><label class="dt-profile-avatar" for="dt-user-photo-input">'+(foto?'<img src="'+foto+'">':esc(String(nome).split(/\s+/).slice(0,2).map(function(x){return x.charAt(0)}).join('').toUpperCase()))+'<span>Alterar foto</span></label><div class="dt-profile-fields"><div><small>Nome</small><b>'+esc(nome)+'</b></div><div><small>E-mail</small><b>'+esc(email)+'</b></div><div><small>Perfil</small><b>'+esc(a.perfil||'analista')+'</b></div><div><small>Lojas</small><b>'+(a.acesso_todas_lojas===true?'Todas as lojas':esc((a.lojas_permitidas||[]).join(', ')||'Loja atual'))+'</b></div></div></div><div class="dt-profile-actions"><button class="btn btn-ghost btn-sm" data-dt-profile-photo>📷 Alterar foto</button><button class="btn btn-ghost btn-sm" data-dt-profile-password>🔑 Redefinir senha</button>'+(podeConfig?'<button class="btn btn-ghost btn-sm" data-dt-profile-settings>⚙️ Configurações</button>':'')+'<button class="btn btn-ghost btn-sm" data-dt-profile-logout>🚪 Sair</button></div></div>';document.body.appendChild(el);}
function paginaAtualId(){var p=document.querySelector('.page.on');return p?p.id.replace(/^page-/,''):'';}
function abrirPermissoesTela(){if(!master())return;var id=paginaAtualId(),mods=Array.isArray(global.DT_MODULOS_PERMISSOES)?global.DT_MODULOS_PERMISSOES:[],aliases={'recebimento-cargas':'recebimento-transbordo','recebimento-tempos':'recebimento-dashboard','recebimento-historico':'recebimento-operacao','recebimento-retornos-status':'recebimento-recusas','recebimento-recusas-cadastros':'recebimento-recusas'},m=mods.find(function(x){return x.id===(aliases[id]||id);});if(!m&&id.indexOf('pcp-')===0)m=mods.find(function(x){return x.id==='pcp-central';});if(!m&&id.indexOf('compras-')===0)m=mods.find(function(x){return x.id==='compras-central';});if(!m){global.showToast&&global.showToast('Esta tela não possui um módulo de permissão mapeado.','warning');return;}var cat=(global.DT_CATALOGO_PERMISSOES||[]).filter(function(x){return x.modulo===m.id;});var old=document.getElementById('dt-page-permissions');if(old)old.remove();var el=document.createElement('div');el.id='dt-page-permissions';el.className='modal-bg open';el.innerHTML='<div class="modal" style="max-width:720px"><div class="modal-hdr"><div><div class="modal-title">🔐 Permissões desta tela</div><div class="sec-sub">'+esc(m.nome)+'</div></div><button class="modal-close" data-close-page-perm>✕</button></div><div class="dt-page-perm-list">'+cat.map(function(x){return '<div><b>'+x.codigo+' -</b><span>'+esc(x.moduloNome)+': '+esc(x.nome)+'</span></div>';}).join('')+'</div><div class="modal-actions"><button class="btn btn-ghost" data-close-page-perm>Fechar</button><button class="btn btn-primary" data-manage-page-perm>Gerenciar usuários e acessos</button></div></div>';document.body.appendChild(el);}
function atualizarGlobalBar(){var u=global._currentAnalistaUser||{},nome=u.displayName||u.nome||u.email||'Perfil';document.querySelectorAll('[data-global-user-name]').forEach(function(n){n.textContent=String(nome).split(' ')[0]||'Perfil';});var inic=String(nome).split(/\s+/).slice(0,2).map(function(x){return x.charAt(0)}).join('').toUpperCase();var foto='';try{foto=localStorage.getItem('dt_user_photo_'+(u.uid||u.email||'local'))||'';}catch(_e){}document.querySelectorAll('[data-global-avatar]').forEach(function(a){a.innerHTML=foto?'<img src="'+foto+'">':esc(inic||'U');});}
document.addEventListener('click',function(e){var t=e.target.closest&&e.target.closest('[data-system-settings]');if(t){abrirConfiguracoesSistema(t.getAttribute('data-system-settings')||'visao-geral');return;}t=e.target.closest&&e.target.closest('[data-system-profile]');if(t){abrirPerfilSistema();return;}t=e.target.closest&&e.target.closest('[data-system-permissions]');if(t){abrirPermissoesTela();return;}t=e.target.closest&&e.target.closest('[data-dt-settings-close]');if(t){fecharConfiguracoesSistema();return;}t=e.target.closest&&e.target.closest('[data-dt-settings-section]');if(t){render(t.getAttribute('data-dt-settings-section'));return;}t=e.target.closest&&e.target.closest('[data-run-diagnostic]');if(t&&typeof global.diagnosticarSync==='function'){global.diagnosticarSync();return;}if(e.target.closest&&e.target.closest('[data-dt-profile-close]')){e.target.closest('#dt-profile-shell').remove();return;}if(e.target.closest&&e.target.closest('[data-dt-profile-photo]')){document.getElementById('dt-user-photo-input')&&document.getElementById('dt-user-photo-input').click();return;}if(e.target.closest&&e.target.closest('[data-dt-profile-password]')){var u=global._currentAnalistaUser||{};if(!u.email){global.showToast&&global.showToast('Não foi possível identificar o e-mail desta conta.','error');}else if(!global.firebase||!global.firebase.app){global.showToast&&global.showToast('Login ainda não está pronto. Atualize a página e tente de novo.','error');}else{global.firebase.app().functions('southamerica-east1').httpsCallable('solicitarRecuperacaoSenha')({email:u.email,canal:'analista'}).then(function(){global.showToast&&global.showToast('Se o acesso estiver ativo, o link será enviado ao e-mail de recuperação cadastrado.','success');}).catch(function(err){global.showToast&&global.showToast(err.message||String(err),'error');});}return;}if(e.target.closest&&e.target.closest('[data-dt-profile-settings]')){document.getElementById('dt-profile-shell')&&document.getElementById('dt-profile-shell').remove();abrirConfiguracoesSistema('visao-geral');return;}if(e.target.closest&&e.target.closest('[data-dt-profile-logout]')){if(!confirm('Sair da conta?'))return;document.getElementById('dt-profile-shell')&&document.getElementById('dt-profile-shell').remove();if(typeof global.doLogoutAnalista==='function')global.doLogoutAnalista();else if(global.AUTH_AN&&typeof global.AUTH_AN.signOut==='function')global.AUTH_AN.signOut();return;}if(e.target.closest&&e.target.closest('[data-close-page-perm]')){document.getElementById('dt-page-permissions')&&document.getElementById('dt-page-permissions').remove();return;}if(e.target.closest&&e.target.closest('[data-manage-page-perm]')){document.getElementById('dt-page-permissions')&&document.getElementById('dt-page-permissions').remove();abrirConfiguracoesSistema('usuarios');return;}});
document.addEventListener('input',function(e){if(e.target.matches&&e.target.matches('[data-dt-perm-search]')){var host=shell().querySelector('[data-dt-settings-content]');host.innerHTML=catalogo(e.target.value);var n=host.querySelector('[data-dt-perm-search]');if(n){n.focus();n.setSelectionRange(n.value.length,n.value.length);}}});
document.addEventListener('change',function(e){if(e.target&&e.target.id==='dt-user-photo-input')setTimeout(atualizarGlobalBar,80);});
document.addEventListener('DOMContentLoaded',atualizarGlobalBar);
global.atualizarBarraGlobalConfig=atualizarGlobalBar;global.abrirConfiguracoesSistema=abrirConfiguracoesSistema;global.fecharConfiguracoesSistema=fecharConfiguracoesSistema;global.abrirPerfilSistema=abrirPerfilSistema;global.abrirPermissoesTela=abrirPermissoesTela;
})(window);
