// Hub profissional de Compras: visão financeira restrita ao setor Compras.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n = v => Number(v) || 0;
  const money = v => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fs = () => global.getDTFirestore();
  const raw = () => global.getDTRawFirestore();
  const tem = a => typeof global.temPermissao!=='function'||global.temPermissao('compras-central',a);
  const nomeCompradorNorm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
  const primeiroNome = v => nomeCompradorNorm(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[.\s_-]+/)[0]||'';
  const seletorComprador=v=>nomeCompradorNorm(v);
  const nomeBateSeletor=(nome,seletor)=>{const n0=nomeCompradorNorm(nome),s0=nomeCompradorNorm(seletor);return !!s0&&(s0.includes(' ')?n0===s0:primeiroNome(n0)===primeiroNome(s0));};
  // PEDIDO AO VIVO (2026-09-18): "cada comprador s\u00f3 pesquisa os produtos
  // dele" vale pra tudo dentro de Compras \u2014 troca o gate antigo (qualquer
  // conta com permiss\u00e3o de visualizar o PCP via tudo, sem no\u00e7\u00e3o de
  // hierarquia) pelo mesmo papel comprador/gerente/admin cadastrado em
  // Usu\u00e1rios e Permiss\u00f5es (ver 37-usuarios-permissoes.js e a mesma l\u00f3gica
  // em 89-compras-dashboard.js, que j\u00e1 usa esse papel pro Dashboard).
  const papelCompras = () => {
    const a=global.DT_USUARIO_ACESSO_ATUAL||{};
    if(a.admin_mestre===true||a.administrador_mestre===true||a.perfil==='administrador')return'admin';
    return a.papelCompras||'';
  };
  const compradoresGerenciados = () => {
    const a=global.DT_USUARIO_ACESSO_ATUAL||{};
    return (Array.isArray(a.compradoresGerenciados)?a.compradoresGerenciados:[]).map(seletorComprador).filter(Boolean);
  };
  const compradorAtual = () => seletorComprador((global.DT_USUARIO_ACESSO_ATUAL||{}).nome||global._currentAnalistaUser?.displayName||global._currentAnalistaUser?.nome||String(global._currentAnalistaUser?.email||'').split('@')[0]||'');
  // Sem nome nenhum na linha (dado antigo/incompleto) sempre aparece \u2014
  // nunca esconder registro por falta de dado, s\u00f3 filtrar quando d\u00e1 pra
  // saber de quem \u00e9.
  const nomeCompradorDaLinha = a => seletorComprador(a?.compradorNome||a?.bluesoftCompradorNome||a?.comprador||a?.compradorEmail||a?.comprador_nome||'');
  // PEDIDO AO VIVO (2026-09-18): "o gerente vai poder pegar o login de uma
  // pessoa que vai sair de férias e unificar na outra... os pedidos da
  // pessoa aparecem TAMBÉM pra quem tá cobrindo" — cobertura temporária
  // (compras_cobertura_temporaria, cadastrada em 79-compras-central.js).
  // `_coberturasAtivas` guarda os primeiros nomes de quem EU estou
  // cobrindo agora — carregado 1x em load() (mesma disciplina de cache das
  // outras coleções deste arquivo).
  let _coberturasAtivas=[];
  async function carregarCoberturasAtivas(){
    const uid=global._currentAnalistaUser?.uid||global.firebase?.auth?.().currentUser?.uid||'';
    if(!uid||typeof global.getDTRawFirestore!=='function'){_coberturasAtivas=[];return _coberturasAtivas;}
    // try/catch (não só .catch() no .get()): um mock/coleção que não
    // suporta encadear 2x .where() lançaria SÍNCRONO, antes de chegar no
    // .get() — uma falha aqui nunca pode derrubar o carregamento do resto
    // da tela.
    try{
      const snap=await raw().collection('compras_cobertura_temporaria').where('substitutoUid','==',uid).where('ativo','==',true).get();
      _coberturasAtivas=snap.docs.map(d=>seletorComprador(d.data().origemNome||'')).filter(Boolean);
    }catch(_e){_coberturasAtivas=[];}
    return _coberturasAtivas;
  }
  // Genérica pra qualquer linha com um desses campos de comprador — usada
  // tanto pra agenda de recebimento quanto pra requisições (productGroups/
  // reportsPage) e histórico de preços (comprador_nome, vindo do BI).
  const linhaDoComprador = a => {
    const papel=papelCompras();
    if(papel==='admin')return true;
    const uid=global._currentAnalistaUser?.uid||global.firebase?.auth?.().currentUser?.uid||'';
    const linhaUid=String(a?.compradorUid||'');
    const coberturasDocs=(global._comprasInternals?.coberturas?.()||[]).filter(c=>c.ativo!==false&&String(c.substitutoUid||'')===String(uid));
    const uidsCobertos=coberturasDocs.map(c=>String(c.origemUid||'')).filter(Boolean);
    if(linhaUid&&(linhaUid===String(uid)||uidsCobertos.includes(linhaUid)))return true;
    const nomeLinha=nomeCompradorDaLinha(a);
    if(papel==='gerente'){
      const geridos=compradoresGerenciados().concat(_coberturasAtivas);
      return !geridos.length||(!nomeLinha&&!linhaUid)||geridos.some(sel=>nomeBateSeletor(nomeLinha,sel));
    }
    const atual=compradorAtual();
    const visiveis=[atual,..._coberturasAtivas].filter(Boolean);
    return !visiveis.length||(!nomeLinha&&!linhaUid)||visiveis.some(sel=>nomeBateSeletor(nomeLinha,sel));
  };
  const collections = { requests:'pcp_requisicoes_compra', products:'producao_produtos', schedules:'pcp_agendamentos', rules:'compras_regras_comprador', receiptAgenda:'recebimento_agendamentos' };
  let cache = { requests:[], products:[], schedules:[], rules:[], receiptAgenda:[], fornecedoresBi:[], consumoInsumosBi:[] }, query = '', selectedProduct = '', cotacaoAtivaId = '', cotacaoEditandoIdx = -1, cotacaoSelecionadaIdx = -1, compraCotacaoAtual=null;
  let filtrosCotacao = { busca:'', etapa:'' };
  let _fornecedoresBiCarregado=false, _consumoInsumosBiCarregado=false;
  let _fornecedoresBiPendente=null, _consumoInsumosBiPendente=null;
  let _baseCarregada=false, _basePendente=null;
  let _receiptAgendaCarregada=false, _receiptAgendaPendente=null;
  let precoFiltro={produto:'',produtoKey:'',inicio:'',fim:'',fornecedor:''}, precoLinhas=[], precoCarregando=false, precoErro='', precoChart=null;
  // PEDIDO AO VIVO (2026-09-18): "escrevo farofa e ele traz toda a família
  // junto" — em vez de buscar direto por texto solto (LIKE na descrição
  // inteira do período, que misturava TODAS as variantes de "farofa" no
  // mesmo gráfico), a caixa agora sugere produtos reais enquanto digita
  // (buscarProdutosComprasBigQuery) e só busca de verdade depois de
  // escolher UM da lista — aí sim exato, por produtoKey.
  let precoSugestoes=[], precoSugerindo=false, precoSugestoesTimer=null;
  let cotProdutoBusca='', cotProdutoSugestoes=[], cotProdutoSugerindo=false, cotProdutoTimer=null, cotProdutoSelecionado=null;
  let filtrosReceb={loja:'',produto:'',agendado:''};
  // PEDIDO AO VIVO (2026-08-27): "Minhas requisições" (Central de Compras)
  // e "Solicitações" (aqui) mostravam a MESMA coisa (pcp_requisicoes_compra,
  // já filtrada pro comprador logado — ver `load()` acima) — consolidado
  // num só lugar, com o nome e o comportamento (ação de registrar compra)
  // que antes só existiam em "Minhas requisições".
  const pageMeta = {
    solicitacoes:['Solicitações PCP','📥'], cotacoes:['Cotações','⚖️'], pedidos:['Pedidos','🧾'], produtos:['Produtos','🔎'], precos:['Análise de Preços','💹'],
    fornecedores:['Fornecedores','🏢'], recebimentos:['Recebimentos','🚚'], relatorios:['Relatórios','📈'], administracao:['Administração','⚙️']
  };
  const key = x => String(x?.prodKey || x?.cod || '').trim() || String(x?.produto || x?.nome || '').trim().toLowerCase();
  const date = v => String(v || '').slice(0,10) || '—';
  const status = s => `<span class="badge ${/cancel|rejeit/i.test(s)?'b-red':/parcial/i.test(s)?'b-orange':/recebid|final|comprad/i.test(s)?'b-green':/analise|cotacao|pedido/i.test(s)?'b-blue':'b-orange'}">${esc(s||'solicitada')}</span>`;
  const requisicaoEncerrada=x=>/^(comprada|finalizada|finalizado|cancelada|cancelado|rejeitada|rejeitado)$/i.test(String(x?.status||''));
  const totalCompradoReq=x=>Array.isArray(x?.pedidosCompra)&&x.pedidosCompra.length?x.pedidosCompra.reduce((s,p)=>s+n(p.quantidade),0):n(x?.quantidadeComprada);
  const saldoComprarReq=x=>Math.max(0,n(x?.quantidade)-totalCompradoReq(x));
  async function load(force=false) {
    if (!force && _baseCarregada) return cache;
    if (_basePendente) return _basePendente;
    _basePendente=(async()=>{
      const empty={docs:[]},uid=global._currentAnalistaUser?.uid||global.firebase?.auth?.().currentUser?.uid||'';
      // PEDIDO AO VIVO (2026-09-18): gerente precisa ver as requisições da
      // equipe dele (várias pessoas, sem UID conhecido aqui), não só as
      // próprias — então consulta sem o filtro de UID (igual admin) e o
      // recorte por comprador acontece depois, em nome (linhaDoComprador).
      await carregarCoberturasAtivas();
      const nomesBase=['requests','products','schedules','rules'];
      const snaps=await Promise.all(nomesBase.map(name=>fs().collection(collections[name]).get().catch(()=>empty)));
      const lojaId=global.getDTLojaAtiva?.()||'',lojaNome=global.getDTLojaAtivaNome?.()||lojaId;
      nomesBase.forEach((name,i)=>{const lista=snaps[i].docs.map(d=>({_id:d.id,lojaId,lojaNome,...d.data()}));cache[name]=(name==='requests'||name==='schedules')?lista.filter(linhaDoComprador):lista;});
      _cfMapaDesempenho=null;
      _baseCarregada=true;
      return cache;
    })();
    try{return await _basePendente;}finally{_basePendente=null;}
  }
  async function loadReceiptAgenda(force=false){
    if(_receiptAgendaCarregada&&!force)return cache.receiptAgenda;
    if(_receiptAgendaPendente)return _receiptAgendaPendente;
    const empty={docs:[]};
    _receiptAgendaPendente=(async()=>{
      const snap=await fs().collection(collections.receiptAgenda).get().catch(()=>empty);
      const lojaId=global.getDTLojaAtiva?.()||'',lojaNome=global.getDTLojaAtivaNome?.()||lojaId;
      cache.receiptAgenda=snap.docs.map(d=>({_id:d.id,lojaId,lojaNome,...d.data()})).filter(linhaDoComprador);
      _receiptAgendaCarregada=true;
      return cache.receiptAgenda;
    })();
    try{return await _receiptAgendaPendente;}finally{_receiptAgendaPendente=null;}
  }
  async function loadFornecedoresBi(force=false){
    if(_fornecedoresBiCarregado&&!force)return cache.fornecedoresBi;
    if(_fornecedoresBiPendente)return _fornecedoresBiPendente;
    const empty={docs:[]};
    _fornecedoresBiPendente=(async()=>{
      const snap=typeof global.getDTRawFirestore==='function'?await raw().collection('bi_fornecedores_agregado').get().catch(()=>empty):empty;
      cache.fornecedoresBi=snap.docs.map(d=>({_id:d.id,...d.data()}));
      _fornecedoresBiCarregado=true;
      return cache.fornecedoresBi;
    })();
    try{return await _fornecedoresBiPendente;}finally{_fornecedoresBiPendente=null;}
  }
  async function loadConsumoInsumosBi(force=false){
    if(_consumoInsumosBiCarregado&&!force)return cache.consumoInsumosBi;
    if(_consumoInsumosBiPendente)return _consumoInsumosBiPendente;
    const empty={docs:[]};
    _consumoInsumosBiPendente=(async()=>{
      const snap=typeof global.getDTRawFirestore==='function'?await raw().collection('bi_consumo_insumos_resumo').get().catch(()=>empty):empty;
      cache.consumoInsumosBi=snap.docs.map(d=>({_id:d.id,...d.data()}));
      _consumoInsumosBiCarregado=true;
      return cache.consumoInsumosBi;
    })();
    try{return await _consumoInsumosBiPendente;}finally{_consumoInsumosBiPendente=null;}
  }
  function header(title, subtitle) { return `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px"><div><div class="page-title" style="font-size:1.15rem">${title}</div><div style="font-size:.74rem;color:var(--muted)">${subtitle}</div></div><button class="btn btn-ghost btn-sm" data-cp-refresh>↻ Atualizar</button></div>`; }
  function table(head, rows, empty='Nenhum registro encontrado.') { return `<div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${head.length}">${empty}</td></tr>`}</tbody></table></div></div>`; }
  function _alteracaoPcpLabel(x){const p=x?.pcpAlteracaoPendente;if(p?.status==='pendente')return `<span class="badge b-orange">⚠ ${esc(p.tipo)}</span>`;if(/cancel/i.test(String(x?.status||'')))return '<span class="badge b-red">Cancelada pelo PCP</span>';return '—';}
  function requestsPage() {
    const base=cache.requests.filter(linhaDoComprador).filter(x=>String(x.origem||'').toUpperCase()!=='COMPRAS_COTACAO');
    const xs=base.filter(x=>!query||JSON.stringify(x).toLowerCase().includes(query));
    const ym=new Date().toISOString().slice(0,7),mes=base.filter(x=>String(x.dataNecessaria||x.criadoEm||'').slice(0,7)===ym),alteracoes=base.filter(x=>x.pcpAlteracaoPendente?.status==='pendente'),canceladasMes=mes.filter(x=>/cancel/i.test(String(x.status||''))),semCompraMes=mes.filter(x=>!requisicaoEncerrada(x)&&totalCompradoReq(x)<=0);
    const resumo=`<div class="kpi-grid" style="margin-bottom:12px"><div class="kpi blue"><div class="kpi-val">${mes.length}</div><div class="kpi-lbl">Solicitações para este mês</div></div><div class="kpi orange"><div class="kpi-val">${semCompraMes.length}</div><div class="kpi-lbl">Ainda não compradas</div></div><div class="kpi teal"><div class="kpi-val">${alteracoes.length}</div><div class="kpi-lbl">Alterações solicitadas pelo PCP</div></div><div class="kpi red"><div class="kpi-val">${canceladasMes.length}</div><div class="kpi-lbl">Canceladas pelo PCP no mês</div></div></div>`;
    const aviso=alteracoes.length?`<div class="tc" style="padding:10px 12px;margin-bottom:12px;border-left:4px solid #f59e0b"><b>🔔 ${alteracoes.length} alteração(ões) do PCP aguardando resposta</b><div style="font-size:.7rem;color:var(--muted);margin-top:3px">Cancelamentos, postergações ou mudanças de quantidade precisam ser confirmados aqui quando já existe compra.</div></div>`:'';
    return header('📥 Solicitações PCP','Pedidos direcionados pelo PCP — compras parciais permanecem abertas até completar a quantidade solicitada.')+resumo+aviso+`<div class="tc" style="padding:12px;margin-bottom:12px"><input class="field" data-cp-search placeholder="Produto, código, solicitante ou status..." value="${esc(query)}"></div>`+table(['Produto','Solicitado','Comprado','Saldo','Necessidade','Destino','Motivo','Prioridade','Comprador','Status','Alteração PCP','Criada em','Pedido(s)',''],xs.map(x=>{const total=totalCompradoReq(x),saldo=saldoComprarReq(x),pedidos=Array.isArray(x.pedidosCompra)?x.pedidosCompra:[];const nums=pedidos.length?pedidos.map(p=>p.numeroCompra).filter(Boolean).join(', '):(x.numeroCompra||'—');return `<tr ${x.pcpAlteracaoPendente?.status==='pendente'?'style="background:rgba(245,158,11,.08)"':''}><td><b>${esc(x.produto)}</b></td><td>${n(x.quantidade).toLocaleString('pt-BR')}</td><td>${total.toLocaleString('pt-BR')}</td><td>${saldo.toLocaleString('pt-BR')}</td><td>${date(x.dataNecessaria)}</td><td>${esc(x.destino||'—')}</td><td>${esc(x.motivo||'—')}</td><td>${esc(x.prioridade||'normal')}</td><td>${esc(x.compradorNome||x.compradorEmail||'Não direcionado')}</td><td>${status(x.status)}</td><td>${_alteracaoPcpLabel(x)}</td><td>${date(x.criadoEm)}</td><td>${esc(nums)}</td><td style="white-space:nowrap">${tem('editar')&&x.pcpAlteracaoPendente?.status==='pendente'?`<button class="acao-lapis" data-cp-req-responder="${esc(x._id)}" title="Responder alteração solicitada pelo PCP">🔔</button>`:''}${tem('editar')&&!requisicaoEncerrada(x)&&saldo>0&&!x.pcpAlteracaoPendente?`<button class="acao-lapis" data-cp-req-analise="${esc(x._id)}" title="Em análise">🔎</button><button class="acao-lapis" data-cp-req-comprar="${esc(x._id)}" title="Registrar compra">🛒</button>`:''}</td></tr>`;}).join(''))+'<div id="cp-req-modal-host"></div>';
  }
  function modalResponderAlteracaoPCP(id){const x=cache.requests.find(r=>r._id===id),p=x?.pcpAlteracaoPendente,host=document.getElementById('cp-req-modal-host');if(!x||!p||!host)return;const detalhe=p.tipo==='postergacao'?`Data: <b>${esc(p.dataAnterior||x.dataNecessaria||'—')}</b> → <b>${esc(p.novaData||'—')}</b>`:p.tipo==='quantidade'?`Quantidade: <b>${n(p.quantidadeAnterior||x.quantidade).toLocaleString('pt-BR')}</b> → <b>${n(p.novaQuantidade).toLocaleString('pt-BR')}</b>`:'O PCP solicita o cancelamento desta solicitação/pedido.';host.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:580px"><div class="modal-header"><div><b>Alteração solicitada pelo PCP</b><small>${esc(x.produto)}</small></div><button class="modal-x" data-cp-req-modal-close>×</button></div><div class="modal-body"><div class="tc" style="padding:12px;border-left:4px solid #f59e0b"><b>${esc(p.tipo)}</b><div style="margin-top:5px">${detalhe}</div>${p.motivo?`<div style="font-size:.75rem;margin-top:6px"><b>Motivo:</b> ${esc(p.motivo)}</div>`:''}</div><div class="form-group" style="margin-top:12px"><label>Retorno para o PCP</label><textarea class="field" id="cp-req-resp-obs" rows="3" placeholder="Observação opcional"></textarea></div></div><div class="modal-footer"><button class="btn btn-danger" data-cp-req-resp="${esc(id)}|nao">Não foi possível alterar</button><button class="btn btn-primary" data-cp-req-resp="${esc(id)}|sim">Confirmar alteração</button></div></div></div>`;}
  async function responderAlteracaoPCP(id,aceitar){if(!tem('editar'))return;const svc=global.DTPCPSolicitacoesWorkflow;if(!svc)throw new Error('Workflow PCP/Compras indisponível.');const obs=document.getElementById('cp-req-resp-obs')?.value.trim()||'';await svc.responderAlteracao(id,aceitar,obs);const h=document.getElementById('cp-req-modal-host');if(h)h.innerHTML='';await load(true);render(_nomePaginaAtiva());global.showToast?.(aceitar?'Alteração confirmada e PCP notificado.':'PCP notificado de que a alteração não foi possível.',aceitar?'success':'warning');}
  function modalRegistrarCompra(id, preenchimento) { const x=cache.requests.find(r=>r._id===id),host=document.getElementById('cp-req-modal-host'); if(!x||!host)return; const pre=preenchimento||{}; cotacaoSelecionadaIdx=Number.isInteger(pre.cotacaoIdx)?pre.cotacaoIdx:-1; compraCotacaoAtual=pre.cotacao||null; const saldo=Math.max(0,saldoComprarReq(x)); host.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:620px"><div class="modal-header"><b>Registrar compra — ${esc(x.produto)}</b><button class="modal-x" data-cp-req-modal-close>×</button></div><div class="modal-body">${cotacaoSelecionadaIdx>=0?'<div class="cp-cot-choice">✓ Proposta selecionada no mapa de cotações. Confirme os dados e informe o número do pedido.</div>':''}<div class="grid2"><div class="form-group"><label>Número da compra/pedido *</label><input class="field" id="cp-req-num" autofocus></div><div class="form-group"><label>Fornecedor *</label><input class="field" id="cp-req-forn" value="${esc(pre.fornecedor||'')}"></div><div class="form-group"><label>Quantidade comprada *</label><input class="field" id="cp-req-qtd" type="number" min="0" value="${n(pre.quantidade)||saldo||n(x.quantidade)}"></div><div class="form-group"><label>Preço unitário *</label><input class="field" id="cp-req-preco" type="number" min="0" step="0.01" value="${pre.precoUnitario?n(pre.precoUnitario):''}" placeholder="0,00"></div><div class="form-group"><label>Previsão de entrega *</label><input class="field" id="cp-req-prev" type="date" value="${esc(pre.dataPrevista||'')}"></div></div><div class="form-group"><label>Observações</label><textarea class="field" id="cp-req-obs" rows="3">${esc(pre.observacao||x.observacaoCompras||'')}</textarea></div></div><div class="modal-footer"><button class="btn btn-ghost" data-cp-req-modal-close>Cancelar</button><button class="btn btn-primary" data-cp-req-save="${esc(id)}">Confirmar e gerar pedido</button></div></div></div>`; }
  // "Usar esta cotação" abre o modal de compra a partir da aba Cotações —
  // salvar precisa voltar pra aba de onde veio, não sempre Solicitações.
  function _nomePaginaAtiva() { const active=document.querySelector('#setor-compras-shell .nav-item.on'); return (active?.id||'').replace('nav-compras-','')||'solicitacoes'; }
  async function marcarEmAnalise(id) { const x=cache.requests.find(r=>r._id===id); if(!x||!tem('editar'))return; await fs().collection(collections.requests).doc(id).set({status:'em_analise',atualizadoEm:new Date().toISOString(),atualizadoPor:global._currentAnalistaUser?.email||''},{merge:true}); await global.DTPCPSolicitacoesWorkflow?.registrarEvento?.(id,'em_analise_compras'); await load(true); render(_nomePaginaAtiva()); }
  async function _validarFornecedorProduto(nome,produtoKey){const s=svcForn?.();if(!s)throw new Error('Cadastro mestre de fornecedores indisponível. Atualize a tela e tente novamente.');const norm=typeof s.normalizarNomeFornecedor==='function'?s.normalizarNomeFornecedor:v=>String(v||'').trim().toLowerCase(),alvo=norm(nome);let vinc=null;if(produtoKey&&typeof s.listarHomologadosPorProduto==='function'){const lista=await s.listarHomologadosPorProduto(String(produtoKey));vinc=lista.find(v=>norm(v.fornecedorNome||v.nomeFantasia||'')===alvo)||null;}else if(typeof s.resolverFornecedorAptoPorNome==='function'){vinc=await s.resolverFornecedorAptoPorNome(nome);}if(!vinc)throw new Error(produtoKey?'Fornecedor não está ativo/homologado para este produto no cadastro mestre.':'Fornecedor não está ativo/homologado no cadastro mestre.');const fornecedorId=vinc.fornecedorId||vinc._id||'';if(fornecedorId&&typeof s.buscarPorId==='function'){const mestre=await s.buscarPorId(fornecedorId);if(!mestre||s.estaBloqueado?.(mestre)||!/^(ativo)$/i.test(String(mestre.situacao||'ativo'))||String(mestre.homologacao?.status||'')!=='homologado'||((s.documentosVencidos?.(mestre)||[]).length>0))throw new Error('Fornecedor está bloqueado, não homologado ou com documentação vencida.');}return vinc;}
  // Compatibilidade: campos legados continuam sendo gravados no documento raiz: fornecedor,quantidadeComprada,precoUnitario.
  async function salvarCompraSolicitacao(id) {
    if(!tem('editar'))return;
    const req=cache.requests.find(r=>r._id===id);if(!req)return;
    const numeroCompra=document.getElementById('cp-req-num')?.value.trim()||'',fornecedor=document.getElementById('cp-req-forn')?.value.trim()||'',quantidadeComprada=Math.max(0,n(document.getElementById('cp-req-qtd')?.value)),precoUnitario=Math.max(0,n(document.getElementById('cp-req-preco')?.value)),dataPrevista=document.getElementById('cp-req-prev')?.value||'',observacaoCompras=document.getElementById('cp-req-obs')?.value.trim()||'';
    if(!numeroCompra||!fornecedor||quantidadeComprada<=0||!dataPrevista){global.showToast?.('Informe número da compra, fornecedor, quantidade e previsão de entrega.','warning');return;}
    const saldoAntes=saldoComprarReq(req);
    const minimoCotacao=cotacaoSelecionadaIdx>=0?Math.max(0,n(compraCotacaoAtual?.quantidadeMinima)):0;
    const excessoJustificadoPorMinimo=minimoCotacao>saldoAntes&&quantidadeComprada>=minimoCotacao;
    if(n(req.quantidade)>0&&quantidadeComprada>saldoAntes&&!excessoJustificadoPorMinimo){global.showToast?.('A quantidade informada é maior que o saldo ainda não comprado ('+saldoAntes.toLocaleString('pt-BR')+').','warning');return;}
    let vinculo=null;try{vinculo=await _validarFornecedorProduto(fornecedor,req.prodKey||req.cod||'');}catch(e){global.showToast?.(e.message||String(e),'warning');return;}
    const agora=new Date().toISOString(),atorUid=global._currentAnalistaUser?.uid||global.firebase?.auth?.().currentUser?.uid||'',atorNome=global._currentAnalistaUser?.nome||global._currentAnalistaUser?.displayName||'',atorEmail=global._currentAnalistaUser?.email||'';
    // A cobertura temporária não transfere a carteira: o responsável continua
    // sendo o comprador original da requisição. Quem executou a compra fica
    // registrado em compradoPor/compradoPorUid para auditoria.
    const compradorUid=req.compradorUid||atorUid,compradorNome=req.compradorNome||atorNome,compradorEmail=req.compradorEmail||atorEmail;
    const cotacaoFinal=compraCotacaoAtual?{...compraCotacaoAtual,precoUnitario}:null;
    const custos=cotacaoFinal?_custosCotacao(cotacaoFinal,quantidadeComprada):{subtotal:precoUnitario*quantidadeComprada,frete:0,impostos:0,desconto:0,total:precoUnitario*quantidadeComprada,custoEfetivoUnit:precoUnitario};
    const pedidosAnteriores=Array.isArray(req.pedidosCompra)?req.pedidosCompra.slice():[];
    if(pedidosAnteriores.some(p=>String(p.numeroCompra||'').trim()===numeroCompra)){global.showToast?.('Esse número de pedido já foi registrado nesta solicitação.','warning');return;}
    if(!pedidosAnteriores.length&&req.numeroCompra&&n(req.quantidadeComprada)>0)pedidosAnteriores.push({numeroCompra:req.numeroCompra,fornecedor:req.fornecedor||'',quantidade:n(req.quantidadeComprada),precoUnitario:n(req.precoUnitario),valorTotal:n(req.valorTotal),dataPrevista:req.dataPrevista||'',compradoEm:req.compradoEm||''});
    const pedido={numeroCompra,fornecedor,fornecedorId:vinculo?.fornecedorId||'',quantidade:quantidadeComprada,precoUnitario,subtotal:custos.subtotal,frete:custos.frete,impostos:custos.impostos,desconto:custos.desconto,valorTotalEfetivo:custos.total,custoEfetivoUnit:custos.custoEfetivoUnit,dataPrevista,observacaoCompras,compradoEm:agora,compradoPor:atorEmail||compradorEmail,compradoPorUid:atorUid,cotacaoIdx:cotacaoSelecionadaIdx};
    const pedidosCompra=[...pedidosAnteriores,pedido],totalComprado=pedidosCompra.reduce((s,p)=>s+n(p.quantidade),0),saldoComprar=Math.max(0,n(req.quantidade)-totalComprado),excessoCompra=Math.max(0,totalComprado-n(req.quantidade)),valorTotal=pedidosCompra.reduce((s,p)=>s+n(p.subtotal??p.valorTotal),0),valorTotalEfetivo=pedidosCompra.reduce((s,p)=>s+n(p.valorTotalEfetivo??p.valorTotal),0),statusReq=n(req.quantidade)>0&&saldoComprar>0?'parcialmente_comprada':'comprada';
    const payload={numeroCompra,fornecedor,fornecedorId:vinculo?.fornecedorId||'',quantidadeComprada:totalComprado,saldoComprar,excessoCompra,precoUnitario,valorTotal,valorTotalEfetivo,dataPrevista,observacaoCompras,status:statusReq,compradoEm:agora,compradoPor:atorEmail||compradorEmail,compradoPorUid:atorUid,pedidosCompra,atualizadoEm:agora};
    if(cotacaoSelecionadaIdx>=0){
      const pontuadas=_pontuarCotacoes(req.cotacoes||[],quantidadeComprada),escolhida=pontuadas.find(c=>c._idx===cotacaoSelecionadaIdx),alternativas=pontuadas.filter(c=>c._idx!==cotacaoSelecionadaIdx),segunda=alternativas.slice().sort((a,b)=>a.custos.total-b.custos.total)[0]||null;
      payload.cotacoes=(req.cotacoes||[]).map((c,i)=>({...c,selecionada:i===cotacaoSelecionadaIdx||c.selecionada===true,selecionadaEm:i===cotacaoSelecionadaIdx?agora:(c.selecionadaEm||''),selecionadaPor:i===cotacaoSelecionadaIdx?(atorEmail||compradorEmail):(c.selecionadaPor||'')}));
      payload.decisaoCotacao={fornecedor:escolhida?.fornecedor||fornecedor,fornecedorId:vinculo?.fornecedorId||'',score:escolhida?.score??null,custoEfetivo:escolhida?.custos?.total??custos.total,segundaOpcao:segunda?.fornecedor||'',segundaOpcaoCusto:segunda?.custos?.total??null,economiaEstimada:segunda?Math.max(0,n(segunda.custos.total)-n(escolhida?.custos?.total??custos.total)):0,decididoEm:agora,decididoPor:atorEmail||compradorEmail,decididoPorUid:atorUid};
    }
    try{
      await fs().collection(collections.requests).doc(id).set(payload,{merge:true});
      const sid=pedidosAnteriores.length?'req_'+id+'_'+String(numeroCompra).replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,80):'req_'+id;
      await fs().collection(collections.schedules).doc(sid).set({requisicaoId:id,cod:req.prodKey||req.cod||'',prodKey:req.prodKey||req.cod||'',produto:req.produto||'',fornecedor,fornecedorId:vinculo?.fornecedorId||'',quantidade:quantidadeComprada,quantidadeRecebida:0,dataPrevista,numeroCompra,precoUnitario,valorTotal:custos.total,custoEfetivoUnit:custos.custoEfetivoUnit,compradorUid,compradorNome,compradorEmail,registradoPorUid:atorUid,registradoPor:atorEmail||'',destino:req.destino||'',pcpResponsavel:req.pcpResponsavel||'',status:'prevista',origem:'COMPRAS',criadoEm:agora,atualizadoEm:agora},{merge:true});
      await global.DTPCPSolicitacoesWorkflow?.registrarEvento?.(id,'compra_registrada',{numeroCompra,fornecedor,quantidade:quantidadeComprada,dataPrevista});
      document.getElementById('cp-req-modal-host').innerHTML='';cotacaoSelecionadaIdx=-1;compraCotacaoAtual=null;await load(true);render(_nomePaginaAtiva());global.showToast?.(statusReq==='comprada'?'Solicitação comprada integralmente.':'Compra parcial registrada. Saldo restante: '+saldoComprar.toLocaleString('pt-BR')+'.','success');
    }catch(e){global.showToast?.('Erro ao registrar compra: '+(e.message||e),'error');}
  }

  // Comparação de cotações: o histórico operacional do fornecedor usa
  // recebimentos CONFIRMADOS em pcp_agendamentos (recebidoEm), nunca a data
  // de agendamento logístico. Isso evita confundir "marcou para receber"
  // com "entregou de verdade". A mesma coleção já é carregada no load()
  // base desta tela; portanto esta análise não adiciona nenhuma leitura.
  const PESOS_COTACAO = { preco:0.40, prazo:0.20, pagamento:0.15, qtdMinima:0.10, frete:0.05, historico:0.10 };
  function _isoMaisDias(dias) { const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+Math.max(0,Math.floor(n(dias))));return d.toISOString().slice(0,10); }
  function _diasAte(data) { if(!data)return null;const hoje=new Date();hoje.setHours(0,0,0,0);const alvo=new Date(String(data).slice(0,10)+'T00:00:00');return Number.isFinite(alvo.getTime())?Math.ceil((alvo-hoje)/86400000):null; }
  function _custosCotacao(c, quantidadeSolicitada) {
    const qtdNecessaria=Math.max(1,n(quantidadeSolicitada));
    const qtdCompra=Math.max(qtdNecessaria,n(c.quantidadeMinima));
    const subtotal=n(c.precoUnitario)*qtdCompra;
    const frete=c.freteIncluso?0:Math.max(0,n(c.freteValor));
    const impostos=subtotal*Math.max(0,n(c.impostosPct))/100;
    const desconto=subtotal*Math.max(0,n(c.descontoPct))/100+Math.max(0,n(c.bonusValor));
    const total=Math.max(0,subtotal+frete+impostos-desconto);
    return {qtdNecessaria,qtdCompra,subtotal,frete,impostos,desconto,total,custoEfetivoUnit:qtdCompra?total/qtdCompra:0,custoPorNecessidade:qtdNecessaria?total/qtdNecessaria:0};
  }
  function _normalizarFornecedorDesempenho(v) {
    const fn=global._fornecedoresService?.normalizarNomeFornecedor;
    if(typeof fn==='function')return fn(v);
    return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');
  }
  function _chaveFornecedorDesempenho(fornecedorId,nome) {
    const id=String(fornecedorId||'').trim();
    return id?'id:'+id:(_normalizarFornecedorDesempenho(nome)?'nome:'+_normalizarFornecedorDesempenho(nome):'');
  }
  function _buscarDesempenhoFornecedor(mapa,{fornecedorId='',fornecedor='' }={}) {
    const porId=_chaveFornecedorDesempenho(fornecedorId,'');
    if(porId&&mapa[porId])return mapa[porId];
    const porNome=_chaveFornecedorDesempenho('',fornecedor);
    return porNome?mapa[porNome]||null:null;
  }
  function _diaUtc(v) {
    if(!v)return null;
    const str=String(v).slice(0,10),d=new Date(str+'T00:00:00Z');
    return Number.isFinite(d.getTime())?d:null;
  }
  function _diasEntreDatas(inicio,fim) {
    const a=_diaUtc(inicio),b=_diaUtc(fim);
    return a&&b?Math.round((b-a)/86400000):null;
  }
  function _desempenhoFornecedoresReais() {
    const reqPorId=new Map(),reqPorPedido=new Map();
    (cache.requests||[]).forEach(r=>{
      if(r._id)reqPorId.set(String(r._id),r);
      if(r.numeroCompra)reqPorPedido.set(String(r.numeroCompra),r);
      (Array.isArray(r.pedidosCompra)?r.pedidosCompra:[]).forEach(p=>{if(p?.numeroCompra)reqPorPedido.set(String(p.numeroCompra),{...r,numeroCompra:p.numeroCompra,compradoEm:p.compradoEm||r.compradoEm});});
    });
    const porFornecedor=new Map();
    (cache.schedules||[]).forEach(a=>{
      const recebido=a.recebidoEm||a.dataRecebimento||'';
      const previsto=a.dataPrevista||'';
      const total=n(a.quantidade),qtdRecebida=n(a.quantidadeRecebida);
      const status=String(a.status||'').toLowerCase();
      const final=/^finalizada?$|^recebida?$/.test(status)||(total>0&&qtdRecebida>=total);
      if(!final||!recebido||!previsto)return;
      const fornecedor=a.fornecedor||a.fornecedorNome||'';
      const req=(a.requisicaoId&&reqPorId.get(String(a.requisicaoId)))||(a.numeroCompra&&reqPorPedido.get(String(a.numeroCompra)))||null;
      const fornecedorId=String(a.fornecedorId||req?.fornecedorId||'').trim();
      const chave=_chaveFornecedorDesempenho(fornecedorId,fornecedor||req?.fornecedor);
      if(!chave)return;
      const desvio=_diasEntreDatas(previsto,recebido);
      if(desvio==null)return;
      const dataPedido=req?.compradoEm||a.criadoEm||'';
      const leadReal=_diasEntreDatas(dataPedido,recebido);
      const acc=porFornecedor.get(chave)||{fornecedorId,fornecedor:fornecedor||req?.fornecedor||fornecedorId,entregas:0,noPrazo:0,atrasadas:0,adiantadas:0,somaDesvio:0,somaAtraso:0,atrasoMaxDias:0,leadTimes:[],ultimas:[]};
      acc.entregas++;
      if(desvio<=0)acc.noPrazo++;else acc.atrasadas++;
      if(desvio<0)acc.adiantadas++;
      acc.somaDesvio+=desvio;acc.somaAtraso+=Math.max(0,desvio);acc.atrasoMaxDias=Math.max(acc.atrasoMaxDias,Math.max(0,desvio));
      if(leadReal!=null&&leadReal>=0)acc.leadTimes.push(leadReal);
      acc.ultimas.push({numeroCompra:a.numeroCompra||'',produto:a.produto||'',previsto:String(previsto).slice(0,10),recebido:String(recebido).slice(0,10),desvioDias:desvio,leadTimeRealDias:leadReal,quantidade:qtdRecebida||total});
      porFornecedor.set(chave,acc);
    });
    // Recebimento/logística também pode ser fonte, mas SOMENTE quando o documento traz um horário real de recebimento/fechamento. Data agendada ou prevista nunca vira entrega real.
    (cache.receiptAgenda||[]).forEach(a=>{
      const recebido=a.recebidoEm||a.dataRecebimento||a.horaFechamentoRecebimento||'';const previsto=a.dataPrevista||a.dataEntregaInicial||'';if(!recebido||!previsto)return;
      const fornecedor=a.fornecedorNome||a.fornecedor||'',numero=String(a.numeroPedido||a.numeroCompra||''),req=reqPorPedido.get(numero)||null;
      const fornecedorId=String(a.fornecedorId||req?.fornecedorId||'').trim(),chave=_chaveFornecedorDesempenho(fornecedorId,fornecedor||req?.fornecedor);if(!chave)return;const desvio=_diasEntreDatas(previsto,recebido);if(desvio==null)return;
      const acc=porFornecedor.get(chave)||{fornecedorId,fornecedor:fornecedor||req?.fornecedor||fornecedorId,entregas:0,noPrazo:0,atrasadas:0,adiantadas:0,somaDesvio:0,somaAtraso:0,atrasoMaxDias:0,leadTimes:[],ultimas:[]};
      const leadReal=_diasEntreDatas(req?.compradoEm||a.criadoEm||'',recebido);acc.entregas++;if(desvio<=0)acc.noPrazo++;else acc.atrasadas++;if(desvio<0)acc.adiantadas++;acc.somaDesvio+=desvio;acc.somaAtraso+=Math.max(0,desvio);acc.atrasoMaxDias=Math.max(acc.atrasoMaxDias,Math.max(0,desvio));if(leadReal!=null&&leadReal>=0)acc.leadTimes.push(leadReal);acc.ultimas.push({numeroCompra:numero,produto:'Pedido de recebimento',previsto:String(previsto).slice(0,10),recebido:String(recebido).slice(0,10),desvioDias:desvio,leadTimeRealDias:leadReal,quantidade:(a.itensPedido||[]).reduce((t,it)=>t+n(it.quantidadeRecebida),0)});porFornecedor.set(chave,acc);
    });
    const resultado={};
    porFornecedor.forEach((acc,chave)=>{
      acc.ultimas.sort((a,b)=>String(b.recebido).localeCompare(String(a.recebido)));
      resultado[chave]={
        fornecedorId:acc.fornecedorId||'',fornecedor:acc.fornecedor,entregas:acc.entregas,noPrazo:acc.noPrazo,atrasadas:acc.atrasadas,adiantadas:acc.adiantadas,
        pontualidadePct:acc.entregas?acc.noPrazo*100/acc.entregas:0,
        atrasoMedioDias:acc.entregas?acc.somaAtraso/acc.entregas:0,
        desvioMedioDias:acc.entregas?acc.somaDesvio/acc.entregas:0,
        atrasoMaxDias:acc.atrasoMaxDias,
        leadTimeRealDias:acc.leadTimes.length?acc.leadTimes.reduce((s,v)=>s+v,0)/acc.leadTimes.length:null,
        ultimas:acc.ultimas.slice(0,20)
      };
    });
    return resultado;
  }
  function _historicoFornecedores() { return _desempenhoFornecedoresReais(); }
  function _pontuarCotacoes(cotacoes, quantidadeSolicitada) {
    if (!cotacoes || !cotacoes.length) return [];
    const historico = _historicoFornecedores();
    const custos = cotacoes.map(c=>_custosCotacao(c,quantidadeSolicitada));
    const precos = custos.map(c=>c.custoPorNecessidade).filter(v=>v>0), minPreco = precos.length?Math.min(...precos):0;
    const prazos = cotacoes.map(c=>n(c.prazoEntregaDias)).filter(v=>v>0), minPrazo = prazos.length?Math.min(...prazos):0;
    const maxCondPag = Math.max(1, ...cotacoes.map(c=>n(c.condicaoPagamentoDias)));
    return cotacoes.map((c,idx) => {
      const custo=custos[idx];
      const scorePreco = custo.custoPorNecessidade>0 && minPreco>0 ? (minPreco/custo.custoPorNecessidade)*100 : 0;
      const scorePrazo = n(c.prazoEntregaDias)>0 && minPrazo>0 ? (minPrazo/n(c.prazoEntregaDias))*100 : 50;
      const scorePagamento = maxCondPag>0 ? (n(c.condicaoPagamentoDias)/maxCondPag)*100 : 0;
      const scoreFrete = c.freteIncluso ? 100 : 0;
      const h = _buscarDesempenhoFornecedor(historico,{fornecedorId:c.fornecedorId,fornecedor:c.fornecedor});
      const scoreHistorico = !h ? 50 : Math.max(0,Math.min(100,(h.pontualidadePct*0.70)+(Math.max(0,100-h.atrasoMedioDias*10)*0.30)));
      const scoreQtdMinima=n(c.quantidadeMinima)>n(quantidadeSolicitada)&&n(quantidadeSolicitada)>0?Math.max(0,(n(quantidadeSolicitada)/n(c.quantidadeMinima))*100):100;
      const scoreFinal = scorePreco*PESOS_COTACAO.preco + scorePrazo*PESOS_COTACAO.prazo + scorePagamento*PESOS_COTACAO.pagamento + scoreQtdMinima*PESOS_COTACAO.qtdMinima + scoreFrete*PESOS_COTACAO.frete + scoreHistorico*PESOS_COTACAO.historico;
      return { ...c, _idx:idx, score:Math.round(scoreFinal), historicoFornecedor:h||null, custos:custo, scoreDetalhes:{preco:Math.round(scorePreco),prazo:Math.round(scorePrazo),pagamento:Math.round(scorePagamento),quantidade:Math.round(scoreQtdMinima),frete:Math.round(scoreFrete),historico:Math.round(scoreHistorico)} };
    }).sort((a,b)=>b.score-a.score).map((c,pos)=>({...c, _melhor:pos===0}));
  }
  function _etapaCotacao(x) { const qtd=(x.cotacoes||[]).length;return qtd===0?'sem_proposta':qtd===1?'coletando':'comparar'; }
  function _badgeEtapaCotacao(x) { const etapa=_etapaCotacao(x);return etapa==='sem_proposta'?'<span class="badge b-orange">Aguardando propostas</span>':etapa==='coletando'?'<span class="badge b-blue">Coletando propostas</span>':'<span class="badge b-green">Pronta para decidir</span>'; }
  function _cotProdutoSugestoesHtml() {
    if(cotProdutoBusca.trim().length<2)return '';
    if(cotProdutoSugerindo)return '<div class="dt-autocomplete cp-cot-product-results">Procurando no catálogo de compras...</div>';
    if(!cotProdutoSugestoes.length)return '<div class="dt-autocomplete cp-cot-product-results">Nenhum produto encontrado por esse código ou descrição.</div>';
    return `<div class="dt-autocomplete cp-cot-product-results">${cotProdutoSugestoes.map(p=>`<button type="button" data-cp-cot-produto="${esc(p.produtoKey)}" data-cp-cot-produto-nome="${esc(p.descricao)}"><b>${esc(p.produtoKey)}</b><span>${esc(p.descricao)}</span><small>${n(p.notas)>0?n(p.notas)+' compra(s) no histórico':(p.origemCatalogo==='insumos-bi'?'Catálogo de insumos':p.origemCatalogo==='cadastro'?'Cadastro do produto':'Sem histórico de compra')}</small></button>`).join('')}</div>`;
  }
  function _cotProdutoBuscaHtml() { return `<div class="tc cp-cot-new"><div><b>Iniciar uma cotação por produto</b><span>Crie uma cotação diretamente, sem precisar de uma solicitação do PCP.</span></div><button type="button" class="btn btn-primary" data-cp-cot-nova-abrir>+ Nova cotação</button></div>`; }
  function abrirBuscaNovaCotacaoProduto() { cotProdutoBusca='';cotProdutoSugestoes=[];cotProdutoSugerindo=false;cotProdutoSelecionado=null;const host=document.getElementById('cp-cotacao-nova-host');if(!host)return;host.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card cp-cot-product-modal"><div class="modal-header"><div><b>Nova cotação</b><small>Selecione o produto que deseja cotar.</small></div><button class="modal-x" data-cp-cot-nova-fechar>×</button></div><div class="modal-body"><div class="form-group"><label>Produto</label><input class="field" id="cp-cot-produto-busca" autocomplete="off" placeholder="Pesquisar por código ou descrição..." autofocus><div id="cp-cot-produto-resultados" class="cp-cot-modal-results"></div></div></div><div class="modal-footer"><button class="btn btn-ghost" data-cp-cot-nova-fechar>Cancelar</button></div></div></div>`;setTimeout(()=>document.getElementById('cp-cot-produto-busca')?.focus(),0); }
  function _produtosLocaisParaCotacao(busca){
    const alvo=String(busca||'').trim().toLowerCase(),out=[];
    const add=(produtoKey,descricao,origem)=>{produtoKey=String(produtoKey||'').trim();descricao=String(descricao||'').trim();if(!produtoKey&&!descricao)return;const texto=(produtoKey+' '+descricao).toLowerCase();if(alvo&&!texto.includes(alvo))return;out.push({produtoKey:produtoKey||descricao,descricao:descricao||produtoKey,notas:0,origemCatalogo:origem});};
    // Tudo abaixo já está em memória nesta sessão; não cria leitura nova no
    // Firestore. Produção cobre produtos fabricados/revendidos cadastrados e,
    // quando o PCP já buscou o BI, os insumos/matérias-primas entram também.
    (cache.products||[]).forEach(x=>add(x.cod||x.prodKey,x.nome||x.produto,'cadastro'));
    (global._pcpInternals?.getInsumosBi?.()||[]).forEach(x=>add(x.cod,x.produto,'insumos-bi'));
    (produtosBi||[]).forEach(x=>add(x.produtoKey,x.descricao,'historico'));
    const vistos=new Set();return out.filter(x=>{const k=String(x.produtoKey);if(vistos.has(k))return false;vistos.add(k);return true;}).slice(0,20);
  }
  async function buscarSugestoesCotacaoProduto() { const busca=cotProdutoBusca.trim();if(busca.length<2){cotProdutoSugestoes=[];cotProdutoSugerindo=false;return;}cotProdutoSugerindo=true;try{const funcoes=global.firebase.app().functions('southamerica-east1'),porNome=funcoes.httpsCallable('buscarProdutosComprasBigQuery')({busca}),porCodigo=/^\d+$/.test(busca)?funcoes.httpsCallable('buscarHistoricoComprasBigQuery')({inicio:_isoMesesAtras(24),fim:new Date().toISOString().slice(0,10),produtoKey:busca,tipoOperacao:'COMPRA'}):Promise.resolve({data:{linhas:[]}});const [respNome,respCodigo]=await Promise.all([porNome,porCodigo]);const lista=[...(respNome?.data?.produtos||[])],linha=(respCodigo?.data?.linhas||[])[0];if(linha&&!lista.some(p=>String(p.produtoKey)===String(busca)))lista.unshift({produtoKey:String(linha.produto_key||busca),descricao:linha.descricao||('Produto '+busca),notas:(respCodigo?.data?.linhas||[]).length});const locais=_produtosLocaisParaCotacao(busca);locais.forEach(p=>{if(!lista.some(x=>String(x.produtoKey)===String(p.produtoKey)))lista.push(p);});cotProdutoSugestoes=lista.slice(0,20);}catch(e){cotProdutoSugestoes=_produtosLocaisParaCotacao(busca);if(!cotProdutoSugestoes.length)global.showToast?.('Não foi possível pesquisar o catálogo: '+(e.message||e),'error');}finally{cotProdutoSugerindo=false;} }
  function abrirNovaCotacaoProduto(produtoKey,produto) { cotProdutoSelecionado={produtoKey,produto};const host=document.getElementById('cp-cotacao-nova-host');if(!host)return;host.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:620px"><div class="modal-header"><div><b>Nova cotação — ${esc(produto)}</b><small>Código ${esc(produtoKey)}</small></div><button class="modal-x" data-cp-cot-nova-fechar>×</button></div><div class="modal-body"><div class="cp-cot-choice"><b>Cotação comercial</b><br>Cadastre as propostas dos fornecedores para comparar preço unitário, validade, prazo, pagamento e condições de contrato. Quantidade e loja serão definidas somente quando houver uma compra.</div><div class="form-group"><label>Objetivo / observação da cotação</label><textarea class="field" id="cp-cot-nova-obs" rows="3" placeholder="Ex.: renovação anual, homologação de fornecedor, redução de custo, contrato de fornecimento..."></textarea></div></div><div class="modal-footer"><button class="btn btn-ghost" data-cp-cot-nova-fechar>Cancelar</button><button class="btn btn-primary" data-cp-cot-nova-salvar>Criar e cadastrar propostas</button></div></div></div>`; }
  async function salvarNovaCotacaoProduto() { if(!tem('editar')||!cotProdutoSelecionado)return;const agora=new Date().toISOString(),u=global._currentAnalistaUser||{},payload={prodKey:cotProdutoSelecionado.produtoKey,cod:cotProdutoSelecionado.produtoKey,produto:cotProdutoSelecionado.produto,quantidade:0,dataNecessaria:'',prioridade:'normal',destino:'',motivo:document.getElementById('cp-cot-nova-obs')?.value.trim()||'Cotação comercial iniciada diretamente por Compras',status:'em_cotacao',origem:'COMPRAS_COTACAO',tipoCotacao:'comercial',cotacoes:[],compradorUid:u.uid||global.firebase?.auth?.().currentUser?.uid||'',compradorNome:u.nome||'',compradorEmail:u.email||'',criadoEm:agora,criadoPor:u.email||'',atualizadoEm:agora};const ref=await fs().collection(collections.requests).add(payload);const criada={_id:ref.id,...payload};cache.requests.unshift(criada);cotProdutoBusca='';cotProdutoSugestoes=[];cotProdutoSelecionado=null;await render('cotacoes');modalCotacao(criada._id);global.showToast?.('Cotação criada. Cadastre as propostas comerciais dos fornecedores.','success'); }
  function quotationsPage() {
    const todos=cache.requests.filter(linhaDoComprador).filter(x=>/analise|cotacao|solicitada|parcialmente_comprada/i.test(String(x.status||'')));
    const busca=filtrosCotacao.busca.trim().toLowerCase();
    const xs=todos.filter(x=>(!busca||[x.produto,x.cod,x.prodKey,x.compradorNome,x.compradorEmail,x._id].some(v=>String(v||'').toLowerCase().includes(busca)))&&(!filtrosCotacao.etapa||_etapaCotacao(x)===filtrosCotacao.etapa));
    const sem=todos.filter(x=>(x.cotacoes||[]).length===0).length, prontas=todos.filter(x=>(x.cotacoes||[]).length>=2).length;
    const urgentes=todos.filter(x=>(x.cotacoes||[]).some(c=>c.validadeProposta&&_diasAte(c.validadeProposta)!==null&&_diasAte(c.validadeProposta)<=7)).length;
    const linhas=xs.map(x=>{const qtdRef=Math.max(1,saldoComprarReq(x)||n(x.quantidade));const pontuadas=_pontuarCotacoes(x.cotacoes||[],qtdRef),melhor=pontuadas[0];return `<tr><td><div class="cp-cot-product"><b>${esc(x.produto||'Produto não informado')}</b><small>#${esc(x._id)} · ${esc(x.cod||x.prodKey||'sem código')}</small></div></td><td>${_badgeEtapaCotacao(x)}<small class="cp-cot-sub">${(x.cotacoes||[]).length} proposta(s)</small></td><td>${melhor?`<b>${money(melhor.precoUnitario)}</b><small class="cp-cot-sub">${esc(melhor.fornecedor)} · validade ${esc(melhor.validadeProposta||'—')}</small>`:'<span style="color:var(--muted)">Ainda sem proposta</span>'}</td><td><button class="btn ${pontuadas.length>=2?'btn-primary':'btn-ghost'} btn-sm" data-cp-cotar="${esc(x._id)}">${pontuadas.length?'Comparar propostas':'Cadastrar proposta'} →</button></td></tr>`;}).join('');
    return header('⚖️ Central de Cotações','Colete propostas, compare o custo final e transforme a escolha em pedido.')
      +`<div class="cp-cot-flow"><span><b>1</b> Selecione o produto</span><i>→</i><span><b>2</b> Cadastre as propostas</span><i>→</i><span><b>3</b> Compare e gere o pedido</span></div>`
      +_cotProdutoBuscaHtml()
      +`<div class="kpi-grid cp-cot-kpis"><div class="kpi orange"><div class="kpi-val">${sem}</div><div class="kpi-lbl">Sem proposta</div></div><div class="kpi blue"><div class="kpi-val">${todos.length-sem-prontas}</div><div class="kpi-lbl">Em coleta</div></div><div class="kpi green"><div class="kpi-val">${prontas}</div><div class="kpi-lbl">Prontas para decidir</div></div><div class="kpi red"><div class="kpi-val">${urgentes}</div><div class="kpi-lbl">Propostas vencendo</div></div></div>`
      +`<div class="tc cp-cot-toolbar"><input class="field" data-cp-cot-busca placeholder="Buscar produto, código, comprador ou solicitação..." value="${esc(filtrosCotacao.busca)}"><select class="field" data-cp-cot-etapa><option value="">Todas as etapas</option><option value="sem_proposta" ${filtrosCotacao.etapa==='sem_proposta'?'selected':''}>Sem proposta</option><option value="coletando" ${filtrosCotacao.etapa==='coletando'?'selected':''}>Coletando propostas</option><option value="comparar" ${filtrosCotacao.etapa==='comparar'?'selected':''}>Prontas para decidir</option></select></div>`
      +table(['Produto / cotação','Etapa','Referência atual','Próxima ação'],linhas,'Nenhuma solicitação encontrada para os filtros selecionados.')
      +'<div id="cp-cotacao-nova-host"></div><div id="cp-cotacao-modal-host"></div><div id="cp-req-modal-host"></div>';
  }
  function _precoProjetado(c,meses){const base=n(c.precoUnitario),reaj=n(c.reajusteAnualPct)/100;if(base<=0)return 0;const anos=Math.floor(Math.max(0,meses)/12);return base*Math.pow(1+reaj,anos);}
  function _horizonteCotacao(c){const m=Math.max(0,n(c.duracaoContratoMeses));if(!m)return 'Sem contrato';return m<12?m+' meses':(m%12?m+' meses':(m/12)+' ano'+(m===12?'':'s'));}
  function _linhaCotacao(c,x) {const p12=_precoProjetado(c,12),p24=_precoProjetado(c,24),p60=_precoProjetado(c,60),h=c.historicoFornecedor;return `<tr class="${c._melhor?'cp-cot-best':''}"><td><div class="cp-cot-product"><b>${esc(c.fornecedor)}</b>${c._melhor?' <span class="badge b-green">recomendada · melhor cenário calculado</span>':''}<small>${h?h.pontualidadePct.toFixed(0)+'% no prazo · '+h.atrasoMedioDias.toFixed(1)+'d atraso médio · '+h.entregas+' entrega(s) reais':'Sem histórico de recebimento confirmado'}</small></div></td><td><b>${money(c.precoUnitario)}</b><small class="cp-cot-sub">unitário atual</small></td><td>${esc(c.validadeProposta||'—')}<small class="cp-cot-sub">contrato: ${esc(_horizonteCotacao(c))}</small></td><td>${n(c.condicaoPagamentoDias)||'—'} dias<small class="cp-cot-sub">lead time ${n(c.prazoEntregaDias)||'—'}d</small></td><td><b>${money(p12)}</b><small class="cp-cot-sub">24m ${money(p24)} · 60m ${money(p60)}</small></td><td>${n(c.reajusteAnualPct).toLocaleString('pt-BR',{maximumFractionDigits:2})}% a.a.<small class="cp-cot-sub">mínimo ${n(c.quantidadeMinima)||'—'}</small></td><td class="cp-cot-actions"><button class="btn btn-primary btn-sm" data-cp-cotacao-usar="${c._idx}">Usar na compra</button><button class="acao-lapis" title="Editar proposta" data-cp-cotacao-editar="${c._idx}">✏️</button><button class="acao-lapis" title="Remover proposta" data-cp-cotacao-remover="${c._idx}">🗑️</button></td></tr>`; }
  function modalCotacao(id,editarIdx) {
    const x=cache.requests.find(r=>r._id===id),host=document.getElementById('cp-cotacao-modal-host');if(!x||!host)return;
    cotacaoAtivaId=id;if(Number.isInteger(editarIdx))cotacaoEditandoIdx=editarIdx;
    const editando=cotacaoEditandoIdx>=0?(x.cotacoes||[])[cotacaoEditandoIdx]:null,pontuadas=_pontuarCotacoes(x.cotacoes||[],Math.max(1,saldoComprarReq(x)||n(x.quantidade)));
    const melhor=pontuadas[0]||null,segunda=pontuadas[1]||null,economia=melhor&&segunda?Math.max(0,n(segunda.custos?.total)-n(melhor.custos?.total)):0;
    const resumoEconomia=melhor?`<div class="tc" style="padding:9px 11px;margin-bottom:10px;font-size:.75rem"><b>Melhor cenário calculado:</b> ${esc(melhor.fornecedor)} · custo efetivo ${money(melhor.custos?.total)}${segunda?` · economia estimada de ${money(economia)} frente à 2ª opção`:''}. A decisão continua sendo do comprador.</div>`:'';
    const fornecedores=[...new Set(cache.requests.flatMap(r=>(r.cotacoes||[]).map(c=>c.fornecedor)).concat(cache.requests.map(r=>r.fornecedorSugerido||r.fornecedor)).filter(Boolean))];
    host.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card cp-cot-modal"><div class="modal-header"><div><b>Cotações — ${esc(x.produto)}</b><small>Código ${esc(x.cod||x.prodKey||'—')} · ${pontuadas.length} proposta(s)</small></div><button class="modal-x" data-cp-cotacao-fechar>×</button></div><div class="modal-body">${resumoEconomia}<div class="cp-cot-explain"><b>Comparativo profissional de fornecimento.</b> Preço unitário é a base; prazo, pagamento, validade, frete, quantidade mínima e histórico ficam visíveis para decisão. Para contratos, o sistema projeta o preço futuro pelo reajuste anual informado. Quantidade e destino só entram quando a proposta for usada para gerar uma compra.</div>${pontuadas.length?`<div class="cp-cot-table"><table class="dt-table"><thead><tr><th>Fornecedor</th><th>Preço atual</th><th>Validade / contrato</th><th>Pagamento / prazo</th><th>Preço projetado</th><th>Reajuste</th><th></th></tr></thead><tbody>${pontuadas.map(c=>_linhaCotacao(c,x)).join('')}</tbody></table></div>`:'<div class="cp-cot-empty"><b>Nenhuma proposta cadastrada</b><span>Cadastre abaixo as condições recebidas dos fornecedores.</span></div>'}<div class="cp-cot-form"><div class="cp-cot-form-title"><div><b>${editando?'Editar proposta':'Nova proposta'}</b><span>Condições comerciais e contratuais.</span></div>${editando?'<button class="btn btn-ghost btn-sm" data-cp-cotacao-cancelar-edicao>Cancelar edição</button>':''}</div><div class="cp-cot-form-grid"><div class="form-group cp-cot-span2"><label>Fornecedor *</label><input class="field" id="cp-cot-forn" list="cp-cot-fornecedores" value="${esc(editando?.fornecedor||'')}" placeholder="Nome do fornecedor"><datalist id="cp-cot-fornecedores">${fornecedores.map(f=>`<option value="${esc(f)}">`).join('')}</datalist></div><div class="form-group"><label>Preço unitário *</label><input class="field" id="cp-cot-preco" type="number" min="0" step="0.0001" value="${n(editando?.precoUnitario)||''}"></div><div class="form-group"><label>Validade da proposta</label><input class="field" id="cp-cot-validade" type="date" value="${esc(editando?.validadeProposta||'')}"></div><div class="form-group"><label>Duração do contrato (meses)</label><input class="field" id="cp-cot-contrato" type="number" min="0" value="${n(editando?.duracaoContratoMeses)||''}" placeholder="Ex.: 12, 24, 60"></div><div class="form-group"><label>Reajuste anual previsto (%)</label><input class="field" id="cp-cot-reajuste" type="number" min="0" step="0.01" value="${n(editando?.reajusteAnualPct)||''}" placeholder="0 = preço fixo"></div><div class="form-group"><label>Condição de pagamento (dias)</label><input class="field" id="cp-cot-pagamento" type="number" min="0" value="${editando?n(editando.condicaoPagamentoDias):30}"></div><div class="form-group"><label>Lead time / entrega (dias)</label><input class="field" id="cp-cot-prazo" type="number" min="0" value="${editando?n(editando.prazoEntregaDias):''}"></div><div class="form-group"><label>Quantidade mínima (opcional)</label><input class="field" id="cp-cot-qtdmin" type="number" min="0" value="${n(editando?.quantidadeMinima)||''}"></div><div class="form-group"><label>Frete adicional</label><input class="field" id="cp-cot-frete-valor" type="number" min="0" step="0.01" value="${n(editando?.freteValor)||''}"></div><div class="form-group"><label>Desconto (%)</label><input class="field" id="cp-cot-desconto" type="number" min="0" step="0.01" value="${n(editando?.descontoPct)||''}"></div><div class="form-group"><label>Impostos/custos adicionais (%)</label><input class="field" id="cp-cot-impostos" type="number" min="0" step="0.01" value="${n(editando?.impostosPct)||''}"></div><div class="form-group cp-cot-check"><label><input type="checkbox" id="cp-cot-frete" ${editando?.freteIncluso?'checked':''}> Frete incluso no preço</label></div><div class="form-group cp-cot-span2"><label>Condições / observações</label><textarea class="field" id="cp-cot-obs" rows="2" placeholder="Marca, especificação, garantia, índice de reajuste, SLA, condição especial...">${esc(editando?.observacoes||'')}</textarea></div></div><div class="cp-cot-form-footer"><span>O comparativo será atualizado automaticamente.</span><button class="btn btn-primary" data-cp-cotacao-add="${esc(id)}">${editando?'Salvar alterações':'+ Adicionar proposta'}</button></div></div></div><div class="modal-footer"><button class="btn btn-ghost" data-cp-cotacao-fechar>Fechar</button></div></div></div>`;
  }
  async function adicionarCotacao(id) { if(!tem('editar'))return;const x=cache.requests.find(r=>r._id===id);if(!x)return;const fornecedor=document.getElementById('cp-cot-forn')?.value.trim()||'',precoUnitario=n(document.getElementById('cp-cot-preco')?.value);if(!fornecedor||precoUnitario<=0){global.showToast?.('Informe o fornecedor e um preço unitário maior que zero.','warning');return;}let vinculo=null;try{vinculo=await _validarFornecedorProduto(fornecedor,x.prodKey||x.cod||'');}catch(e){global.showToast?.(e.message||String(e),'warning');return;}const agora=new Date().toISOString();const nova={fornecedor,fornecedorId:vinculo?.fornecedorId||'',precoUnitario,prazoEntregaDias:n(document.getElementById('cp-cot-prazo')?.value),condicaoPagamentoDias:n(document.getElementById('cp-cot-pagamento')?.value),quantidadeMinima:n(document.getElementById('cp-cot-qtdmin')?.value),freteIncluso:!!document.getElementById('cp-cot-frete')?.checked,freteValor:n(document.getElementById('cp-cot-frete-valor')?.value),impostosPct:n(document.getElementById('cp-cot-impostos')?.value),descontoPct:n(document.getElementById('cp-cot-desconto')?.value),bonusValor:n(document.getElementById('cp-cot-bonus')?.value),validadeProposta:document.getElementById('cp-cot-validade')?.value||'',duracaoContratoMeses:n(document.getElementById('cp-cot-contrato')?.value),reajusteAnualPct:n(document.getElementById('cp-cot-reajuste')?.value),observacoes:document.getElementById('cp-cot-obs')?.value.trim()||'',criadoEm:cotacaoEditandoIdx>=0?(x.cotacoes||[])[cotacaoEditandoIdx]?.criadoEm||agora:agora,criadoPor:cotacaoEditandoIdx>=0?(x.cotacoes||[])[cotacaoEditandoIdx]?.criadoPor||global._currentAnalistaUser?.email||'':global._currentAnalistaUser?.email||'',atualizadoEm:agora};let cotacoes;if(cotacaoEditandoIdx>=0){cotacoes=(x.cotacoes||[]).map((c,i)=>i===cotacaoEditandoIdx?nova:c);}else{cotacoes=[...(x.cotacoes||[]),nova];}await fs().collection(collections.requests).doc(id).set({cotacoes,status:/solicitada|analise/i.test(x.status||'')?'em_cotacao':x.status,atualizadoEm:agora},{merge:true});x.cotacoes=cotacoes;x.status='em_cotacao';cotacaoEditandoIdx=-1;modalCotacao(id);global.showToast?.('Proposta salva e comparativo atualizado.','success'); }
  async function removerCotacaoIdx(idx) { if(!tem('editar')||!cotacaoAtivaId)return; const x=cache.requests.find(r=>r._id===cotacaoAtivaId); if(!x)return; const cotacoes=(x.cotacoes||[]).filter((_,i)=>i!==idx); await fs().collection(collections.requests).doc(cotacaoAtivaId).set({cotacoes},{merge:true}); x.cotacoes=cotacoes; cotacaoEditandoIdx=-1; modalCotacao(cotacaoAtivaId); }
  function usarCotacaoIdx(idx) { if(!cotacaoAtivaId)return;const x=cache.requests.find(r=>r._id===cotacaoAtivaId);if(!x)return;const c=(x.cotacoes||[])[idx];if(!c)return;const host=document.getElementById('cp-cotacao-modal-host');if(host)host.innerHTML='';const quantidade=Math.max(saldoComprarReq(x),n(c.quantidadeMinima));modalRegistrarCompra(cotacaoAtivaId,{fornecedor:c.fornecedor,precoUnitario:c.precoUnitario,quantidade,dataPrevista:_isoMaisDias(c.prazoEntregaDias),observacao:`Cotação selecionada: ${c.fornecedor}. Pagamento: ${n(c.condicaoPagamentoDias)} dias.${c.observacoes?' '+c.observacoes:''}`,cotacaoIdx:idx,cotacao:c}); }
  // PEDIDO AO VIVO (2026-08-27): "em pedidos... elas têm que mostrar os
  // pedidos que vêm da base, da pasta lá — não pedidos do PCP. Os pedidos
  // do PCP vai mostrar lá em solicitações PCP" — Pedidos passa a ser o
  // catálogo de pedidos de compra reais, sincronizados de compras_a_receber.json
  // (recebimento_agendamentos), agrupado por número de pedido. Nada de
  // pcp_requisicoes_compra aqui — essa é a base de Solicitações PCP.
  // PEDIDO AO VIVO (2026-08-27): "trago os campos código do produto, valor,
  // quantidade recebida" — cada item de itensPedido já carrega produtoKey/
  // custoUnitario/quantidadeRecebida/valorPendente (ver _sincronizarAgendaBiLoja,
  // functions/index.js). Na lista de Pedidos entram como soma por pedido
  // (recebido/valor pendente); o detalhe item a item fica no "Ver itens".
  function ordersPage() { const pedidos=(cache.receiptAgenda||[]).filter(x=>!query||JSON.stringify(x).toLowerCase().includes(query)); return header('🧾 Pedidos de compra','Pedidos vindos da base — aguardando ou já agendados para recebimento.')+`<div class="tc" style="padding:12px;margin-bottom:12px"><input class="field" data-cp-search placeholder="Nº do pedido, fornecedor ou comprador..." value="${esc(query)}"></div>`+table(['Pedido','Fornecedor','Comprador','Itens','Qtd. pendente','Qtd. recebida','Valor pendente','Previsão','Entrega final','Status',''],pedidos.map(x=>{const itens=x.itensPedido||[],qtdTotal=itens.reduce((s,i)=>s+n(i.quantidadePendente),0),recebidoTotal=itens.reduce((s,i)=>s+n(i.quantidadeRecebida),0),valorTotal=itens.reduce((s,i)=>s+n(i.valorPendente),0);return `<tr><td><b>${esc(x.numeroPedido||'—')}</b></td><td>${esc(x.fornecedorNome||'—')}</td><td>${esc(x.compradorNome||'—')}</td><td>${itens.length} ite${itens.length===1?'m':'ns'}</td><td>${qtdTotal.toLocaleString('pt-BR')}</td><td>${recebidoTotal.toLocaleString('pt-BR')}</td><td>${money(valorTotal)}</td><td>${date(x.dataPrevista)}</td><td>${date(x.dataEntregaFinal)}</td><td>${x.dataAgendada?'<span class="badge b-green">Agendado '+date(x.dataAgendada)+'</span>':'<span class="badge b-orange">Aguardando agendamento</span>'}</td><td><button class="btn btn-ghost btn-sm" data-cp-pedido-itens="${esc(x._id)}">Ver itens</button></td></tr>`;}).join(''),'Nenhum pedido encontrado na base.')+'<div id="cp-pedido-itens-modal-host"></div>'; }
  function modalItensPedido(id) { const x=(cache.receiptAgenda||[]).find(p=>p._id===id),host=document.getElementById('cp-pedido-itens-modal-host'); if(!x||!host)return; const itens=x.itensPedido||[]; host.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:760px"><div class="modal-header"><b>Itens do pedido — ${esc(x.numeroPedido)}</b><button class="modal-x" data-cp-pedido-itens-fechar>×</button></div><div class="modal-body"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Código</th><th>Produto</th><th>Pendente</th><th>Recebida</th><th>Custo unit.</th><th>Valor pendente</th></tr></thead><tbody>${itens.length?itens.map(i=>`<tr><td>${esc(i.produtoKey||'—')}</td><td><b>${esc(i.produto)}</b></td><td>${n(i.quantidadePendente).toLocaleString('pt-BR')}</td><td>${n(i.quantidadeRecebida).toLocaleString('pt-BR')}</td><td>${money(i.custoUnitario)}</td><td>${money(i.valorPendente)}</td></tr>`).join(''):'<tr><td colspan="6">Sem itens.</td></tr>'}</tbody></table></div></div><div class="modal-footer"><button class="btn btn-ghost" data-cp-pedido-itens-fechar>Fechar</button></div></div></div>`; }
  // PEDIDO AO VIVO (2026-09-02): "produtos cadastrado na produção ele nem
  // tem, nem vai ter histórico de compras porque é produzido aqui" —
  // PEDIDO AO VIVO (2026-09-18): "só mostra produto de produção, não
  // mostra matéria-prima comprada... os números têm que ser do arquivo
  // real, não da solicitação do PCP" — a lista/360° antes vinham de
  // pcp_requisicoes_compra (preenchida à mão pelo PCP: só existe pro que
  // passou por lá) + producao_produtos (catálogo de produção). Agora vêm
  // direto do histórico real (compras_historico/BigQuery,
  // buscarResumoProdutosComprasBigQuery) — TODO produto de verdade
  // comprado aparece (matéria-prima, embalagem, qualquer coisa do BI), e
  // os números (última compra/fornecedor/valor) são os reais, não o que
  // alguém digitou numa solicitação. Buyer-scoping já sai aplicado no
  // servidor (mesmo `compradores` do resumo do Dashboard).
  let produtosBi=null, produtosBiCarregando=false, produtosBiErro='';
  function nomesVisiveisBi(){
    const papel=papelCompras();
    if(papel==='admin')return null;
    if(papel==='gerente'){const geridos=compradoresGerenciados().concat(_coberturasAtivas);return geridos.length?geridos:null;}
    const visiveis=[compradorAtual(),..._coberturasAtivas].filter(Boolean);
    return visiveis.length?visiveis:null;
  }
  async function carregarProdutosBi(forcar){
    if(produtosBi&&!forcar)return produtosBi;
    produtosBiCarregando=true;produtosBiErro='';
    try{
      const callable=global.firebase.app().functions('southamerica-east1').httpsCallable('buscarResumoProdutosComprasBigQuery');
      const compradores=nomesVisiveisBi();
      const resp=await callable(compradores?{compradores}:{});
      produtosBi=resp?.data?.produtos||[];
    }catch(e){produtosBi=[];produtosBiErro=e.message||String(e);}
    finally{produtosBiCarregando=false;}
    return produtosBi;
  }
  function productsPage(){
    if(produtosBiCarregando)return header('🔎 Produtos e histórico de compras','Todo produto já comprado de verdade — matéria-prima, embalagem, qualquer item do histórico real.')+'<div class="empty">Consultando o histórico real de compras (BigQuery)...</div>';
    if(produtosBiErro)return header('🔎 Produtos e histórico de compras','Todo produto já comprado de verdade — matéria-prima, embalagem, qualquer item do histórico real.')+`<div class="tc" style="padding:12px;border:1px solid var(--danger)">Falha ao consultar o histórico: ${esc(produtosBiErro)}</div>`;
    const lista=(produtosBi||[]).filter(g=>!query||(String(g.descricao||'')+' '+String(g.produtoKey||'')).toLowerCase().includes(query));
    return header('🔎 Produtos e histórico de compras','Todo produto já comprado de verdade — matéria-prima, embalagem, qualquer item do histórico real.')+`<div class="tc" style="padding:12px;margin-bottom:12px"><input class="field" data-cp-search placeholder="Pesquisar produto ou código..." value="${esc(query)}"></div>`+table(['Código','Produto','Compras','Última compra','Último fornecedor','Último valor','Ação'],lista.map(g=>`<tr><td>${esc(g.produtoKey||'—')}</td><td><b>${esc(g.descricao||'—')}</b></td><td>${g.numCompras}</td><td>${date(g.ultimaData)}</td><td>${esc(g.ultimoFornecedor||'—')}</td><td>${g.ultimoPreco?money(g.ultimoPreco):'—'}</td><td><button class="btn btn-ghost btn-sm" data-cp-product="${esc(g.produtoKey)}">Ver 360°</button></td></tr>`).join(''),'Nenhum produto comprado encontrado no histórico.'); }
  // PEDIDO AO VIVO (2026-08-28): "a quantidade que usa de cada insumo, você
  // não aplicou" — bi_consumo_insumos_resumo (sincronizado do BI, somado
  // por sku) cruzado pelo código do produto no 360°.
  // PEDIDO AO VIVO (2026-08-28): "nos produtos também quando vão circular
  // no compras lá quando clicar naquele cálculo lá que eu tinha falado, ele
  // vai mostrar todo esse resumo" — mesmo histórico de cortes/faturamento
  // por mês do "Relatório do Produto" (78-pcp-central.js), reaproveitando
  // o mesmo cache global (_pcpCortesInternals, pcp-cortes.js) — sem
  // duplicar sincronização nem coleção.
  function _linhaCortesCompras(h){const atingimento=h.quantidadePedidaCx>0?(h.quantidadeFaturadaCx/h.quantidadePedidaCx)*100:null;const [ano,mes]=String(h.mes||'').split('-');return `<tr><td>${mes&&ano?mes+'/'+ano:h.mes}</td><td>${n(h.quantidadePedidaCx).toLocaleString('pt-BR')}</td><td>${n(h.quantidadeFaturadaCx).toLocaleString('pt-BR')}</td><td>${n(h.corteRoteiroCx).toLocaleString('pt-BR')}</td><td>${money(h.faturamentoRs)}</td><td>${atingimento==null?'—':atingimento.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%'}</td></tr>`;}
  let prod360CacheKey='', prod360Linhas=[], prod360Carregando=false, prod360Erro='';
  async function _carregarProd360(forcar){
    if(!forcar&&prod360CacheKey===selectedProduct)return;
    prod360CacheKey=selectedProduct;prod360Carregando=true;prod360Erro='';prod360Linhas=[];
    try{
      const callable=global.firebase.app().functions('southamerica-east1').httpsCallable('buscarHistoricoComprasBigQuery');
      const compradores=nomesVisiveisBi();
      const payload={inicio:_isoMesesAtras(24),fim:new Date().toISOString().slice(0,10),produtoKey:selectedProduct,tipoOperacao:'COMPRA'};
      if(compradores)payload.compradores=compradores;
      const resp=await callable(payload);
      prod360Linhas=resp?.data?.linhas||[];
    }catch(e){prod360Erro=e.message||String(e);}
    finally{prod360Carregando=false;}
  }
  async function product360(){
    await _carregarProd360();
    const g=(produtosBi||[]).find(x=>x.produtoKey===selectedProduct);
    const nome=g?.descricao||selectedProduct||'';
    const voltar='<div style="margin-bottom:10px"><button class="btn btn-ghost btn-sm" data-cp-produto-voltar>← Voltar</button></div>';
    if(prod360Carregando)return voltar+header('🔎 '+esc(nome),'Comparativo das últimas compras, fornecedores, prazos e evolução de custo.')+'<div class="empty">Consultando o histórico real de compras...</div>';
    if(prod360Erro)return voltar+header('🔎 '+esc(nome),'Comparativo das últimas compras, fornecedores, prazos e evolução de custo.')+`<div class="tc" style="padding:12px;border:1px solid var(--danger)">Falha: ${esc(prod360Erro)}</div>`;
    const rows=prod360Linhas.filter(linhaDoComprador).slice().sort((a,b)=>String(b.data_emissao||'').localeCompare(String(a.data_emissao||'')));
    const prices=rows.map(x=>n(x.custo_liq_unit)).filter(Boolean), avg=prices.length?prices.reduce((a,b)=>a+b,0)/prices.length:0,last=rows[0];
    const consumo=(cache.consumoInsumosBi||[]).find(x=>String(x.sku)===String(selectedProduct));
    const cortes=await global._pcpCortesInternals?.buscarHistoricoProduto?.(selectedProduct).catch(()=>[])||[];
    return voltar+header('🔎 '+esc(nome),'Comparativo das últimas compras, fornecedores, prazos e evolução de custo (histórico real, últimos 24 meses).')+`<div class="kpi-grid" style="margin-bottom:14px"><div class="kpi blue"><div class="kpi-val">${last?money(last.custo_liq_unit):'—'}</div><div class="kpi-lbl">Última compra</div></div><div class="kpi teal"><div class="kpi-val">${prices.length?money(avg):'—'}</div><div class="kpi-lbl">Preço médio</div></div><div class="kpi green"><div class="kpi-val">${prices.length?money(Math.min(...prices)):'—'}</div><div class="kpi-lbl">Menor preço</div></div><div class="kpi orange"><div class="kpi-val">${rows.length}</div><div class="kpi-lbl">Compras comparadas</div></div><div class="kpi purple"><div class="kpi-val">${consumo?n(consumo.mediaMensal).toLocaleString('pt-BR',{maximumFractionDigits:1}):'—'}</div><div class="kpi-lbl">Consumo médio mensal (BI)</div></div></div>`+table(['Data','NF','Fornecedor','Qtd','Unitário','Total','Comprador'],rows.map(x=>`<tr><td>${date(x.data_emissao)}</td><td>${esc(x.nf_numero||'—')}</td><td>${esc(x.nome_abreviado||'—')}</td><td>${n(x.quantidade_faturada).toLocaleString('pt-BR')}</td><td>${money(x.custo_liq_unit)}</td><td>${money(x.Custo_liquido_total)}</td><td>${esc(x.comprador_nome||'—')}</td></tr>`).join(''),'Sem compras no período.')+(cortes.length?`<div class="tc" style="padding:12px;margin-top:12px"><b>✂️ Cortes e faturamento por mês</b>`+table(['Mês','Pedida (cx)','Faturada (cx)','Corte (cx)','Faturamento','% Atingimento'],cortes.slice(0,6).map(_linhaCortesCompras).join(''))+'</div>':'');
  }
  // PEDIDO AO VIVO (2026-08-28): "ranking de fornecedores que você não
  // aplicou lá no Compras" — bi_fornecedores_agregado tem o ranking real
  // (todo o histórico de NF, não só requisição manual). Mostrado ANTES da
  // tabela derivada de pcp_requisicoes_compra, que continua existindo pra
  // quem tem compra registrada manualmente (dado diferente, não substitui).
  function _rankingFornecedoresBiHtml() {
    const linhas=[];
    (cache.fornecedoresBi||[]).forEach(doc=>(doc.top||[]).forEach(t=>linhas.push({categoria:doc.categoria,ano:doc.ano,fornecedor:t.f,valor:n(t.valor),kg:n(t.kg),caixas:n(t.caixas)})));
    if(!linhas.length)return '';
    linhas.sort((a,b)=>b.ano-a.ano||b.valor-a.valor);
    return `<div class="tc" style="padding:12px;margin-bottom:12px"><b>Ranking real de fornecedores (histórico de notas fiscais)</b><div style="font-size:.72rem;color:var(--muted);margin-top:3px;margin-bottom:10px">Matéria-prima e produto acabado, por ano — sincronizado automaticamente do BI.</div>`
      +table(['Categoria','Ano','Fornecedor','Valor Total','Kg','Caixas'],linhas.slice(0,50).map(l=>`<tr><td>${l.categoria==='materia_prima'?'Matéria-prima':'Produto acabado'}</td><td>${esc(l.ano)}</td><td><b>${esc(l.fornecedor)}</b></td><td>${money(l.valor)}</td><td>${l.kg.toLocaleString('pt-BR')}</td><td>${l.caixas.toLocaleString('pt-BR')}</td></tr>`).join(''))
      +'</div>';
  }
  // Fase 1A — Fundação de Compras (fornecedor mestre). suppliersPage()
  // deixa de ser uma tabela derivada só de pcp_requisicoes_compra.fornecedor
  // (texto livre) e passa a ser a tela do cadastro mestre real
  // (compras_fornecedores/compras_fornecedor_produtos, via
  // compras-fornecedores-service.js) — mesmo padrão de navegação de
  // detalhe já usado em Produtos (selectedProduct/product360). O ranking
  // do BI (_rankingFornecedoresBiHtml, acima) NÃO muda uma linha: só passa
  // a ser embutido como seção analítica, claramente separada do cadastro.
  let cf = { subTab:'lista', busca:'', filtroSituacao:'', lista:[], carregado:false, selecionadoId:'', conciliacao:null, conciliando:false };
  const svcForn = () => global._fornecedoresService;
  function _cfPodeConfigurar() { return tem('configurar'); }
  // BUG AO VIVO REAL (2026-09-06): "clica atualizar a tela só dá uma
  // piscada e não mostra nada" — a leitura de `compras_fornecedores`
  // (firestore.rules) exige `hasPermission('compras-central','visualizar')`,
  // diferente das outras abas deste MESMO módulo (Solicitações/Pedidos/
  // Recebimentos leem coleções gated só por `canAccessStore`, sem exigir
  // essa permissão específica) — uma conta sem essa caixinha marcada tinha
  // a leitura negada pelo Firestore, mas o `.catch(()=>[])` (proteção
  // legítima contra 1 coleção falhar derrubar a tela inteira, mesmo padrão
  // usado em várias outras telas) escondia isso por completo: "lista
  // vazia" e "sem permissão" ficavam visualmente IDÊNTICOS, sem nenhum
  // aviso. Detecta o caso de permissão à parte pra mostrar um aviso claro
  // em vez de fingir que não tem fornecedor nenhum cadastrado.
  async function _cfCarregarLista(forcar) {
    if (cf.carregado && !forcar) return;
    cf.semPermissao = typeof global.temPermissao === 'function' && !global.temPermissao('compras-central', 'visualizar');
    const s = svcForn();
    const base=(s&&typeof s.listar==='function')?await s.listar({limit:5000}).catch(()=>[]):(s&&typeof s.pesquisarPorNome==='function'?await s.pesquisarPorNome('',{limit:5000}).catch(()=>[]):[]);const termo=String(cf.busca||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');cf.lista=termo?base.filter(f=>[f.nomeFantasia,f.razaoSocial,f.cnpjFormatado,f.cnpj].some(v=>String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(termo))):base;
    cf.carregado = true;
  }
  function _cfBadgeSituacao(sit) { return `<span class="badge ${sit === 'bloqueado' ? 'b-red' : /inativo|pendente/.test(sit || '') ? 'b-orange' : 'b-green'}">${esc(sit || 'ativo')}</span>`; }
  function _cfBadgeHomologacao(h) { const st = h?.status || 'nao_homologado'; return `<span class="badge ${st === 'homologado' ? 'b-green' : st === 'em_avaliacao' ? 'b-blue' : 'b-orange'}">${esc(st.replace(/_/g, ' '))}</span>`; }
  let _cfMapaDesempenho=null,cfBuscaTimer=null;
  function _cfDesempenho(f) {
    const mapa=_cfMapaDesempenho||(_cfMapaDesempenho=_desempenhoFornecedoresReais());
    const porId=_buscarDesempenhoFornecedor(mapa,{fornecedorId:f?.fornecedorId,fornecedor:f?.nomeFantasia});
    if(porId)return porId;
    const nomes=[f?.nomeFantasia,f?.razaoSocial].filter(Boolean);
    for(const nome of nomes){const d=_buscarDesempenhoFornecedor(mapa,{fornecedor:nome});if(d)return d;}
    return null;
  }
  function _cfFmtDias(v) { return v==null||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('pt-BR',{maximumFractionDigits:1})+' d'; }
  function _cfSubtabsHtml() { const abas = [['lista', 'Lista']]; if (_cfPodeConfigurar()) abas.push(['conciliacao', 'Conciliação (simulação)']); return `<div style="display:flex;gap:6px;margin-bottom:12px">${abas.map(([id, label]) => `<button class="btn ${cf.subTab === id ? 'btn-primary' : 'btn-ghost'} btn-sm" data-cf-subtab="${id}">${esc(label)}</button>`).join('')}</div>`; }
  function _cfTabelaManualHtml() { const map = new Map(); const linhas=typeof global._comprasInternals?.historicoPedidosCompra==='function'?global._comprasInternals.historicoPedidosCompra():cache.requests.filter(x=>n(x.quantidadeComprada)>0); linhas.filter(x => x.fornecedor).forEach(x => { const k = x.fornecedor; if (!map.has(k)) map.set(k, []); map.get(k).push(x); }); return table(['Fornecedor', 'Pedidos', 'Produtos', 'Total comprado', 'Última compra'], [...map].map(([nome, rows]) => `<tr><td><b>${esc(nome)}</b></td><td>${rows.length}</td><td>${new Set(rows.map(key)).size}</td><td>${money(rows.reduce((s, x) => s + n(x.valorTotalEfetivo??x.valorTotal), 0))}</td><td>${date(rows.sort((a, b) => String(b.compradoEm || '').localeCompare(String(a.compradoEm || '')))[0]?.compradoEm)}</td></tr>`).join('')); }
  function _cfListaHtml() {
    if (cf.semPermissao) {
      return '<div class="tc" style="padding:16px;border-left:4px solid var(--danger,#d92020);background:rgba(217,32,32,.06)"><b style="color:var(--danger,#d92020)">⚠️ Sem permissão para ver o cadastro de fornecedores</b><div style="font-size:.78rem;color:var(--muted);margin-top:4px">Sua conta não tem a permissão "Compras · Central de Compras → visualizar". Peça pra um administrador conferir isso em Usuários e Permissões — não é uma lista vazia, é acesso negado pelo Firestore.</div></div>';
    }
    const alvo = (cf.filtroSituacao || '').trim();
    const linhas = cf.lista.filter(f => !alvo || f.situacao === alvo);
    const filtros = `<div class="tc" style="padding:10px;margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input class="field" style="flex:1;min-width:200px" data-cf-busca placeholder="Nome, razão social ou CNPJ..." value="${esc(cf.busca)}"><select class="field" style="max-width:220px" data-cf-filtro-situacao><option value="">Todas as situações</option><option value="ativo" ${alvo === 'ativo' ? 'selected' : ''}>Ativo</option><option value="inativo" ${alvo === 'inativo' ? 'selected' : ''}>Inativo</option><option value="bloqueado" ${alvo === 'bloqueado' ? 'selected' : ''}>Bloqueado</option><option value="pendente_documentacao" ${alvo === 'pendente_documentacao' ? 'selected' : ''}>Pendente documentação</option></select>${_cfPodeConfigurar() ? '<button class="btn btn-primary btn-sm" data-cf-novo>+ Novo fornecedor</button>' : ''}</div>`;
    const tabela = table(['Nome fantasia', 'CNPJ', 'Situação', 'Homologação', 'Lead padrão', 'Pontualidade real', 'Atraso médio', 'Entregas', 'Categorias', ''], linhas.map(f => {const d=_cfDesempenho(f);return `<tr><td><b>${esc(f.nomeFantasia)}</b><div style="font-size:.68rem;color:var(--muted)">${esc(f.razaoSocial)}</div></td><td>${esc(f.cnpjFormatado || '—')}</td><td>${_cfBadgeSituacao(f.situacao)}</td><td>${_cfBadgeHomologacao(f.homologacao)}</td><td>${n(f.leadTimePadraoDias) ? n(f.leadTimePadraoDias) + ' dia(s)' : '—'}</td><td>${d?`<b>${d.pontualidadePct.toLocaleString('pt-BR',{maximumFractionDigits:0})}%</b>`:'—'}</td><td>${d?_cfFmtDias(d.atrasoMedioDias):'—'}</td><td>${d?d.entregas:'—'}</td><td>${esc((f.categorias || []).join(', ') || '—')}</td><td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" data-cf-detalhe="${esc(f.fornecedorId)}">360°</button></td></tr>`;}).join(''), 'Nenhum fornecedor cadastrado no mestre ainda.');
    return filtros + tabela
      + '<div class="tc" style="padding:8px 12px;margin:14px 0 4px"><b style="font-size:.8rem">Ranking (BI) — seção analítica</b><div style="font-size:.7rem;color:var(--muted)">Histórico real de notas fiscais, sincronizado do BI. Não é o cadastro mestre.</div></div>'
      + _rankingFornecedoresBiHtml()
      + '<div class="tc" style="padding:8px 12px;margin-bottom:4px"><b style="font-size:.8rem">Compras registradas manualmente (pcp_requisicoes_compra)</b></div>'
      + _cfTabelaManualHtml();
  }
  function _cfModalCadastroHtml(f) {
    const editando = !!f;
    return `<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:680px"><div class="modal-header"><b>${editando ? 'Editar fornecedor' : 'Novo fornecedor'}</b><button class="modal-x" data-cf-modal-fechar>×</button></div><div class="modal-body">`
      + `<div class="grid2">`
      + `<div class="form-group"><label>Razão social *</label><input class="field" id="cf-razao" value="${esc(f?.razaoSocial || '')}"></div>`
      + `<div class="form-group"><label>Nome fantasia *</label><input class="field" id="cf-fantasia" value="${esc(f?.nomeFantasia || '')}"></div>`
      + `<div class="form-group"><label>CNPJ${editando ? ' (não editável após cadastro)' : ''}</label><input class="field" id="cf-cnpj" ${editando ? 'disabled' : ''} value="${esc(f?.cnpjFormatado || f?.cnpj || '')}" placeholder="00.000.000/0000-00"></div>`
      + `<div class="form-group"><label>Inscrição estadual</label><input class="field" id="cf-ie" value="${esc(f?.inscricaoEstadual || '')}"></div>`
      + `<div class="form-group"><label>Situação</label><select class="field" id="cf-situacao"><option value="ativo" ${(!f || f.situacao === 'ativo') ? 'selected' : ''}>Ativo</option><option value="inativo" ${f?.situacao === 'inativo' ? 'selected' : ''}>Inativo</option><option value="pendente_documentacao" ${f?.situacao === 'pendente_documentacao' ? 'selected' : ''}>Pendente documentação</option></select></div>`
      + `<div class="form-group"><label>Homologação</label><select class="field" id="cf-homologacao"><option value="nao_homologado" ${(f?.homologacao?.status||'nao_homologado')==='nao_homologado'?'selected':''}>Não homologado</option><option value="em_avaliacao" ${f?.homologacao?.status==='em_avaliacao'?'selected':''}>Em avaliação</option><option value="homologado" ${f?.homologacao?.status==='homologado'?'selected':''}>Homologado</option></select></div>`
      + `<div class="form-group"><label>Categorias (separadas por vírgula)</label><input class="field" id="cf-categorias" value="${esc((f?.categorias || []).join(', '))}" placeholder="materia_prima, embalagem"></div>`
      + `<div class="form-group"><label>Lead time padrão (dias)</label><input class="field" id="cf-leadtime" type="number" min="0" value="${n(f?.leadTimePadraoDias) || ''}"></div>`
      + `<div class="form-group"><label>Condição de pagamento padrão (dias)</label><input class="field" id="cf-condpag" type="number" min="0" value="${n(f?.condicaoPagamentoPadrao?.dias) || ''}"></div>`
      + `<div class="form-group"><label>Frete padrão</label><select class="field" id="cf-frete"><option value="a_combinar" ${(!f || f?.fretePadrao === 'a_combinar') ? 'selected' : ''}>A combinar</option><option value="CIF" ${f?.fretePadrao === 'CIF' ? 'selected' : ''}>CIF</option><option value="FOB" ${f?.fretePadrao === 'FOB' ? 'selected' : ''}>FOB</option><option value="incluso" ${f?.fretePadrao === 'incluso' ? 'selected' : ''}>Incluso</option></select></div>`
      + `</div><div class="grid2">`
      + `<div class="form-group"><label>Contato principal — nome</label><input class="field" id="cf-contato-nome" value="${esc(f?.contatos?.[0]?.nome || '')}"></div>`
      + `<div class="form-group"><label>Contato principal — telefone</label><input class="field" id="cf-contato-tel" value="${esc(f?.contatos?.[0]?.telefone || '')}"></div>`
      + `<div class="form-group"><label>Contato principal — e-mail</label><input class="field" id="cf-contato-email" value="${esc(f?.contatos?.[0]?.email || '')}"></div>`
      + `</div><div class="form-group"><label>Observações</label><textarea class="field" id="cf-obs" rows="2">${esc(f?.observacoes || '')}</textarea></div>`
      + `</div><div class="modal-footer"><button class="btn btn-ghost" data-cf-modal-fechar>Cancelar</button><button class="btn btn-primary" data-cf-salvar="${esc(f?.fornecedorId || '')}">Salvar</button></div></div></div>`;
  }
  function _cfModalBloqueioHtml(f, acao) {
    const bloqueando = acao === 'bloquear';
    return `<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:480px"><div class="modal-header"><b>${bloqueando ? 'Bloquear' : 'Desbloquear'} fornecedor — ${esc(f.nomeFantasia)}</b><button class="modal-x" data-cf-modal-fechar>×</button></div><div class="modal-body"><div class="form-group"><label>Justificativa *</label><textarea class="field" id="cf-bloqueio-motivo" rows="3" placeholder="Obrigatório"></textarea></div></div><div class="modal-footer"><button class="btn btn-ghost" data-cf-modal-fechar>Cancelar</button><button class="btn btn-primary" data-cf-confirmar-bloqueio="${esc(f.fornecedorId)}" data-cf-acao="${bloqueando ? 'bloquear' : 'desbloquear'}">${bloqueando ? 'Bloquear' : 'Desbloquear'}</button></div></div></div>`;
  }
  function _cfAbrirModalCadastro(f) { const host = document.getElementById('cf-modal-host'); if (host) host.innerHTML = _cfModalCadastroHtml(f); }
  function _cfAbrirModalBloqueio(f, acao) { const host = document.getElementById('cf-modal-host'); if (host) host.innerHTML = _cfModalBloqueioHtml(f, acao); }
  function _cfFecharModal() { const host = document.getElementById('cf-modal-host'); if (host) host.innerHTML = ''; }
  async function _cfSalvarCadastro(idExistente) {
    const dados = {
      razaoSocial: document.getElementById('cf-razao')?.value.trim() || '',
      nomeFantasia: document.getElementById('cf-fantasia')?.value.trim() || '',
      cnpj: idExistente ? undefined : (document.getElementById('cf-cnpj')?.value || ''),
      inscricaoEstadual: document.getElementById('cf-ie')?.value.trim() || '',
      situacao: document.getElementById('cf-situacao')?.value || 'ativo',
      homologacao: { ...(idExistente ? ((cf.lista||[]).find(x=>x.fornecedorId===idExistente)?.homologacao||{}) : {}), status: document.getElementById('cf-homologacao')?.value || 'nao_homologado' },
      categorias: (document.getElementById('cf-categorias')?.value || '').split(',').map(x => x.trim()).filter(Boolean),
      leadTimePadraoDias: n(document.getElementById('cf-leadtime')?.value),
      condicaoPagamentoPadrao: { dias: n(document.getElementById('cf-condpag')?.value), descricao: n(document.getElementById('cf-condpag')?.value) ? n(document.getElementById('cf-condpag')?.value) + ' dias' : '' },
      fretePadrao: document.getElementById('cf-frete')?.value || 'a_combinar',
      contatos: document.getElementById('cf-contato-nome')?.value.trim() ? [{ nome: document.getElementById('cf-contato-nome').value.trim(), telefone: document.getElementById('cf-contato-tel')?.value.trim() || '', email: document.getElementById('cf-contato-email')?.value.trim() || '', principal: true }] : [],
      observacoes: document.getElementById('cf-obs')?.value.trim() || '',
    };
    try {
      if (idExistente) await svcForn().atualizarFornecedor(idExistente, dados); else await svcForn().criarFornecedor(dados);
      _cfFecharModal(); await _cfCarregarLista(true); global.showToast?.('Fornecedor salvo.', 'success'); render('fornecedores');
    } catch (e) { global.showToast?.(e.message || String(e), 'error'); }
  }
  async function _cfConfirmarBloqueio(id, acao) {
    const motivo = document.getElementById('cf-bloqueio-motivo')?.value.trim() || '';
    if (!motivo) { global.showToast?.('Informe a justificativa.', 'warning'); return; }
    try {
      if (acao === 'bloquear') await svcForn().bloquearFornecedor(id, motivo); else await svcForn().desbloquearFornecedor(id, motivo);
      _cfFecharModal(); global.showToast?.('Fornecedor atualizado.', 'success'); render('fornecedores');
    } catch (e) { global.showToast?.(e.message || String(e), 'error'); }
  }
  // PEDIDO AO VIVO (2026-09-18): "monta um cadastro de fornecedor→produto,
  // tipo o modal de máquina da Programação Produção" — vincularProdutoFornecedor
  // já existia (Fase 1A) mas nenhuma tela chamava; o 360° só EXIBIA os
  // vínculos, nunca deixava criar um novo. A lista de produto pra escolher
  // vem do histórico real de compras (produtosBi, mesma fonte de Produtos
  // 360°) — cobre matéria-prima/embalagem/qualquer coisa já comprada de
  // verdade, não só o catálogo de produção.
  async function _cfVincularProduto(fornecedorId) {
    if (!_cfPodeConfigurar()) return;
    const campo = document.getElementById('cf-vinc-produto');
    const texto = (campo?.value || '').trim();
    if (!texto) { global.showToast?.('Escolha um produto da lista de sugestões.', 'warning'); return; }
    await carregarProdutosBi();
    const produto = (produtosBi || []).find(p => String(p.descricao || '').trim().toLowerCase() === texto.toLowerCase());
    if (!produto) { global.showToast?.('Produto não encontrado — escolha um item da lista de sugestões (não digite livre).', 'warning'); return; }
    const codigo = document.getElementById('cf-vinc-codigo')?.value.trim() || '';
    const preco = document.getElementById('cf-vinc-preco')?.value;
    const leadTime = document.getElementById('cf-vinc-leadtime')?.value;
    const quantidadeMinima=document.getElementById('cf-vinc-minimo')?.value;
    const multiplo=document.getElementById('cf-vinc-multiplo')?.value;
    try {
      await svcForn().vincularProdutoFornecedor({ fornecedorId, produtoId: produto.produtoKey, produtoNomeSnapshot: produto.descricao, codigoNoFornecedor: codigo, precoReferencia: preco ? Number(preco) : null, quantidadeMinima: quantidadeMinima ? Number(quantidadeMinima) : 0, multiplo: multiplo ? Number(multiplo) : 1, leadTimeDias: leadTime ? Number(leadTime) : 0, homologado: true });
      global.showToast?.('Produto vinculado ao fornecedor.', 'success');
      render('fornecedores');
    } catch (e) { global.showToast?.(e.message || String(e), 'error'); }
  }
  async function _cfRemoverVinculo(fornecedorId, produtoId) {
    if (!_cfPodeConfigurar() || !confirm('Remover este vínculo de produto?')) return;
    try { await svcForn().removerVinculoProduto(fornecedorId, produtoId); global.showToast?.('Vínculo removido.', 'success'); render('fornecedores'); }
    catch (e) { global.showToast?.(e.message || String(e), 'error'); }
  }
  async function _cf360Html(id) {
    const s = svcForn();
    const f = s ? await s.buscarPorId(id) : null;
    if (!f) return _cfListaHtml();
    const produtos = await s.listarProdutosDoFornecedor(id).catch(() => []);
    if (_cfPodeConfigurar()) await carregarProdutosBi();
    const norm = s.normalizarNomeFornecedor;
    const historico = cache.requests.filter(x => String(x.fornecedorId||'')===String(id) || (!x.fornecedorId && x.fornecedor && norm(x.fornecedor) === norm(f.nomeFantasia))).sort((a, b) => String(b.compradoEm || '').localeCompare(String(a.compradoEm || '')));
    const desempenho=_cfDesempenho(f);
    const auditoria = await global.listarAuditoria?.({ colecao: 'compras_fornecedores', docId: id, global: true }).catch(() => []) || [];
    const bloqueado = s.estaBloqueado(f);
    const contato = f.contatos?.[0];
    const formVinculo = _cfPodeConfigurar() ? `<div class="tc" style="padding:12px;margin-bottom:4px"><b style="font-size:.8rem">Vincular produto a este fornecedor</b><div style="display:grid;grid-template-columns:2fr repeat(5,minmax(105px,1fr)) auto;gap:7px;margin-top:8px;align-items:end"><div><label style="font-size:.68rem;font-weight:700">Produto</label><input class="field" id="cf-vinc-produto" list="cf-vinc-produtos" placeholder="Buscar produto do histórico..."><datalist id="cf-vinc-produtos">${(produtosBi || []).map(p => `<option value="${esc(p.descricao)}"></option>`).join('')}</datalist></div><div><label style="font-size:.68rem;font-weight:700">Código no fornecedor</label><input class="field" id="cf-vinc-codigo"></div><div><label style="font-size:.68rem;font-weight:700">Preço referência</label><input class="field" id="cf-vinc-preco" type="number" step="0.01" min="0"></div><div><label style="font-size:.68rem;font-weight:700">Qtd. mínima</label><input class="field" id="cf-vinc-minimo" type="number" min="0"></div><div><label style="font-size:.68rem;font-weight:700">Múltiplo</label><input class="field" id="cf-vinc-multiplo" type="number" min="1" value="1"></div><div><label style="font-size:.68rem;font-weight:700">Lead time (dias)</label><input class="field" id="cf-vinc-leadtime" type="number" min="0"></div><button class="btn btn-primary btn-sm" data-cf-vincular="${esc(id)}">+ Vincular</button></div></div>` : '';
    return `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px"><div><button class="btn btn-ghost btn-sm" data-cf-voltar>← Voltar</button><div class="page-title" style="font-size:1.1rem;margin-top:6px">${esc(f.nomeFantasia)} ${_cfBadgeSituacao(f.situacao)}</div><div style="font-size:.74rem;color:var(--muted)">${esc(f.razaoSocial)}${f.cnpjFormatado ? ' · ' + esc(f.cnpjFormatado) : ''}</div></div>${_cfPodeConfigurar() ? `<div style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" data-cf-editar="${esc(id)}">✏️ Editar</button>${bloqueado ? `<button class="btn btn-ghost btn-sm" data-cf-desbloquear="${esc(id)}">🔓 Desbloquear</button>` : `<button class="btn btn-ghost btn-sm" data-cf-bloquear="${esc(id)}">🔒 Bloquear</button>`}</div>` : ''}</div>`
      + `<div class="kpi-grid" style="margin-bottom:14px"><div class="kpi blue"><div class="kpi-val">${_cfBadgeHomologacao(f.homologacao)}</div><div class="kpi-lbl">Homologação</div></div><div class="kpi teal"><div class="kpi-val">${n(f.leadTimePadraoDias) || '—'}</div><div class="kpi-lbl">Lead time padrão (dias)</div></div><div class="kpi ${desempenho&&desempenho.pontualidadePct>=90?'green':desempenho&&desempenho.pontualidadePct>=75?'orange':'red'}"><div class="kpi-val">${desempenho?desempenho.pontualidadePct.toLocaleString('pt-BR',{maximumFractionDigits:0})+'%':'—'}</div><div class="kpi-lbl">Entregas no prazo</div></div><div class="kpi orange"><div class="kpi-val">${desempenho?_cfFmtDias(desempenho.atrasoMedioDias):'—'}</div><div class="kpi-lbl">Atraso médio real</div></div><div class="kpi purple"><div class="kpi-val">${desempenho?_cfFmtDias(desempenho.leadTimeRealDias):'—'}</div><div class="kpi-lbl">Lead time real médio</div></div><div class="kpi green"><div class="kpi-val">${desempenho?desempenho.entregas:0}</div><div class="kpi-lbl">Recebimentos confirmados</div></div></div>`
      + `<div class="tc" style="padding:12px;margin-bottom:12px"><b>Contato</b><div style="font-size:.8rem;margin-top:6px">${contato ? esc(contato.nome) + (contato.telefone ? ' · ' + esc(contato.telefone) : '') + (contato.email ? ' · ' + esc(contato.email) : '') : 'Nenhum contato cadastrado.'}</div>${f.observacoes ? `<div style="font-size:.76rem;color:var(--muted);margin-top:6px">${esc(f.observacoes)}</div>` : ''}</div>`
      + formVinculo
      + `<div class="tc" style="padding:8px 12px;margin:14px 0 4px"><b style="font-size:.8rem">Desempenho real de entrega</b><div style="font-size:.7rem;color:var(--muted)">Calculado somente com recebimento real confirmado (PCP ou Logística quando houver data real de recebimento/fechamento). Data apenas agendada ou prevista não conta como entrega.</div></div>`
      + (desempenho?table(['Pedido','Produto','Previsto','Recebido','Desvio','Lead time real','Qtd. recebida'],desempenho.ultimas.map(x=>`<tr><td>${esc(x.numeroCompra||'—')}</td><td>${esc(x.produto||'—')}</td><td>${date(x.previsto)}</td><td>${date(x.recebido)}</td><td>${x.desvioDias>0?`<span class="badge b-red">+${x.desvioDias}d</span>`:x.desvioDias<0?`<span class="badge b-green">${x.desvioDias}d</span>`:'<span class="badge b-green">No prazo</span>'}</td><td>${_cfFmtDias(x.leadTimeRealDias)}</td><td>${n(x.quantidade).toLocaleString('pt-BR')}</td></tr>`).join(''),'Sem recebimentos confirmados para este fornecedor.'):'<div class="tc" style="padding:12px;color:var(--muted);font-size:.76rem">Sem recebimentos confirmados vinculáveis a este fornecedor.</div>')
      + `<div class="tc" style="padding:8px 12px;margin:14px 0 4px"><b style="font-size:.8rem">Produtos fornecidos</b></div>`
      + table(['Produto', 'Código no fornecedor', 'Preço referência', 'Qtd. mínima', 'Múltiplo', 'Lead time', 'Homologado', ''], produtos.map(p => `<tr><td>${esc(p.produtoNomeSnapshot || p.produtoId)}</td><td>${esc(p.codigoNoFornecedor || '—')}</td><td>${p.precoReferencia != null ? money(p.precoReferencia) : '—'}</td><td>${n(p.quantidadeMinima) || '—'}</td><td>${n(p.multiplo) || 1}</td><td>${n(p.leadTimeDias) || '—'}</td><td>${p.homologado ? 'Sim' : 'Não'}</td><td>${_cfPodeConfigurar() ? `<button class="btn btn-ghost btn-sm" data-cf-remover-vinculo="${esc(id)}" data-cf-remover-produto="${esc(p.produtoId)}">🗑️</button>` : ''}</td></tr>`).join(''), 'Nenhum produto vinculado ainda.')
      + `<div class="tc" style="padding:8px 12px;margin:14px 0 4px"><b style="font-size:.8rem">Histórico operacional de requisições PCP (ID do fornecedor; legado por nome somente quando necessário)</b></div>`
      + table(['Data', 'Pedido', 'Qtd', 'Unitário', 'Total'], historico.map(x => `<tr><td>${date(x.compradoEm)}</td><td>${esc(x.numeroCompra || '—')}</td><td>${n(x.quantidadeComprada).toLocaleString('pt-BR')}</td><td>${money(x.precoUnitario)}</td><td>${money(x.valorTotalEfetivo??x.valorTotal)}</td></tr>`).join(''), 'Sem histórico de compra vinculado a este nome ainda.')
      + `<div class="tc" style="padding:8px 12px;margin:14px 0 4px"><b style="font-size:.8rem">Histórico de alterações</b></div>`
      + table(['Quando', 'Quem', 'Alterações'], auditoria.map(a => `<tr><td>${date(a.criadoEm)}</td><td>${esc(a.criadoPor || '—')}</td><td>${(a.alteracoes || []).map(x => `${esc(x.campo)}: ${esc(x.valorAnterior ?? '—')} → ${esc(x.valorNovo ?? '—')}`).join('; ')}</td></tr>`).join(''), 'Nenhuma alteração registrada ainda.')
      + '<div id="cf-modal-host"></div>';
  }
  async function _cfConciliacaoHtml() {
    if (!_cfPodeConfigurar()) return '<div class="empty">Você não tem permissão para acessar a conciliação.</div>';
    if (cf.conciliando) return '<div class="empty">Comparando nomes legados com o cadastro mestre...</div>';
    if (!cf.conciliacao) return '<div class="tc" style="padding:14px"><p style="color:var(--muted);font-size:.8rem">Compara os nomes de fornecedor usados hoje (texto livre, sem CNPJ) em Solicitações, Agendamentos, Pedidos e no BI contra o cadastro mestre. <b>Somente leitura — nada é gravado aqui.</b></p><button class="btn btn-primary btn-sm" data-cf-rodar-conciliacao>▶️ Rodar simulação</button></div>';
    const r = cf.conciliacao;
    const grupo = (titulo, itens) => `<div class="tc" style="padding:8px 12px;margin:14px 0 4px"><b style="font-size:.8rem">${esc(titulo)} (${itens.length})</b></div>` + table(['Nome legado', 'Candidato(s)'], itens.map(x => `<tr><td>${esc(x.nomeLegado)}</td><td>${x.candidatos.map(c => esc(c.nomeFantasia)).join(', ') || '—'}</td></tr>`).join(''), 'Nenhum registro nesta categoria.');
    return `<div style="margin-bottom:10px"><button class="btn btn-ghost btn-sm" data-cf-rodar-conciliacao>↻ Rodar de novo</button></div>` + grupo('Correspondência exata', r.exato) + grupo('Correspondência provável', r.provavel) + grupo('Ambíguo (mais de um candidato)', r.ambiguo) + grupo('Sem correspondência', r.semCorrespondencia);
  }
  async function suppliersPage() {
    if (cf.selecionadoId) return await _cf360Html(cf.selecionadoId);
    await _cfCarregarLista();
    const corpo = cf.subTab === 'conciliacao' ? await _cfConciliacaoHtml() : _cfListaHtml();
    return header('🏢 Fornecedores', 'Cadastro mestre de fornecedores — produtos vinculados, homologação, bloqueios e histórico.') + _cfSubtabsHtml() + corpo + '<div id="cf-modal-host"></div>';
  }
  // PEDIDO AO VIVO (2026-08-27): "em agendamento vai ficar todos os
  // pedidos mostrando os que está agendado e os que não está agendado...
  // vai ser agendado lá pela [logística] ainda" — cada pedido de
  // recebimento_agendamentos vira uma linha por item (itensPedido), pra dar
  // pra ver produto a produto quem já tem dataAgendada e quem só tem a
  // dataPrevista (aguardando). O item não carrega classificação de
  // matéria-prima/produto acabado (esse filtro saiu junto com a troca de
  // fonte) — mas carrega código do produto, custo unitário, quantidade
  // recebida e valor pendente ("trago os campos código do produto, valor,
  // quantidade recebida"), somados entre parcelas do mesmo pedido/produto.
  function receiptsPage(){
    const linhas=[];
    (cache.receiptAgenda||[]).forEach(p=>{
      const itens=(p.itensPedido&&p.itensPedido.length)?p.itensPedido:[{produto:'—',quantidadePendente:0}];
      itens.forEach(it=>linhas.push({lojaId:p.lojaId,lojaNome:p.lojaNome,numeroPedido:p.numeroPedido,fornecedor:p.fornecedorNome,comprador:p.compradorNome,produto:it.produto,produtoKey:it.produtoKey,quantidadePendente:it.quantidadePendente,quantidadeRecebida:it.quantidadeRecebida,custoUnitario:it.custoUnitario,valorPendente:it.valorPendente,dataPrevista:p.dataPrevista,dataEntregaFinal:p.dataEntregaFinal,dataAgendada:p.dataAgendada,status:p.status}));
    });
    const lojas=[...new Map(linhas.map(x=>[x.lojaId||'',x.lojaNome||x.lojaId||'Loja ativa'])).entries()],produtos=[...new Set(linhas.map(x=>x.produto).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const xs=linhas.filter(x=>{if(filtrosReceb.loja&&String(x.lojaId||'')!==filtrosReceb.loja)return false;if(filtrosReceb.produto&&x.produto!==filtrosReceb.produto)return false;if(filtrosReceb.agendado==='sim'&&!x.dataAgendada)return false;if(filtrosReceb.agendado==='nao'&&x.dataAgendada)return false;return true;});
    const filtros=`<div class="tc" style="padding:10px;margin-bottom:12px;display:grid;grid-template-columns:repeat(3,minmax(150px,1fr));gap:7px"><select class="field" data-cp-rec-filter="loja"><option value="">Todas as lojas</option>${lojas.map(([id,nome])=>`<option value="${esc(id)}" ${filtrosReceb.loja===id?'selected':''}>${esc(nome)}</option>`).join('')}</select><select class="field" data-cp-rec-filter="produto"><option value="">Todos os produtos</option>${produtos.map(p=>`<option ${filtrosReceb.produto===p?'selected':''}>${esc(p)}</option>`).join('')}</select><select class="field" data-cp-rec-filter="agendado"><option value="">Agendados e não agendados</option><option value="sim" ${filtrosReceb.agendado==='sim'?'selected':''}>Agendados</option><option value="nao" ${filtrosReceb.agendado==='nao'?'selected':''}>Não agendados</option></select></div>`;
    return header('🚚 Recebimentos de compras','Todos os pedidos da base — agendados e aguardando agendamento pela logística.')+filtros+table(['Loja','Pedido','Código','Produto','Fornecedor','Comprador','Previsto','Agendado','Pendente','Recebida','Valor pendente','Status'],xs.map(x=>`<tr><td>${esc(x.lojaNome||x.lojaId||'—')}</td><td>${esc(x.numeroPedido||'—')}</td><td>${esc(x.produtoKey||'—')}</td><td><b>${esc(x.produto)}</b></td><td>${esc(x.fornecedor||'—')}</td><td>${esc(x.comprador||'—')}</td><td>${date(x.dataPrevista)}</td><td>${x.dataAgendada?`<span class="badge b-green">${date(x.dataAgendada)}</span>`:'<span class="badge b-orange">Não agendado</span>'}</td><td>${n(x.quantidadePendente).toLocaleString('pt-BR')}</td><td>${n(x.quantidadeRecebida).toLocaleString('pt-BR')}</td><td>${money(x.valorPendente)}</td><td>${status(x.status)}</td></tr>`).join(''),'Nenhum pedido na base ainda.');
  }

  function _isoMesesAtras(meses){const d=new Date();d.setMonth(d.getMonth()-meses);return d.toISOString().slice(0,10);}
  function _precoFiltrosHtml(){
    if(!precoFiltro.inicio)precoFiltro.inicio=_isoMesesAtras(12);
    if(!precoFiltro.fim)precoFiltro.fim=new Date().toISOString().slice(0,10);
    const fornecedores=[...new Set(precoLinhas.map(x=>x.nome_abreviado).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    return `<div class="tc" style="padding:12px;margin-bottom:12px;overflow:visible"><div style="display:grid;grid-template-columns:minmax(220px,2fr) repeat(3,minmax(140px,1fr)) auto;gap:8px;align-items:end"><div style="position:relative"><label style="font-size:.7rem;font-weight:700">Produto</label><input class="field" id="cp-preco-produto" autocomplete="off" value="${esc(precoFiltro.produto)}" placeholder="Digite pelo menos 2 letras..."><div id="cp-preco-sugestoes-host" style="position:absolute;top:100%;left:0;right:0;z-index:50">${_precoSugestoesHtml()}</div></div><div><label style="font-size:.7rem;font-weight:700">De</label><input class="field" type="date" id="cp-preco-inicio" value="${esc(precoFiltro.inicio)}"></div><div><label style="font-size:.7rem;font-weight:700">Até</label><input class="field" type="date" id="cp-preco-fim" value="${esc(precoFiltro.fim)}"></div><div><label style="font-size:.7rem;font-weight:700">Fornecedor</label><select class="field" id="cp-preco-fornecedor"><option value="">Todos</option>${fornecedores.map(f=>`<option value="${esc(f)}" ${precoFiltro.fornecedor===f?'selected':''}>${esc(f)}</option>`).join('')}</select></div><button class="btn btn-primary btn-sm" data-cp-preco-buscar>🔎 Buscar</button></div><div style="font-size:.68rem;color:var(--muted);margin-top:6px">${precoFiltro.produtoKey?'Produto selecionado — a busca é exata, sem misturar variantes parecidas.':'Escolha um produto da lista de sugestões pra buscar o histórico exato dele.'}</div></div>`;
  }
  // PEDIDO AO VIVO (2026-09-18): "só aparece um produto por vez, deveria
  // abrir uma caixa maior mostrando uns 10, com barra de rolagem" — bug
  // real: este `<div>` tinha position:absolute IGUAL ao container pai
  // (#cp-preco-sugestoes-host, que já é o posicionado). Um absolute DENTRO
  // de outro absolute conta a altura a partir do pai — que, sem conteúdo
  // em fluxo normal (o próprio filho é absolute, sai do fluxo), fica com
  // altura zero. Resultado: a caixa "existia" mas colapsada, só sobrando 1
  // linha visível por cima do conteúdo da página. Fix: o filho fica
  // relative/estático (o pai já cuida do posicionamento) — junto, aumentei
  // pra caber ~10 produtos (320px) antes de precisar rolar.
  function _precoSugestoesHtml(){
    if(precoFiltro.produtoKey||!precoFiltro.produto||precoFiltro.produto.trim().length<2)return '';
    if(precoSugerindo)return `<div class="dt-autocomplete" style="background:var(--bg,#fff);border:1px solid var(--border);border-radius:var(--r);margin-top:2px;padding:8px;font-size:.75rem;color:var(--muted);box-shadow:0 4px 14px rgba(0,0,0,.12)">Procurando produtos...</div>`;
    if(!precoSugestoes.length)return `<div class="dt-autocomplete" style="background:var(--bg,#fff);border:1px solid var(--border);border-radius:var(--r);margin-top:2px;padding:8px;font-size:.75rem;color:var(--muted);box-shadow:0 4px 14px rgba(0,0,0,.12)">Nenhum produto comprado bate com esse texto.</div>`;
    return `<div class="dt-autocomplete" style="background:var(--bg,#fff);border:1px solid var(--border);border-radius:var(--r);margin-top:2px;max-height:340px;overflow:auto;box-shadow:0 4px 14px rgba(0,0,0,.12)">${precoSugestoes.map(p=>`<div data-cp-preco-sugestao="${esc(p.produtoKey)}" data-cp-preco-sugestao-desc="${esc(p.descricao)}" style="padding:8px 10px;cursor:pointer;font-size:.8rem;border-bottom:1px solid var(--border)">${esc(p.descricao)}</div>`).join('')}</div>`;
  }
  async function buscarSugestoesPrecoProduto(){
    const busca=(precoFiltro.produto||'').trim();
    if(busca.length<2){precoSugestoes=[];precoSugerindo=false;return;}
    precoSugerindo=true;
    try{
      const callable=global.firebase.app().functions('southamerica-east1').httpsCallable('buscarProdutosComprasBigQuery');
      const resp=await callable({busca});
      precoSugestoes=resp?.data?.produtos||[];
    }catch(_e){precoSugestoes=[];}
    finally{precoSugerindo=false;}
  }
  function _precoResumoHtml(){
    const linhas=(precoFiltro.fornecedor?precoLinhas.filter(x=>String(x.nome_abreviado||'')===precoFiltro.fornecedor):precoLinhas).filter(linhaDoComprador);
    if(precoCarregando)return '<div class="empty">Consultando histórico de preços...</div>';
    if(precoErro)return `<div class="tc" style="padding:12px;border:1px solid var(--danger)">Falha: ${esc(precoErro)}</div>`;
    if(!linhas.length)return '<div class="empty"><div class="empty-title">Pesquise um produto para ver a trajetória completa de preços.</div></div>';
    const ord=linhas.slice().sort((a,b)=>String(a.data_emissao||'').localeCompare(String(b.data_emissao||'')));
    const precos=ord.map(x=>n(x.custo_liq_unit)).filter(v=>v>0), ultimo=ord[ord.length-1], anterior=ord.length>1?ord[ord.length-2]:null;
    const media=precos.length?precos.reduce((a,b)=>a+b,0)/precos.length:0,min=precos.length?Math.min(...precos):0,max=precos.length?Math.max(...precos):0;
    const variacao=anterior&&n(anterior.custo_liq_unit)>0?((n(ultimo.custo_liq_unit)-n(anterior.custo_liq_unit))/n(anterior.custo_liq_unit))*100:null;
    const mensal=new Map();ord.forEach(x=>{const m=String(x.data_emissao||'').slice(0,7);if(!m)return;const a=mensal.get(m)||{s:0,c:0,q:0};a.s+=n(x.custo_liq_unit);a.c++;a.q+=n(x.quantidade_faturada);mensal.set(m,a);});
    global.__comprasPrecoMensal=[...mensal.entries()].map(([mes,a])=>({mes,media:a.c?a.s/a.c:0,qtd:a.q}));
    return `<div class="kpi-grid" style="margin-bottom:14px"><div class="kpi blue"><div class="kpi-val">${money(ultimo.custo_liq_unit)}</div><div class="kpi-lbl">Último preço</div></div><div class="kpi teal"><div class="kpi-val">${money(media)}</div><div class="kpi-lbl">Preço médio</div></div><div class="kpi green"><div class="kpi-val">${money(min)}</div><div class="kpi-lbl">Menor preço</div></div><div class="kpi orange"><div class="kpi-val">${money(max)}</div><div class="kpi-lbl">Maior preço</div></div><div class="kpi ${variacao!=null&&variacao>0?'red':'green'}"><div class="kpi-val">${variacao==null?'—':variacao.toLocaleString('pt-BR',{maximumFractionDigits:1})+'%'}</div><div class="kpi-lbl">Variação vs compra anterior</div></div></div><div class="tc" style="padding:12px;margin-bottom:14px"><b>📈 Preço médio por mês</b><div style="height:260px;margin-top:8px"><canvas id="cp-preco-chart"></canvas></div></div>${table(['Data','NF','Fornecedor','Quantidade','Preço unitário','Valor total','Comprador'],ord.slice().reverse().map(x=>`<tr><td>${date(x.data_emissao)}</td><td>${esc(x.nf_numero||'—')}</td><td>${esc(x.nome_abreviado||'—')}</td><td>${n(x.quantidade_faturada).toLocaleString('pt-BR')}</td><td>${money(x.custo_liq_unit)}</td><td>${money(x.Custo_liquido_total)}</td><td>${esc(x.comprador_nome||'—')}</td></tr>`).join(''),'Sem compras no período.')}`;
  }
  function priceAnalysisPage(){return header('💹 Análise de Preços','Trajetória das compras, média mensal, fornecedores e variações de preço.')+_precoFiltrosHtml()+_precoResumoHtml();}
  function _desenharGraficoPreco(){
    if(precoChart){try{precoChart.destroy();}catch(_){ }precoChart=null;}
    const ctx=document.getElementById('cp-preco-chart'),dados=global.__comprasPrecoMensal||[];if(!ctx||!global.Chart||!dados.length)return;
    precoChart=new global.Chart(ctx,{type:'line',data:{labels:dados.map(x=>{const [a,m]=x.mes.split('-');return m+'/'+a;}),datasets:[{label:'Preço médio',data:dados.map(x=>x.media),tension:.2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{tooltip:{callbacks:{label:function(c){return 'Preço médio: '+money(c.raw);}}}},scales:{y:{ticks:{callback:function(v){return 'R$ '+Number(v).toLocaleString('pt-BR');}}}}}});
  }
  async function buscarAnalisePrecos(){
    // Só relê o campo do DOM quando ainda NÃO tem produtoKey resolvido —
    // isto é: um clique numa sugestão já deixou precoFiltro.produto/
    // produtoKey certos, e essa releitura (que pega o texto BRUTO que a
    // pessoa digitou, ex. "farofa") não pode sobrescrever isso.
    const prod=document.getElementById('cp-preco-produto'); if(prod&&!precoFiltro.produtoKey)precoFiltro.produto=prod.value.trim();
    const ini=document.getElementById('cp-preco-inicio');if(ini)precoFiltro.inicio=ini.value;
    const fim=document.getElementById('cp-preco-fim');if(fim)precoFiltro.fim=fim.value;
    const forn=document.getElementById('cp-preco-fornecedor');if(forn)precoFiltro.fornecedor=forn.value;
    if(!precoFiltro.produto){global.showToast?.('Digite um produto para pesquisar.','warning');return;}
    precoSugestoes=[];precoCarregando=true;precoErro='';render('precos');
    try{
      const callable=global.firebase.app().functions('southamerica-east1').httpsCallable('buscarHistoricoComprasBigQuery');
      // PEDIDO AO VIVO (2026-09-18): "escrevo farofa e ele traz toda a
      // família junto" — com produtoKey (veio de uma sugestão clicada), a
      // busca é EXATA (produto_key = X); sem produtoKey (Enter/Buscar sem
      // escolher da lista), cai no LIKE de sempre — continua funcionando,
      // só não é mais o caminho recomendado.
      const payload={inicio:precoFiltro.inicio,fim:precoFiltro.fim,tipoOperacao:'COMPRA'};
      if(precoFiltro.produtoKey)payload.produtoKey=precoFiltro.produtoKey;else payload.produto=precoFiltro.produto;
      const resp=await callable(payload);
      precoLinhas=resp?.data?.linhas||[];
    }catch(e){precoLinhas=[];precoErro=e.message||String(e);}finally{precoCarregando=false;await render('precos');}
  }
  function comprasAbrirAnalisePreco(produto){precoFiltro.produto=String(produto||'');precoFiltro.produtoKey='';precoFiltro.fornecedor='';precoLinhas=[];precoErro='';const nav=document.getElementById('nav-compras-precos');navigate('precos',nav);setTimeout(buscarAnalisePrecos,0);}
  // PEDIDO AO VIVO (2026-09-18): "reconstrua usando os arquivos reais de BI
  // que já existem hoje — a integração BlueSoft não vai acontecer" — a
  // tela era um placeholder estático (KPIs zerados vindos de
  // pcp_requisicoes_compra, a solicitação manual do PCP) com um aviso de
  // "Próximas integrações BlueSoft" que não existe mais no projeto. Agora
  // reaproveita a MESMA consulta agregada já usada pelo Dashboard de
  // Compras (buscarResumoComprasDashboardBigQuery, real, testada e no ar
  // desde a Fase 10) — Relatórios vira a versão TABULAR/detalhada do mesmo
  // dado (todo mês, todo fornecedor, todo produto — não só o Top 10 do
  // Dashboard), com o mesmo recorte por comprador de sempre.
  let relatoriosBi=null, relatoriosBiCarregando=false, relatoriosBiErro='';
  async function carregarRelatoriosBi(forcar){
    if(relatoriosBi&&!forcar)return relatoriosBi;
    relatoriosBiCarregando=true;relatoriosBiErro='';
    try{
      const callable=global.firebase.app().functions('southamerica-east1').httpsCallable('buscarResumoComprasDashboardBigQuery');
      const compradores=nomesVisiveisBi();
      const resp=await callable(compradores?{compradores}:{});
      relatoriosBi=resp?.data?.resumo||null;
    }catch(e){relatoriosBi=null;relatoriosBiErro=e.message||String(e);}
    finally{relatoriosBiCarregando=false;}
    return relatoriosBi;
  }
  function reportsPage(){
    if(relatoriosBiCarregando)return header('📈 Relatórios de compras','Indicadores reais do histórico de compras (BigQuery) — por período, produto e fornecedor.')+'<div class="empty">Consultando o histórico real de compras (BigQuery)...</div>';
    if(relatoriosBiErro)return header('📈 Relatórios de compras','Indicadores reais do histórico de compras (BigQuery) — por período, produto e fornecedor.')+`<div class="tc" style="padding:12px;border:1px solid var(--danger)">Falha ao consultar o histórico: ${esc(relatoriosBiErro)}</div>`;
    const r=relatoriosBi||{};
    const porMes=(r.porMes||[]).slice().sort((a,b)=>String(b.mes||'').localeCompare(String(a.mes||'')));
    const topFornecedores=r.topFornecedores||[], topProdutos=r.topProdutos||[], maisSubiram=r.maisSubiram||[], maisCairam=r.maisCairam||[];
    return header('📈 Relatórios de compras','Indicadores reais do histórico de compras (BigQuery) — por período, produto e fornecedor.')
      +`<div class="kpi-grid" style="margin-bottom:14px"><div class="kpi blue"><div class="kpi-val">${money(r.compradoNoMes||0)}</div><div class="kpi-lbl">Comprado no mês</div></div><div class="kpi teal"><div class="kpi-val">${money(r.compradoNoAno||0)}</div><div class="kpi-lbl">Comprado no ano</div></div><div class="kpi green"><div class="kpi-val">${n(r.nPedidos)}</div><div class="kpi-lbl">Notas fiscais</div></div><div class="kpi orange"><div class="kpi-val">${money(r.valorTotal||0)}</div><div class="kpi-lbl">Valor total (histórico)</div></div></div>`
      +`<div class="tc" style="padding:12px;margin-bottom:14px"><b>Compras por mês</b>`+table(['Mês','Valor'],porMes.map(m=>{const [ano,mes]=String(m.mes||'').split('-');return `<tr><td>${mes&&ano?mes+'/'+ano:m.mes}</td><td>${money(m.valor)}</td></tr>`;}).join(''),'Sem histórico de compras.')+'</div>'
      +`<div class="tc" style="padding:12px;margin-bottom:14px"><b>Fornecedores</b>`+table(['Fornecedor','Quantidade','Valor'],topFornecedores.map(f=>`<tr><td>${esc(f.fornecedor||'—')}</td><td>${n(f.qtd).toLocaleString('pt-BR')}</td><td>${money(f.valor)}</td></tr>`).join(''),'Sem fornecedores no período.')+'</div>'
      +`<div class="tc" style="padding:12px;margin-bottom:14px"><b>Produtos</b>`+table(['Produto','Quantidade','Valor'],topProdutos.map(p=>`<tr><td>${esc(p.produto||'—')}</td><td>${n(p.qtd).toLocaleString('pt-BR')}</td><td>${money(p.valor)}</td></tr>`).join(''),'Sem produtos no período.')+'</div>'
      +`<div class="tc" style="padding:12px;margin-bottom:14px"><b>📈 Maiores altas de preço</b>`+table(['Produto','Variação'],maisSubiram.map(p=>`<tr><td>${esc(p.produto||'—')}</td><td style="color:var(--danger,#dc2626)">${(n(p.variacaoPct)).toLocaleString('pt-BR',{maximumFractionDigits:1})}%</td></tr>`).join(''),'Sem variação de preço registrada.')+'</div>'
      +`<div class="tc" style="padding:12px"><b>📉 Maiores quedas de preço</b>`+table(['Produto','Variação'],maisCairam.map(p=>`<tr><td>${esc(p.produto||'—')}</td><td style="color:#16a34a">${(n(p.variacaoPct)).toLocaleString('pt-BR',{maximumFractionDigits:1})}%</td></tr>`).join(''),'Sem variação de preço registrada.')+'</div>';
  }
  // PEDIDO AO VIVO (2026-09-18): "eu não entendo como funciona esse regra
  // de compradores" — o texto antigo era só um checklist genérico (com uma
  // linha de "Conciliação BlueSoft" que nem existe mais no projeto) e o
  // botão levava pra aba "Histórico" da tela antiga, não pra regra em si.
  // Agora explica o que a regra faz de verdade e já abre direto na aba
  // "Regras de compradores" (ver data-cp-open-central no listener abaixo).
  function adminPage() { return header('⚙️ Administração de Compras','Regras de comprador por produto, categoria e fornecedor.')+`<div class="tc" style="padding:14px"><h3 style="margin-top:0">Como funciona a regra de comprador</h3><p style="color:var(--muted);font-size:.82rem;line-height:1.5">Cadastre 1 vez qual comprador é responsável por cada <b>produto</b>, <b>categoria</b> ou <b>fornecedor</b>. A partir daí, toda solicitação de compra criada pelo PCP já é direcionada automaticamente pro comprador certo — ninguém escolhe manualmente. Prioridade de resolução: Produto → Categoria → Fornecedor.</p><button class="btn btn-primary btn-sm" data-cp-open-central>🧾 Abrir regras de compradores</button></div>`; }
  async function render(name) { const page=document.getElementById('page-compras-'+name);if(!page)return;page.innerHTML='<div class="empty">Carregando...</div>';await load();if(name==='pedidos'||name==='recebimentos'||name==='cotacoes')await loadReceiptAgenda();if(name==='fornecedores')await loadFornecedoresBi();if(name==='produtos'){await carregarProdutosBi();if(selectedProduct)await loadConsumoInsumosBi();}if(name==='relatorios')await carregarRelatoriosBi();const html=name==='solicitacoes'?requestsPage():name==='cotacoes'?quotationsPage():name==='pedidos'?ordersPage():name==='produtos'?(selectedProduct?await product360():productsPage()):name==='precos'?priceAnalysisPage():name==='fornecedores'?await suppliersPage():name==='recebimentos'?receiptsPage():name==='relatorios'?reportsPage():adminPage();page.innerHTML=html;if(name==='precos')setTimeout(_desenharGraficoPreco,0); }
  // Roteador (correção de bug real confirmada nesta sessão): selectedProduct
  // nunca era limpo — reabrir "Produtos" pela barra lateral enquanto um
  // produto estava selecionado ficava preso no 360° do último produto. Uma
  // navegação "pura" pra produtos (navigate) sempre limpa a seleção; só
  // comprasSetProduto (clique em "Ver 360°", ou o roteador restaurando
  // ?produto= da URL) mantém/define um produto específico.
  function navigate(name, el) { if(name==='dashboard'||name==='central'){global._comprasIrParaPaginaOriginal?.(name,el);return;} if(name==='produtos')selectedProduct=''; if(name==='fornecedores')cf.selecionadoId=''; document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('on'));el?.classList.add('on');const page=document.getElementById('page-compras-'+name);page?.classList.add('on');const title=document.getElementById('page-title');if(title)title.textContent='Compras · '+(pageMeta[name]?.[0]||name);render(name).catch(e=>{if(page)page.innerHTML='<div class="empty">Falha: '+esc(e.message||e)+'</div>';}); }
  function comprasSetProduto(k) { selectedProduct=k||''; document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('on'));document.getElementById('nav-compras-produtos')?.classList.add('on');const page=document.getElementById('page-compras-produtos');page?.classList.add('on');const title=document.getElementById('page-title');if(title)title.textContent='Compras · '+(pageMeta.produtos?.[0]||'Produtos');render('produtos').catch(e=>{if(page)page.innerHTML='<div class="empty">Falha: '+esc(e.message||e)+'</div>';}); }
  function comprasClearSelectedProduct(){ selectedProduct=''; }
  function comprasGetSelectedProduct(){ return selectedProduct; }
  global._comprasIrParaPaginaOriginal=global.comprasIrParaPagina; global.comprasIrParaPagina=navigate; global.renderComprasProfissional=render;
  global.comprasSetProduto=comprasSetProduto;global.comprasClearSelectedProduct=comprasClearSelectedProduct;global.comprasGetSelectedProduct=comprasGetSelectedProduct;global.comprasAbrirAnalisePreco=comprasAbrirAnalisePreco;
  document.addEventListener('click',e=>{
    if(e.target.closest('[data-cp-cot-nova-abrir]')){abrirBuscaNovaCotacaoProduto();return;}
    const produto=e.target.closest('[data-cp-cot-produto]');
    if(produto){abrirNovaCotacaoProduto(produto.dataset.cpCotProduto,produto.dataset.cpCotProdutoNome);return;}
    if(e.target.closest('[data-cp-cot-nova-fechar]')){const h=document.getElementById('cp-cotacao-nova-host');if(h)h.innerHTML='';cotProdutoSelecionado=null;return;}
    if(e.target.closest('[data-cp-cot-nova-salvar]')){salvarNovaCotacaoProduto().catch(x=>global.showToast?.(x.message||x,'error'));}
  });
  document.addEventListener('input',e=>{
    if(e.target.id!=='cp-cot-produto-busca')return;
    cotProdutoBusca=e.target.value;cotProdutoSelecionado=null;clearTimeout(cotProdutoTimer);
    const busca=cotProdutoBusca.trim();cotProdutoSugerindo=busca.length>=2;cotProdutoSugestoes=busca.length>=2?cotProdutoSugestoes:[];
    const host=document.getElementById('cp-cot-produto-resultados');if(host)host.innerHTML=_cotProdutoSugestoesHtml();
    if(busca.length>=2)cotProdutoTimer=setTimeout(()=>buscarSugestoesCotacaoProduto().then(()=>{const h=document.getElementById('cp-cot-produto-resultados');if(h)h.innerHTML=_cotProdutoSugestoesHtml();}),300);
  });
  document.addEventListener('click',e=>{if(e.target.closest('[data-cp-preco-buscar]')){buscarAnalisePrecos();return;}const sug=e.target.closest('[data-cp-preco-sugestao]');if(sug){precoFiltro.produtoKey=sug.dataset.cpPrecoSugestao;precoFiltro.produto=sug.dataset.cpPrecoSugestaoDesc||precoFiltro.produto;precoSugestoes=[];buscarAnalisePrecos();return;}const p=e.target.closest('[data-cp-product]');if(p){comprasSetProduto(p.dataset.cpProduct);return;}if(e.target.closest('[data-cp-produto-voltar]')){comprasClearSelectedProduct();render('produtos');return;}if(e.target.closest('[data-cp-refresh]')){Object.keys(cache).forEach(k=>cache[k]=[]);_baseCarregada=false;_fornecedoresBiCarregado=false;_consumoInsumosBiCarregado=false;produtosBi=null;prod360CacheKey='';relatoriosBi=null;cf.carregado=false;cf.conciliacao=null;const active=document.querySelector('#setor-compras-shell .nav-item.on');navigate((active?.id||'').replace('nav-compras-','')||'solicitacoes',active);return;}if(e.target.closest('[data-cp-open-central]')){global._comprasIrParaPaginaOriginal?.('central',document.getElementById('nav-compras-central'));global.comprasSetAbaCentral?.('regras');return;}const rr=e.target.closest('[data-cp-req-responder]');if(rr){modalResponderAlteracaoPCP(rr.dataset.cpReqResponder);return;}const rsp=e.target.closest('[data-cp-req-resp]');if(rsp){const [id,resp]=rsp.dataset.cpReqResp.split('|');responderAlteracaoPCP(id,resp==='sim').catch(x=>global.showToast?.(x.message||x,'error'));return;}const an=e.target.closest('[data-cp-req-analise]');if(an){marcarEmAnalise(an.dataset.cpReqAnalise).catch(x=>global.showToast?.(x.message,'error'));return;}const co=e.target.closest('[data-cp-req-comprar]');if(co){modalRegistrarCompra(co.dataset.cpReqComprar);return;}const sv=e.target.closest('[data-cp-req-save]');if(sv){salvarCompraSolicitacao(sv.dataset.cpReqSave).catch(x=>global.showToast?.(x.message,'error'));return;}if(e.target.closest('[data-cp-req-modal-close]')){const h=document.getElementById('cp-req-modal-host');if(h)h.innerHTML='';cotacaoSelecionadaIdx=-1;compraCotacaoAtual=null;return;}const cot=e.target.closest('[data-cp-cotar]');if(cot){cotacaoEditandoIdx=-1;modalCotacao(cot.dataset.cpCotar);return;}if(e.target.closest('[data-cp-cotacao-fechar]')){const h=document.getElementById('cp-cotacao-modal-host');if(h)h.innerHTML='';cotacaoAtivaId='';cotacaoEditandoIdx=-1;return;}const cadd=e.target.closest('[data-cp-cotacao-add]');if(cadd){adicionarCotacao(cadd.dataset.cpCotacaoAdd).catch(x=>global.showToast?.(x.message,'error'));return;}const cedit=e.target.closest('[data-cp-cotacao-editar]');if(cedit){modalCotacao(cotacaoAtivaId,Number(cedit.dataset.cpCotacaoEditar));return;}if(e.target.closest('[data-cp-cotacao-cancelar-edicao]')){cotacaoEditandoIdx=-1;modalCotacao(cotacaoAtivaId);return;}const cuse=e.target.closest('[data-cp-cotacao-usar]');if(cuse){usarCotacaoIdx(Number(cuse.dataset.cpCotacaoUsar));return;}const cdel=e.target.closest('[data-cp-cotacao-remover]');if(cdel){removerCotacaoIdx(Number(cdel.dataset.cpCotacaoRemover)).catch(x=>global.showToast?.(x.message,'error'));return;}const pi=e.target.closest('[data-cp-pedido-itens]');if(pi){modalItensPedido(pi.dataset.cpPedidoItens);return;}if(e.target.closest('[data-cp-pedido-itens-fechar]')){const h=document.getElementById('cp-pedido-itens-modal-host');if(h)h.innerHTML='';return;}});
  document.addEventListener('change',e=>{const f=e.target.closest('[data-cp-rec-filter]');if(!f)return;filtrosReceb[f.dataset.cpRecFilter]=f.value;render('recebimentos');});
  document.addEventListener('change',e=>{const etapa=e.target.closest('[data-cp-cot-etapa]');if(etapa){filtrosCotacao.etapa=etapa.value;render('cotacoes');}});
  document.addEventListener('input',e=>{if(!e.target.matches('[data-cp-cot-busca]'))return;filtrosCotacao.busca=e.target.value;const pos=e.target.selectionStart;render('cotacoes').then(()=>{const campo=document.querySelector('[data-cp-cot-busca]');if(campo){campo.focus();campo.setSelectionRange(pos,pos);}});});
  // BUG AO VIVO REAL (2026-09-18): "digito uma letra e tenho que clicar de
  // novo pra continuar digitando" — render() reconstrói o innerHTML inteiro
  // (inclusive o próprio campo de busca) a cada tecla, que perde o foco
  // sozinho. Restaura foco+posição do cursor depois do redesenho.
  document.addEventListener('input',e=>{if(e.target.matches('[data-cp-search]')){query=e.target.value.toLowerCase();const active=document.querySelector('#setor-compras-shell .nav-item.on');const pos=e.target.selectionStart;render((active?.id||'').replace('nav-compras-','')||'produtos').then(()=>{const campo=document.querySelector('[data-cp-search]');if(campo){campo.focus();campo.setSelectionRange(pos,pos);}});}
    if(e.target.id==='cp-preco-produto'){
      // Redesenha só o container das sugestões (#cp-preco-sugestoes-host),
      // nunca a página inteira — senão o campo perderia o foco a cada
      // letra digitada (mesmo bug já corrigido antes na busca de
      // Produtos/Pedidos).
      precoFiltro.produto=e.target.value;precoFiltro.produtoKey='';
      clearTimeout(precoSugestoesTimer);
      const busca=precoFiltro.produto.trim();
      precoSugerindo=busca.length>=2;precoSugestoes=busca.length>=2?precoSugestoes:[];
      const host=document.getElementById('cp-preco-sugestoes-host');if(host)host.innerHTML=_precoSugestoesHtml();
      if(busca.length>=2){precoSugestoesTimer=setTimeout(()=>{buscarSugestoesPrecoProduto().then(()=>{const h2=document.getElementById('cp-preco-sugestoes-host');if(h2)h2.innerHTML=_precoSugestoesHtml();});},300);}
    }
  });
  // Fase 1A — Fundação de Compras: eventos da aba Fornecedores (cadastro
  // mestre), isolados num listener próprio pra não inflar ainda mais o
  // listener único de cima.
  document.addEventListener('click', e => {
    const st = e.target.closest('[data-cf-subtab]'); if (st) { cf.subTab = st.dataset.cfSubtab; cf.selecionadoId = ''; render('fornecedores'); return; }
    if (e.target.closest('[data-cf-novo]')) { _cfAbrirModalCadastro(null); return; }
    const ed = e.target.closest('[data-cf-editar]'); if (ed) { svcForn().buscarPorId(ed.dataset.cfEditar).then(f => f && _cfAbrirModalCadastro(f)); return; }
    if (e.target.closest('[data-cf-modal-fechar]')) { _cfFecharModal(); return; }
    const sv = e.target.closest('[data-cf-salvar]'); if (sv) { _cfSalvarCadastro(sv.dataset.cfSalvar || '').catch(x => global.showToast?.(x.message, 'error')); return; }
    const v360 = e.target.closest('[data-cf-detalhe]'); if (v360) { cf.selecionadoId = v360.dataset.cfDetalhe; render('fornecedores'); return; }
    if (e.target.closest('[data-cf-voltar]')) { cf.selecionadoId = ''; render('fornecedores'); return; }
    const bl = e.target.closest('[data-cf-bloquear]'); if (bl) { svcForn().buscarPorId(bl.dataset.cfBloquear).then(f => f && _cfAbrirModalBloqueio(f, 'bloquear')); return; }
    const desbl = e.target.closest('[data-cf-desbloquear]'); if (desbl) { svcForn().buscarPorId(desbl.dataset.cfDesbloquear).then(f => f && _cfAbrirModalBloqueio(f, 'desbloquear')); return; }
    const cbl = e.target.closest('[data-cf-confirmar-bloqueio]'); if (cbl) { _cfConfirmarBloqueio(cbl.dataset.cfConfirmarBloqueio, cbl.dataset.cfAcao).catch(x => global.showToast?.(x.message, 'error')); return; }
    if (e.target.closest('[data-cf-rodar-conciliacao]')) { cf.conciliando = true; render('fornecedores'); svcForn().simularConciliacaoLegado().then(r => { cf.conciliacao = r; cf.conciliando = false; render('fornecedores'); }).catch(x => { cf.conciliando = false; global.showToast?.(x.message, 'error'); render('fornecedores'); }); return; }
    const vinc = e.target.closest('[data-cf-vincular]'); if (vinc) { _cfVincularProduto(vinc.dataset.cfVincular).catch(x => global.showToast?.(x.message, 'error')); return; }
    const remVinc = e.target.closest('[data-cf-remover-vinculo]'); if (remVinc) { _cfRemoverVinculo(remVinc.dataset.cfRemoverVinculo, remVinc.dataset.cfRemoverProduto).catch(x => global.showToast?.(x.message, 'error')); return; }
  });
  document.addEventListener('input', e => { if (e.target.matches('[data-cf-busca]')) { cf.busca = e.target.value; const pos=e.target.selectionStart;clearTimeout(cfBuscaTimer);cfBuscaTimer=setTimeout(()=>render('fornecedores').then(()=>{const campo=document.querySelector('[data-cf-busca]');if(campo){campo.focus();try{campo.setSelectionRange(pos,pos);}catch(_e){}}}),180); } });
  document.addEventListener('change', e => { if (e.target.matches('[data-cf-filtro-situacao]')) { cf.filtroSituacao = e.target.value; render('fornecedores'); } });
})(window);
