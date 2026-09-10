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

  // `setor`/`canais` (correção estrutural — reforma da tela de Usuários e
  // Permissões): `setor` é mecânico, a partir do agrupamento por prefixo
  // que já existia informalmente (sem-prefixo + recebimento-* → logística,
  // producao-* → produção, pcp-*/compras-* → seus próprios setores).
  // `canais` NÃO é suposição — é auditoria real contra firestore.rules:
  // grep por `canUseColetor()`/`hasPermissionColetorRecebimento`/
  // `hasPermissionRecebimentoQualquerCanal(NaLoja)` mostra que o Coletor
  // toca várias coleções (dt_contagens, dt_auditorias_coletor, etc.), mas
  // SEM checar a permissão fina do catálogo — é liberado por CANAL
  // (canUseColetor() sozinho, incondicional), então marcar/desmarcar essas
  // permissões pra uma conta só-Coletor não muda nada de verdade. As ÚNICAS
  // áreas onde a permissão fina do catálogo realmente controla o que o
  // Coletor pode fazer são recebimento-operacao/recebimento-transbordo
  // (via hasPermissionColetorRecebimento/hasPermissionRecebimentoQualquerCanal*)
  // — só essas duas ganham `canais:['analista','coletor']`; o resto fica
  // ['analista'] (comportamento atual preservado, sem prometer um controle
  // que as regras não têm).
  const MODULOS=[
    {id:'dashboard',nome:'Dashboard',setor:'logistica',canais:['analista'],acoes:['visualizar','atualizar']},
    {id:'inventarios',nome:'Inventários',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar','exportar','publicar','finalizar']},
    {id:'acompanhamento',nome:'Acompanhamento',setor:'logistica',canais:['analista'],acoes:['visualizar','atualizar','exportar']},
    {id:'auditoria',nome:'Auditoria',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar','exportar','publicar','finalizar']},
    {id:'contagens',nome:'Contagens',setor:'logistica',canais:['analista'],acoes:['visualizar','editar','excluir','exportar']},
    {id:'pendencias',nome:'Pendências',setor:'logistica',canais:['analista'],acoes:['visualizar','editar','exportar']},
    {id:'recontagens',nome:'Recontagem',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir','exportar']},
    {id:'rel-divergencias',nome:'Relatório de Conflitos',setor:'logistica',canais:['analista'],acoes:['visualizar','exportar']},
    {id:'capas-duplicadas',nome:'Capas Duplicadas',setor:'logistica',canais:['analista'],acoes:['visualizar','editar','excluir','exportar']},
    {id:'produtividade',nome:'Produtividade',setor:'logistica',canais:['analista'],acoes:['visualizar','exportar']},
    {id:'enderecos',nome:'Endereços',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar','exportar']},
    {id:'produtos',nome:'Produtos',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar','exportar','atualizar']},
    {id:'coletores',nome:'Coletores',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir','aprovar','bloquear']},
    {id:'operadores',nome:'Usuários e Permissões',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir']},
    {id:'lojas',nome:'Lojas',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar']},
    {id:'rastreabilidade',nome:'Rastreabilidade',setor:'logistica',canais:['analista'],acoes:['visualizar','excluir','exportar']},
    {id:'importar-exportar',nome:'Importar / Exportar / API',setor:'logistica',canais:['analista'],acoes:['visualizar','importar','exportar','configurar','executar','excluir']},
    {id:'producao-dashboard',nome:'Produção · Dashboard',setor:'producao',canais:['analista'],acoes:['visualizar']},
    {id:'producao-ficha-tecnica',nome:'Produção · Ficha Técnica',setor:'producao',canais:['analista'],acoes:['visualizar','criar','editar','excluir']},
    {id:'producao-maquinas',nome:'Produção · Máquinas',setor:'producao',canais:['analista'],acoes:['visualizar','criar','editar','excluir']},
    {id:'producao-programacao',nome:'Produção · Programação',setor:'producao',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar']},
    {id:'producao-gantt',nome:'Produção · Gantt',setor:'producao',canais:['analista'],acoes:['visualizar','editar','reordenar','exportar']},
    {id:'producao-realizado',nome:'Produção · Realizado',setor:'producao',canais:['analista'],acoes:['visualizar','editar','finalizar','liberar','resetar','importar','exportar']},
    {id:'producao-insumos',nome:'Produção · Insumos',setor:'producao',canais:['analista'],acoes:['visualizar','editar','importar','exportar']},
    {id:'producao-projecao',nome:'Produção · Projeção',setor:'producao',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar','exportar']},
    {id:'producao-prog-automatica',nome:'Produção · Prog. Automática',setor:'producao',canais:['analista'],acoes:['visualizar','executar']},
    {id:'producao-funcionarios',nome:'Produção · Funcionários',setor:'producao',canais:['analista'],acoes:['visualizar','criar','editar','excluir']},
    {id:'producao-relatorios',nome:'Produção · Relatórios',setor:'producao',canais:['analista'],acoes:['visualizar','exportar']},
    {id:'producao-setup',nome:'Produção · Tempos de Setup',setor:'producao',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar','exportar']},
    {id:'producao-mapa-fabrica',nome:'Produção · Mapa da Fábrica',setor:'producao',canais:['analista'],acoes:['visualizar']},
    {id:'producao-config',nome:'Produção · Configurações',setor:'producao',canais:['analista'],acoes:['visualizar','editar']},
    {id:'producao-importacao',nome:'Produção · Importação / API',setor:'producao',canais:['analista'],acoes:['visualizar','importar','exportar','configurar']},
    {id:'producao-estoque',nome:'Produção · Estoque (Bluesoft)',setor:'producao',canais:['analista'],acoes:['visualizar']},
    {id:'producao-relatorios-bi',nome:'Produção · Relatórios BI (Compras/PCP/Produção)',setor:'producao',canais:['analista'],acoes:['visualizar','exportar']},
    {id:'pcp-central',nome:'PCP · Central de Planejamento',setor:'pcp',canais:['analista'],acoes:['visualizar','criar','editar','excluir','configurar']},
    {id:'compras-central',nome:'Compras · Central de Compras',setor:'compras',canais:['analista'],acoes:['visualizar','editar','configurar']},
    // Recebimento operacional — módulos do setor, incluindo Recusas dentro de Recebimento.
    // "Tempos/Performance" reaproveita a permissão do
    // Dashboard e "Histórico" a de Recebimentos, por serem visões de
    // leitura dos mesmos dados, não módulos com escrita própria.
    {id:'recebimento-dashboard',nome:'Recebimento · Dashboard',setor:'logistica',canais:['analista'],acoes:['visualizar']},
    {id:'recebimento-operacao',nome:'Recebimento · Recebimentos',setor:'logistica',canais:['analista','coletor'],acoes:['visualizar','criar','editar','cancelar','finalizar','corrigir-horario','gerar-qrcode','exportar','excluir']},
    {id:'recebimento-notas',nome:'Recebimento · Notas Fiscais',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar','exportar']},
    {id:'recebimento-fornecedores',nome:'Recebimento · Fornecedores',setor:'logistica',canais:['analista'],acoes:['visualizar','editar','exportar']},
    {id:'recebimento-agendamentos',nome:'Recebimento · Agenda / Cargas',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir']},
    {id:'recebimento-transbordo',nome:'Recebimento · Transbordo',setor:'logistica',canais:['analista','coletor'],acoes:['visualizar','criar','editar','cancelar','finalizar','corrigir-horario','gerar-qrcode','excluir']},
    {id:'recebimento-paletes',nome:'Recebimento · Paletes',setor:'logistica',canais:['analista','coletor'],acoes:['visualizar','criar','editar','excluir']},
    {id:'recebimento-patio-tempo-real',nome:'Recebimento · Pátio em Tempo Real',setor:'logistica',canais:['analista'],acoes:['visualizar']},
    {id:'recebimento-recusas',nome:'Recebimento · Notas Retornadas',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir','importar','exportar']},
    {id:'recebimento-retornos-indicadores',nome:'Recebimento · Indicadores de Retornos',setor:'logistica',canais:['analista'],acoes:['visualizar']},
    // Só "visualizar" — quem PODE avançar uma etapa é governado pela MESMA
    // permissão 'editar' de recebimento-recusas (mesmo dado, mesma tela de
    // origem), não uma ação granular nova — decisão do plano desta feature,
    // pra não repetir o estouro de orçamento de sub-expressões do rules já
    // sofrido duas vezes neste projeto com múltiplas permissões pro mesmo
    // registro. Checado manualmente em 99-recebimento-retornos-status.js.
    {id:'recebimento-retornos-status',nome:'Recebimento · Status de Retornos',setor:'logistica',canais:['analista'],acoes:['visualizar']},
    {id:'recebimento-recusas-indicadores',nome:'Recebimento · Recusas',setor:'logistica',canais:['analista'],acoes:['visualizar']},
    {id:'recebimento-consulta-notas',nome:'Recebimento · Consulta de Notas Fiscais',setor:'logistica',canais:['analista'],acoes:['visualizar','importar','exportar']},
    // Pedido ao vivo do usuário: "as partes de cadastro da parte de
    // recebimento fazer em um menu só... deixar bem separado e organizado"
    // — Motorista/Motivo/Conferente (que viviam misturados dentro da
    // própria tela de Notas Retornadas) viraram uma tela própria. Só
    // "visualizar" aqui, mesmo padrão de indicadores/status acima — quem
    // PODE criar/editar/excluir um cadastro continua sendo a MESMA
    // permissão administrativa de recebimento-recusas (Firestore rules
    // já protege as coleções recebimento_recusas_motoristas/_motivos/
    // _conferentes por ali, sem regra nova).
    {id:'recebimento-recusas-cadastros',nome:'Recebimento · Notas Retornadas · Cadastros',setor:'logistica',canais:['analista'],acoes:['visualizar']},
    {id:'recebimento-config',nome:'Recebimento · Configurações',setor:'logistica',canais:['analista'],acoes:['visualizar','criar','editar','excluir']}
  ];
  const ROTULOS={visualizar:'Visualizar',criar:'Criar',editar:'Editar',excluir:'Excluir',importar:'Importar',exportar:'Exportar',publicar:'Liberar/Publicar',finalizar:'Finalizar',cancelar:'Cancelar',atualizar:'Atualizar',aprovar:'Aprovar',bloquear:'Bloquear',configurar:'Configurar',executar:'Executar/Enviar',reordenar:'Reordenar','corrigir-horario':'Corrigir horário','gerar-qrcode':'Gerar QR Code'};
  const MODULO_ICONES={dashboard:'📊',inventarios:'📦',acompanhamento:'📈',auditoria:'🕵️',contagens:'🔢',pendencias:'⏳',recontagens:'🔁','rel-divergencias':'⚠️','capas-duplicadas':'🧾',produtividade:'🏆',enderecos:'📍',produtos:'🏷️',coletores:'📱',operadores:'👤',lojas:'🏪',rastreabilidade:'🔍','importar-exportar':'🔄','producao-dashboard':'📊','producao-ficha-tecnica':'🏭','producao-maquinas':'⚙️','producao-programacao':'📋','producao-gantt':'📅','producao-realizado':'✅','producao-insumos':'🧪','producao-projecao':'📈','producao-prog-automatica':'🤖','producao-funcionarios':'👷','producao-relatorios':'📊','producao-setup':'🔧','producao-mapa-fabrica':'🗺️','producao-config':'⚙️','producao-importacao':'🔄','producao-estoque':'📦','recebimento-dashboard':'📊','recebimento-operacao':'🚚','recebimento-notas':'📄','recebimento-fornecedores':'🏢','recebimento-agendamentos':'📅','recebimento-transbordo':'🚛','recebimento-patio-tempo-real':'📦','recebimento-recusas':'↩️','recebimento-retornos-indicadores':'📊','recebimento-recusas-indicadores':'📊','recebimento-config':'⚙️'};
  const todos=()=>Object.fromEntries(MODULOS.map(m=>[m.id,Object.fromEntries(m.acoes.map(a=>[a,true]))]));
  const normalizar=(p,legadoTotal)=>{
    if(!p||typeof p!=='object')return legadoTotal?todos():{};
    const out={}; MODULOS.forEach(m=>{out[m.id]={};m.acoes.forEach(a=>out[m.id][a]=p[m.id]?.[a]===true);});return out;
  };
  const _todasAcoesDe=id=>Object.fromEntries((MODULOS.find(m=>m.id===id)?.acoes||[]).map(a=>[a,true]));
  // Presets (correção estrutural — atalhos de permissão por função, seção 8
  // do pedido): aplicar um preset é só um PONTO DE PARTIDA — marca as
  // permissões definidas e para por aí; o admin continua livre pra ajustar
  // manualmente depois (nunca trava a edição, nunca sobrescreve sozinho).
  // "Operador de Coletor · Recebimento" fica só com editar/criar/corrigir-
  // horario/gerar-qrcode (o que o bip do Coletor de fato usa — o 5º bip de
  // finalização passa pelo ramo "editar" das Firestore Rules, nunca pelo
  // "finalizar" dedicado) — sem cancelar/finalizar, que são ações
  // administrativas (o pedido é explícito: "não liberar telas
  // administrativas").
  const PRESETS=[
    {id:'coletor-recebimento',nome:'Operador de Coletor · Recebimento',icone:'📱',descricao:'Bipar transbordo pelo Coletor — sem telas administrativas.',
      permissoes:{
        'recebimento-operacao':{visualizar:true,criar:true,editar:true,'corrigir-horario':true,'gerar-qrcode':true},
        'recebimento-transbordo':{visualizar:true,criar:true,editar:true,'corrigir-horario':true,'gerar-qrcode':true},
        'recebimento-paletes':{visualizar:true,criar:true,editar:true},
      }},
    {id:'analista-recebimento',nome:'Analista de Recebimento',icone:'🚚',descricao:'Dashboard, recebimentos, notas, fornecedores, agenda, transbordo e configurações do setor.',
      permissoes:Object.fromEntries(MODULOS.filter(m=>m.id.startsWith('recebimento-')).map(m=>[m.id,_todasAcoesDe(m.id)]))},
    {id:'pcp',nome:'PCP',icone:'📋',descricao:'Acesso completo ao setor PCP.',
      permissoes:{'pcp-central':_todasAcoesDe('pcp-central')}},
    {id:'compras',nome:'Compras',icone:'🛒',descricao:'Acesso completo ao setor Compras.',
      permissoes:{'compras-central':_todasAcoesDe('compras-central')}},
    {id:'administrador',nome:'Administrador',icone:'👑',descricao:'Acesso completo a todos os módulos.',
      permissoes:todos()},
  ];
  // Limpa tudo antes de aplicar — um preset precisa ser previsível (o
  // mesmo resultado sempre, a partir de qualquer estado anterior), não uma
  // soma incremental que dependeria do que já estava marcado antes.
  function opAplicarPreset(prefix,presetId){
    const preset=PRESETS.find(x=>x.id===presetId);if(!preset)return;
    opMarcarPermissoes(prefix,false);
    Object.keys(preset.permissoes).forEach(moduloId=>{
      Object.keys(preset.permissoes[moduloId]).forEach(acao=>{
        if(preset.permissoes[moduloId][acao]!==true)return;
        const chk=document.querySelector(`#op-permissoes-${prefix} [data-modulo="${moduloId}"][data-acao="${acao}"]`);
        if(chk)chk.checked=true;
      });
      _permAtualizarIndeterminado(prefix,moduloId);
    });
    _permAtualizarContagemGeral(prefix);
    _permAtualizarVisibilidade(prefix);
    global.showToast?.('Modelo "'+preset.nome+'" aplicado — ainda pode ajustar antes de salvar.','success');
  }

  async function carregarLojas(){lojasCache=await global.DTLoja.garantirLojaInicial();return lojasCache;}
  function lojasLabels(ids){const a=Array.isArray(ids)?ids:[];if(!a.length)return'<span class="badge badge-red">Sem loja</span>';return a.map(id=>`<span class="badge badge-blue" style="margin:2px">${esc(lojasCache.find(x=>x.id===id)?.nome||id)}</span>`).join('');}
  function canais(u){const c=u.canais_acesso||{};return `${c.coletor!==false?'📱 Coletor ':''}${c.analista===true||u.perfil==='analista'?'🖥️ Analista':''}`.trim()||'Sem acesso';}
  async function coletarUsuariosExistentes(){
    await carregarLojas();const mapa=new Map(),snap=await raw().collection(ACCESS).get().catch(()=>({docs:[]}));
    snap.docs.forEach(d=>{const x={id:d.id,...d.data()};if(x.conta_secundaria===true)return;mapa.set(x.uid||x.email||d.id,x);});
    // PEDIDO AO VIVO (2026-09-10, "até os usuários demora pra carregar"):
    // era um for/await SEQUENCIAL — uma leitura de dt_operadores por loja,
    // esperando terminar uma pra só então começar a próxima. Com N lojas
    // isso sozinho já custava N idas e voltas ao servidor em série antes da
    // lista aparecer. Promise.all troca por "todas ao mesmo tempo" sem
    // mudar o que é buscado nem a ordem de mescla (resultadosPorLoja mantém
    // a ordem de lojasCache, processado abaixo na mesma sequência de antes).
    const resultadosPorLoja=await Promise.all(lojasCache.map(loja=>raw().collection('lojas').doc(loja.id).collection('dt_operadores').limit(500).get().then(s=>({loja,docs:s.docs})).catch(e=>{console.warn('[Usuários]',e.message);return{loja,docs:[]};})));
    resultadosPorLoja.forEach(({loja,docs})=>{docs.forEach(d=>{const o={id:d.id,...d.data()};if(o.conta_secundaria===true)return;const k=o.uid||o.email||d.id,a=mapa.get(k)||{};mapa.set(k,{...o,...a,uid:a.uid||o.uid||d.id,email:a.email||o.email||'',nome:a.nome||o.nome||o.name||'',_lojasEncontradas:[...new Set([...(a._lojasEncontradas||[]),loja.id])]});});});
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
  // Lista vertical com círculo pequeno + nome (mesmo idioma visual das
  // ações do módulo) — substitui a grade de caixas lado a lado que "tomava
  // conta da tela toda" (pedido ao vivo do usuário).
  function montarChecks(id,sel){const b=document.getElementById(id);if(!b)return;const s=new Set(sel||[]);b.innerHTML=lojasCache.map(l=>`<label class="op-loja-item"><input type="checkbox" value="${esc(l.id)}" ${s.has(l.id)?'checked':''}><span>${esc(l.nome||l.id)}</span></label>`).join('');}
  function setModo(p,m){document.querySelectorAll(`input[name="op-lojas-${p}-modo"]`).forEach(r=>r.checked=r.value===m);const b=document.getElementById(`op-lojas-${p}-box`);if(b)b.style.display=m==='selecionadas'?'block':'none';}
  // Correção estrutural: antes, desmarcar "Analista" escondia o painel de
  // permissões INTEIRO (hack de quando só existia canal Coletor de
  // propósito, pra não travar recebimento-transbordo pra ele). Agora o
  // painel fica sempre visível e cada checkbox de canal RE-FILTRA a árvore
  // (_permAtualizarVisibilidade) — mostra só setor/módulo compatível com o
  // que está marcado, nos dois sentidos (Coletor sozinho não vê nada
  // exclusivo do Analista, e vice-versa).
  function renderCanais(prefix,c={}){const b=document.getElementById(`op-canais-${prefix}`);if(!b)return;b.innerHTML=[['coletor','📱 Coletor'],['analista','🖥️ Analista']].map(([id,n])=>`<label class="op-toggle-chip"><input type="checkbox" data-canal="${id}" ${c[id]===true?'checked':''}> ${n}</label>`).join('');b.querySelectorAll('[data-canal]').forEach(chk=>chk.addEventListener('change',()=>{_permAtualizarVisibilidade(prefix);if(prefix==='criar')opGerarUsername();}));}
  // Setores: fase 1 da unificação com o Sistema de Produção — controla só
  // quais abas de topo (Logística/Compras/PCP/Produção) aparecem pro login;
  // dentro de cada setor, os módulos continuam filtrados pelas permissões
  // de sempre (renderPermissoes/temPermissao), sem mudança nessa mecânica.
  // Logística vem marcada por padrão (undefined !== false) pra ninguém
  // perder acesso ao que já usa hoje.
  var SETORES=[['logistica','🚚 Logística'],['compras','🛒 Compras'],['pcp','📋 PCP'],['producao','🏭 Produção']];
  // PEDIDO AO VIVO (2026-08-27): "seleciono a loja... aí seleciona os
  // setores... aí só vai aparecer as permissões do que eu selecionar" —
  // antes, marcar/desmarcar setor aqui não reagia em nada; a árvore de
  // permissões (renderPermissoes) sempre mostrava TODOS os setores. Agora
  // dispara o mesmo filtro que os canais já usam (_permAtualizarVisibilidade),
  // que também esconde o setor inteiro quando ele não está marcado aqui.
  // BUG AO VIVO REAL (2026-08-27 — "quando eu seleciono compras, ou PCP ou
  // produção, a tela fica toda branca"): o checkbox aqui usava
  // `data-setor`, o MESMO nome de atributo que a barra de navegação de
  // Setores do topo do app já usa pra trocar de setor inteiro (ver
  // document.addEventListener('click',...) mais abaixo, que casa QUALQUER
  // `[data-setor]` clicado em qualquer lugar do documento e chama
  // irParaSetor()). Clicar num checkbox "Compras/PCP/Produção" aqui também
  // disparava irParaSetor('compras'/'pcp'/'producao') por baixo — trocando
  // o setor do app inteiro e escondendo a shell onde o modal estava,
  // exatamente a "tela em branco" relatada. Renomeado pra `data-op-setor`,
  // que não colide com nada.
  function renderSetores(prefix,s={}){const b=document.getElementById(`op-setores-${prefix}`);if(!b)return;b.innerHTML=SETORES.map(([id,n])=>`<label class="op-toggle-chip"><input type="checkbox" data-op-setor="${id}" ${(id==='logistica'?s[id]!==false:s[id]===true)?'checked':''}> ${n}</label>`).join('');b.querySelectorAll('[data-op-setor]').forEach(chk=>chk.addEventListener('change',()=>_permAtualizarVisibilidade(prefix)));}
  function lerSetores(prefix){const o={logistica:false,compras:false,pcp:false,producao:false};document.querySelectorAll(`#op-setores-${prefix} [data-op-setor]`).forEach(x=>o[x.dataset.opSetor]=x.checked);return o;}
  // Reforma da tela de Usuários e Permissões (correção estrutural) — trocou
  // a grade solta de cards por uma árvore Canal → Setor → Módulo → Ação. O
  // Canal é o seletor "Onde este login pode entrar" logo ACIMA desta árvore
  // (renderCanais) — ele não vira um nível de indentação a mais aqui dentro,
  // ele FILTRA quais setor/módulo aparecem (seção 7.2 do pedido: conta só-
  // Coletor não deve nem ver permissão exclusiva do Analista). Setor agrupa
  // os módulos (mecânico, por `m.setor`); Módulo é o card recolhível de
  // sempre; Ação são os chips de dentro. `data-perm-canais` guarda os canais
  // do módulo pra o filtro em _permAtualizarVisibilidade() decidir o que
  // mostrar sem precisar re-renderizar a árvore inteira a cada clique.
  var SETORES_PERM_INFO={logistica:{label:'🚚 Logística'},compras:{label:'🛒 Compras'},pcp:{label:'📋 PCP'},producao:{label:'🏭 Produção'}};
  function renderPermissoes(prefix,p){
    const b=document.getElementById(`op-permissoes-${prefix}`);if(!b)return;
    const perms=normalizar(p,false);
    const totalGeral=MODULOS.reduce((a,m)=>a+m.acoes.length,0);
    const marcadosGeral=MODULOS.reduce((a,m)=>a+m.acoes.filter(ac=>perms[m.id]?.[ac]===true).length,0);
    const porSetor={};
    MODULOS.forEach(m=>{(porSetor[m.setor]=porSetor[m.setor]||[]).push(m);});
    const arvore=Object.keys(SETORES_PERM_INFO).filter(s=>(porSetor[s]||[]).length).map(setorId=>{
      const modulosDoSetor=porSetor[setorId];
      const marcadosSetor=modulosDoSetor.reduce((a,m)=>a+m.acoes.filter(ac=>perms[m.id]?.[ac]===true).length,0);
      const totalSetor=modulosDoSetor.reduce((a,m)=>a+m.acoes.length,0);
      const modulosHtml=modulosDoSetor.map(m=>{
        const marcados=m.acoes.filter(a=>perms[m.id]?.[a]===true).length;
        const todas=marcados===m.acoes.length, nenhuma=marcados===0;
        const busca=esc((m.nome+' '+m.acoes.map(a=>ROTULOS[a]).join(' ')).toLowerCase());
        return `<div class="perm-modulo" data-perm-card data-perm-busca="${busca}" data-perm-canais="${m.canais.join(',')}">
          <div class="perm-modulo-hdr" data-perm-toggle-modulo="1">
            <span class="perm-modulo-seta">▸</span>
            <label class="perm-card-toggle" onclick="event.stopPropagation()">
              <input type="checkbox" data-modulo-all="${m.id}" ${todas?'checked':''} onchange="opMarcarModulo('${prefix}','${m.id}',this.checked)">
              <span class="perm-card-icon">${MODULO_ICONES[m.id]||'▫️'}</span>
              <span class="perm-card-name">${esc(m.nome)}</span>
            </label>
            <span class="perm-card-count ${todas?'is-complete':nenhuma?'is-empty':'is-partial'}" data-contagem-modulo="${m.id}">${marcados}/${m.acoes.length}</span>
          </div>
          <div class="perm-modulo-acoes">${m.acoes.map(a=>`<label class="perm-chip"><input type="checkbox" data-modulo="${m.id}" data-acao="${a}" ${perms[m.id]?.[a]===true?'checked':''} onchange="opAtualizarContagemModulo('${prefix}','${m.id}')"> ${ROTULOS[a]}</label>`).join('')}</div>
        </div>`;
      }).join('');
      return `<div class="perm-setor" data-perm-setor="${setorId}">
        <div class="perm-setor-hdr" data-perm-toggle-setor="1">
          <span class="perm-setor-seta">▾</span>
          <span>${SETORES_PERM_INFO[setorId].label}</span>
          <span class="perm-card-count" style="margin-left:auto">${marcadosSetor}/${totalSetor}</span>
        </div>
        <div class="perm-setor-modulos">${modulosHtml}</div>
      </div>`;
    }).join('');
    b.innerHTML=`<div class="perm-presets">
      <span class="perm-presets-label">Modelo rápido:</span>
      ${PRESETS.map(pr=>`<button type="button" class="btn btn-ghost btn-sm" title="${esc(pr.descricao)}" data-op-preset="${pr.id}" data-op-preset-prefix="${prefix}">${pr.icone} ${esc(pr.nome)}</button>`).join('')}
    </div>
    <div class="perm-toolbar">
      <input type="text" class="perm-busca" placeholder="🔍 Buscar módulo ou permissão..." oninput="opFiltrarPermissoes('${prefix}',this.value)">
      <span class="perm-total-geral" data-contagem-geral="${prefix}">${marcadosGeral} de ${totalGeral} selecionadas</span>
      <button type="button" class="btn btn-ghost btn-sm" onclick="opMarcarPermissoes('${prefix}',true)">✓ Marcar tudo</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick="opMarcarPermissoes('${prefix}',false)">✕ Limpar tudo</button>
    </div>
    <div class="perm-arvore" data-perm-grid="${prefix}">${arvore}</div>
    <div class="perm-vazio" data-perm-vazio="${prefix}" style="display:none">Nenhuma permissão encontrada para essa busca (ou nenhum módulo faz sentido pro canal marcado).</div>`;
    MODULOS.forEach(m=>_permAtualizarIndeterminado(prefix,m.id));
    _permAtualizarVisibilidade(prefix);
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
    if(contagem){contagem.textContent=`${marcados}/${total}`;contagem.className='perm-card-count '+(marcados===total?'is-complete':marcados===0?'is-empty':'is-partial');}
    const todas=box.querySelector(`[data-modulo-all="${moduloId}"]`);
    if(todas){todas.checked=total>0&&marcados===total;todas.indeterminate=marcados>0&&marcados<total;}
  }
  // Substitui a busca de texto pura por uma que também respeita o canal —
  // as duas razões de esconder um módulo (busca não bate, canal não é
  // compatível) precisam ser combinadas (E lógico), não uma sobrescrever a
  // outra. `termoParam` vem de quem digitou (oninput); quando ausente
  // (chamada pelo listener de canal, que não tem o texto em mãos), relê o
  // valor atual do campo de busca direto do DOM.
  function _permAtualizarVisibilidade(prefix,termoParam){
    const grid=document.querySelector(`[data-perm-grid="${prefix}"]`);if(!grid)return;
    const campoBusca=document.querySelector(`#op-permissoes-${prefix} .perm-busca`);
    const t=String(termoParam!==undefined?termoParam:(campoBusca?.value||'')).trim().toLowerCase();
    const canaisMarcados=lerCanais(prefix);
    const canaisAtivos=Object.keys(canaisMarcados).filter(c=>canaisMarcados[c]);
    const setoresMarcados=lerSetores(prefix);
    let visiveis=0;
    grid.querySelectorAll('[data-perm-setor]').forEach(setorEl=>{
      // "só vai aparecer as permissões do que eu selecionar" — setor
      // desmarcado em "Setores" esconde o bloco inteiro, sem nem olhar os
      // módulos de dentro (o filtro de canal continua rodando por cima,
      // pros setores que ficaram visíveis).
      if(!setoresMarcados[setorEl.dataset.permSetor]){setorEl.style.display='none';setorEl.querySelectorAll('[data-perm-card]').forEach(card=>card.style.display='none');return;}
      let algumVisivelNesteSetor=false;
      setorEl.querySelectorAll('[data-perm-card]').forEach(card=>{
        const canaisModulo=(card.dataset.permCanais||'').split(',').filter(Boolean);
        const combinaCanal=canaisAtivos.some(c=>canaisModulo.includes(c));
        const combinaBusca=!t||(card.dataset.permBusca||'').includes(t);
        const ok=combinaCanal&&combinaBusca;
        card.style.display=ok?'':'none';
        if(ok){visiveis++;algumVisivelNesteSetor=true;}
      });
      setorEl.style.display=algumVisivelNesteSetor?'':'none';
    });
    const vazio=document.querySelector(`[data-perm-vazio="${prefix}"]`);if(vazio)vazio.style.display=visiveis?'none':'block';
  }
  function opFiltrarPermissoes(prefix,termo){_permAtualizarVisibilidade(prefix,termo);}
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
  async function opEditarUsuario(i){editando=usuarios[i];editandoIndice=i;if(!editando)return;await carregarLojas();document.getElementById('opedit-nome').value=editando.nome||editando.name||'';document.getElementById('opedit-cargo').value=editando.perfil||editando.tipo||'operador';document.getElementById('opedit-setor').value=editando.setor||'';document.getElementById('opedit-senha').value='';montarChecks('op-lojas-editar-lista',editando.lojas_permitidas||[]);setModo('editar',editando.acesso_todas_lojas===true?'todas':'selecionadas');const legadoAnalista=editando.perfil==='analista'&&!editando.canais_acesso;renderCanais('editar',editando.canais_acesso||{coletor:true,analista:legadoAnalista});renderSetores('editar',editando.setores_permitidos||{});renderPermissoes('editar',normalizar(editando.permissoes,legadoAnalista));document.getElementById('op-permissoes-editar').style.display='block';const btnExcluir=document.getElementById('btn-excluir-oped');if(btnExcluir)btnExcluir.style.display=usuarioProtegido(editando)?'none':'inline-flex';const diag=document.getElementById('op-diagnostico');if(diag){diag.style.display='none';diag.innerHTML='';}document.getElementById('op-modal-bg').style.display='flex';}
  function opFecharModal(){document.getElementById('op-modal-bg').style.display='none';editando=null;editandoIndice=-1;const diag=document.getElementById('op-diagnostico');if(diag){diag.style.display='none';diag.innerHTML='';}}
  async function opExcluirUsuarioAtual(){if(editandoIndice<0)return;const indice=editandoIndice;opFecharModal();await opExcluirUsuario(indice);}

  // ── Diagnóstico de acesso (correção estrutural) ─────────────────────────
  // Lê os documentos usuarios_acessos AO VIVO (não o cache de `usuarios`,
  // que só tem o que coletarUsuariosExistentes() já mesclou) — pra pegar
  // divergência de verdade entre a conta principal e as vinculadas, sem
  // depender de recarregar a lista inteira. Facilita o suporte: em vez de
  // adivinhar por que um Coletor específico está com permission-denied, dá
  // pra ver aqui se o documento dele existe e se bate com o principal.
  function _uidsVinculadosDe(u){return [...new Set([u.analista_uid,u.coletor_uid,...(u.uids_vinculados||[])].filter(Boolean).filter(x=>x!==(u.uid||u.id)))];}
  async function _lerDocAcesso(uid){const snap=await raw().collection(ACCESS).doc(uid).get().catch(()=>null);return {uid,existe:!!snap?.exists,dados:snap?.exists?snap.data():null};}
  function _permissoesIguais(a,b){return JSON.stringify(a||{})===JSON.stringify(b||{});}
  async function opAbrirDiagnostico(){
    if(!editando)return;
    const box=document.getElementById('op-diagnostico');if(!box)return;
    box.style.display='block';
    box.innerHTML='⏳ Verificando…';
    const uidPrincipal=editando.uid||editando.id||emailId(editando.email);
    const vinculados=_uidsVinculadosDe(editando);
    const principal=await _lerDocAcesso(uidPrincipal);
    const outros=await Promise.all(vinculados.map(_lerDocAcesso));
    _renderDiagnostico(uidPrincipal,principal,outros);
  }
  function _renderDiagnostico(uidPrincipal,principal,outros){
    const box=document.getElementById('op-diagnostico');if(!box)return;
    const divergentes=outros.filter(o=>o.existe&&!_permissoesIguais(o.dados.permissoes,principal.dados?.permissoes));
    const ausentes=outros.filter(o=>!o.existe);
    const linhaUid=(rotulo,d)=>`<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0"><span style="color:var(--muted)">${esc(rotulo)}</span><span class="mono" style="font-size:.72rem">${esc(d.uid)} — ${d.existe?(d===principal?'✓ encontrado':(_permissoesIguais(d.dados.permissoes,principal.dados?.permissoes)?'✓ sincronizado':'⚠ não sincronizado')):'⚠ documento não encontrado'}</span></div>`;
    const alerta=(divergentes.length||ausentes.length)
      ? `<div class="badge badge-red" style="margin-top:8px;display:inline-block">⚠ Permissões do login Coletor não estão sincronizadas com o cadastro principal.</div><button type="button" class="btn btn-primary btn-sm" style="margin-top:8px;display:block" data-op-diagnostico-ressincronizar="${esc(uidPrincipal)}">🔄 Ressincronizar agora</button>`
      : `<div class="badge badge-green" style="margin-top:8px;display:inline-block">✓ Todas as identidades sincronizadas</div>`;
    // "Sincronizado" só compara contas entre si — não prova que a permissão
    // marcada na TELA chegou de verdade no Firestore (login único não tem
    // com o que comparar, sempre dá "sincronizado" mesmo se o valor real
    // salvo estiver errado/vazio). Esta seção mostra o valor CRU, lido
    // agora mesmo do documento — bypassa qualquer cache do navegador — pra
    // responder "o que está gravado de verdade" sem depender de adivinhação.
    const dadosPrincipal=principal.dados||{};
    const permissoesReais=dadosPrincipal.permissoes||{};
    const areasComAlgumaAcao=Object.keys(permissoesReais).filter(a=>Object.values(permissoesReais[a]||{}).some(v=>v===true));
    const linhaPermissoesReais=areasComAlgumaAcao.length
      ? areasComAlgumaAcao.map(area=>`<div style="padding:2px 0"><span class="mono" style="font-size:.7rem">${esc(area)}</span>: ${Object.keys(permissoesReais[area]).filter(ac=>permissoesReais[area][ac]===true).map(esc).join(', ')||'—'}</div>`).join('')
      : '<div style="color:var(--danger,#ff4757)">Nenhuma permissão marcada como true no documento — se a tela mostra checkboxes marcados, o Salvar não persistiu.</div>';
    box.innerHTML=`
      <div>${linhaUid('UID principal',principal)}</div>
      ${outros.map(o=>linhaUid('UID vinculado',o)).join('')}
      ${!outros.length?'<div style="color:var(--muted)">Nenhuma identidade vinculada — login único.</div>':''}
      ${alerta}
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
        <div style="font-weight:700;margin-bottom:4px">Valor real gravado agora (lido direto do Firestore):</div>
        <div>Canal: ${esc(JSON.stringify(dadosPrincipal.canais_acesso||{}))}</div>
        <div>Ativo: ${dadosPrincipal.ativo===false?'Não':'Sim'}</div>
        <div>Lojas: ${dadosPrincipal.acesso_todas_lojas===true?'Todas':(esc((dadosPrincipal.lojas_permitidas||[]).join(', ')||'nenhuma'))}</div>
        <div style="margin-top:4px">Permissões com alguma ação marcada:</div>
        ${linhaPermissoesReais}
      </div>`;
  }
  // Não é migração em massa — só reaplica o MESMO fan-out que
  // criarOperador()/opSalvarEdicao() já fazem, sob demanda, pra corrigir
  // contas que ficaram dessincronizadas ANTES desta correção existir (sem
  // reescrever nada em quem já está ok).
  async function opRessincronizarPermissoes(uidPrincipal){
    const doc=await raw().collection(ACCESS).doc(uidPrincipal).get().catch(()=>null);
    if(!doc?.exists)return global.showToast?.('Conta principal não encontrada','error');
    const dados=doc.data(),vinculados=_uidsVinculadosDe({...dados,uid:uidPrincipal});
    for(const alvoUid of vinculados){
      await raw().collection(ACCESS).doc(alvoUid).set({permissoes:dados.permissoes,canais_acesso:dados.canais_acesso,setores_permitidos:dados.setores_permitidos,conta_secundaria:true,cadastro_principal_uid:uidPrincipal},{merge:true});
    }
    global.showToast?.('Permissões ressincronizadas','success');
    const principal=await _lerDocAcesso(uidPrincipal),outros=await Promise.all(vinculados.map(_lerDocAcesso));
    _renderDiagnostico(uidPrincipal,principal,outros);
  }
  // Busca por UID direto (correção estrutural — pedido ao vivo: "não
  // consigo rastrear o UID dele"). Contas `conta_secundaria===true` ficam
  // de propósito fora da listagem principal (coletarUsuariosExistentes),
  // e um login criado por engano via "Primeiro acesso" no Coletor
  // (usuário digitou um login diferente do cadastrado, virou uma conta
  // órfã sem NENHUM vínculo) nunca aparece na lista de jeito nenhum — o
  // único jeito de achar essas contas é procurando pelo UID exato, direto
  // no documento, sem passar pela lista.
  async function opBuscarPorUid(){
    const uid=String(document.getElementById('op-busca-uid')?.value||'').trim();
    const box=document.getElementById('op-busca-uid-resultado');if(!box)return;
    if(!uid){global.showToast?.('Cole um UID pra buscar','error');return;}
    box.style.display='block';
    box.innerHTML='⏳ Buscando…';
    const doc=await _lerDocAcesso(uid);
    if(!doc.existe){
      box.innerHTML=`<div class="badge badge-red" style="display:inline-block">⚠ Nenhum documento usuarios_acessos encontrado pra esse UID.</div>
        <div style="margin-top:6px;color:var(--muted)">Isso normalmente quer dizer: a conta existe no Firebase Auth (alguém conseguiu logar com ela), mas NUNCA foi cadastrada nessa tela — típico de login criado sozinho pelo Coletor em "Primeiro acesso" com um usuário diferente do que o Analista configurou.</div>`;
      return;
    }
    const d=doc.dados;
    const areas=Object.keys(d.permissoes||{}).filter(a=>Object.values(d.permissoes[a]||{}).some(v=>v===true));
    box.innerHTML=`
      <div><b>E-mail:</b> ${esc(d.email||'—')}</div>
      <div><b>Nome:</b> ${esc(d.nome||'—')}</div>
      <div><b>Canal:</b> ${esc(JSON.stringify(d.canais_acesso||{}))}</div>
      <div><b>Ativo:</b> ${d.ativo===false?'Não':'Sim'}</div>
      <div><b>Conta secundária?</b> ${d.conta_secundaria===true?('Sim — vinculada a '+esc(d.cadastro_principal_uid||'?')+' (por isso não aparece na lista principal)'):'Não'}</div>
      <div><b>Permissões com alguma ação marcada:</b> ${areas.length?esc(areas.join(', ')):'nenhuma — permissoes:{} ou tudo false'}</div>`;
  }
  document.addEventListener('click',function(event){
    if(event.target.closest('[data-op-buscar-uid]')){opBuscarPorUid();return;}
    if(event.target.closest('[data-op-diagnostico-abrir]')){opAbrirDiagnostico();return;}
    const btnResync=event.target.closest('[data-op-diagnostico-ressincronizar]');
    if(btnResync){opRessincronizarPermissoes(btnResync.getAttribute('data-op-diagnostico-ressincronizar'));return;}
  });
  // Árvore de permissões: cada setor/módulo expande/recolhe (mesmo idioma
  // de clique-delegado já usado no resto do arquivo, ex.: data-usuario-editar
  // acima) — clicar no checkbox "marcar tudo do módulo" (dentro do cabeçalho)
  // não deve expandir/recolher junto, por isso o próprio checkbox chama
  // `event.stopPropagation()` no HTML gerado por renderPermissoes().
  document.addEventListener('click',function(event){
    const setorHdr=event.target.closest('[data-perm-toggle-setor]');
    if(setorHdr){setorHdr.closest('[data-perm-setor]')?.classList.toggle('is-recolhido');return;}
    const moduloHdr=event.target.closest('[data-perm-toggle-modulo]');
    if(moduloHdr){moduloHdr.closest('.perm-modulo')?.classList.toggle('is-aberto');return;}
    const btnPreset=event.target.closest('[data-op-preset]');
    if(btnPreset){opAplicarPreset(btnPreset.getAttribute('data-op-preset-prefix'),btnPreset.getAttribute('data-op-preset'));return;}
  });
  async function opSalvarEdicao(){if(!editando||!validarAcesso('editar'))return;const modo=document.querySelector('input[name="op-lojas-editar-modo"]:checked')?.value||'todas',sel=[...document.querySelectorAll('#op-lojas-editar-lista input:checked')].map(x=>x.value);if(modo==='selecionadas'&&!sel.length)return global.showToast?.('Selecione ao menos uma loja','error');const uid=editando.uid||editando.id||emailId(editando.email),c=lerCanais('editar'),novaSenha=document.getElementById('opedit-senha').value,data={uid,email:String(editando.email||'').toLowerCase(),nome:document.getElementById('opedit-nome').value.trim(),perfil:c.analista?'analista':'operador',setor:document.getElementById('opedit-setor').value.trim(),ativo:editando.ativo!==false,canais_acesso:c,setores_permitidos:lerSetores('editar'),permissoes:lerPermissoes('editar'),acesso_todas_lojas:modo==='todas',lojas_permitidas:modo==='todas'?[]:sel,atualizado_em:new Date().toISOString(),atualizado_por:global._currentAnalistaUser?.email||''};if(novaSenha&&novaSenha.length<6)return global.showToast?.('A nova senha deve ter no mínimo 6 caracteres (pode ser só números)','error');try{if(novaSenha){if(!temPermissao('operadores','editar'))throw new Error('Seu login não possui permissão para alterar senhas');const callable=firebase.app().functions('southamerica-east1').httpsCallable('alterarSenhaUsuario'),uids=[uid,editando.analista_uid,editando.coletor_uid,...(editando.uids_vinculados||[])].filter(Boolean);await callable({uids:[...new Set(uids)],senha:novaSenha});}await raw().collection(ACCESS).doc(uid).set(data,{merge:true});
      // CORREÇÃO ESTRUTURAL (causa raiz do "admin edita a permissão mas o
      // Coletor continua negado"): esta função só gravava em
      // usuarios_acessos/{uid} (a conta principal) — qualquer UID vinculado
      // (coletor_uid/analista_uid/uids_vinculados) nunca era tocado aqui,
      // então ficava PARA SEMPRE com o `permissoes` de quando foi criado
      // (inclusive o `permissoes:{}` do bug de criação, se nunca foi
      // corrigido). Mesma lista de UIDs já usada acima pra sincronizar senha
      // (alterarSenhaUsuario) — agora permissoes/canais_acesso seguem o
      // mesmo caminho: uma única fonte canônica (`data`, o que o admin
      // acabou de marcar) espelhada em toda identidade vinculada.
      const uidsVinculadosEdicao=[...new Set([editando.analista_uid,editando.coletor_uid,...(editando.uids_vinculados||[])].filter(Boolean).filter(x=>x!==uid))];
      for(const alvoUid of uidsVinculadosEdicao){await raw().collection(ACCESS).doc(alvoUid).set({...data,uid:alvoUid,conta_secundaria:true,cadastro_principal_uid:uid},{merge:true});}
      for(const l of lojasCache){for(const alvoUid of [...new Set([uid,editando.coletor_uid].filter(Boolean))]){const ref=raw().collection('lojas').doc(l.id).collection('dt_operadores').doc(alvoUid),ex=await ref.get().catch(()=>null);if(ex?.exists||data.acesso_todas_lojas||sel.includes(l.id))await ref.set({...data,uid:alvoUid,conta_secundaria:alvoUid!==uid},{merge:true});}}global.showToast?.(novaSenha?'Acessos e nova senha salvos':'Acessos e permissões salvos','success');opFecharModal();await listarOperadores();}catch(e){global.showToast?.('Erro ao salvar: '+(e?.message||e),'error');}}
  // As permissões granulares (Recebimento · Transbordo, etc.) ficavam
  // escondidas pra login só-Coletor (display:none) — pensado quando essas
  // permissões só importavam pro Analista. Bug ao vivo relatado: um login
  // só-Coletor não conseguia gerar transbordo, porque nem tinha como o
  // admin marcar "Recebimento · Transbordo → Criar/Editar" pra ele — o
  // painel inteiro sumia. O fluxo de bip fixo por motorista (fase 15) passou
  // a exigir essa permissão pra ações que o Coletor dispara sozinho, então
  // o painel agora fica sempre visível, não só quando o canal Analista tá
  // marcado.
  // PEDIDO AO VIVO (2026-08-27): "se eu cancelar... e colocar de novo criar
  // novo usuário, não é pra vim com as informações, é pra vim do zero" —
  // nome/senha/preview de login nunca eram limpos ao reabrir; se você
  // cancelava e abria de novo, o que tinha digitado antes ainda estava lá.
  function opAbrirModalCriar(){
    const campoNome=document.getElementById('op-nome'),campoSenha=document.getElementById('op-senha');
    if(campoNome)campoNome.value='';
    if(campoSenha)campoSenha.value='';
    const preview=document.getElementById('op-logins-preview');if(preview)preview.innerHTML='Informe o nome completo.';
    carregarLojas().then(()=>{montarChecks('op-lojas-criar-lista',[]);setModo('criar','todas');renderCanais('criar',{coletor:true,analista:false});renderSetores('criar',{});renderPermissoes('criar',{});document.getElementById('op-permissoes-criar').style.display='block';document.getElementById('op-modal-criar-bg').style.display='flex';});
  }
  function opFecharModalCriar(){document.getElementById('op-modal-criar-bg').style.display='none';}
  // PEDIDO AO VIVO (2026-08-27): a prévia de login agora segue os
  // checkboxes de "Onde este login pode entrar" (canais), não mais o card
  // "Tipo de acesso" removido — mostra só a linha do canal marcado, e cada
  // linha exige só o que aquele login precisa (Analista só usa o primeiro
  // nome; Coletor precisa de primeiro+sobrenome).
  function opGerarUsername(){const l=loginsDoNome(document.getElementById('op-nome')?.value),c=lerCanais('criar'),campo=document.getElementById('op-username'),preview=document.getElementById('op-logins-preview');if(campo)campo.value=l.coletor;const linhas=[];if(c.analista)linhas.push(`<div><strong>Login do Analista:</strong> ${l.primeiro?esc(l.analista):'informe o nome'}</div>`);if(c.coletor)linhas.push(`<div><strong>Login do Coletor:</strong> ${esc(l.coletor||'informe também o sobrenome')}</div>`);if(preview)preview.innerHTML=!l.primeiro?'Informe o nome completo.':linhas.length?linhas.join(''):'Marque Analista e/ou Coletor em "Onde este login pode entrar".';}
  function opGerarSenha(){document.getElementById('op-senha').value=Math.random().toString(36).slice(-4).toUpperCase()+Math.floor(1000+Math.random()*9000);}
  function toggleOpSenha(){const e=document.getElementById('op-senha');e.type=e.type==='password'?'text':'password';}function toggleOpeditSenha(){const e=document.getElementById('opedit-senha');e.type=e.type==='password'?'text':'password';}
  function opValidarUsername(){}function opValidarSenha(){}
  async function criarOperador(){
    // PEDIDO AO VIVO (2026-08-27): "eu selecionei só analista, sem
    // coletor... não precisa criar um login pra coletor" — antes disso, o
    // login do Coletor era SEMPRE exigido/criado (mesmo senha do
    // Analista escondida atrás de "tipo"), obrigando um sobrenome mesmo
    // pra conta que nunca ia usar o Coletor. `c` (canais marcados em
    // "Onde este login pode entrar") agora é a única fonte de verdade —
    // cada exigência abaixo é condicional ao canal que ela realmente serve.
    const nome=document.getElementById('op-nome').value.trim(),senha=document.getElementById('op-senha').value,c=lerCanais('criar'),logins=loginsDoNome(nome);
    if(!logins.primeiro)return global.showToast?.('Informe o nome completo','error');
    if(c.coletor&&(!logins.segundo||!logins.coletorEmail))return global.showToast?.('Informe também o sobrenome — necessário pro login do Coletor','error');
    if(senha.length<6)return global.showToast?.('Informe uma senha com no mínimo 6 caracteres (pode ser só números)','error');
    if(!validarAcesso('criar'))return;
    const modo=document.querySelector('input[name="op-lojas-criar-modo"]:checked')?.value||'todas',sel=[...document.querySelectorAll('#op-lojas-criar-lista input:checked')].map(x=>x.value);
    if(modo==='selecionadas'&&!sel.length)return global.showToast?.('Selecione ao menos uma loja','error');
    let contaExistente=false;
    try{
      const criar=firebase.app().functions('southamerica-east1').httpsCallable('criarUsuarioVinculado'),resposta=await criar({nome,senha,emailAnalista:c.analista?logins.analista:null,emailColetor:c.coletor?logins.coletorEmail:null,criarAnalista:c.analista,criarColetor:c.coletor}),auth=resposta?.data||{};
      if(!auth.ok||!auth.uid||(c.analista&&!auth.analista_uid)||(c.coletor&&!auth.coletor_uid))throw new Error('O Firebase não confirmou a criação dos logins');
      contaExistente=auth.conta_existente===true;
      const agora=new Date().toISOString(),uids=[auth.uid,auth.coletor_uid].filter(Boolean),data={uid:auth.uid,analista_uid:auth.analista_uid||null,coletor_uid:auth.coletor_uid||null,uids_vinculados:[...new Set(uids)],email:auth.analista_uid?logins.analista:logins.coletorEmail,email_analista:auth.analista_uid?logins.analista:'',email_coletor:auth.coletor_uid?logins.coletorEmail:'',login_coletor:auth.coletor_uid?logins.coletor:'',nome,perfil:c.analista?'analista':'operador',ativo:true,canais_acesso:c,setores_permitidos:lerSetores('criar'),permissoes:lerPermissoes('criar'),acesso_todas_lojas:modo==='todas',lojas_permitidas:modo==='todas'?[]:sel,atualizado_em:agora};
      if(!contaExistente)data.criado_em=agora;
      else data.recuperado_em=agora;
      // PEDIDO AO VIVO (2026-09-08): "todo login criado, no primeiro
      // acesso peça pra alterar a senha... só para acessos que têm
      // Analista" — carimba só no documento PRINCIPAL (que é sempre a
      // identidade Analista quando esse canal existe, ver `data.uid`
      // acima) e nunca no `secundario` do Coletor logo abaixo — login que
      // só tem Coletor nunca vê essa exigência, e a conta secundária de
      // quem tem os dois canais também fica de fora de propósito (a
      // troca acontece 1x, pela sessão do Analista).
      if(c.analista)data.precisaTrocarSenha=true;
      await raw().collection(ACCESS).doc(auth.uid).set(data,{merge:true});
      // CORREÇÃO ESTRUTURAL (causa raiz do "admin liberou mas o Coletor
      // continua com permission-denied"): a conta secundária gravava
      // `permissoes:{}` fixo, ignorando o que foi marcado no formulário —
      // Firestore Rules resolve permissão estritamente por UID autenticado
      // (usuarios_acessos/{uid}), então duas contas Firebase Auth (Analista +
      // Coletor) são dois documentos NUNCA cruzados entre si; a conta que o
      // Coletor realmente usa (coletor_uid) precisa ter as MESMAS permissões
      // do formulário, não um mapa vazio. Fonte canônica = `data.permissoes`
      // (o que o admin marcou), espelhada em toda identidade vinculada.
      // Só grava a conta secundária do Coletor quando ela realmente existe
      // (canal Coletor marcado) — antes disso rodava sempre, mesmo sem
      // coletor_uid, gravando um doc fantasma pra uid `null`.
      if(auth.coletor_uid&&auth.coletor_uid!==auth.uid){const{precisaTrocarSenha:_flagAnalista,...dataSemFlagSenha}=data;const secundario={...dataSemFlagSenha,uid:auth.coletor_uid,email:logins.coletorEmail,perfil:'operador',canais_acesso:{coletor:true,analista:false},permissoes:data.permissoes,conta_secundaria:true,cadastro_principal_uid:auth.uid};await raw().collection(ACCESS).doc(auth.coletor_uid).set(secundario,{merge:true});}
      for(const l of lojasCache.filter(l=>data.acesso_todas_lojas||sel.includes(l.id))){const base=raw().collection('lojas').doc(l.id).collection('dt_operadores');await base.doc(auth.uid).set(data,{merge:true});if(auth.coletor_uid&&auth.coletor_uid!==auth.uid)await base.doc(auth.coletor_uid).set({...data,uid:auth.coletor_uid,email:logins.coletorEmail,perfil:'operador',canais_acesso:{coletor:true,analista:false},permissoes:data.permissoes,conta_secundaria:true,cadastro_principal_uid:auth.uid},{merge:true});}
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

    // Compatibilidade para o módulo Recusas, criado depois de muitos usuários
    // de Recebimento já terem suas permissões salvas no Firestore. Esses
    // usuários não possuem a chave `recebimento-recusas` no mapa antigo; sem
    // este fallback a sidebar simplesmente escondia a nova aba e parecia que
    // o módulo não tinha sido publicado. Se a chave existir, respeitamos
    // exatamente o que foi configurado. Se ainda não existir, um Analista que
    // já tinha acesso ao Recebimento herda Recusas até o cadastro de usuário
    // ser salvo novamente com as permissões novas.
    // Cargas (Montagem/Expedição) é conceitualmente um passo ANTES do
    // transbordo de verdade — reaproveita a MESMA permissão de Transbordo
    // (recebimento-transbordo) ou Recebimentos (recebimento-operacao), sem
    // área de permissão própria (mesma decisão de engenharia já tomada nas
    // firestore.rules pra essa coleção — ver hasPermissionRecebimento).
    if(modulo==='recebimento-cargas'){
      return a.permissoes?.['recebimento-transbordo']?.[acao]===true || a.permissoes?.['recebimento-operacao']?.[acao]===true;
    }
    if(modulo==='recebimento-recusas'){
      const explicita=a.permissoes?.['recebimento-recusas'];
      if(explicita && typeof explicita==='object') return explicita?.[acao]===true;
      const ehAnalista=(a.perfil==='analista') || a.canais_acesso?.analista===true;
      const tinhaRecebimento=['recebimento-operacao','recebimento-transbordo','recebimento-notas','recebimento-dashboard']
        .some(m=>a.permissoes?.[m]?.visualizar===true);
      if(ehAnalista && tinhaRecebimento) return true;
    }
    return a.permissoes?.[modulo]?.[acao]===true;
  }
  function aplicarPermissoesAnalista(){
    const a=global.DT_USUARIO_ACESSO_ATUAL;if(!a)return;
    const legado=!a.permissoes; if(legado)return;
    MODULOS.forEach(m=>{const nav=document.getElementById('nav-'+m.id),page=document.getElementById('page-'+m.id),ver=temPermissao(m.id);if(nav)nav.style.display=ver?'':'none';if(page&&!ver)page.classList.remove('on');});
    // BUG AO VIVO REAL (2026-09-03): "o site está travando... qualquer tela
    // que eu entre demora pra carregar" — esta função roda a cada mutação
    // no DOM inteiro (MutationObserver em document.body, debounced 40ms),
    // e cada página visitada na sessão FICA no DOM (só escondida via CSS,
    // nunca removida) — depois de navegar por várias telas ao longo do
    // dia, document.querySelectorAll varria TODAS elas (inclusive as ~20
    // escondidas) a cada mutação em QUALQUER lugar do app. Só a página
    // ATIVA (.page.on) tem botão que dá pra clicar — escondida não
    // interage com ninguém — então os dois scans abaixo (que antes eram
    // document.querySelectorAll(...), varrendo tudo) agora ficam restritos
    // a ela, cortando o trabalho de "todo o histórico de telas da sessão"
    // pra "só a tela que a pessoa está olhando agora".
    const escopo=document.querySelector('.page.on')||document;
    escopo.querySelectorAll('[onclick],[onchange]').forEach(el=>{const txt=(el.getAttribute('onclick')||el.getAttribute('onchange')||'').toLowerCase(),page=el.closest('.page')?.id?.replace(/^page-/,'');if(!page||!MODULOS.some(m=>m.id===page))return;let acao='visualizar';if(/exclu|limpar|cancelar.*recont/.test(txt))acao='excluir';else if(/export|baixar|download/.test(txt))acao='exportar';else if(/import|processfile|handlefile/.test(txt))acao='importar';else if(/criar|novo|adicionar|registrar/.test(txt))acao='criar';else if(/public|liberar/.test(txt))acao='publicar';else if(/finaliz|fecharinvent|encerrar/.test(txt))acao='finalizar';else if(/aprovar/.test(txt))acao='aprovar';else if(/bloquear/.test(txt))acao='bloquear';else if(/salvarconfig|apiset|mapeamento/.test(txt))acao='configurar';else if(/enviar|executar/.test(txt))acao='executar';else if(/salvar|editar|reatrib|confirmar/.test(txt))acao='editar';else if(/atualizar|refresh/.test(txt))acao='atualizar';if(acao!=='visualizar'&&!temPermissao(page,acao))el.style.display='none';});
    // Recebimento (fase 15/FASE 5) usa clique delegado (data-*) em vez de
    // onclick inline (obrigatório porque as linhas são geradas
    // dinamicamente — onclick inline não reaplica em HTML injetado depois
    // do primeiro carregamento). O laço acima nunca alcança esses botões,
    // então a ação de cada um é mapeada aqui, 1 pra 1 com o que
    // firestore.rules realmente exige (não é heurística por texto).
    const RECEBIMENTO_ACAO_POR_ATRIBUTO={
      'recop-novo':'criar','recop-iniciar-descarga':'editar','recop-finalizar-descarga':'editar','recop-conferencia':'editar','recop-finalizar':'finalizar','recop-detalhes':'editar','recop-cancelar':'cancelar','recop-nota-remover':'criar',
      'rebt-qr-teste':'gerar-qrcode','rebt-novo':'criar','rebt-saida':'editar','rebt-chegada':'editar','rebt-iniciar':'editar','rebt-fim-descarga':'editar','rebt-finalizar':'finalizar','rebt-cancelar':'cancelar','rebt-excluir':'excluir','rebt-excluir-todos':'excluir','rebt-editar-completo':'corrigir-horario',
      'recmot-novo':'editar','recmot-editar':'editar','recmot-excluir':'editar',
      'recveic-novo':'editar','recveic-editar':'editar','recveic-excluir':'editar',
      'recdoca-novo':'editar','recdoca-editar':'editar','recdoca-excluir':'editar',
      'recag-novo':'criar','recag-editar':'editar','recag-excluir':'excluir',
      'recist-exportar':'exportar',
      'recusa-ler-pdfs':'importar','recusa-salvar-import':'importar','recusa-sync-bluesoft':'importar','recusa-sync-agora':'importar','recusa-ler-import-cadastros':'importar','recusa-salvar-import-cadastros':'importar',
      'recusa-add':'editar','recusa-toggle':'editar','recusa-del':'excluir','recusa-excluir':'excluir',
      'recusa-atualizar':'visualizar','recusa-exportar':'exportar','recusa-solicitar-conf':'criar','recusa-tratamento':'editar',
    };
    const RECEBIMENTO_SELETOR=Object.keys(RECEBIMENTO_ACAO_POR_ATRIBUTO).map(k=>'[data-'+k+']').join(',');
    document.querySelectorAll(RECEBIMENTO_SELETOR).forEach(el=>{
      const page=el.closest('.page')?.id?.replace(/^page-/,'');
      if(!page||!MODULOS.some(m=>m.id===page))return;
      const attr=Object.keys(RECEBIMENTO_ACAO_POR_ATRIBUTO).find(k=>el.hasAttribute('data-'+k));
      const acao=attr&&RECEBIMENTO_ACAO_POR_ATRIBUTO[attr];
      if(acao&&!temPermissao(page,acao))el.style.display='none';
    });
  }
  // Só faz sentido logo após o login, pra escolher a tela inicial de quem
  // não tem nenhuma página ainda ativa. Ficava DENTRO de
  // aplicarPermissoesAnalista() antes — só que essa função agora roda a
  // toda hora (MutationObserver a cada mudança no DOM, redraw do
  // Recebimento a cada ação), e como a tela de Usuários e Permissões não
  // faz parte do sistema de `.page`, toda vez que o admin mexia numa
  // permissão (o contador "N de M" muda o DOM → dispara o observer) o app
  // pulava sozinho pra primeira aba liberada — exatamente a aba que
  // estava sendo mexida. Chamar só uma vez, no login, resolve sem tirar a
  // funcionalidade original (era só esse único ponto que precisava dela).
  function irParaPrimeiraPaginaPermitida(){
    const primeira=MODULOS.find(m=>temPermissao(m.id));if(!document.querySelector('.page.on')&&primeira)global.goPage?.(primeira.id,document.getElementById('nav-'+primeira.id));
  }
  // ── Setores (fase 1 da unificação com o Sistema de Produção) ──────────
  // Barra de abas no topo (Logística/Compras/PCP/Produção). Logística é o
  // Inventário de hoje, sem mudança nenhuma — só reclassificado como um
  // setor. Compras/PCP/Produção, nesta fase, são só um placeholder "em
  // construção"; os módulos reais entram nas próximas fases, um por vez.
  // PEDIDO AO VIVO (2026-09-10): "tirar PCP, Compras e Produção... como se
  // não fizesse mais parte do projeto" — Compras/PCP/Produção saíram deste
  // mapa de propósito. `irParaSetor()` já recusa qualquer id que não esteja
  // aqui (`if(!SETORES_INFO[id])return;`), e a barra de setores (linha
  // ~851, `Object.keys(SETORES_INFO)`) só oferece o que sobrou — não é só
  // "escondido", ninguém consegue mais navegar até lá pela UI. Os
  // `<script>` desses 3 setores também saíram de analista.html (só ficam
  // os poucos arquivos que o Recebimento usa de verdade, ver comentário
  // lá), então também não roda mais nenhum código nem leitura deles.
  var SETORES_INFO={
    logistica:{label:'🚚 Logística',icone:'🚚',titulo:'Logística'}
  };
  var _setorAtual='logistica';
  // Logística (fase 15/FASE 1) passou a ter DOIS contextos completos —
  // Inventário (shell de sempre) e Recebimento (sidebar própria,
  // #setor-logistica-recebimento-shell) — escolhidos pelo flyout do botão
  // "Logística". `_logisticaView` guarda qual dos dois está ativo; entra
  // sempre em 'inventario' por padrão, exatamente como hoje.
  var _logisticaView='inventario';
  function irParaSetor(id,view){
    if(!SETORES_INFO[id])return;
    if(id==='logistica'&&view)_logisticaView=view;
    _setorAtual=id;
    document.querySelectorAll('#setor-bar button').forEach(function(b){
      var ativo=b.id==='setor-btn-'+id;
      b.style.borderBottomColor=ativo?'var(--accent)':'transparent';
      b.style.color=ativo?'#fff':'rgba(255,255,255,.65)';
    });
    var logisticaEl=document.getElementById('app-main-logistica'),recebimentoShell=document.getElementById('setor-logistica-recebimento-shell'),placeholder=document.getElementById('setor-placeholder'),producaoShell=document.getElementById('setor-producao-shell'),pcpShell=document.getElementById('setor-pcp-shell'),comprasShell=document.getElementById('setor-compras-shell');
    if(logisticaEl)logisticaEl.style.display=(id==='logistica'&&_logisticaView==='inventario')?'flex':'none';
    if(recebimentoShell)recebimentoShell.style.display=(id==='logistica'&&_logisticaView==='recebimento')?'flex':'none';
    if(producaoShell)producaoShell.style.display=id==='producao'?'flex':'none';
    if(pcpShell)pcpShell.style.display=id==='pcp'?'flex':'none';
    if(comprasShell)comprasShell.style.display=id==='compras'?'flex':'none';
    if(id==='logistica'||id==='producao'||id==='pcp'||id==='compras'){
      if(placeholder)placeholder.style.display='none';
      if(id==='logistica'&&_logisticaView==='recebimento'&&!document.querySelector('#setor-logistica-recebimento-shell .page.on')){
        if(temPermissao('recebimento-dashboard','visualizar'))goPage('recebimento-dashboard',document.getElementById('nav-recebimento-dashboard'));
        else if(temPermissao('recebimento-operacao','visualizar'))goPage('recebimento-operacao',document.getElementById('nav-recebimento-operacao'));
        else if(temPermissao('recebimento-notas','visualizar'))goPage('recebimento-notas',document.getElementById('nav-recebimento-notas'));
        else if(temPermissao('recebimento-fornecedores','visualizar'))goPage('recebimento-fornecedores',document.getElementById('nav-recebimento-fornecedores'));
        else if(temPermissao('recebimento-agendamentos','visualizar'))goPage('recebimento-agendamentos',document.getElementById('nav-recebimento-agendamentos'));
        else if(temPermissao('recebimento-transbordo','visualizar'))goPage('recebimento-transbordo',document.getElementById('nav-recebimento-transbordo'));
        else if(temPermissao('recebimento-recusas','visualizar'))goPage('recebimento-recusas',document.getElementById('nav-recebimento-recusas'));
        else if(temPermissao('recebimento-config','visualizar'))goPage('recebimento-config',document.getElementById('nav-recebimento-config'));
        else{var pgr=document.getElementById('page-recebimento-dashboard');if(pgr){pgr.innerHTML='<div class="empty"><div class="empty-icon">🔒</div><div class="empty-title">Sem módulos liberados neste setor ainda</div></div>';pgr.classList.add('on');}}
      }
      if(id==='pcp'&&!document.querySelector('#setor-pcp-shell .page.on')){
        if(temPermissao('pcp-central','visualizar')&&typeof global.pcpIrParaAba==='function')global.pcpIrParaAba('dashboard',document.getElementById('nav-pcp-dashboard'));
        else{var pgp=document.getElementById('page-pcp-central');if(pgp){pgp.innerHTML='<div class="empty"><div class="empty-icon">🔒</div><div class="empty-title">Sem módulos liberados neste setor ainda</div></div>';pgp.classList.add('on');}}
      }
      if(id==='compras'&&!document.querySelector('#setor-compras-shell .page.on')){
        if(temPermissao('compras-central','visualizar')&&typeof global.comprasIrParaPagina==='function')global.comprasIrParaPagina('dashboard',document.getElementById('nav-compras-dashboard'));
        else{var pgc=document.getElementById('page-compras-central');if(pgc){pgc.innerHTML='<div class="empty"><div class="empty-icon">🔒</div><div class="empty-title">Sem módulos liberados neste setor ainda</div></div>';pgc.classList.add('on');}}
      }
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
        else if(temPermissao('producao-config','visualizar'))goPage('producao-config',document.getElementById('nav-producao-config'));
        else if(temPermissao('producao-importacao','visualizar'))goPage('producao-importacao',document.getElementById('nav-producao-importacao'));
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
  var RECEBIMENTO_MODULOS=['recebimento-dashboard','recebimento-operacao','recebimento-notas','recebimento-fornecedores','recebimento-agendamentos','recebimento-transbordo','recebimento-paletes','recebimento-patio-tempo-real','recebimento-recusas','recebimento-config'];
  // Engrenagem de Configurações (pedido ao vivo do usuário) — Usuários/
  // Coletores/Lojas/API são cross-loja, não fazem sentido enterrados dentro
  // só do setor Inventário; ficam na mesma linha dos setores, sempre
  // acessíveis de qualquer setor. String vazia (sem o ícone) se o usuário
  // não tiver nenhuma dessas permissões — evita mostrar uma engrenagem que
  // só abriria um painel vazio.
  // Correção estrutural (pedido ao vivo do usuário): as mesmas 3 opções
  // (Usuários/Coletores/Lojas) apareciam DUAS vezes — uma na engrenagem do
  // topo (só pra escolher qual abrir) e de novo como abas DENTRO do card
  // já aberto (mesmas 3 opções, mesmos nomes). A engrenagem agora é um
  // botão único que já abre direto na primeira opção que o usuário tem
  // permissão (Usuários → Coletores → Lojas, mesma ordem de antes) — as
  // abas de dentro do modal (cfgm-tab-*, HTML fixo em analista.html)
  // continuam sendo o único lugar de trocar entre as três.
  function _htmlFlyoutConfiguracoes(){
    var podeOperadores=temPermissao('operadores'),podeColetores=temPermissao('coletores'),podeLojas=temPermissao('lojas');
    var podeApi=temPermissao('importar-exportar');
    if(!podeOperadores&&!podeColetores&&!podeLojas&&!podeApi)return '';
    // "integracao" (Configuração da API — dt_config/integracao_api, usada
    // por Produção/PCP/Compras via 90-bluesoft-service.js, não só
    // Inventário) é a 4ª aba possível, mesmo padrão das outras 3 — cai pra
    // ela quando é a única coisa liberada, em vez do atalho antigo que
    // navegava direto pra Inventário → Importar/Exportar.
    // data-config-abrir (não onclick inline) porque este HTML é injetado via
    // .innerHTML — o sanitizador global de common-utils.js remove qualquer
    // atributo on* silenciosamente, sem erro nenhum no console; o clique
    // delegado em document já trata [data-config-abrir] mais abaixo.
    var primeiraAba=podeOperadores?'operadores':(podeColetores?'coletores':(podeLojas?'lojas':(podeApi?'integracao':null)));
    if(!primeiraAba)return '';
    return '<button type="button" id="setor-btn-config" data-config-abrir="'+primeiraAba+'" style="background:transparent;border:none;color:rgba(255,255,255,.65);padding:12px 16px;font-size:1rem;cursor:pointer;margin-left:auto" title="Configurações">⚙️</button>';
  }
  // Abas de dentro do modal seguem a MESMA permissão que antes decidia se o
  // item aparecia na engrenagem — sem isso, um usuário sem permissão de
  // "coletores" via a aba mesmo assim (só ficava invisível o atalho de
  // fora, não a aba de dentro).
  function _aplicarPermissaoAbasConfiguracoes(){
    var mapa={operadores:'cfgm-tab-operadores',coletores:'cfgm-tab-coletores',lojas:'cfgm-tab-lojas'};
    Object.keys(mapa).forEach(function(modulo){
      var el=document.getElementById(mapa[modulo]);
      if(el)el.style.display=temPermissao(modulo)?'':'none';
    });
    // A aba de Integração API segue a MESMA permissão que já gateava o
    // recurso em Inventário → Importar/Exportar ("importar-exportar") — não
    // é um módulo novo, só um segundo lugar de abrir a mesma tela.
    var elApi=document.getElementById('cfgm-tab-integracao');
    if(elApi)elApi.style.display=temPermissao('importar-exportar')?'':'none';
  }
  function aplicarSetoresPermitidos(){
    // Move page-integracao-api pro modal de Configurações já no boot (não só
    // na primeira vez que a engrenagem abre) — sem isso, quem for direto em
    // Inventário → Importar/Exportar → API antes de abrir a engrenagem veria
    // o card sumido: ele começa dentro de #ie-panel-api com class="page"
    // (escondida por padrão, só fica visível com .on), e só ganha .on
    // quando abrirModalConfiguracoes('integracao') roda.
    _moverPaginasParaModalConfiguracoes();
    var a=global.DT_USUARIO_ACESSO_ATUAL;if(!a)return;
    var admin=a.admin_mestre===true||a.administrador_mestre===true||a.perfil==='administrador';
    var setores=a.setores_permitidos||{};
    var idsLiberados=Object.keys(SETORES_INFO).filter(function(id){
      return admin||(id==='logistica'?setores.logistica!==false:setores[id]===true);
    });
    var bar=document.getElementById('setor-bar');if(!bar)return;
    var temAlgumaPermissaoRecebimento=RECEBIMENTO_MODULOS.some(function(m){return temPermissao(m);});
    var flyoutConfig=_htmlFlyoutConfiguracoes();
    // Antes, com só 1 setor liberado, a barra inteira ficava escondida (não
    // fazia sentido mostrar 1 aba só). Agora "Logística" pode esconder um
    // flyout com Recebimento dentro — se for esse o único setor E o usuário
    // tiver alguma permissão de Recebimento, a barra continua visível (só
    // com essa aba) pra não esconder o único jeito de chegar em Recebimento.
    // A engrenagem de Configurações também precisa continuar acessível
    // mesmo nesse caso (é cross-loja, não depende de setor nenhum liberado).
    if(idsLiberados.length<=1&&!(idsLiberados[0]==='logistica'&&temAlgumaPermissaoRecebimento)){
      bar.innerHTML=flyoutConfig;
      bar.style.display=flyoutConfig?'flex':'none';
      irParaSetor('logistica');
      return;
    }
    bar.innerHTML=idsLiberados.map(function(id){
      var btn='<button type="button" id="setor-btn-'+id+'" data-setor="'+id+'" style="background:transparent;border:none;color:rgba(255,255,255,.65);padding:12px 16px;font-size:.82rem;font-weight:700;cursor:pointer;border-bottom:3px solid transparent">'+SETORES_INFO[id].label+'</button>';
      // Fase 15 — só "Logística" ganha o flyout (Inventário/Recebimento);
      // os outros setores continuam abas simples, sem sub-navegação ainda.
      if(id!=='logistica')return btn;
      var itemRecebimento=temAlgumaPermissaoRecebimento?'<button type="button" class="setor-flyout-item" data-setor-view="recebimento">🚚 Recebimento</button>':'';
      return '<div class="setor-flyout-trigger">'+btn+
        '<div class="setor-flyout-panel">'+
          '<button type="button" class="setor-flyout-item" data-setor-view="inventario">📦 Inventário</button>'+
          itemRecebimento+
        '</div></div>';
    }).join('')+flyoutConfig;
    bar.style.display='flex';
    irParaSetor(idsLiberados.includes(_setorAtual)?_setorAtual:'logistica');
  }
  // ── Modal de Configurações (engrenagem no topo) ──────────────────────
  // As páginas reais (#page-operadores/#page-coletores/#page-lojas) nunca
  // mudam de conteúdo/lógica — só o nó de DOM é movido pra dentro do modal
  // na primeira vez que ele abre (idempotente: se já estiver lá, não faz
  // nada). goPage() continua funcionando igual, porque ele acha a página
  // por id (document.getElementById), não importa onde ela mora na árvore.
  function _moverPaginasParaModalConfiguracoes(){
    var destino=document.getElementById('modal-config-conteudo');
    if(!destino)return;
    ['page-operadores','page-coletores','page-lojas','page-integracao-api'].forEach(function(id){
      var el=document.getElementById(id);
      if(el&&el.parentNode!==destino)destino.appendChild(el);
    });
  }
  // goPage() troca .on em TODAS as .page do documento (não só dentro do
  // shell atual) — abrir o modal por cima de, por exemplo, PCP, e chamar
  // goPage('operadores',...) tiraria o .on da página do PCP que estava
  // ativa. Por isso guarda qual estava ativa ANTES de abrir, e restaura ao
  // fechar — assim o usuário volta pro exato lugar de onde saiu, sem
  // precisar navegar de novo (pedido ao vivo: "abrir numa janela na frente").
  var _paginaAntesConfig=null;
  function abrirModalConfiguracoes(pageId,itemEl){
    _moverPaginasParaModalConfiguracoes();
    var modalEl=document.getElementById('modal-configuracoes');
    if(modalEl&&!modalEl.classList.contains('open')){
      var atual=document.querySelector('.page.on');
      _paginaAntesConfig=atual?atual.id.replace(/^page-/,''):null;
    }
    global.openModal?.('modal-configuracoes');
    _aplicarPermissaoAbasConfiguracoes();
    document.querySelectorAll('#modal-configuracoes .cfgm-tab').forEach(function(b){b.classList.remove('on');});
    var tabBtn=document.getElementById('cfgm-tab-'+pageId);
    if(tabBtn)tabBtn.classList.add('on');
    // "integracao" não é um módulo de permissão de verdade (é a mesma tela
    // de sempre, "importar-exportar", só reaberta aqui) — goPage() genérico
    // checaria temPermissao('integracao','visualizar'), que não existe pra
    // ninguém, e bloquearia todo mundo. Mostra a página movida direto e
    // reaproveita ieSetTab('api') (já existente em
    // 43-importar-exportar-api.js) pra carregar a config salva nos campos.
    if(pageId==='integracao'){
      if(!temPermissao('importar-exportar')){global.showToast?.('Você não possui acesso a esta aba.','error');return;}
      document.querySelectorAll('.page').forEach(function(p){p.classList.remove('on');});
      var pg=document.getElementById('page-integracao-api');
      if(pg)pg.classList.add('on');
      var titEl=document.getElementById('page-title');if(titEl)titEl.textContent='Configurações · Integração API';
      global.ieSetTab?.('api');
      return;
    }
    goPage(pageId,document.getElementById('nav-'+pageId));
  }
  // PEDIDO AO VIVO (2026-08-27): "se eu tiver criando um e eu fechar, quando
  // eu clicar de novo lá nas configurações não é pra abrir já onde eu
  // estava, é pra abrir as configurações normal do começo" — fechar
  // Configurações agora também fecha Criar/Editar Usuário se algum dos
  // dois ficou aberto por cima, pra nunca reabrir Configurações já em cima
  // de um modal de usuário esquecido aberto.
  function fecharModalConfiguracoes(){
    global.closeModal?.('modal-configuracoes');
    const modalCriar=document.getElementById('op-modal-criar-bg');if(modalCriar)modalCriar.style.display='none';
    const modalEditar=document.getElementById('op-modal-bg');if(modalEditar)modalEditar.style.display='none';
    editando=null;editandoIndice=-1;
    if(_paginaAntesConfig)goPage(_paginaAntesConfig,document.getElementById('nav-'+_paginaAntesConfig));
    _paginaAntesConfig=null;
  }
  global.abrirModalConfiguracoes=abrirModalConfiguracoes;
  global.fecharModalConfiguracoes=fecharModalConfiguracoes;
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
  // Flyout de "Logística" (fase 15) — item do menu navega direto pra
  // Inventário ou Recebimento; clique no botão/gatilho alterna .open (fallback
  // pra telas touch, onde :hover não é confiável); clique fora fecha tudo.
  document.addEventListener('click',function(event){
    // Engrenagem de Configurações — checado ANTES do ramo genérico de
    // .setor-flyout-item logo abaixo (esses botões também têm essa classe,
    // só pra herdar o estilo do flyout; sem checar primeiro, cairiam no
    // ramo de baixo e chamariam irParaSetor('logistica', undefined) à toa).
    const itemConfig=event.target.closest('[data-config-abrir]');
    if(itemConfig){
      abrirModalConfiguracoes(itemConfig.dataset.configAbrir,itemConfig);
      itemConfig.closest('.setor-flyout-trigger')?.classList.remove('open');
      return;
    }
    const item=event.target.closest('.setor-flyout-item');
    if(item){
      irParaSetor('logistica',item.dataset.setorView);
      item.closest('.setor-flyout-trigger')?.classList.remove('open');
      return;
    }
    const trigger=event.target.closest('.setor-flyout-trigger');
    if(trigger){trigger.classList.toggle('open');return;}
    document.querySelectorAll('.setor-flyout-trigger.open').forEach(t=>t.classList.remove('open'));
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
  Object.assign(global,{DT_MODULOS_PERMISSOES:MODULOS,DT_PRESETS_PERMISSOES:PRESETS,temPermissao,aplicarPermissoesAnalista,irParaPrimeiraPaginaPermitida,listarOperadores,opFiltrarLista,opEditarUsuario,opExcluirUsuario,opExcluirUsuarioAtual,opSalvarEdicao,opFecharModal,opAbrirModalCriar,opFecharModalCriar,opSetModoLojasCriar,opSetModoLojasEditar,opGerarUsername,opGerarSenha,toggleOpSenha,toggleOpeditSenha,opValidarUsername,opValidarSenha,criarOperador,oplSetTab,opCarregarOperadoresParaFiltro,opVerificarMinhaConta,opMarcarPermissoes,opMarcarModulo,opAtualizarContagemModulo,opFiltrarPermissoes,opAbrirDiagnostico,opRessincronizarPermissoes,opAplicarPreset,opBuscarPorUid});
})(window);
