// Usuários, canais de acesso e autorização detalhada por módulo.
(function(global){
  'use strict';
  const raw=()=>global.getDTRawFirestore();
  const ACCESS='usuarios_acessos';
  let usuarios=[],editando=null,lojasCache=[];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const emailId=email=>String(email||'').trim().toLowerCase().replace(/[^a-z0-9._-]/g,'_');

  const MODULOS=[
    {id:'dashboard',nome:'Dashboard',acoes:['visualizar','atualizar']},
    {id:'inventarios',nome:'Inventários',acoes:['visualizar','criar','editar','excluir','importar','exportar','publicar','finalizar']},
    {id:'acompanhamento',nome:'Acompanhamento',acoes:['visualizar','atualizar','exportar']},
    {id:'auditoria',nome:'Auditoria',acoes:['visualizar','criar','editar','excluir','importar','exportar','publicar','finalizar']},
    {id:'contagens',nome:'Contagens',acoes:['visualizar','editar','excluir','exportar']},
    {id:'pendencias',nome:'Pendências',acoes:['visualizar','editar','exportar']},
    {id:'recontagens',nome:'Recontagem',acoes:['visualizar','criar','editar','excluir','exportar']},
    {id:'rel-divergencias',nome:'Relatório de Conflitos',acoes:['visualizar','exportar']},
    {id:'capas-duplicadas',nome:'Capas Duplicadas',acoes:['visualizar','editar','excluir','exportar']},
    {id:'produtividade',nome:'Produtividade',acoes:['visualizar','exportar']},
    {id:'enderecos',nome:'Endereços',acoes:['visualizar','criar','editar','excluir','importar','exportar']},
    {id:'produtos',nome:'Produtos',acoes:['visualizar','criar','editar','excluir','importar','exportar','atualizar']},
    {id:'coletores',nome:'Coletores',acoes:['visualizar','criar','editar','excluir','aprovar','bloquear']},
    {id:'operadores',nome:'Usuários e Permissões',acoes:['visualizar','criar','editar','excluir']},
    {id:'lojas',nome:'Lojas',acoes:['visualizar','criar','editar','excluir','importar']},
    {id:'rastreabilidade',nome:'Rastreabilidade',acoes:['visualizar','excluir','exportar']},
    {id:'importar-exportar',nome:'Importar / Exportar / API',acoes:['visualizar','importar','exportar','configurar','executar','excluir']}
  ];
  const ROTULOS={visualizar:'Visualizar',criar:'Criar',editar:'Editar',excluir:'Excluir',importar:'Importar',exportar:'Exportar',publicar:'Liberar/Publicar',finalizar:'Finalizar',atualizar:'Atualizar',aprovar:'Aprovar',bloquear:'Bloquear',configurar:'Configurar',executar:'Executar/Enviar'};
  const todos=()=>Object.fromEntries(MODULOS.map(m=>[m.id,Object.fromEntries(m.acoes.map(a=>[a,true]))]));
  const normalizar=(p,legadoTotal)=>{
    if(!p||typeof p!=='object')return legadoTotal?todos():{};
    const out={}; MODULOS.forEach(m=>{out[m.id]={};m.acoes.forEach(a=>out[m.id][a]=p[m.id]?.[a]===true);});return out;
  };

  async function carregarLojas(){lojasCache=await global.DTLoja.garantirLojaInicial();return lojasCache;}
  function lojasLabels(ids){const a=Array.isArray(ids)?ids:[];if(!a.length)return'<span class="badge badge-red">Sem loja</span>';return a.map(id=>`<span class="badge badge-blue" style="margin:2px">${esc(lojasCache.find(x=>x.id===id)?.nome||id)}</span>`).join('');}
  function canais(u){const c=u.canais_acesso||{};return `${c.coletor!==false?'📱 Coletor ':''}${c.analista===true||u.perfil==='analista'?'🖥️ Analista':''}`.trim()||'Sem acesso';}
  async function coletarUsuariosExistentes(){
    await carregarLojas();const mapa=new Map(),snap=await raw().collection(ACCESS).get().catch(()=>({docs:[]}));
    snap.docs.forEach(d=>{const x={id:d.id,...d.data()};mapa.set(x.uid||x.email||d.id,x);});
    for(const loja of lojasCache){try{const s=await raw().collection('lojas').doc(loja.id).collection('dt_operadores').limit(500).get();s.docs.forEach(d=>{const o={id:d.id,...d.data()},k=o.uid||o.email||d.id,a=mapa.get(k)||{};mapa.set(k,{...o,...a,uid:a.uid||o.uid||d.id,email:a.email||o.email||'',nome:a.nome||o.nome||o.name||'',_lojasEncontradas:[...new Set([...(a._lojasEncontradas||[]),loja.id])]});});}catch(e){console.warn('[Usuários]',e.message);}}
    const atual=global._currentAnalistaUser;if(atual){const k=atual.uid||atual.email;if(!mapa.has(k))mapa.set(k,{uid:atual.uid,email:atual.email,nome:atual.displayName||atual.email?.split('@')[0],perfil:'analista',acesso_todas_lojas:true,lojas_permitidas:[],canais_acesso:{coletor:true,analista:true},permissoes:todos()});}
    usuarios=[...mapa.values()].sort((a,b)=>String(a.nome||a.email).localeCompare(String(b.nome||b.email),'pt-BR'));return usuarios;
  }
  async function listarOperadores(){const w=document.getElementById('op-lista-wrap');if(!w)return;w.innerHTML='<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando usuários…</div></div>';try{await coletarUsuariosExistentes();renderUsuarios();opCarregarOperadoresParaFiltro();}catch(e){w.innerHTML=`<div class="empty"><div class="empty-title">Erro ao carregar usuários</div><div class="empty-sub">${esc(e.message)}</div></div>`;}}
  function usuarioProtegido(u){
    const atual=global._currentAnalistaUser;
    return !u?.uid||u.uid===atual?.uid||u.admin_mestre===true||u.administrador_mestre===true;
  }
  function renderUsuarios(){const w=document.getElementById('op-lista-wrap');if(!w)return;const q=String(document.getElementById('op-busca')?.value||'').toLowerCase(),lista=usuarios.filter(u=>`${u.nome||''} ${u.email||''} ${u.perfil||''}`.toLowerCase().includes(q));if(!lista.length){w.innerHTML='<div class="empty"><div class="empty-title">Nenhum usuário encontrado</div></div>';return;}w.innerHTML=`<div style="overflow:auto"><table><thead><tr><th>Usuário</th><th>Acesso</th><th>Lojas</th><th>Status</th><th>Ações</th></tr></thead><tbody>${lista.map((u,i)=>`<tr><td><b>${esc(u.nome||u.name||'Sem nome')}</b><div style="font-size:.72rem;color:var(--muted)">${esc(u.email||'—')}</div></td><td>${esc(canais(u))}</td><td>${u.acesso_todas_lojas===true?'<span class="badge badge-green">Todas</span>':lojasLabels(u.lojas_permitidas||u.lojasPermitidas)}</td><td>${u.ativo===false?'<span class="badge badge-red">Bloqueado</span>':'<span class="badge badge-green">Ativo</span>'}</td><td><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" onclick="opEditarUsuario(${i})">⚙️ Configurar</button>${usuarioProtegido(u)?'<span class="badge badge-blue" title="A própria conta e o administrador mestre não podem ser excluídos">Protegido</span>':`<button class="btn btn-danger btn-sm" onclick="opExcluirUsuario(${i})">🗑 Excluir</button>`}</div></td></tr>`).join('')}</tbody></table></div>`;}
  function opFiltrarLista(){renderUsuarios();}
  function montarChecks(id,sel){const b=document.getElementById(id);if(!b)return;const s=new Set(sel||[]);b.innerHTML=lojasCache.map(l=>`<label style="display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid var(--border);border-radius:9px;cursor:pointer"><input type="checkbox" value="${esc(l.id)}" ${s.has(l.id)?'checked':''}><span>${esc(l.nome||l.id)}</span></label>`).join('');}
  function setModo(p,m){document.querySelectorAll(`input[name="op-lojas-${p}-modo"]`).forEach(r=>r.checked=r.value===m);const b=document.getElementById(`op-lojas-${p}-box`);if(b)b.style.display=m==='selecionadas'?'block':'none';}
  function renderCanais(prefix,c={}){const b=document.getElementById(`op-canais-${prefix}`);if(!b)return;b.innerHTML=[['coletor','📱 Coletor'],['analista','🖥️ Analista']].map(([id,n])=>`<label style="padding:10px 13px;border:1px solid var(--border);border-radius:10px;cursor:pointer"><input type="checkbox" data-canal="${id}" ${c[id]===true?'checked':''}> ${n}</label>`).join('');b.querySelector('[data-canal="analista"]')?.addEventListener('change',e=>{const p=document.getElementById(`op-permissoes-${prefix}`);if(p)p.style.display=e.target.checked?'block':'none';});}
  function renderPermissoes(prefix,p){const b=document.getElementById(`op-permissoes-${prefix}`);if(!b)return;const perms=normalizar(p,false);b.innerHTML=`<div style="display:flex;gap:6px;margin-bottom:8px"><button type="button" class="btn btn-ghost btn-sm" onclick="opMarcarPermissoes('${prefix}',true)">Marcar tudo</button><button type="button" class="btn btn-ghost btn-sm" onclick="opMarcarPermissoes('${prefix}',false)">Limpar</button></div><div style="border:1px solid var(--border);border-radius:12px;overflow:hidden">${MODULOS.map((m,i)=>`<div style="padding:10px 12px;background:${i%2?'var(--surface-2)':'var(--surface)'}"><div style="font-weight:700;font-size:.8rem;margin-bottom:7px">${esc(m.nome)}</div><div style="display:flex;gap:8px;flex-wrap:wrap">${m.acoes.map(a=>`<label style="font-size:.72rem;cursor:pointer"><input type="checkbox" data-modulo="${m.id}" data-acao="${a}" ${perms[m.id]?.[a]?'checked':''}> ${ROTULOS[a]}</label>`).join('')}</div></div>`).join('')}</div>`;}
  function opMarcarPermissoes(prefix,v){document.querySelectorAll(`#op-permissoes-${prefix} input[type=checkbox]`).forEach(x=>x.checked=v);}
  function lerCanais(prefix){const o={coletor:false,analista:false};document.querySelectorAll(`#op-canais-${prefix} [data-canal]`).forEach(x=>o[x.dataset.canal]=x.checked);return o;}
  function lerPermissoes(prefix){const p={};MODULOS.forEach(m=>p[m.id]={});document.querySelectorAll(`#op-permissoes-${prefix} [data-modulo]`).forEach(x=>p[x.dataset.modulo][x.dataset.acao]=x.checked);return p;}
  function validarAcesso(prefix){const c=lerCanais(prefix);if(!c.coletor&&!c.analista){global.showToast?.('Libere Coletor e/ou Analista','error');return false;}if(c.analista&&!MODULOS.some(m=>lerPermissoes(prefix)[m.id]?.visualizar)){global.showToast?.('Libere ao menos uma aba do Analista','error');return false;}return true;}
  function opSetModoLojasCriar(m){setModo('criar',m);}function opSetModoLojasEditar(m){setModo('editar',m);}
  async function opEditarUsuario(i){editando=usuarios[i];if(!editando)return;await carregarLojas();document.getElementById('opedit-nome').value=editando.nome||editando.name||'';document.getElementById('opedit-cargo').value=editando.perfil||editando.tipo||'operador';document.getElementById('opedit-setor').value=editando.setor||'';document.getElementById('opedit-senha').value='';montarChecks('op-lojas-editar-lista',editando.lojas_permitidas||[]);setModo('editar',editando.acesso_todas_lojas===true?'todas':'selecionadas');const legadoAnalista=editando.perfil==='analista'&&!editando.canais_acesso;renderCanais('editar',editando.canais_acesso||{coletor:true,analista:legadoAnalista});renderPermissoes('editar',normalizar(editando.permissoes,legadoAnalista));document.getElementById('op-permissoes-editar').style.display=(editando.canais_acesso?.analista===true||legadoAnalista)?'block':'none';document.getElementById('op-modal-bg').style.display='flex';}
  function opFecharModal(){document.getElementById('op-modal-bg').style.display='none';editando=null;}
  async function opSalvarEdicao(){if(!editando||!validarAcesso('editar'))return;const modo=document.querySelector('input[name="op-lojas-editar-modo"]:checked')?.value||'todas',sel=[...document.querySelectorAll('#op-lojas-editar-lista input:checked')].map(x=>x.value);if(modo==='selecionadas'&&!sel.length)return global.showToast?.('Selecione ao menos uma loja','error');const uid=editando.uid||editando.id||emailId(editando.email),c=lerCanais('editar'),data={uid,email:String(editando.email||'').toLowerCase(),nome:document.getElementById('opedit-nome').value.trim(),perfil:c.analista?'analista':'operador',setor:document.getElementById('opedit-setor').value.trim(),ativo:editando.ativo!==false,canais_acesso:c,permissoes:lerPermissoes('editar'),acesso_todas_lojas:modo==='todas',lojas_permitidas:modo==='todas'?[]:sel,atualizado_em:new Date().toISOString(),atualizado_por:global._currentAnalistaUser?.email||''};try{await raw().collection(ACCESS).doc(uid).set(data,{merge:true});for(const l of lojasCache){const ref=raw().collection('lojas').doc(l.id).collection('dt_operadores').doc(uid),ex=await ref.get().catch(()=>null);if(ex?.exists||data.acesso_todas_lojas||sel.includes(l.id))await ref.set(data,{merge:true});}global.showToast?.('Acessos e permissões salvos','success');opFecharModal();await listarOperadores();}catch(e){global.showToast?.('Erro ao salvar: '+e.message,'error');}}
  function opAbrirModalCriar(){carregarLojas().then(()=>{montarChecks('op-lojas-criar-lista',[]);setModo('criar','todas');renderCanais('criar',{coletor:true,analista:false});renderPermissoes('criar',{});document.getElementById('op-permissoes-criar').style.display='none';document.getElementById('op-modal-criar-bg').style.display='flex';});}
  function opFecharModalCriar(){document.getElementById('op-modal-criar-bg').style.display='none';}
  function opSelecionarTipo(tipo){document.querySelectorAll('input[name="op-tipo"]').forEach(r=>r.checked=r.value===tipo);const an=tipo==='analista';const ac=document.querySelector('#op-canais-criar [data-canal="analista"]'),co=document.querySelector('#op-canais-criar [data-canal="coletor"]');if(ac)ac.checked=an;if(co)co.checked=true;const p=document.getElementById('op-permissoes-criar');if(p)p.style.display=an?'block':'none';}
  function opGerarUsername(){const n=document.getElementById('op-nome')?.value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/\s+/).filter(Boolean);if(n?.length>=2)document.getElementById('op-username').value=n[0]+'.'+n[n.length-1];}
  function opGerarSenha(){document.getElementById('op-senha').value=Math.random().toString(36).slice(-4).toUpperCase()+Math.floor(1000+Math.random()*9000);}
  function toggleOpSenha(){const e=document.getElementById('op-senha');e.type=e.type==='password'?'text':'password';}function toggleOpeditSenha(){const e=document.getElementById('opedit-senha');e.type=e.type==='password'?'text':'password';}
  function opValidarUsername(){}function opValidarSenha(){}
  async function criarOperador(){const nome=document.getElementById('op-nome').value.trim(),login=document.getElementById('op-username').value.trim().toLowerCase(),senha=document.getElementById('op-senha').value;if(!nome||!login||senha.length<6)return global.showToast?.('Preencha nome, login e senha com no mínimo 6 caracteres','error');if(!validarAcesso('criar'))return;const email=login.includes('@')?login:login+'@daterrinhaalimentos.com.br',modo=document.querySelector('input[name="op-lojas-criar-modo"]:checked')?.value||'todas',sel=[...document.querySelectorAll('#op-lojas-criar-lista input:checked')].map(x=>x.value);if(modo==='selecionadas'&&!sel.length)return global.showToast?.('Selecione ao menos uma loja','error');try{let app;try{app=firebase.app('dt-user-admin');}catch(_){app=firebase.initializeApp(global.DT_FIREBASE_CFG,'dt-user-admin');}const cred=await app.auth().createUserWithEmailAndPassword(email,senha);await cred.user.updateProfile({displayName:nome});const c=lerCanais('criar'),data={uid:cred.user.uid,email,nome,perfil:c.analista?'analista':'operador',ativo:true,canais_acesso:c,permissoes:lerPermissoes('criar'),acesso_todas_lojas:modo==='todas',lojas_permitidas:modo==='todas'?[]:sel,criado_em:new Date().toISOString()};await raw().collection(ACCESS).doc(cred.user.uid).set(data);for(const l of lojasCache.filter(l=>data.acesso_todas_lojas||sel.includes(l.id)))await raw().collection('lojas').doc(l.id).collection('dt_operadores').doc(cred.user.uid).set(data,{merge:true});await app.auth().signOut();opFecharModalCriar();global.showToast?.('Usuário criado com permissões detalhadas','success');await listarOperadores();}catch(e){global.showToast?.('Erro ao criar usuário: '+e.message,'error');}}
  async function opExcluirUsuario(i){
    const u=usuarios[i];
    if(!u||usuarioProtegido(u))return global.showToast?.('Esta conta é protegida e não pode ser excluída','error');
    if(!temPermissao('operadores','excluir'))return global.showToast?.('Seu login não possui permissão para excluir usuários','error');
    const nome=u.nome||u.email||'este usuário';
    if(!global.confirm(`Excluir permanentemente ${nome}?\n\nO login será removido do Firebase Authentication e os acessos serão apagados de todas as lojas. Esta ação não pode ser desfeita.`))return;
    try{
      global.showToast?.('Excluindo usuário do Firebase…','info');
      const callable=firebase.app().functions('southamerica-east1').httpsCallable('excluirUsuario');
      const resposta=await callable({uid:u.uid});
      if(!resposta?.data?.ok)throw new Error('O Firebase não confirmou a exclusão');
      global.showToast?.('Usuário excluído do Firebase e de todas as lojas','success');
      await listarOperadores();
    }catch(e){
      console.error('[Usuários] Falha ao excluir',e);
      const codigo=String(e?.code||'').replace('functions/','');
      const msg=codigo==='not-found'?'Publique também as funções do Firebase antes de usar a exclusão.':(e?.message||'Falha desconhecida');
      global.showToast?.('Erro ao excluir usuário: '+msg,'error');
    }
  }

  function temPermissao(modulo,acao='visualizar'){
    const a=global.DT_USUARIO_ACESSO_ATUAL;if(!a||!a.permissoes)return true;
    if(modulo==='recontagens') return a.permissoes?.recontagens?.[acao]===true || a.permissoes?.divergencias?.[acao]===true;
    return a.permissoes?.[modulo]?.[acao]===true;
  }
  function aplicarPermissoesAnalista(){
    const a=global.DT_USUARIO_ACESSO_ATUAL;if(!a)return;
    const legado=!a.permissoes; if(legado)return;
    MODULOS.forEach(m=>{const nav=document.getElementById('nav-'+m.id),page=document.getElementById('page-'+m.id),ver=temPermissao(m.id);if(nav)nav.style.display=ver?'':'none';if(page&&!ver)page.classList.remove('on');});
    document.querySelectorAll('[onclick],[onchange]').forEach(el=>{const txt=(el.getAttribute('onclick')||el.getAttribute('onchange')||'').toLowerCase(),page=el.closest('.page')?.id?.replace(/^page-/,'');if(!page||!MODULOS.some(m=>m.id===page))return;let acao='visualizar';if(/exclu|limpar|cancelar.*recont/.test(txt))acao='excluir';else if(/export|baixar|download/.test(txt))acao='exportar';else if(/import|processfile|handlefile/.test(txt))acao='importar';else if(/criar|novo|adicionar|registrar/.test(txt))acao='criar';else if(/public|liberar/.test(txt))acao='publicar';else if(/finaliz|fecharinvent|encerrar/.test(txt))acao='finalizar';else if(/aprovar/.test(txt))acao='aprovar';else if(/bloquear/.test(txt))acao='bloquear';else if(/salvarconfig|apiset|mapeamento/.test(txt))acao='configurar';else if(/enviar|executar/.test(txt))acao='executar';else if(/salvar|editar|reatrib|confirmar/.test(txt))acao='editar';else if(/atualizar|refresh/.test(txt))acao='atualizar';if(acao!=='visualizar'&&!temPermissao(page,acao))el.style.display='none';});
    const primeira=MODULOS.find(m=>temPermissao(m.id));if(!document.querySelector('.page.on')&&primeira)global.goPage?.(primeira.id,document.getElementById('nav-'+primeira.id));
  }
  let timerPermissoes=null;
  document.addEventListener('DOMContentLoaded',function(){
    new MutationObserver(function(){
      if(!global.DT_USUARIO_ACESSO_ATUAL?.permissoes)return;
      clearTimeout(timerPermissoes);
      timerPermissoes=setTimeout(aplicarPermissoesAnalista,40);
    }).observe(document.body,{childList:true,subtree:true});
  });
  function oplSetTab(tab){const op=tab==='operadores';document.getElementById('opl-page-operadores').style.display=op?'block':'none';document.getElementById('opl-page-lojas').style.display=op?'none':'block';if(op)listarOperadores();else global.renderGestaoLojas?.();}
  function opCarregarOperadoresParaFiltro(){const s=document.getElementById('op-rec-filtro-operador');if(s)s.innerHTML='<option value="">Selecione um operador…</option>'+usuarios.map(u=>`<option value="${esc(u.uid||u.id)}">${esc(u.nome||u.email)}</option>`).join('');}
  function opVerificarMinhaConta(){}
  Object.assign(global,{DT_MODULOS_PERMISSOES:MODULOS,temPermissao,aplicarPermissoesAnalista,listarOperadores,opFiltrarLista,opEditarUsuario,opExcluirUsuario,opSalvarEdicao,opFecharModal,opAbrirModalCriar,opFecharModalCriar,opSetModoLojasCriar,opSetModoLojasEditar,opSelecionarTipo,opGerarUsername,opGerarSenha,toggleOpSenha,toggleOpeditSenha,opValidarUsername,opValidarSenha,criarOperador,oplSetTab,opCarregarOperadoresParaFiltro,opVerificarMinhaConta,opMarcarPermissoes});
})(window);
