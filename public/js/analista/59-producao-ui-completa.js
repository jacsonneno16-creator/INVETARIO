(function(global){
'use strict';

// Etapa 7 FIX: paridade visual SEM recriar a arvore de navegacao.
// Regra critica: os #nav-producao-* originais permanecem no DOM com seus
// onclicks, IDs e referencias, pois o shell principal e o sistema de permissoes
// dependem exatamente desses elementos.

// Pedido ao vivo do usuário: "deixa só os mesmos menu que tem no original,
// e o outro coloca no final com três pontinho" — a barra principal só
// mostra o fluxo do dia a dia; o resto (cadastro/config/uso ocasional) fica
// atrás do "⋮ Mais" (mesmo padrão de flyout já usado em Usuários e
// Permissões). O CSS de .prod-more-wrap/.prod-more-menu já existia
// (producao-completa.css) mas nunca tinha sido ligado a elemento nenhum.
// PEDIDO AO VIVO (usuário, com print do original: "esse menus que eu
// coloquei nem ficam aí nos 3 pontinhos" — a barra principal do original
// (index.html:173-184) tem 9 abas fixas, sem "Mais": Dashboard, Programação,
// Máquinas, Prog. Visual, Realizado, Insumos/Máq., Insumos Geral, Prog.
// Automática, Relatórios. Ajustado pra bater exatamente com isso —
// "Insumos Geral" é uma 2ª entrada de menu pro MESMO módulo (a original
// também tem os dois como abas separadas, mas é o mesmo dado por baixo).
const ROTAS_PRINCIPAIS=[
 'producao-dashboard','producao-programacao','producao-maquinas','producao-gantt',
 'producao-realizado','producao-insumos','producao-insumos-geral','producao-prog-automatica','producao-relatorios',
];
// Rótulo/ícone de cada item NÃO precisa ser recriado aqui — o node original
// (com <span class="nav-icon"> + texto) é reaproveitado tal como está,
// só reparentado pra dentro do menu.
const ROTAS_MAIS=[
 'producao-ficha-tecnica','producao-projecao','producao-funcionarios','producao-setup',
 'producao-mapa-fabrica','producao-config','producao-importacao','producao-estoque',
];

const _invalidadores=global.DTProducaoInvalidadores=global.DTProducaoInvalidadores||[];
function registrarInvalidacao(fn){if(typeof fn==='function'&&!_invalidadores.includes(fn))_invalidadores.push(fn);}
function invalidarTudo(){_invalidadores.slice().forEach(fn=>{try{fn();}catch(e){console.warn('[Producao] Falha ao invalidar cache:',e);}});}

async function atualizarContextoHeader(){
  const loja=document.getElementById('prod-loja-atual');
  const lojaPill=document.getElementById('prod-loja-pill');
  const id=global.getDTLojaAtiva?.()||'';
  let nome=id||'Sem loja';
  try{const lojas=await global.DTLoja?.listar(false)||[];nome=lojas.find(l=>l.id===id)?.nome||nome;}catch(_){ }
  if(loja){loja.textContent='🏭 '+nome;loja.title='Loja ativa: '+nome+' — clique para trocar';}
  if(lojaPill)lojaPill.textContent=nome;
  const nomeUser=document.getElementById('prod-user-name');
  const avatar=document.getElementById('prod-user-avatar');
  const u=global.firebase?.auth?.().currentUser;
  const display=(u?.displayName||u?.email||'Usuario').trim();
  if(nomeUser)nomeUser.textContent=display;
  if(avatar)avatar.textContent=(display[0]||'U').toUpperCase();
}

global.DTProducao={...(global.DTProducao||{}),registrarInvalidacao,invalidarTudo,atualizarLojaSidebar:atualizarContextoHeader};
global.addEventListener?.('dt-loja-alterada',()=>{invalidarTudo();atualizarContextoHeader();});

function criarHeader(){
  const shell=document.getElementById('setor-producao-shell');
  const aside=shell?.querySelector(':scope > .sidebar');
  if(!aside||document.getElementById('prod-original-header'))return;

  // NAO usamos aside.innerHTML. Assim os nav originais continuam exatamente
  // os mesmos objetos DOM que permissoes/irParaSetor/goPage conhecem.
  aside.classList.add('producao-sidebar-completa','producao-original-nav');
  const sec=aside.querySelector(':scope > .sb-sec');
  if(sec)sec.classList.add('prod-sb-sec-hidden');

  const header=document.createElement('div');
  header.id='prod-original-header';
  header.className='prod-original-header';
  header.innerHTML=''+
    '<div class="prod-original-logo"><div class="prod-logo-mark">DT</div><div class="prod-logo-copy"><div class="prod-logo-name">DT <span>Producao</span></div><div class="prod-logo-sub">Da Terrinha Alimentos</div></div></div>'+
    '<div class="prod-header-actions">'+
      '<div class="prod-pill"><span class="prod-dot"></span><span>Loja</span><strong id="prod-loja-pill">—</strong></div>'+
      '<button type="button" id="prod-loja-atual" class="prod-store-btn" title="Trocar loja">🏭 Trocar loja</button>'+
      '<button type="button" id="prod-theme-toggle" class="prod-icon-btn" title="Alternar tema">☀️</button>'+
      '<div class="prod-user-chip"><span id="prod-user-avatar" class="prod-user-avatar">U</span><span id="prod-user-name" class="prod-user-name">Usuario</span></div>'+
    '</div>';
  aside.insertBefore(header,aside.firstChild);

  // Mantem cada nav original, apenas acrescentando classe visual — mesmos
  // elementos DOM, mesmo onclick, só ganham o estilo de aba.
  ROTAS_PRINCIPAIS.forEach(id=>{
    const n=document.getElementById('nav-'+id);
    if(n){n.classList.add('prod-tab-btn','prod-primary-tab');n.dataset.prodRoute=id;}
  });

  // "⋮ Mais" — o resto do menu original (cadastro/config/uso ocasional) não
  // some, só muda de lugar: os MESMOS nós (com onclick="goPage(...)" intacto)
  // são REPARENTADOS pra dentro do painel, não recriados — por isso a
  // navegação, as permissões e o estado "ativo" continuam funcionando
  // exatamente como antes, não importa se o item está na barra ou no menu.
  const moreWrap=document.createElement('div');
  moreWrap.className='prod-more-wrap';
  moreWrap.innerHTML='<button type="button" id="prod-more-btn" class="prod-tab-btn" title="Mais opções">⋮ Mais</button><div class="prod-more-menu" id="prod-more-menu"></div>';
  const menu=moreWrap.querySelector('#prod-more-menu');
  ROTAS_MAIS.forEach(id=>{
    const n=document.getElementById('nav-'+id);
    if(!n)return;
    n.classList.add('prod-tab-btn');
    n.dataset.prodRoute=id;
    menu.appendChild(n);
  });
  aside.appendChild(moreWrap);

  aside.addEventListener('click',e=>{
    const loja=e.target.closest('#prod-loja-atual');
    if(loja){e.preventDefault();e.stopPropagation();if(typeof global.trocarLojaInventario==='function')global.trocarLojaInventario(e);return;}
    const theme=e.target.closest('#prod-theme-toggle');
    if(theme){e.preventDefault();e.stopPropagation();toggleTheme();return;}
    const maisBtn=e.target.closest('#prod-more-btn');
    if(maisBtn){e.preventDefault();e.stopPropagation();menu.classList.toggle('on');return;}
    // Escolher qualquer item DENTRO do menu fecha o painel (não fica aberto
    // cobrindo a página depois de navegar).
    if(menu.contains(e.target))menu.classList.remove('on');
  });
  document.addEventListener('click',e=>{
    if(!menu.classList.contains('on'))return;
    if(!moreWrap.contains(e.target))menu.classList.remove('on');
  });

  aplicarTemaSalvo();
  atualizarContextoHeader();
}

function aplicarTemaSalvo(){
  const shell=document.getElementById('setor-producao-shell');if(!shell)return;
  const light=localStorage.getItem('dt-producao-tema')==='light';
  shell.classList.toggle('prod-light',light);atualizarBotaoTema();
}
function atualizarBotaoTema(){
  const shell=document.getElementById('setor-producao-shell');const b=document.getElementById('prod-theme-toggle');if(!shell||!b)return;
  b.textContent=shell.classList.contains('prod-light')?'🌙':'☀️';
  b.title=shell.classList.contains('prod-light')?'Usar tema escuro':'Usar tema claro';
}
function toggleTheme(){
  const shell=document.getElementById('setor-producao-shell');if(!shell)return;
  const light=shell.classList.toggle('prod-light');localStorage.setItem('dt-producao-tema',light?'light':'dark');atualizarBotaoTema();
}

function decorarPagina(page){
  if(!page||page.dataset.prodDecorada==='1')return;
  page.dataset.prodDecorada='1';page.classList.add('producao-page-completa');
}
function decorarTudo(){document.querySelectorAll('#setor-producao-shell [id^="page-producao-"]').forEach(decorarPagina);}

function observarConteudo(){
  const content=document.querySelector('#setor-producao-shell > .content');
  if(!content||content.dataset.prodObserver==='1')return;
  content.dataset.prodObserver='1';
  // Observamos apenas filhos adicionados. Nao observamos mudancas de classe,
  // evitando ciclos com goPage/permissoes.
  const mo=new MutationObserver(()=>decorarTudo());
  mo.observe(content,{subtree:true,childList:true});
}

// Pedido ao vivo do usuário: "mexer em tudo" — modais (edição de máquina,
// setup, ficha técnica, funcionário, reordenar fila do Gantt...) são
// elementos <div class="modal-bg"> que vivem FORA de #setor-producao-shell
// no DOM (irmãos, não descendentes), então não herdam as variáveis
// --prod-* mapeadas nele. Marca o <body> quando o setor ativo é Produção
// e o CSS (producao-completa.css) escurece qualquer modal aberto nesse
// contexto, sem precisar duplicar a lógica por modal.
function _shellProducaoVisivel(){
  const shell=document.getElementById('setor-producao-shell');
  return !!shell&&global.getComputedStyle(shell).display!=='none';
}
function _patchModaisParaTemaProducao(){
  const origOpen=global.openModal, origClose=global.closeModal;
  if(typeof origOpen!=='function'||origOpen._prodPatched)return;
  function open(id){
    if(_shellProducaoVisivel())document.body.classList.add('prod-modal-context');
    return origOpen.apply(this,arguments);
  }
  function close(id){
    const r=origClose.apply(this,arguments);
    if(!document.querySelector('.modal-bg.open'))document.body.classList.remove('prod-modal-context');
    return r;
  }
  open._prodPatched=true;
  global.openModal=open;global.closeModal=close;
}

function init(){criarHeader();decorarTudo();observarConteudo();atualizarContextoHeader();_patchModaisParaTemaProducao();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();

global.ProducaoUICompleta={montarSidebar:criarHeader,montarShellOriginal:criarHeader,toggleTheme};
})(window);
