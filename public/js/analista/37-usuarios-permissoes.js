// Usuários, canais de acesso e autorização detalhada por módulo.
(function(global){
  'use strict';
  const raw=()=>global.getDTRawFirestore();
  const ACCESS='usuarios_acessos';
  let usuarios=[],editando=null,lojasCache=[];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const emailId=email=>String(email||'').trim().toLowerCase().replace(/[^a-z0-9._-]/g,'_');
  const DOMINIO='@daterrinhaalimentos.com.br';
  const partesNome=nome=>String(nome||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s-]/g,'').split(/\s+/).filter(Boolean);
  const loginsDoNome=nome=>{
    const partes=partesNome(nome),primeiro=partes[0]||'',segundo=partes[1]||'';
    return {primeiro,segundo,analista:primeiro?primeiro+DOMINIO:'',coletor:primeiro&&segundo?primeiro+'.'+segundo:'',coletorEmail:primeiro&&segundo?primeiro+'.'+segundo+DOMINIO:''};
  };

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
    snap.docs.forEach(d=>{const x={id:d.id,...d.data()};if(x.conta_secundaria===true)return;mapa.set(x.uid||x.email||d.id,x);});
    for(const loja of lojasCache){try{const s=await raw().collection('lojas').doc(loja.id).collection('dt_operadores').limit(500).get();s.docs.forEach(d=>{const o={id:d.id,...d.data()};if(o.conta_secundaria===true)return;const k=o.uid||o.email||d.id,a=mapa.get(k)||{};mapa.set(k,{...o,...a,uid:a.uid||o.uid||d.id,email:a.email||o.email||'',nome:a.nome||o.nome||o.name||'',_lojasEncontradas:[...new Set([...(a._lojasEncontradas||[]),loja.id])]});});}catch(e){console.warn('[Usuários]',e.message);}}
    const atual=global._currentAnalistaUser;if(atual){const k=atual.uid||atual.email;if(!mapa.has(k))mapa.set(k,{uid:atual.uid,email:atual.email,nome:atual.displayName||atual.email?.split('@')[0],perfil:'analista',acesso_todas_lojas:true,lojas_permitidas:[],canais_acesso:{coletor:true,analista:true},permissoes:todos()});}
    usuarios=[...mapa.values()].sort((a,b)=>String(a.nome||a.email).localeCompare(String(b.nome||b.email),'pt-BR'));return usuarios;
  }
  async function listarOperadores(){const w=document.getElementById('op-lista-wrap');if(!w)return;w.innerHTML='<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando usuários…</div></div>';try{await coletarUsuariosExistentes();renderUsuarios();opCarregarOperadoresParaFiltro();}catch(e){w.innerHTML=`<div class="empty"><div class="empty-title">Erro ao carregar usuários</div><div class="empty-sub">${esc(e.message)}</div></div>`;}}
  function usuarioProtegido(u){
    const atual=global._currentAnalistaUser;
    return !u?.uid||u.uid===atual?.uid||u.admin_mestre===true||u.administrador_mestre===true;
  }
  function loginsHtml(u){const analista=u.email_analista||((u.canais_acesso?.analista===true||u.perfil==='analista')?u.email:'');const coletor=u.login_coletor||String(u.email_coletor||((u.canais_acesso?.coletor!==false&&u.perfil!=='analista')?u.email:'')).split('@')[0];return `${analista?`<div style="font-size:.72rem;color:var(--muted)">🖥️ ${esc(analista)}</div>`:''}${coletor?`<div style="font-size:.72rem;color:var(--muted)">📱 ${esc(coletor)}</div>`:''}`||'<div style="font-size:.72rem;color:var(--muted)">—</div>';}
  function renderUsuarios(){const w=document.getElementById('op-lista-wrap');if(!w)return;const q=String(document.getElementById('op-busca')?.value||'').toLowerCase(),lista=usuarios.map((u,i)=>({...u,_indiceOriginal:i})).filter(u=>`${u.nome||''} ${u.email||''} ${u.email_analista||''} ${u.email_coletor||''} ${u.login_coletor||''} ${u.perfil||''}`.toLowerCase().includes(q));if(!lista.length){w.innerHTML='<div class="empty"><div class="empty-title">Nenhum usuário encontrado</div></div>';return;}w.innerHTML=`<div style="overflow:auto"><table><thead><tr><th>Usuário e logins</th><th>Acesso</th><th>Lojas</th><th>Status</th><th>Ações</th></tr></thead><tbody>${lista.map(u=>`<tr><td><b>${esc(u.nome||u.name||'Sem nome')}</b>${loginsHtml(u)}</td><td>${esc(canais(u))}</td><td>${u.acesso_todas_lojas===true?'<span class="badge badge-green">Todas</span>':lojasLabels(u.lojas_permitidas||u.lojasPermitidas)}</td><td>${u.ativo===false?'<span class="badge badge-red">Bloqueado</span>':'<span class="badge badge-green">Ativo</span>'}</td><td><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" onclick="opEditarUsuario(${u._indiceOriginal})">⚙️ Configurar</button>${usuarioProtegido(u)?'<span class="badge badge-blue" title="A própria conta e o administrador mestre não podem ser excluídos">Protegido</span>':`<button class="btn btn-danger btn-sm" onclick="opExcluirUsuario(${u._indiceOriginal})">🗑 Excluir</button>`}</div></td></tr>`).join('')}</tbody></table></div>`;}
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
  async function opSalvarEdicao(){if(!editando||!validarAcesso('editar'))return;const modo=document.querySelector('input[name="op-lojas-editar-modo"]:checked')?.value||'todas',sel=[...document.querySelectorAll('#op-lojas-editar-lista input:checked')].map(x=>x.value);if(modo==='selecionadas'&&!sel.length)return global.showToast?.('Selecione ao menos uma loja','error');const uid=editando.uid||editando.id||emailId(editando.email),c=lerCanais('editar'),novaSenha=document.getElementById('opedit-senha').value,data={uid,email:String(editando.email||'').toLowerCase(),nome:document.getElementById('opedit-nome').value.trim(),perfil:c.analista?'analista':'operador',setor:document.getElementById('opedit-setor').value.trim(),ativo:editando.ativo!==false,canais_acesso:c,permissoes:lerPermissoes('editar'),acesso_todas_lojas:modo==='todas',lojas_permitidas:modo==='todas'?[]:sel,atualizado_em:new Date().toISOString(),atualizado_por:global._currentAnalistaUser?.email||''};if(novaSenha&&(novaSenha.length<8||!/\\d/.test(novaSenha)||!/[A-Za-z]/.test(novaSenha)))return global.showToast?.('A nova senha deve ter no mínimo 8 caracteres, com letras e números','error');try{if(novaSenha){if(!temPermissao('operadores','editar'))throw new Error('Seu login não possui permissão para alterar senhas');const callable=firebase.app().functions('southamerica-east1').httpsCallable('alterarSenhaUsuario'),uids=[uid,editando.analista_uid,editando.coletor_uid,...(editando.uids_vinculados||[])].filter(Boolean);await callable({uids:[...new Set(uids)],senha:novaSenha});}await raw().collection(ACCESS).doc(uid).set(data,{merge:true});for(const l of lojasCache){for(const alvoUid of [...new Set([uid,editando.coletor_uid].filter(Boolean))]){const ref=raw().collection('lojas').doc(l.id).collection('dt_operadores').doc(alvoUid),ex=await ref.get().catch(()=>null);if(ex?.exists||data.acesso_todas_lojas||sel.includes(l.id))await ref.set({...data,uid:alvoUid,conta_secundaria:alvoUid!==uid},{merge:true});}}global.showToast?.(novaSenha?'Acessos e nova senha salvos':'Acessos e permissões salvos','success');opFecharModal();await listarOperadores();}catch(e){global.showToast?.('Erro ao salvar: '+(e?.message||e),'error');}}
  function opAbrirModalCriar(){carregarLojas().then(()=>{montarChecks('op-lojas-criar-lista',[]);setModo('criar','todas');renderCanais('criar',{coletor:true,analista:false});renderPermissoes('criar',{});document.getElementById('op-permissoes-criar').style.display='none';document.getElementById('op-modal-criar-bg').style.display='flex';});}
  function opFecharModalCriar(){document.getElementById('op-modal-criar-bg').style.display='none';}
  function opSelecionarTipo(tipo){document.querySelectorAll('input[name="op-tipo"]').forEach(r=>r.checked=r.value===tipo);const an=tipo==='analista';const ac=document.querySelector('#op-canais-criar [data-canal="analista"]'),co=document.querySelector('#op-canais-criar [data-canal="coletor"]');if(ac)ac.checked=an;if(co)co.checked=true;const p=document.getElementById('op-permissoes-criar');if(p)p.style.display=an?'block':'none';opGerarUsername();}
  function opGerarUsername(){const l=loginsDoNome(document.getElementById('op-nome')?.value),tipo=document.querySelector('input[name="op-tipo"]:checked')?.value||'operador',campo=document.getElementById('op-username'),preview=document.getElementById('op-logins-preview');if(campo)campo.value=l.coletor;if(preview)preview.innerHTML=l.primeiro?(tipo==='analista'?`<div><strong>Login do Analista:</strong> ${esc(l.analista)}</div><div><strong>Login do Coletor:</strong> ${esc(l.coletor||'informe também o segundo nome')}</div>`:`<div><strong>Login do Coletor:</strong> ${esc(l.coletor||'informe também o segundo nome')}</div>`):'Informe o nome completo.';}
  function opGerarSenha(){document.getElementById('op-senha').value=Math.random().toString(36).slice(-4).toUpperCase()+Math.floor(1000+Math.random()*9000);}
  function toggleOpSenha(){const e=document.getElementById('op-senha');e.type=e.type==='password'?'text':'password';}function toggleOpeditSenha(){const e=document.getElementById('opedit-senha');e.type=e.type==='password'?'text':'password';}
  function opValidarUsername(){}function opValidarSenha(){}
  async function criarOperador(){
    const nome=document.getElementById('op-nome').value.trim(),senha=document.getElementById('op-senha').value,tipo=document.querySelector('input[name="op-tipo"]:checked')?.value||'operador',logins=loginsDoNome(nome);
    if(!logins.primeiro||!logins.segundo||!logins.coletor||!logins.coletorEmail)return global.showToast?.('Informe ao menos o primeiro e o segundo nome','error');
    if(senha.length<8||!/\d/.test(senha)||!/[A-Za-z]/.test(senha))return global.showToast?.('Informe uma senha com no mínimo 8 caracteres, com letras e números','error');
    if(!validarAcesso('criar'))return;
    const modo=document.querySelector('input[name="op-lojas-criar-modo"]:checked')?.value||'todas',sel=[...document.querySelectorAll('#op-lojas-criar-lista input:checked')].map(x=>x.value);
    if(modo==='selecionadas'&&!sel.length)return global.showToast?.('Selecione ao menos uma loja','error');
    let contaExistente=false;
    try{
      const criar=firebase.app().functions('southamerica-east1').httpsCallable('criarUsuarioVinculado'),resposta=await criar({nome,senha,emailAnalista:logins.analista,emailColetor:logins.coletorEmail,criarAnalista:tipo==='analista'}),auth=resposta?.data||{};
      if(!auth.ok||!auth.uid||!auth.coletor_uid)throw new Error('O Firebase não confirmou a criação dos logins');
      contaExistente=auth.conta_existente===true;
      const c=lerCanais('criar'),agora=new Date().toISOString(),uids=[auth.uid,auth.coletor_uid].filter(Boolean),data={uid:auth.uid,analista_uid:auth.analista_uid||null,coletor_uid:auth.coletor_uid,uids_vinculados:[...new Set(uids)],email:tipo==='analista'?logins.analista:logins.coletorEmail,email_analista:tipo==='analista'?logins.analista:'',email_coletor:logins.coletorEmail,login_coletor:logins.coletor,nome,perfil:c.analista?'analista':'operador',ativo:true,canais_acesso:c,permissoes:lerPermissoes('criar'),acesso_todas_lojas:modo==='todas',lojas_permitidas:modo==='todas'?[]:sel,atualizado_em:agora};
      if(!contaExistente)data.criado_em=agora;
      else data.recuperado_em=agora;
      await raw().collection(ACCESS).doc(auth.uid).set(data,{merge:true});
      if(auth.coletor_uid!==auth.uid){const secundario={...data,uid:auth.coletor_uid,email:logins.coletorEmail,perfil:'operador',canais_acesso:{coletor:true,analista:false},permissoes:{},conta_secundaria:true,cadastro_principal_uid:auth.uid};await raw().collection(ACCESS).doc(auth.coletor_uid).set(secundario,{merge:true});}
      for(const l of lojasCache.filter(l=>data.acesso_todas_lojas||sel.includes(l.id))){const base=raw().collection('lojas').doc(l.id).collection('dt_operadores');await base.doc(auth.uid).set(data,{merge:true});if(auth.coletor_uid!==auth.uid)await base.doc(auth.coletor_uid).set({...data,uid:auth.coletor_uid,email:logins.coletorEmail,perfil:'operador',canais_acesso:{coletor:true,analista:false},permissoes:{},conta_secundaria:true,cadastro_principal_uid:auth.uid},{merge:true});}
      opFecharModalCriar();
      global.showToast?.(contaExistente?'Usuário existente atualizado e logins vinculados':'Usuário criado com os logins vinculados','success');
      await listarOperadores();
    }catch(e){
      const mensagens={
        'functions/invalid-argument':'Revise o nome e a senha informados.',
        'functions/permission-denied':'Seu login não possui permissão para criar usuários.',
        'functions/not-found':'Publique também as funções do Firebase para criar os logins vinculados.'
      };
      global.showToast?.(mensagens[e?.code]||('Não foi possível criar o usuário: '+(e?.message||'erro desconhecido')),'error');
    }
  }
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
    if(a.admin_mestre===true||a.administrador_mestre===true||a.perfil==='administrador')return true;
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
  function oplSetTab(tab){
    const op=tab==='operadores', pageOp=document.getElementById('opl-page-operadores'), pageLojas=document.getElementById('opl-page-lojas');
    if(pageOp)pageOp.style.display=op?'block':'none';
    if(pageLojas)pageLojas.style.display=op?'none':'block';
    [['opl-tab-operadores',op],['opl-tab-lojas',!op]].forEach(([id,ativo])=>{const b=document.getElementById(id);if(!b)return;b.style.background=ativo?'var(--green,#1E6F4E)':'transparent';b.style.color=ativo?'#fff':'var(--muted)';b.style.boxShadow=ativo?'0 2px 10px rgba(30,111,78,.3)':'none';});
    const page=document.getElementById('page-operadores'); if(page)page.scrollIntoView({block:'start'});
    if(op)listarOperadores();else global.renderGestaoLojas?.();
  }
  function opCarregarOperadoresParaFiltro(){const s=document.getElementById('op-rec-filtro-operador');if(s)s.innerHTML='<option value="">Selecione um operador…</option>'+usuarios.map(u=>`<option value="${esc(u.uid||u.id)}">${esc(u.nome||u.email)}</option>`).join('');}
  function opVerificarMinhaConta(){}
  Object.assign(global,{DT_MODULOS_PERMISSOES:MODULOS,temPermissao,aplicarPermissoesAnalista,listarOperadores,opFiltrarLista,opEditarUsuario,opExcluirUsuario,opSalvarEdicao,opFecharModal,opAbrirModalCriar,opFecharModalCriar,opSetModoLojasCriar,opSetModoLojasEditar,opSelecionarTipo,opGerarUsername,opGerarSenha,toggleOpSenha,toggleOpeditSenha,opValidarUsername,opValidarSenha,criarOperador,oplSetTab,opCarregarOperadoresParaFiltro,opVerificarMinhaConta,opMarcarPermissoes});
})(window);
