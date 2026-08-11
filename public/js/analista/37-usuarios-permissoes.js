// Usuários, canais de acesso e autorização detalhada por módulo.
(function(global){
  'use strict';
  const raw=()=>global.getDTRawFirestore();
  const ACCESS='usuarios_acessos';
  let usuarios=[],editando=null,editandoIndice=-1,lojasCache=[];
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
    {id:'importar-exportar',nome:'Importar / Exportar / API',acoes:['visualizar','importar','exportar','configurar','executar','excluir']},
    {id:'producao-dashboard',nome:'Produção · Dashboard',acoes:['visualizar']},
    {id:'producao-ficha-tecnica',nome:'Produção · Ficha Técnica',acoes:['visualizar','criar','editar','excluir']},
    {id:'producao-maquinas',nome:'Produção · Máquinas',acoes:['visualizar','criar','editar','excluir']},
    {id:'producao-programacao',nome:'Produção · Programação',acoes:['visualizar','criar','editar','excluir']},
    {id:'producao-gantt',nome:'Produção · Gantt',acoes:['visualizar','editar','reordenar']},
    {id:'producao-realizado',nome:'Produção · Realizado',acoes:['visualizar','editar']},
    {id:'producao-insumos',nome:'Produção · Insumos',acoes:['visualizar']},
    {id:'producao-projecao',nome:'Produção · Projeção',acoes:['visualizar','criar','editar','excluir']},
    {id:'producao-prog-automatica',nome:'Produção · Prog. Automática',acoes:['visualizar','executar']},
    {id:'producao-funcionarios',nome:'Produção · Funcionários',acoes:['visualizar','criar','editar','excluir']},
    {id:'producao-relatorios',nome:'Produção · Relatórios',acoes:['visualizar']},
    {id:'producao-setup',nome:'Produção · Tempos de Setup',acoes:['visualizar','criar','editar','excluir']},
    {id:'producao-mapa-fabrica',nome:'Produção · Mapa da Fábrica',acoes:['visualizar']},
    {id:'producao-estoque',nome:'Produção · Estoque (Bluesoft)',acoes:['visualizar']}
  ];
  const ROTULOS={visualizar:'Visualizar',criar:'Criar',editar:'Editar',excluir:'Excluir',importar:'Importar',exportar:'Exportar',publicar:'Liberar/Publicar',finalizar:'Finalizar',atualizar:'Atualizar',aprovar:'Aprovar',bloquear:'Bloquear',configurar:'Configurar',executar:'Executar/Enviar',reordenar:'Reordenar'};
  const MODULO_ICONES={dashboard:'📊',inventarios:'📦',acompanhamento:'📈',auditoria:'🕵️',contagens:'🔢',pendencias:'⏳',recontagens:'🔁','rel-divergencias':'⚠️','capas-duplicadas':'🧾',produtividade:'🏆',enderecos:'📍',produtos:'🏷️',coletores:'📱',operadores:'👤',lojas:'🏪',rastreabilidade:'🔍','importar-exportar':'🔄','producao-dashboard':'📊','producao-ficha-tecnica':'🏭','producao-maquinas':'⚙️','producao-programacao':'📋','producao-gantt':'📅','producao-realizado':'✅','producao-insumos':'🧪','producao-projecao':'📈','producao-prog-automatica':'🤖','producao-funcionarios':'👷','producao-relatorios':'📊','producao-setup':'🔧','producao-mapa-fabrica':'🗺️','producao-estoque':'📦'};
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
  function renderUsuarios(){
    const w=document.getElementById('op-lista-wrap');
    if(!w)return;
    const q=String(document.getElementById('op-busca')?.value||'').toLowerCase();
    const perfil=String(document.getElementById('op-filtro-perfil')?.value||'');
    const status=String(document.getElementById('op-filtro-status')?.value||'');
    const lista=usuarios.map((u,i)=>({...u,_indiceOriginal:i})).filter(u=>{
      const texto=`${u.nome||''} ${u.email||''} ${u.email_analista||''} ${u.email_coletor||''} ${u.login_coletor||''} ${u.perfil||''}`.toLowerCase();
      const p=String(u.perfil||u.tipo||'operador').toLowerCase();
      const ehAdmin=u.admin_mestre===true||u.administrador_mestre===true||p==='administrador'||p==='admin';
      const perfilOk=!perfil||(perfil==='administrador'?ehAdmin:perfil==='analista'?(p==='analista'&&!ehAdmin):(p==='operador'&&!ehAdmin));
      const statusOk=!status||(status==='ativo'?u.ativo!==false:u.ativo===false);
      return texto.includes(q)&&perfilOk&&statusOk;
    });
    global.DTAtualizarResumoUsuarios?.(usuarios,lista.length);
    if(!lista.length){w.innerHTML='<div class="empty"><div class="empty-title">Nenhum usuário encontrado</div></div>';return;}
    w.innerHTML=`<div class="tbl-wrap op-lista-linhas"><table>
      <thead><tr><th>Usuário</th><th>Login</th><th>Acesso</th><th>Lojas</th><th>Status</th><th style="width:74px;text-align:center">Ações</th></tr></thead>
      <tbody>${lista.map(u=>{
        const loginPrincipal=u.email_analista||u.email||'—';
        const loginColetor=u.login_coletor||String(u.email_coletor||'').split('@')[0]||'—';
        return `<tr>
          <td><div style="display:flex;align-items:center;gap:10px"><div class="u-avatar" style="width:32px;height:32px;font-size:.75rem;flex:0 0 auto">${esc((u.nome||u.email||'?').charAt(0).toUpperCase())}</div><div><div style="font-weight:750">${esc(u.nome||u.name||'Sem nome')}</div><div style="font-size:.68rem;color:var(--muted)">${esc(u.setor||u.perfil||'Usuário')}</div></div></div></td>
          <td><div style="font-size:.74rem">${esc(loginPrincipal)}</div><div style="font-size:.68rem;color:var(--muted)">Coletor: ${esc(loginColetor)}</div></td>
          <td>${esc(canais(u))}</td>
          <td>${u.acesso_todas_lojas===true?'<span class="badge badge-green">Todas</span>':lojasLabels(u.lojas_permitidas||u.lojasPermitidas)}</td>
          <td>${u.ativo===false?'<span class="badge badge-red">Bloqueado</span>':'<span class="badge badge-green">Ativo</span>'}</td>
          <td style="text-align:center"><button class="acao-lapis" type="button" title="Configurar usuário" aria-label="Configurar usuário" data-usuario-editar="${u._indiceOriginal}">✏️</button></td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }
  function opFiltrarLista(){renderUsuarios();}
  function montarChecks(id,sel){const b=document.getElementById(id);if(!b)return;const s=new Set(sel||[]);b.innerHTML=lojasCache.map(l=>`<label style="display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid var(--border);border-radius:9px;cursor:pointer"><input type="checkbox" value="${esc(l.id)}" ${s.has(l.id)?'checked':''}><span>${esc(l.nome||l.id)}</span></label>`).join('');}
  function setModo(p,m){document.querySelectorAll(`input[name="op-lojas-${p}-modo"]`).forEach(r=>r.checked=r.value===m);const b=document.getElementById(`op-lojas-${p}-box`);if(b)b.style.display=m==='selecionadas'?'block':'none';}
  function renderCanais(prefix,c={}){const b=document.getElementById(`op-canais-${prefix}`);if(!b)return;b.innerHTML=[['coletor','📱 Coletor'],['analista','🖥️ Analista']].map(([id,n])=>`<label style="padding:10px 13px;border:1px solid var(--border);border-radius:10px;cursor:pointer"><input type="checkbox" data-canal="${id}" ${c[id]===true?'checked':''}> ${n}</label>`).join('');b.querySelector('[data-canal="analista"]')?.addEventListener('change',e=>{const p=document.getElementById(`op-permissoes-${prefix}`);if(p)p.style.display=e.target.checked?'block':'none';});}
  // Setores: fase 1 da unificação com o Sistema de Produção — controla só
  // quais abas de topo (Logística/Compras/PCP/Produção) aparecem pro login;
  // dentro de cada setor, os módulos continuam filtrados pelas permissões
  // de sempre (renderPermissoes/temPermissao), sem mudança nessa mecânica.
  // Logística vem marcada por padrão (undefined !== false) pra ninguém
  // perder acesso ao que já usa hoje.
  var SETORES=[['logistica','🚚 Logística'],['compras','🛒 Compras'],['pcp','📋 PCP'],['producao','🏭 Produção']];
  function renderSetores(prefix,s={}){const b=document.getElementById(`op-setores-${prefix}`);if(!b)return;b.innerHTML=SETORES.map(([id,n])=>`<label style="padding:10px 13px;border:1px solid var(--border);border-radius:10px;cursor:pointer"><input type="checkbox" data-setor="${id}" ${(id==='logistica'?s[id]!==false:s[id]===true)?'checked':''}> ${n}</label>`).join('');}
  function lerSetores(prefix){const o={logistica:false,compras:false,pcp:false,producao:false};document.querySelectorAll(`#op-setores-${prefix} [data-setor]`).forEach(x=>o[x.dataset.setor]=x.checked);return o;}
  function renderPermissoes(prefix,p){
    const b=document.getElementById(`op-permissoes-${prefix}`);if(!b)return;
    const perms=normalizar(p,false);
    const totalGeral=MODULOS.reduce((a,m)=>a+m.acoes.length,0);
    const marcadosGeral=MODULOS.reduce((a,m)=>a+m.acoes.filter(ac=>perms[m.id]?.[ac]===true).length,0);
    const cartoes=MODULOS.map(m=>{
      const marcados=m.acoes.filter(a=>perms[m.id]?.[a]===true).length;
      const todas=marcados===m.acoes.length, nenhuma=marcados===0;
      const busca=esc((m.nome+' '+m.acoes.map(a=>ROTULOS[a]).join(' ')).toLowerCase());
      return `<div class="perm-card" data-perm-card data-perm-busca="${busca}">
        <div class="perm-card-hdr">
          <label class="perm-card-toggle">
            <input type="checkbox" data-modulo-all="${m.id}" ${todas?'checked':''} onchange="opMarcarModulo('${prefix}','${m.id}',this.checked)">
            <span class="perm-card-icon">${MODULO_ICONES[m.id]||'▫️'}</span>
            <span class="perm-card-name">${esc(m.nome)}</span>
          </label>
          <span class="perm-card-count ${todas?'is-complete':nenhuma?'is-empty':'is-partial'}" data-contagem-modulo="${m.id}">${marcados} de ${m.acoes.length}</span>
        </div>
        <div class="perm-card-body">${m.acoes.map(a=>`<label class="perm-chip"><input type="checkbox" data-modulo="${m.id}" data-acao="${a}" ${perms[m.id]?.[a]===true?'checked':''} onchange="opAtualizarContagemModulo('${prefix}','${m.id}')"> ${ROTULOS[a]}</label>`).join('')}</div>
      </div>`;
    }).join('');
    b.innerHTML=`<div class="perm-toolbar">
      <input type="text" class="perm-busca" placeholder="🔍 Buscar módulo ou permissão..." oninput="opFiltrarPermissoes('${prefix}',this.value)">
      <span class="perm-total-geral" data-contagem-geral="${prefix}">${marcadosGeral} de ${totalGeral} selecionadas</span>
      <button type="button" class="btn btn-ghost btn-sm" onclick="opMarcarPermissoes('${prefix}',true)">✓ Marcar tudo</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick="opMarcarPermissoes('${prefix}',false)">✕ Limpar tudo</button>
    </div>
    <div class="perm-grid" data-perm-grid="${prefix}">${cartoes}</div>
    <div class="perm-vazio" data-perm-vazio="${prefix}" style="display:none">Nenhuma permissão encontrada para essa busca.</div>`;
    MODULOS.forEach(m=>_permAtualizarIndeterminado(prefix,m.id));
  }
  function _permAtualizarContagemGeral(prefix){
    const box=document.getElementById(`op-permissoes-${prefix}`);if(!box)return;
    const checks=[...box.querySelectorAll('[data-modulo]')];
    const marcados=checks.filter(x=>x.checked).length;
    const el=box.querySelector(`[data-contagem-geral="${prefix}"]`);if(el)el.textContent=`${marcados} de ${checks.length} selecionadas`;
  }
  function _permAtualizarIndeterminado(prefix,moduloId){
    const box=document.getElementById(`op-permissoes-${prefix}`);if(!box)return;
    const checks=[...box.querySelectorAll(`[data-modulo="${moduloId}"]`)];
    const marcados=checks.filter(x=>x.checked).length, total=checks.length;
    const contagem=box.querySelector(`[data-contagem-modulo="${moduloId}"]`);
    if(contagem){contagem.textContent=`${marcados} de ${total}`;contagem.className='perm-card-count '+(marcados===total?'is-complete':marcados===0?'is-empty':'is-partial');}
    const todas=box.querySelector(`[data-modulo-all="${moduloId}"]`);
    if(todas){todas.checked=total>0&&marcados===total;todas.indeterminate=marcados>0&&marcados<total;}
  }
  function opFiltrarPermissoes(prefix,termo){
    const grid=document.querySelector(`[data-perm-grid="${prefix}"]`);if(!grid)return;
    const t=String(termo||'').trim().toLowerCase();
    let visiveis=0;
    grid.querySelectorAll('[data-perm-card]').forEach(card=>{
      const ok=!t||(card.dataset.permBusca||'').includes(t);
      card.style.display=ok?'':'none';
      if(ok)visiveis++;
    });
    const vazio=document.querySelector(`[data-perm-vazio="${prefix}"]`);if(vazio)vazio.style.display=visiveis?'none':'block';
  }
  function opAtualizarContagemModulo(prefix,moduloId){
    _permAtualizarIndeterminado(prefix,moduloId);
    _permAtualizarContagemGeral(prefix);
  }
  function opMarcarModulo(prefix,moduloId,valor){
    document.querySelectorAll(`#op-permissoes-${prefix} [data-modulo="${moduloId}"]`).forEach(x=>x.checked=valor);
    opAtualizarContagemModulo(prefix,moduloId);
  }
  function opMarcarPermissoes(prefix,v){
    document.querySelectorAll(`#op-permissoes-${prefix} [data-modulo]`).forEach(x=>x.checked=v);
    MODULOS.forEach(m=>_permAtualizarIndeterminado(prefix,m.id));
    _permAtualizarContagemGeral(prefix);
  }
  function lerCanais(prefix){const o={coletor:false,analista:false};document.querySelectorAll(`#op-canais-${prefix} [data-canal]`).forEach(x=>o[x.dataset.canal]=x.checked);return o;}
  function lerPermissoes(prefix){const p={};MODULOS.forEach(m=>p[m.id]={});document.querySelectorAll(`#op-permissoes-${prefix} [data-modulo]`).forEach(x=>p[x.dataset.modulo][x.dataset.acao]=x.checked);return p;}
  function validarAcesso(prefix){const c=lerCanais(prefix);if(!c.coletor&&!c.analista){global.showToast?.('Libere Coletor e/ou Analista','error');return false;}if(c.analista&&!MODULOS.some(m=>lerPermissoes(prefix)[m.id]?.visualizar)){global.showToast?.('Libere ao menos uma aba do Analista','error');return false;}return true;}
  function opSetModoLojasCriar(m){setModo('criar',m);}function opSetModoLojasEditar(m){setModo('editar',m);}
  async function opEditarUsuario(i){editando=usuarios[i];editandoIndice=i;if(!editando)return;await carregarLojas();document.getElementById('opedit-nome').value=editando.nome||editando.name||'';document.getElementById('opedit-cargo').value=editando.perfil||editando.tipo||'operador';document.getElementById('opedit-setor').value=editando.setor||'';document.getElementById('opedit-senha').value='';montarChecks('op-lojas-editar-lista',editando.lojas_permitidas||[]);setModo('editar',editando.acesso_todas_lojas===true?'todas':'selecionadas');const legadoAnalista=editando.perfil==='analista'&&!editando.canais_acesso;renderCanais('editar',editando.canais_acesso||{coletor:true,analista:legadoAnalista});renderSetores('editar',editando.setores_permitidos||{});renderPermissoes('editar',normalizar(editando.permissoes,legadoAnalista));document.getElementById('op-permissoes-editar').style.display=(editando.canais_acesso?.analista===true||legadoAnalista)?'block':'none';const btnExcluir=document.getElementById('btn-excluir-oped');if(btnExcluir)btnExcluir.style.display=usuarioProtegido(editando)?'none':'inline-flex';document.getElementById('op-modal-bg').style.display='flex';}
  function opFecharModal(){document.getElementById('op-modal-bg').style.display='none';editando=null;editandoIndice=-1;}
  async function opExcluirUsuarioAtual(){if(editandoIndice<0)return;const indice=editandoIndice;opFecharModal();await opExcluirUsuario(indice);}
  async function opSalvarEdicao(){if(!editando||!validarAcesso('editar'))return;const modo=document.querySelector('input[name="op-lojas-editar-modo"]:checked')?.value||'todas',sel=[...document.querySelectorAll('#op-lojas-editar-lista input:checked')].map(x=>x.value);if(modo==='selecionadas'&&!sel.length)return global.showToast?.('Selecione ao menos uma loja','error');const uid=editando.uid||editando.id||emailId(editando.email),c=lerCanais('editar'),novaSenha=document.getElementById('opedit-senha').value,data={uid,email:String(editando.email||'').toLowerCase(),nome:document.getElementById('opedit-nome').value.trim(),perfil:c.analista?'analista':'operador',setor:document.getElementById('opedit-setor').value.trim(),ativo:editando.ativo!==false,canais_acesso:c,setores_permitidos:lerSetores('editar'),permissoes:lerPermissoes('editar'),acesso_todas_lojas:modo==='todas',lojas_permitidas:modo==='todas'?[]:sel,atualizado_em:new Date().toISOString(),atualizado_por:global._currentAnalistaUser?.email||''};if(novaSenha&&(novaSenha.length<8||!/\\d/.test(novaSenha)||!/[A-Za-z]/.test(novaSenha)))return global.showToast?.('A nova senha deve ter no mínimo 8 caracteres, com letras e números','error');try{if(novaSenha){if(!temPermissao('operadores','editar'))throw new Error('Seu login não possui permissão para alterar senhas');const callable=firebase.app().functions('southamerica-east1').httpsCallable('alterarSenhaUsuario'),uids=[uid,editando.analista_uid,editando.coletor_uid,...(editando.uids_vinculados||[])].filter(Boolean);await callable({uids:[...new Set(uids)],senha:novaSenha});}await raw().collection(ACCESS).doc(uid).set(data,{merge:true});for(const l of lojasCache){for(const alvoUid of [...new Set([uid,editando.coletor_uid].filter(Boolean))]){const ref=raw().collection('lojas').doc(l.id).collection('dt_operadores').doc(alvoUid),ex=await ref.get().catch(()=>null);if(ex?.exists||data.acesso_todas_lojas||sel.includes(l.id))await ref.set({...data,uid:alvoUid,conta_secundaria:alvoUid!==uid},{merge:true});}}global.showToast?.(novaSenha?'Acessos e nova senha salvos':'Acessos e permissões salvos','success');opFecharModal();await listarOperadores();}catch(e){global.showToast?.('Erro ao salvar: '+(e?.message||e),'error');}}
  function opAbrirModalCriar(){carregarLojas().then(()=>{montarChecks('op-lojas-criar-lista',[]);setModo('criar','todas');renderCanais('criar',{coletor:true,analista:false});renderSetores('criar',{});renderPermissoes('criar',{});document.getElementById('op-permissoes-criar').style.display='none';document.getElementById('op-modal-criar-bg').style.display='flex';});}
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
      const c=lerCanais('criar'),agora=new Date().toISOString(),uids=[auth.uid,auth.coletor_uid].filter(Boolean),data={uid:auth.uid,analista_uid:auth.analista_uid||null,coletor_uid:auth.coletor_uid,uids_vinculados:[...new Set(uids)],email:tipo==='analista'?logins.analista:logins.coletorEmail,email_analista:tipo==='analista'?logins.analista:'',email_coletor:logins.coletorEmail,login_coletor:logins.coletor,nome,perfil:c.analista?'analista':'operador',ativo:true,canais_acesso:c,setores_permitidos:lerSetores('criar'),permissoes:lerPermissoes('criar'),acesso_todas_lojas:modo==='todas',lojas_permitidas:modo==='todas'?[]:sel,atualizado_em:agora};
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
  // ── Setores (fase 1 da unificação com o Sistema de Produção) ──────────
  // Barra de abas no topo (Logística/Compras/PCP/Produção). Logística é o
  // Inventário de hoje, sem mudança nenhuma — só reclassificado como um
  // setor. Compras/PCP/Produção, nesta fase, são só um placeholder "em
  // construção"; os módulos reais entram nas próximas fases, um por vez.
  var SETORES_INFO={
    logistica:{label:'🚚 Logística',icone:'🚚',titulo:'Logística'},
    compras:{label:'🛒 Compras',icone:'🛒',titulo:'Compras'},
    pcp:{label:'📋 PCP',icone:'📋',titulo:'PCP'},
    producao:{label:'🏭 Produção',icone:'🏭',titulo:'Produção'}
  };
  var _setorAtual='logistica';
  function irParaSetor(id){
    if(!SETORES_INFO[id])return;
    _setorAtual=id;
    document.querySelectorAll('#setor-bar button').forEach(function(b){
      var ativo=b.id==='setor-btn-'+id;
      b.style.borderBottomColor=ativo?'var(--accent)':'transparent';
      b.style.color=ativo?'#fff':'rgba(255,255,255,.65)';
    });
    var logisticaEl=document.getElementById('app-main-logistica'),placeholder=document.getElementById('setor-placeholder'),producaoShell=document.getElementById('setor-producao-shell');
    if(logisticaEl)logisticaEl.style.display=id==='logistica'?'flex':'none';
    if(producaoShell)producaoShell.style.display=id==='producao'?'flex':'none';
    if(id==='logistica'||id==='producao'){
      if(placeholder)placeholder.style.display='none';
      if(id==='producao'&&!document.querySelector('#setor-producao-shell .page.on')){
        if(temPermissao('producao-dashboard','visualizar'))goPage('producao-dashboard',document.getElementById('nav-producao-dashboard'));
        else if(temPermissao('producao-ficha-tecnica','visualizar'))goPage('producao-ficha-tecnica',document.getElementById('nav-producao-ficha-tecnica'));
        else if(temPermissao('producao-maquinas','visualizar'))goPage('producao-maquinas',document.getElementById('nav-producao-maquinas'));
        else if(temPermissao('producao-programacao','visualizar'))goPage('producao-programacao',document.getElementById('nav-producao-programacao'));
        else if(temPermissao('producao-gantt','visualizar'))goPage('producao-gantt',document.getElementById('nav-producao-gantt'));
        else if(temPermissao('producao-realizado','visualizar'))goPage('producao-realizado',document.getElementById('nav-producao-realizado'));
        else if(temPermissao('producao-insumos','visualizar'))goPage('producao-insumos',document.getElementById('nav-producao-insumos'));
        else if(temPermissao('producao-projecao','visualizar'))goPage('producao-projecao',document.getElementById('nav-producao-projecao'));
        else if(temPermissao('producao-prog-automatica','visualizar'))goPage('producao-prog-automatica',document.getElementById('nav-producao-prog-automatica'));
        else if(temPermissao('producao-funcionarios','visualizar'))goPage('producao-funcionarios',document.getElementById('nav-producao-funcionarios'));
        else if(temPermissao('producao-relatorios','visualizar'))goPage('producao-relatorios',document.getElementById('nav-producao-relatorios'));
        else if(temPermissao('producao-setup','visualizar'))goPage('producao-setup',document.getElementById('nav-producao-setup'));
        else if(temPermissao('producao-mapa-fabrica','visualizar'))goPage('producao-mapa-fabrica',document.getElementById('nav-producao-mapa-fabrica'));
        else if(temPermissao('producao-estoque','visualizar'))goPage('producao-estoque',document.getElementById('nav-producao-estoque'));
        else{var pg=document.getElementById('page-producao-ficha-tecnica');if(pg){pg.innerHTML='<div class="empty"><div class="empty-icon">🔒</div><div class="empty-title">Sem módulos liberados neste setor ainda</div></div>';pg.classList.add('on');}}
      }
    }else{
      if(placeholder){
        placeholder.style.display='flex';
        var info=SETORES_INFO[id];
        var elIcone=document.getElementById('setor-placeholder-icone'),elTitulo=document.getElementById('setor-placeholder-titulo');
        if(elIcone)elIcone.textContent=info.icone;
        if(elTitulo)elTitulo.textContent=info.titulo;
      }
    }
  }
  function aplicarSetoresPermitidos(){
    var a=global.DT_USUARIO_ACESSO_ATUAL;if(!a)return;
    var admin=a.admin_mestre===true||a.administrador_mestre===true||a.perfil==='administrador';
    var setores=a.setores_permitidos||{};
    var idsLiberados=Object.keys(SETORES_INFO).filter(function(id){
      return admin||(id==='logistica'?setores.logistica!==false:setores[id]===true);
    });
    var bar=document.getElementById('setor-bar');if(!bar)return;
    if(idsLiberados.length<=1){bar.style.display='none';irParaSetor('logistica');return;}
    bar.innerHTML=idsLiberados.map(function(id){
      return '<button type="button" id="setor-btn-'+id+'" data-setor="'+id+'" style="background:transparent;border:none;color:rgba(255,255,255,.65);padding:12px 16px;font-size:.82rem;font-weight:700;cursor:pointer;border-bottom:3px solid transparent">'+SETORES_INFO[id].label+'</button>';
    }).join('');
    bar.style.display='flex';
    irParaSetor(idsLiberados.includes(_setorAtual)?_setorAtual:'logistica');
  }
  global.irParaSetor=irParaSetor;
  global.aplicarSetoresPermitidos=aplicarSetoresPermitidos;
  // data-setor + escutador delegado (em vez de onclick inline): o botão da
  // barra de Setores é gerado via innerHTML, e onclick injetado assim não
  // dispara em alguns navegadores/extensões — mesmo motivo pelo qual o
  // resto deste arquivo já usa data-usuario-editar + addEventListener em
  // vez de onclick pra linhas geradas dinamicamente.
  document.addEventListener('click',function(event){
    const botao=event.target.closest('[data-setor]');
    if(!botao)return;
    irParaSetor(botao.dataset.setor);
  });

  let timerPermissoes=null;
  document.addEventListener('DOMContentLoaded',function(){
    new MutationObserver(function(){
      if(!global.DT_USUARIO_ACESSO_ATUAL?.permissoes)return;
      clearTimeout(timerPermissoes);
      timerPermissoes=setTimeout(aplicarPermissoesAnalista,40);
    }).observe(document.body,{childList:true,subtree:true});
  });
  // Fase de captura (mesmo padrão usado em Gestão de Lojas): garante o clique
  // mesmo se algum outro componente interromper a propagação no bubbling.
  document.addEventListener('click',function(event){
    const botao=event.target.closest('[data-usuario-editar]');
    if(!botao)return;
    event.preventDefault();
    event.stopPropagation();
    if(typeof event.stopImmediatePropagation==='function')event.stopImmediatePropagation();
    const indice=Number(botao.getAttribute('data-usuario-editar'));
    if(Number.isInteger(indice))opEditarUsuario(indice);
  },true);

  function oplSetTab(){
    const pageOp=document.getElementById('opl-page-operadores');
    if(pageOp)pageOp.style.display='block';
    listarOperadores();
  }
  function opCarregarOperadoresParaFiltro(){const s=document.getElementById('op-rec-filtro-operador');if(s)s.innerHTML='<option value="">Selecione um operador…</option>'+usuarios.map(u=>`<option value="${esc(u.uid||u.id)}">${esc(u.nome||u.email)}</option>`).join('');}
  function opVerificarMinhaConta(){}
  Object.assign(global,{DT_MODULOS_PERMISSOES:MODULOS,temPermissao,aplicarPermissoesAnalista,listarOperadores,opFiltrarLista,opEditarUsuario,opExcluirUsuario,opExcluirUsuarioAtual,opSalvarEdicao,opFecharModal,opAbrirModalCriar,opFecharModalCriar,opSetModoLojasCriar,opSetModoLojasEditar,opSelecionarTipo,opGerarUsername,opGerarSenha,toggleOpSenha,toggleOpeditSenha,opValidarUsername,opValidarSenha,criarOperador,oplSetTab,opCarregarOperadoresParaFiltro,opVerificarMinhaConta,opMarcarPermissoes,opMarcarModulo,opAtualizarContagemModulo,opFiltrarPermissoes});
})(window);
