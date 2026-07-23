// Configuração global de usuários e permissões por loja.
(function(global){
  'use strict';
  const raw=()=>global.getDTRawFirestore();
  const ACCESS='usuarios_acessos';
  let usuarios=[];
  let editando=null;
  let lojasCache=[];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const emailId=email=>String(email||'').trim().toLowerCase().replace(/[^a-z0-9._-]/g,'_');

  async function carregarLojas(){ lojasCache=await global.DTLoja.garantirLojaInicial(); return lojasCache; }
  function lojasLabels(ids){
    const arr=Array.isArray(ids)?ids:[];
    if(!arr.length)return '<span class="badge badge-red">Sem loja</span>';
    return arr.map(id=>{const l=lojasCache.find(x=>x.id===id);return `<span class="badge badge-blue" style="margin:2px">${esc(l?.nome||id)}</span>`;}).join('');
  }
  async function coletarUsuariosExistentes(){
    await carregarLojas();
    const mapa=new Map();
    const accessSnap=await raw().collection(ACCESS).get().catch(()=>({docs:[]}));
    accessSnap.docs.forEach(d=>{const x={id:d.id,...d.data()};mapa.set(x.uid||x.email||d.id,x);});
    for(const loja of lojasCache){
      try{
        const snap=await raw().collection('lojas').doc(loja.id).collection('dt_operadores').limit(500).get();
        snap.docs.forEach(d=>{
          const o={id:d.id,...d.data()}; const k=o.uid||o.email||d.id;
          const atual=mapa.get(k)||{};
          mapa.set(k,{...o,...atual,uid:atual.uid||o.uid||d.id,email:atual.email||o.email||'',nome:atual.nome||o.nome||o.name||'',_lojasEncontradas:[...new Set([...(atual._lojasEncontradas||[]),loja.id])]});
        });
      }catch(e){console.warn('[Usuários] Loja',loja.id,e.message);}
    }
    const atual=global._currentAnalistaUser;
    if(atual){const k=atual.uid||atual.email; if(!mapa.has(k))mapa.set(k,{uid:atual.uid,email:atual.email,nome:atual.displayName||atual.email?.split('@')[0],perfil:'analista',acesso_todas_lojas:true,lojas_permitidas:[]});}
    usuarios=[...mapa.values()].sort((a,b)=>String(a.nome||a.email).localeCompare(String(b.nome||b.email),'pt-BR'));
    return usuarios;
  }
  async function listarOperadores(){
    const wrap=document.getElementById('op-lista-wrap'); if(!wrap)return;
    wrap.innerHTML='<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando usuários…</div></div>';
    try{
      await coletarUsuariosExistentes();
      renderUsuarios();
      opCarregarOperadoresParaFiltro();
    }catch(e){wrap.innerHTML=`<div class="empty"><div class="empty-title">Erro ao carregar usuários</div><div class="empty-sub">${esc(e.message)}</div></div>`;}
  }
  function renderUsuarios(){
    const wrap=document.getElementById('op-lista-wrap'); if(!wrap)return;
    const q=String(document.getElementById('op-busca')?.value||'').toLowerCase();
    const lista=usuarios.filter(u=>`${u.nome||''} ${u.email||''} ${u.perfil||u.tipo||''}`.toLowerCase().includes(q));
    if(!lista.length){wrap.innerHTML='<div class="empty"><div class="empty-icon">👤</div><div class="empty-title">Nenhum usuário encontrado</div></div>';return;}
    wrap.innerHTML=`<div style="overflow:auto"><table><thead><tr><th>Usuário</th><th>Perfil</th><th>Lojas permitidas</th><th>Status</th><th>Ação</th></tr></thead><tbody>${lista.map((u,i)=>{
      const all=u.acesso_todas_lojas===true;
      return `<tr><td><b>${esc(u.nome||u.name||'Sem nome')}</b><div style="font-size:.72rem;color:var(--muted)">${esc(u.email||'—')}</div></td><td>${esc(u.perfil||u.tipo||'operador')}</td><td>${all?'<span class="badge badge-green">Todas as lojas</span>':lojasLabels(u.lojas_permitidas||u.lojasPermitidas)}</td><td>${u.ativo===false?'<span class="badge badge-red">Bloqueado</span>':'<span class="badge badge-green">Ativo</span>'}</td><td><button class="btn btn-primary btn-sm" onclick="opEditarUsuario(${i})">⚙️ Configurar</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function opFiltrarLista(){renderUsuarios();}
  function montarChecks(containerId, selecionadas){
    const box=document.getElementById(containerId); if(!box)return;
    const set=new Set(selecionadas||[]);
    box.innerHTML=lojasCache.map(l=>`<label style="display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid var(--border);border-radius:9px;cursor:pointer"><input type="checkbox" value="${esc(l.id)}" ${set.has(l.id)?'checked':''} style="accent-color:var(--accent)"><span>${esc(l.nome||l.id)}</span></label>`).join('');
  }
  function setModo(prefix,modo){
    document.querySelectorAll(`input[name="op-lojas-${prefix}-modo"]`).forEach(r=>r.checked=r.value===modo);
    const box=document.getElementById(`op-lojas-${prefix}-box`);if(box)box.style.display=modo==='selecionadas'?'block':'none';
  }
  function opSetModoLojasCriar(m){setModo('criar',m);}
  function opSetModoLojasEditar(m){setModo('editar',m);}
  async function opEditarUsuario(index){
    editando=usuarios[index]; if(!editando)return;
    await carregarLojas();
    document.getElementById('opedit-nome').value=editando.nome||editando.name||'';
    document.getElementById('opedit-cargo').value=editando.perfil||editando.tipo||editando.cargo||'operador';
    document.getElementById('opedit-setor').value=editando.setor||'';
    document.getElementById('opedit-senha').value='';
    const all=editando.acesso_todas_lojas===true;
    montarChecks('op-lojas-editar-lista',editando.lojas_permitidas||editando.lojasPermitidas||[]);
    opSetModoLojasEditar(all?'todas':'selecionadas');
    document.getElementById('op-modal-bg').style.display='flex';
  }
  function opFecharModal(){const el=document.getElementById('op-modal-bg');if(el)el.style.display='none';editando=null;}
  async function opSalvarEdicao(){
    if(!editando)return;
    const modo=document.querySelector('input[name="op-lojas-editar-modo"]:checked')?.value||'todas';
    const selecionadas=[...document.querySelectorAll('#op-lojas-editar-lista input:checked')].map(x=>x.value);
    if(modo==='selecionadas'&&!selecionadas.length){global.showToast?.('Selecione ao menos uma loja','error');return;}
    const uid=editando.uid||editando.id||emailId(editando.email);
    const data={uid,email:String(editando.email||'').toLowerCase(),nome:document.getElementById('opedit-nome').value.trim(),perfil:document.getElementById('opedit-cargo').value.trim()||'operador',setor:document.getElementById('opedit-setor').value.trim(),ativo:editando.ativo!==false,acesso_todas_lojas:modo==='todas',lojas_permitidas:modo==='todas'?[]:selecionadas,atualizado_em:new Date().toISOString(),atualizado_por:global._currentAnalistaUser?.email||''};
    try{
      await raw().collection(ACCESS).doc(uid).set(data,{merge:true});
      // Espelha a configuração nos cadastros operacionais já existentes.
      for(const loja of lojasCache){
        const ref=raw().collection('lojas').doc(loja.id).collection('dt_operadores').doc(uid);
        const existe=await ref.get().catch(()=>null);
        if(existe?.exists || data.acesso_todas_lojas || selecionadas.includes(loja.id)) await ref.set(data,{merge:true});
      }
      global.showToast?.('Permissões de lojas salvas','success');opFecharModal();await listarOperadores();
    }catch(e){global.showToast?.('Erro ao salvar permissões: '+e.message,'error');}
  }
  function opAbrirModalCriar(){
    carregarLojas().then(()=>{montarChecks('op-lojas-criar-lista',[]);opSetModoLojasCriar('todas');document.getElementById('op-modal-criar-bg').style.display='flex';});
  }
  function opFecharModalCriar(){document.getElementById('op-modal-criar-bg').style.display='none';}
  function opSelecionarTipo(tipo){document.querySelectorAll('input[name="op-tipo"]').forEach(r=>r.checked=r.value===tipo);}
  function opGerarUsername(){const n=document.getElementById('op-nome')?.value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/\s+/).filter(Boolean);if(n?.length>=2)document.getElementById('op-username').value=n[0]+'.'+n[n.length-1];}
  function opGerarSenha(){const s=Math.random().toString(36).slice(-4).toUpperCase()+Math.floor(1000+Math.random()*9000);document.getElementById('op-senha').value=s;}
  function toggleOpSenha(){const e=document.getElementById('op-senha');e.type=e.type==='password'?'text':'password';}
  function toggleOpeditSenha(){const e=document.getElementById('opedit-senha');e.type=e.type==='password'?'text':'password';}
  function opValidarUsername(){} function opValidarSenha(){}
  async function criarOperador(){
    const nome=document.getElementById('op-nome').value.trim(), login=document.getElementById('op-username').value.trim().toLowerCase(), senha=document.getElementById('op-senha').value;
    if(!nome||!login||senha.length<6){global.showToast?.('Preencha nome, login e senha com no mínimo 6 caracteres','error');return;}
    const email=login.includes('@')?login:login+'@daterrinhaalimentos.com.br';
    const modo=document.querySelector('input[name="op-lojas-criar-modo"]:checked')?.value||'todas';
    const selecionadas=[...document.querySelectorAll('#op-lojas-criar-lista input:checked')].map(x=>x.value);
    if(modo==='selecionadas'&&!selecionadas.length){global.showToast?.('Selecione ao menos uma loja','error');return;}
    try{
      let app;try{app=firebase.app('dt-user-admin');}catch(_){app=firebase.initializeApp(global.DT_FIREBASE_CFG,'dt-user-admin');}
      const cred=await app.auth().createUserWithEmailAndPassword(email,senha);await cred.user.updateProfile({displayName:nome});
      const tipo=document.querySelector('input[name="op-tipo"]:checked')?.value||'operador';
      const data={uid:cred.user.uid,email,nome,perfil:tipo,ativo:true,acesso_todas_lojas:modo==='todas',lojas_permitidas:modo==='todas'?[]:selecionadas,criado_em:new Date().toISOString()};
      await raw().collection(ACCESS).doc(cred.user.uid).set(data);
      for(const loja of lojasCache.filter(l=>data.acesso_todas_lojas||selecionadas.includes(l.id))) await raw().collection('lojas').doc(loja.id).collection('dt_operadores').doc(cred.user.uid).set(data,{merge:true});
      await app.auth().signOut();opFecharModalCriar();global.showToast?.('Usuário criado e permissões salvas','success');await listarOperadores();
    }catch(e){global.showToast?.('Erro ao criar usuário: '+e.message,'error');}
  }
  function oplSetTab(tab){
    const op=tab==='operadores';document.getElementById('opl-page-operadores').style.display=op?'block':'none';document.getElementById('opl-page-lojas').style.display=op?'none':'block';
    const a=document.getElementById('opl-tab-operadores'),b=document.getElementById('opl-tab-lojas');
    if(a){a.style.background=op?'var(--green,#1E6F4E)':'transparent';a.style.color=op?'#fff':'var(--muted)';}
    if(b){b.style.background=!op?'var(--green,#1E6F4E)':'transparent';b.style.color=!op?'#fff':'var(--muted)';}
    if(op)listarOperadores();else if(global.renderGestaoLojas)global.renderGestaoLojas();
  }
  function opCarregarOperadoresParaFiltro(){const s=document.getElementById('op-rec-filtro-operador');if(!s)return;s.innerHTML='<option value="">Selecione um operador…</option>'+usuarios.map(u=>`<option value="${esc(u.uid||u.id)}">${esc(u.nome||u.email)}</option>`).join('');}
  function opVerificarMinhaConta(){}

  Object.assign(global,{listarOperadores,opFiltrarLista,opEditarUsuario,opSalvarEdicao,opFecharModal,opAbrirModalCriar,opFecharModalCriar,opSetModoLojasCriar,opSetModoLojasEditar,opSelecionarTipo,opGerarUsername,opGerarSenha,toggleOpSenha,toggleOpeditSenha,opValidarUsername,opValidarSenha,criarOperador,oplSetTab,opCarregarOperadoresParaFiltro,opVerificarMinhaConta});
})(window);
