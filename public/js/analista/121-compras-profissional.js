// Hub profissional de Compras: visão financeira restrita ao setor Compras.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const n = v => Number(v) || 0;
  const money = v => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fs = () => global.getDTFirestore();
  const raw = () => global.getDTRawFirestore();
  const tem = a => typeof global.temPermissao!=='function'||global.temPermissao('compras-central',a);
  const collections = { requests:'pcp_requisicoes_compra', products:'producao_produtos', schedules:'pcp_agendamentos', rules:'compras_regras_comprador', receiptAgenda:'recebimento_agendamentos' };
  let cache = { requests:[], products:[], schedules:[], rules:[], receiptAgenda:[], fornecedoresBi:[], consumoInsumosBi:[] }, query = '', selectedProduct = '', cotacaoAtivaId = '';
  let filtrosReceb={loja:'',produto:'',agendado:''};
  // PEDIDO AO VIVO (2026-08-27): "Minhas requisições" (Central de Compras)
  // e "Solicitações" (aqui) mostravam a MESMA coisa (pcp_requisicoes_compra,
  // já filtrada pro comprador logado — ver `load()` acima) — consolidado
  // num só lugar, com o nome e o comportamento (ação de registrar compra)
  // que antes só existiam em "Minhas requisições".
  const pageMeta = {
    solicitacoes:['Solicitações PCP','📥'], cotacoes:['Cotações','⚖️'], pedidos:['Pedidos','🧾'], produtos:['Produtos','🔎'],
    fornecedores:['Fornecedores','🏢'], recebimentos:['Recebimentos','🚚'], relatorios:['Relatórios','📈'], administracao:['Administração','⚙️']
  };
  const key = x => String(x?.prodKey || x?.cod || '').trim() || String(x?.produto || x?.nome || '').trim().toLowerCase();
  const date = v => String(v || '').slice(0,10) || '—';
  const status = s => `<span class="badge ${/cancel|rejeit/i.test(s)?'b-red':/recebid|final|comprad/i.test(s)?'b-green':/analise|cotacao|pedido/i.test(s)?'b-blue':'b-orange'}">${esc(s||'solicitada')}</span>`;
  async function load(force=false) {
    if (!force && cache.requests.length) return cache;
    const empty={docs:[]},uid=global._currentAnalistaUser?.uid||global.firebase?.auth?.().currentUser?.uid||'',restrito=!tem('configurar');
    const snaps=await Promise.all(Object.values(collections).map(c=>{let ref=fs().collection(c);if(restrito&&uid&&(c===collections.requests||c===collections.schedules))ref=ref.where('compradorUid','==',uid);return ref.get().catch(()=>empty);}));
    const lojaId=global.getDTLojaAtiva?.()||'',lojaNome=global.getDTLojaAtivaNome?.()||lojaId;
    Object.keys(collections).forEach((name,i)=>{cache[name]=snaps[i].docs.map(d=>({_id:d.id,lojaId,lojaNome,...d.data()}));});
    // PEDIDO AO VIVO (2026-08-28): "ranking de fornecedores que você não
    // aplicou lá no Compras" — bi_fornecedores_agregado é GLOBAL (não por
    // loja), por isso busca à parte com raw(), não entra no loop acima.
    const temRaw=typeof global.getDTRawFirestore==='function';
    const [fornecedoresBiSnap,consumoInsumosBiSnap]=await Promise.all([
      temRaw?raw().collection('bi_fornecedores_agregado').get().catch(()=>empty):Promise.resolve(empty),
      temRaw?raw().collection('bi_consumo_insumos_resumo').get().catch(()=>empty):Promise.resolve(empty),
    ]);
    cache.fornecedoresBi=fornecedoresBiSnap.docs.map(d=>({_id:d.id,...d.data()}));
    cache.consumoInsumosBi=consumoInsumosBiSnap.docs.map(d=>({_id:d.id,...d.data()}));
    return cache;
  }
  function header(title, subtitle) { return `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px"><div><div class="page-title" style="font-size:1.15rem">${title}</div><div style="font-size:.74rem;color:var(--muted)">${subtitle}</div></div><button class="btn btn-ghost btn-sm" data-cp-refresh>↻ Atualizar</button></div>`; }
  function table(head, rows, empty='Nenhum registro encontrado.') { return `<div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${head.length}">${empty}</td></tr>`}</tbody></table></div></div>`; }
  function requestsPage() { const xs=cache.requests.filter(x=>!query||JSON.stringify(x).toLowerCase().includes(query)); return header('📥 Solicitações PCP','Pedidos direcionados pelo PCP — registre a compra sem sair daqui.')+`<div class="tc" style="padding:12px;margin-bottom:12px"><input class="field" data-cp-search placeholder="Produto, código, solicitante ou status..." value="${esc(query)}"></div>`+table(['Produto','Solicitado','Necessidade','Destino','Motivo','Prioridade','Comprador','Status','Criada em','Compra',''],xs.map(x=>`<tr><td><b>${esc(x.produto)}</b></td><td>${n(x.quantidade).toLocaleString('pt-BR')}</td><td>${date(x.dataNecessaria)}</td><td>${esc(x.destino||'—')}</td><td>${esc(x.motivo||'—')}</td><td>${esc(x.prioridade||'normal')}</td><td>${esc(x.compradorNome||x.compradorEmail||'Não direcionado')}</td><td>${status(x.status)}</td><td>${date(x.criadoEm)}</td><td>${esc(x.numeroCompra||'—')}</td><td style="white-space:nowrap">${tem('editar')&&!/comprad|final|cancel|rejeit/i.test(String(x.status||''))?`<button class="acao-lapis" data-cp-req-analise="${esc(x._id)}" title="Em análise">🔎</button><button class="acao-lapis" data-cp-req-comprar="${esc(x._id)}" title="Registrar compra">🛒</button>`:''}</td></tr>`).join(''))+'<div id="cp-req-modal-host"></div>'; }
  function modalRegistrarCompra(id, preenchimento) { const x=cache.requests.find(r=>r._id===id),host=document.getElementById('cp-req-modal-host'); if(!x||!host)return; const pre=preenchimento||{}; host.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:620px"><div class="modal-header"><b>Registrar compra — ${esc(x.produto)}</b><button class="modal-x" data-cp-req-modal-close>×</button></div><div class="modal-body"><div class="grid2"><div class="form-group"><label>Número da compra/pedido</label><input class="field" id="cp-req-num"></div><div class="form-group"><label>Fornecedor</label><input class="field" id="cp-req-forn" value="${esc(pre.fornecedor||'')}"></div><div class="form-group"><label>Quantidade comprada</label><input class="field" id="cp-req-qtd" type="number" min="0" value="${n(x.quantidade)}"></div><div class="form-group"><label>Preço unitário</label><input class="field" id="cp-req-preco" type="number" min="0" step="0.01" value="${pre.precoUnitario?n(pre.precoUnitario):''}" placeholder="0,00"></div><div class="form-group"><label>Previsão de entrega</label><input class="field" id="cp-req-prev" type="date"></div></div><div class="form-group"><label>Observações</label><textarea class="field" id="cp-req-obs" rows="3">${esc(x.observacaoCompras||'')}</textarea></div></div><div class="modal-footer"><button class="btn btn-ghost" data-cp-req-modal-close>Cancelar</button><button class="btn btn-primary" data-cp-req-save="${esc(id)}">Salvar compra</button></div></div></div>`; }
  // "Usar esta cotação" abre o modal de compra a partir da aba Cotações —
  // salvar precisa voltar pra aba de onde veio, não sempre Solicitações.
  function _nomePaginaAtiva() { const active=document.querySelector('#setor-compras-shell .nav-item.on'); return (active?.id||'').replace('nav-compras-','')||'solicitacoes'; }
  async function marcarEmAnalise(id) { const x=cache.requests.find(r=>r._id===id); if(!x||!tem('editar'))return; await fs().collection(collections.requests).doc(id).set({status:'em_analise',atualizadoEm:new Date().toISOString(),atualizadoPor:global._currentAnalistaUser?.email||''},{merge:true}); await load(true); render(_nomePaginaAtiva()); }
  async function salvarCompraSolicitacao(id) { if(!tem('editar'))return; const req=cache.requests.find(r=>r._id===id); if(!req)return; const numeroCompra=document.getElementById('cp-req-num')?.value.trim()||'',fornecedor=document.getElementById('cp-req-forn')?.value.trim()||'',quantidadeComprada=Math.max(0,n(document.getElementById('cp-req-qtd')?.value)),precoUnitario=Math.max(0,n(document.getElementById('cp-req-preco')?.value)),dataPrevista=document.getElementById('cp-req-prev')?.value||'',observacaoCompras=document.getElementById('cp-req-obs')?.value.trim()||''; if(!numeroCompra||!fornecedor||quantidadeComprada<=0||!dataPrevista){global.showToast?.('Informe número da compra, fornecedor, quantidade e previsão de entrega.','warning');return;} const valorTotal=precoUnitario*quantidadeComprada,agora=new Date().toISOString(); const compradorUid=global._currentAnalistaUser?.uid||global.firebase?.auth?.().currentUser?.uid||'',compradorNome=global._currentAnalistaUser?.nome||req.compradorNome||'',compradorEmail=global._currentAnalistaUser?.email||req.compradorEmail||''; const payload={numeroCompra,fornecedor,quantidadeComprada,precoUnitario,valorTotal,dataPrevista,observacaoCompras,status:'comprada',compradoEm:agora,compradoPor:compradorEmail,atualizadoEm:agora}; try{await fs().collection(collections.requests).doc(id).set(payload,{merge:true});await fs().collection(collections.schedules).doc('req_'+id).set({requisicaoId:id,cod:req.prodKey||req.cod||'',prodKey:req.prodKey||req.cod||'',produto:req.produto||'',fornecedor,quantidade:quantidadeComprada,quantidadeRecebida:0,dataPrevista,numeroCompra,precoUnitario,valorTotal,compradorUid,compradorNome,compradorEmail,destino:req.destino||'',pcpResponsavel:req.pcpResponsavel||'',status:'prevista',origem:'COMPRAS',criadoEm:agora,atualizadoEm:agora},{merge:true});document.getElementById('cp-req-modal-host').innerHTML='';await load(true);render(_nomePaginaAtiva());global.showToast?.('Compra registrada.','success');}catch(e){global.showToast?.('Erro ao registrar compra: '+(e.message||e),'error');} }
  // PEDIDO AO VIVO (2026-08-27): "duas, três empresas mandam cotação...
  // ela vai ter que fazer todo um cálculo pra me dar um retorno de qual é
  // a melhor pra fazer negócio... se tem esses bônus, impostos, quanto
  // tempo" — comparação com peso configurável por fator, nunca escolhendo
  // sozinho (só ordena e destaca, quem decide é o comprador). Histórico do
  // fornecedor vem de recebimento_agendamentos (dataAgendada real vs
  // dataPrevista original) — "pega todo o histórico que precisar".
  const PESOS_COTACAO = { preco:0.40, prazo:0.20, pagamento:0.15, qtdMinima:0.10, frete:0.05, historico:0.10 };
  function _historicoFornecedores() {
    const porFornecedor = new Map();
    (cache.receiptAgenda||[]).forEach(a => {
      const chave = String(a.fornecedorNome||'').trim().toLowerCase();
      if (!chave || !a.dataAgendada || !a.dataPrevista) return;
      const atraso = (new Date(a.dataAgendada) - new Date(a.dataPrevista)) / 86400000;
      if (!Number.isFinite(atraso)) return;
      const acc = porFornecedor.get(chave) || [];
      acc.push(atraso); porFornecedor.set(chave, acc);
    });
    const resultado = {};
    porFornecedor.forEach((atrasos, chave) => { resultado[chave] = { atrasoMedioDias: atrasos.reduce((s,v)=>s+v,0)/atrasos.length, entregas: atrasos.length }; });
    return resultado;
  }
  function _pontuarCotacoes(cotacoes) {
    if (!cotacoes || !cotacoes.length) return [];
    const historico = _historicoFornecedores();
    const precos = cotacoes.map(c=>n(c.precoUnitario)).filter(v=>v>0), minPreco = precos.length?Math.min(...precos):0;
    const prazos = cotacoes.map(c=>n(c.prazoEntregaDias)).filter(v=>v>0), minPrazo = prazos.length?Math.min(...prazos):0;
    const maxCondPag = Math.max(1, ...cotacoes.map(c=>n(c.condicaoPagamentoDias)));
    return cotacoes.map((c,idx) => {
      const scorePreco = n(c.precoUnitario)>0 && minPreco>0 ? (minPreco/n(c.precoUnitario))*100 : 0;
      const scorePrazo = n(c.prazoEntregaDias)>0 && minPrazo>0 ? (minPrazo/n(c.prazoEntregaDias))*100 : 50;
      const scorePagamento = maxCondPag>0 ? (n(c.condicaoPagamentoDias)/maxCondPag)*100 : 0;
      const scoreFrete = c.freteIncluso ? 100 : 0;
      const h = historico[String(c.fornecedor||'').trim().toLowerCase()];
      const scoreHistorico = !h ? 50 : Math.max(0, 100 - h.atrasoMedioDias*10);
      const scoreFinal = scorePreco*PESOS_COTACAO.preco + scorePrazo*PESOS_COTACAO.prazo + scorePagamento*PESOS_COTACAO.pagamento + 100*PESOS_COTACAO.qtdMinima + scoreFrete*PESOS_COTACAO.frete + scoreHistorico*PESOS_COTACAO.historico;
      return { ...c, _idx:idx, score:Math.round(scoreFinal), historicoFornecedor:h||null };
    }).sort((a,b)=>b.score-a.score).map((c,pos)=>({...c, _melhor:pos===0}));
  }
  function quotationsPage() { const xs=cache.requests.filter(x=>/analise|cotacao|solicitada/i.test(String(x.status||''))); return header('⚖️ Cotações','Mapa comparativo, aprovações e rastreabilidade por solicitação.')+`<div class="kpi-grid" style="margin-bottom:14px"><div class="kpi orange"><div class="kpi-val">${xs.length}</div><div class="kpi-lbl">Aguardando cotação</div></div><div class="kpi blue"><div class="kpi-val">${xs.filter(x=>/cotacao/i.test(x.status||'')).length}</div><div class="kpi-lbl">Em cotação</div></div></div>`+table(['Solicitação','Produto','Qtd','Comprador','Prazo','Cotações','Status','Ação'],xs.map(x=>`<tr><td>${esc(x._id)}</td><td><b>${esc(x.produto)}</b></td><td>${n(x.quantidade).toLocaleString('pt-BR')}</td><td>${esc(x.compradorNome||x.compradorEmail||'—')}</td><td>${date(x.dataNecessaria)}</td><td>${(x.cotacoes||[]).length}</td><td>${status(x.status)}</td><td><button class="btn btn-ghost btn-sm" data-cp-cotar="${esc(x._id)}">📊 Cotar</button></td></tr>`).join(''))+'<div id="cp-cotacao-modal-host"></div><div id="cp-req-modal-host"></div>'; }
  function _linhaCotacao(c) { return `<tr${c._melhor?' style="background:rgba(34,197,94,.08)"':''}><td>${esc(c.fornecedor)}${c._melhor?' <span class="badge b-green" style="font-size:.6rem">recomendada</span>':''}</td><td>${money(c.precoUnitario)}</td><td>${n(c.prazoEntregaDias)}d</td><td>${n(c.condicaoPagamentoDias)}d</td><td>${n(c.quantidadeMinima)||'—'}</td><td>${c.freteIncluso?'Sim':'Não'}</td><td>${c.historicoFornecedor?c.historicoFornecedor.atrasoMedioDias.toFixed(1)+'d ('+c.historicoFornecedor.entregas+' entrega(s))':'Sem histórico'}</td><td><b>${c.score}</b></td><td><button class="btn btn-primary btn-sm" data-cp-cotacao-usar="${c._idx}">Usar esta</button> <button class="acao-lapis" title="Remover" data-cp-cotacao-remover="${c._idx}">🗑️</button></td></tr>`; }
  function modalCotacao(id) { const x=cache.requests.find(r=>r._id===id),host=document.getElementById('cp-cotacao-modal-host'); if(!x||!host)return; cotacaoAtivaId=id; const pontuadas=_pontuarCotacoes(x.cotacoes||[]); host.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:900px"><div class="modal-header"><b>Cotações — ${esc(x.produto)}</b><button class="modal-x" data-cp-cotacao-fechar>×</button></div><div class="modal-body"><div style="font-size:.72rem;color:var(--muted);margin-bottom:10px">Cadastre a proposta de cada fornecedor. O sistema ordena pela melhor combinação de preço, prazo, pagamento, frete e histórico — você decide qual usar.</div>${pontuadas.length?`<div style="overflow:auto;margin-bottom:14px"><table class="dt-table"><thead><tr><th>Fornecedor</th><th>Preço unit.</th><th>Prazo entrega</th><th>Cond. pagamento</th><th>Qtd mínima</th><th>Frete incluso</th><th>Histórico</th><th>Score</th><th></th></tr></thead><tbody>${pontuadas.map(_linhaCotacao).join('')}</tbody></table></div>`:'<div class="empty" style="margin-bottom:14px"><div class="empty-sub">Nenhuma cotação cadastrada ainda.</div></div>'}<div class="tc" style="padding:12px"><b style="font-size:.8rem">+ Nova proposta</b><div class="grid2" style="margin-top:8px"><div class="form-group"><label>Fornecedor</label><input class="field" id="cp-cot-forn"></div><div class="form-group"><label>Preço unitário</label><input class="field" id="cp-cot-preco" type="number" min="0" step="0.01"></div><div class="form-group"><label>Prazo de entrega (dias)</label><input class="field" id="cp-cot-prazo" type="number" min="0"></div><div class="form-group"><label>Condição de pagamento (dias)</label><input class="field" id="cp-cot-pagamento" type="number" min="0" value="30"></div><div class="form-group"><label>Quantidade mínima</label><input class="field" id="cp-cot-qtdmin" type="number" min="0"></div><div class="form-group" style="display:flex;align-items:flex-end"><label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="cp-cot-frete"> Frete incluso</label></div></div><div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn btn-primary btn-sm" data-cp-cotacao-add="${esc(id)}">+ Adicionar proposta</button></div></div></div><div class="modal-footer"><button class="btn btn-ghost" data-cp-cotacao-fechar>Fechar</button></div></div></div>`; }
  async function adicionarCotacao(id) { if(!tem('editar'))return; const x=cache.requests.find(r=>r._id===id); if(!x)return; const fornecedor=document.getElementById('cp-cot-forn')?.value.trim()||''; if(!fornecedor){global.showToast?.('Informe o fornecedor.','warning');return;} const nova={fornecedor,precoUnitario:n(document.getElementById('cp-cot-preco')?.value),prazoEntregaDias:n(document.getElementById('cp-cot-prazo')?.value),condicaoPagamentoDias:n(document.getElementById('cp-cot-pagamento')?.value),quantidadeMinima:n(document.getElementById('cp-cot-qtdmin')?.value),freteIncluso:!!document.getElementById('cp-cot-frete')?.checked,criadoEm:new Date().toISOString(),criadoPor:global._currentAnalistaUser?.email||''}; const cotacoes=[...(x.cotacoes||[]),nova]; await fs().collection(collections.requests).doc(id).set({cotacoes,status:x.status==='solicitada'?'em_cotacao':x.status,atualizadoEm:new Date().toISOString()},{merge:true}); x.cotacoes=cotacoes; if(x.status==='solicitada')x.status='em_cotacao'; modalCotacao(id); }
  async function removerCotacaoIdx(idx) { if(!tem('editar')||!cotacaoAtivaId)return; const x=cache.requests.find(r=>r._id===cotacaoAtivaId); if(!x)return; const cotacoes=(x.cotacoes||[]).filter((_,i)=>i!==idx); await fs().collection(collections.requests).doc(cotacaoAtivaId).set({cotacoes},{merge:true}); x.cotacoes=cotacoes; modalCotacao(cotacaoAtivaId); }
  function usarCotacaoIdx(idx) { if(!cotacaoAtivaId)return; const x=cache.requests.find(r=>r._id===cotacaoAtivaId); if(!x)return; const c=(x.cotacoes||[])[idx]; if(!c)return; const host=document.getElementById('cp-cotacao-modal-host'); if(host)host.innerHTML=''; modalRegistrarCompra(cotacaoAtivaId, {fornecedor:c.fornecedor, precoUnitario:c.precoUnitario}); }
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
  // producao_produtos guarda TANTO produto comprado (fornecedorPadrao)
  // quanto produzido internamente (empresaProdutoraId); completar a lista
  // com quem tem empresaProdutoraId estava trazendo exatamente quem nunca
  // vai ter compra de verdade. Mesmo campo que produzidoInternamente() já
  // usa em 78-pcp-central.js, aplicado aqui também.
  function productGroups() { const map=new Map(); cache.requests.filter(x=>n(x.quantidadeComprada)>0).forEach(x=>{const k=key(x);if(!map.has(k))map.set(k,{key:k,name:x.produto,code:x.prodKey||x.cod||'',rows:[]});map.get(k).rows.push(x);}); cache.products.filter(p=>!p.empresaProdutoraId).forEach(p=>{const k=key(p);if(k&&!map.has(k))map.set(k,{key:k,name:p.nome,code:p.cod||'',rows:[]});}); return [...map.values()]; }
  function productsPage() { const groups=productGroups().filter(g=>!query||(g.name+' '+g.code).toLowerCase().includes(query)); return header('🔎 Produtos e histórico de compras','Pesquise qualquer item e abra o comparativo completo das últimas compras.')+`<div class="tc" style="padding:12px;margin-bottom:12px"><input class="field" data-cp-search placeholder="Pesquisar produto ou código..." value="${esc(query)}"></div>`+table(['Código','Produto','Compras','Última compra','Último fornecedor','Último valor','Ação'],groups.map(g=>{const rows=g.rows.sort((a,b)=>String(b.compradoEm||'').localeCompare(String(a.compradoEm||''))),last=rows[0];return `<tr><td>${esc(g.code||'—')}</td><td><b>${esc(g.name)}</b></td><td>${rows.length}</td><td>${date(last?.compradoEm)}</td><td>${esc(last?.fornecedor||'—')}</td><td>${last?money(last.precoUnitario):'—'}</td><td><button class="btn btn-ghost btn-sm" data-cp-product="${esc(g.key)}">Ver 360°</button></td></tr>`;}).join('')); }
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
  async function product360() { const g=productGroups().find(x=>x.key===selectedProduct); if(!g)return productsPage(); const rows=g.rows.sort((a,b)=>String(b.compradoEm||'').localeCompare(String(a.compradoEm||''))); const prices=rows.map(x=>n(x.precoUnitario)).filter(Boolean), avg=prices.length?prices.reduce((a,b)=>a+b,0)/prices.length:0,last=rows[0]; const consumo=(cache.consumoInsumosBi||[]).find(x=>String(x.sku)===String(g.code)); const cortes=await global._pcpCortesInternals?.buscarHistoricoProduto?.(g.code).catch(()=>[])||[]; return header('🔎 '+esc(g.name),'Comparativo das últimas compras, fornecedores, prazos e evolução de custo.')+`<div class="kpi-grid" style="margin-bottom:14px"><div class="kpi blue"><div class="kpi-val">${last?money(last.precoUnitario):'—'}</div><div class="kpi-lbl">Última compra</div></div><div class="kpi teal"><div class="kpi-val">${prices.length?money(avg):'—'}</div><div class="kpi-lbl">Preço médio</div></div><div class="kpi green"><div class="kpi-val">${prices.length?money(Math.min(...prices)):'—'}</div><div class="kpi-lbl">Menor preço</div></div><div class="kpi orange"><div class="kpi-val">${rows.length}</div><div class="kpi-lbl">Compras comparadas</div></div><div class="kpi purple"><div class="kpi-val">${consumo?n(consumo.mediaMensal).toLocaleString('pt-BR',{maximumFractionDigits:1}):'—'}</div><div class="kpi-lbl">Consumo médio mensal (BI)</div></div></div>`+table(['Data','Pedido','Fornecedor','Qtd','Unitário','Total','Comprador','Entrega'],rows.map(x=>`<tr><td>${date(x.compradoEm)}</td><td>${esc(x.numeroCompra||'—')}</td><td>${esc(x.fornecedor||'—')}</td><td>${n(x.quantidadeComprada).toLocaleString('pt-BR')}</td><td>${money(x.precoUnitario)}</td><td>${money(x.valorTotal)}</td><td>${esc(x.compradorNome||x.compradorEmail||'—')}</td><td>${date(x.dataPrevista)}</td></tr>`).join(''))+(cortes.length?`<div class="tc" style="padding:12px;margin-top:12px"><b>✂️ Cortes e faturamento por mês</b>`+table(['Mês','Pedida (cx)','Faturada (cx)','Corte (cx)','Faturamento','% Atingimento'],cortes.slice(0,6).map(_linhaCortesCompras).join(''))+'</div>':''); }
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
    cf.lista = (s && typeof s.pesquisarPorNome === 'function') ? await s.pesquisarPorNome(cf.busca, { limit: 500 }).catch(() => []) : [];
    cf.carregado = true;
  }
  function _cfBadgeSituacao(sit) { return `<span class="badge ${sit === 'bloqueado' ? 'b-red' : /inativo|pendente/.test(sit || '') ? 'b-orange' : 'b-green'}">${esc(sit || 'ativo')}</span>`; }
  function _cfBadgeHomologacao(h) { const st = h?.status || 'nao_homologado'; return `<span class="badge ${st === 'homologado' ? 'b-green' : st === 'em_avaliacao' ? 'b-blue' : 'b-orange'}">${esc(st.replace(/_/g, ' '))}</span>`; }
  function _cfSubtabsHtml() { const abas = [['lista', 'Lista']]; if (_cfPodeConfigurar()) abas.push(['conciliacao', 'Conciliação (simulação)']); return `<div style="display:flex;gap:6px;margin-bottom:12px">${abas.map(([id, label]) => `<button class="btn ${cf.subTab === id ? 'btn-primary' : 'btn-ghost'} btn-sm" data-cf-subtab="${id}">${esc(label)}</button>`).join('')}</div>`; }
  function _cfTabelaManualHtml() { const map = new Map(); cache.requests.filter(x => x.fornecedor).forEach(x => { const k = x.fornecedor; if (!map.has(k)) map.set(k, []); map.get(k).push(x); }); return table(['Fornecedor', 'Pedidos', 'Produtos', 'Total comprado', 'Última compra'], [...map].map(([nome, rows]) => `<tr><td><b>${esc(nome)}</b></td><td>${rows.length}</td><td>${new Set(rows.map(key)).size}</td><td>${money(rows.reduce((s, x) => s + n(x.valorTotal), 0))}</td><td>${date(rows.sort((a, b) => String(b.compradoEm || '').localeCompare(String(a.compradoEm || '')))[0]?.compradoEm)}</td></tr>`).join('')); }
  function _cfListaHtml() {
    if (cf.semPermissao) {
      return '<div class="tc" style="padding:16px;border-left:4px solid var(--danger,#d92020);background:rgba(217,32,32,.06)"><b style="color:var(--danger,#d92020)">⚠️ Sem permissão para ver o cadastro de fornecedores</b><div style="font-size:.78rem;color:var(--muted);margin-top:4px">Sua conta não tem a permissão "Compras · Central de Compras → visualizar". Peça pra um administrador conferir isso em Usuários e Permissões — não é uma lista vazia, é acesso negado pelo Firestore.</div></div>';
    }
    const alvo = (cf.filtroSituacao || '').trim();
    const linhas = cf.lista.filter(f => !alvo || f.situacao === alvo);
    const filtros = `<div class="tc" style="padding:10px;margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input class="field" style="flex:1;min-width:200px" data-cf-busca placeholder="Nome, razão social ou CNPJ..." value="${esc(cf.busca)}"><select class="field" style="max-width:220px" data-cf-filtro-situacao><option value="">Todas as situações</option><option value="ativo" ${alvo === 'ativo' ? 'selected' : ''}>Ativo</option><option value="inativo" ${alvo === 'inativo' ? 'selected' : ''}>Inativo</option><option value="bloqueado" ${alvo === 'bloqueado' ? 'selected' : ''}>Bloqueado</option><option value="pendente_documentacao" ${alvo === 'pendente_documentacao' ? 'selected' : ''}>Pendente documentação</option></select>${_cfPodeConfigurar() ? '<button class="btn btn-primary btn-sm" data-cf-novo>+ Novo fornecedor</button>' : ''}</div>`;
    const tabela = table(['Nome fantasia', 'CNPJ', 'Situação', 'Homologação', 'Lead time', 'Categorias', ''], linhas.map(f => `<tr><td><b>${esc(f.nomeFantasia)}</b><div style="font-size:.68rem;color:var(--muted)">${esc(f.razaoSocial)}</div></td><td>${esc(f.cnpjFormatado || '—')}</td><td>${_cfBadgeSituacao(f.situacao)}</td><td>${_cfBadgeHomologacao(f.homologacao)}</td><td>${n(f.leadTimePadraoDias) ? n(f.leadTimePadraoDias) + ' dia(s)' : '—'}</td><td>${esc((f.categorias || []).join(', ') || '—')}</td><td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" data-cf-detalhe="${esc(f.fornecedorId)}">360°</button></td></tr>`).join(''), 'Nenhum fornecedor cadastrado no mestre ainda.');
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
  async function _cf360Html(id) {
    const s = svcForn();
    const f = s ? await s.buscarPorId(id) : null;
    if (!f) return _cfListaHtml();
    const produtos = await s.listarProdutosDoFornecedor(id).catch(() => []);
    const norm = s.normalizarNomeFornecedor;
    const historico = cache.requests.filter(x => x.fornecedor && norm(x.fornecedor) === norm(f.nomeFantasia)).sort((a, b) => String(b.compradoEm || '').localeCompare(String(a.compradoEm || '')));
    const auditoria = await global.listarAuditoria?.({ colecao: 'compras_fornecedores', docId: id, global: true }).catch(() => []) || [];
    const bloqueado = s.estaBloqueado(f);
    const contato = f.contatos?.[0];
    return `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px"><div><button class="btn btn-ghost btn-sm" data-cf-voltar>← Voltar</button><div class="page-title" style="font-size:1.1rem;margin-top:6px">${esc(f.nomeFantasia)} ${_cfBadgeSituacao(f.situacao)}</div><div style="font-size:.74rem;color:var(--muted)">${esc(f.razaoSocial)}${f.cnpjFormatado ? ' · ' + esc(f.cnpjFormatado) : ''}</div></div>${_cfPodeConfigurar() ? `<div style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" data-cf-editar="${esc(id)}">✏️ Editar</button>${bloqueado ? `<button class="btn btn-ghost btn-sm" data-cf-desbloquear="${esc(id)}">🔓 Desbloquear</button>` : `<button class="btn btn-ghost btn-sm" data-cf-bloquear="${esc(id)}">🔒 Bloquear</button>`}</div>` : ''}</div>`
      + `<div class="kpi-grid" style="margin-bottom:14px"><div class="kpi blue"><div class="kpi-val">${_cfBadgeHomologacao(f.homologacao)}</div><div class="kpi-lbl">Homologação</div></div><div class="kpi teal"><div class="kpi-val">${n(f.leadTimePadraoDias) || '—'}</div><div class="kpi-lbl">Lead time padrão (dias)</div></div><div class="kpi orange"><div class="kpi-val">${produtos.length}</div><div class="kpi-lbl">Produtos vinculados</div></div><div class="kpi green"><div class="kpi-val">${historico.length}</div><div class="kpi-lbl">Compras (histórico legado)</div></div></div>`
      + `<div class="tc" style="padding:12px;margin-bottom:12px"><b>Contato</b><div style="font-size:.8rem;margin-top:6px">${contato ? esc(contato.nome) + (contato.telefone ? ' · ' + esc(contato.telefone) : '') + (contato.email ? ' · ' + esc(contato.email) : '') : 'Nenhum contato cadastrado.'}</div>${f.observacoes ? `<div style="font-size:.76rem;color:var(--muted);margin-top:6px">${esc(f.observacoes)}</div>` : ''}</div>`
      + `<div class="tc" style="padding:8px 12px;margin-bottom:4px"><b style="font-size:.8rem">Produtos fornecidos</b></div>`
      + table(['Produto', 'Código no fornecedor', 'Preço referência', 'Qtd. mínima', 'Lead time', 'Homologado'], produtos.map(p => `<tr><td>${esc(p.produtoNomeSnapshot || p.produtoId)}</td><td>${esc(p.codigoNoFornecedor || '—')}</td><td>${p.precoReferencia != null ? money(p.precoReferencia) : '—'}</td><td>${n(p.quantidadeMinima) || '—'}</td><td>${n(p.leadTimeDias) || '—'}</td><td>${p.homologado ? 'Sim' : 'Não'}</td></tr>`).join(''), 'Nenhum produto vinculado ainda.')
      + `<div class="tc" style="padding:8px 12px;margin:14px 0 4px"><b style="font-size:.8rem">Histórico de compras (legado, por nome — pcp_requisicoes_compra)</b></div>`
      + table(['Data', 'Pedido', 'Qtd', 'Unitário', 'Total'], historico.map(x => `<tr><td>${date(x.compradoEm)}</td><td>${esc(x.numeroCompra || '—')}</td><td>${n(x.quantidadeComprada).toLocaleString('pt-BR')}</td><td>${money(x.precoUnitario)}</td><td>${money(x.valorTotal)}</td></tr>`).join(''), 'Sem histórico de compra vinculado a este nome ainda.')
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
  function reportsPage() { const bought=cache.requests.filter(x=>n(x.quantidadeComprada)>0),total=bought.reduce((s,x)=>s+n(x.valorTotal),0);return header('📈 Relatórios de compras','Indicadores por período, comprador, produto e fornecedor.')+`<div class="kpi-grid"><div class="kpi blue"><div class="kpi-val">${bought.length}</div><div class="kpi-lbl">Compras registradas</div></div><div class="kpi teal"><div class="kpi-val">${money(total)}</div><div class="kpi-lbl">Valor comprado</div></div><div class="kpi green"><div class="kpi-val">${new Set(bought.map(x=>x.fornecedor).filter(Boolean)).size}</div><div class="kpi-lbl">Fornecedores</div></div><div class="kpi orange"><div class="kpi-val">${new Set(bought.map(key)).size}</div><div class="kpi-lbl">Produtos</div></div></div><div class="tc" style="padding:14px;margin-top:14px"><b>Próximas integrações BlueSoft</b><p style="color:var(--muted);font-size:.78rem">Pedidos, entregas, notas fiscais, ficha de estoque, negociações e sortimento serão conciliados pelo código externo, sempre com trilha de sincronização.</p></div>`; }
  function adminPage() { return header('⚙️ Administração de Compras','Regras, alçadas, integrações e qualidade cadastral.')+`<div class="tc" style="padding:14px"><h3 style="margin-top:0">Controles recomendados</h3><ul><li>Regra de comprador por produto, categoria e fornecedor.</li><li>Alçada de aprovação por valor e exceção.</li><li>Bloqueio de pedido sem cotação/aprovação quando exigido.</li><li>Conciliação BlueSoft com log, data e resultado da sincronização.</li><li>Credenciais exclusivamente no servidor; nunca no navegador.</li></ul><button class="btn btn-primary btn-sm" data-cp-open-central>Abrir regras atuais</button></div>`; }
  async function render(name) { const page=document.getElementById('page-compras-'+name);if(!page)return;page.innerHTML='<div class="empty">Carregando...</div>';await load();const html=name==='solicitacoes'?requestsPage():name==='cotacoes'?quotationsPage():name==='pedidos'?ordersPage():name==='produtos'?(selectedProduct?await product360():productsPage()):name==='fornecedores'?await suppliersPage():name==='recebimentos'?receiptsPage():name==='relatorios'?reportsPage():adminPage();page.innerHTML=html; }
  // Roteador (correção de bug real confirmada nesta sessão): selectedProduct
  // nunca era limpo — reabrir "Produtos" pela barra lateral enquanto um
  // produto estava selecionado ficava preso no 360° do último produto. Uma
  // navegação "pura" pra produtos (navigate) sempre limpa a seleção; só
  // comprasSetProduto (clique em "Ver 360°", ou o roteador restaurando
  // ?produto= da URL) mantém/define um produto específico.
  function navigate(name, el) { if(name==='dashboard'||name==='central'){global._comprasIrParaPaginaOriginal?.(name,el);return;} if(!tem('visualizar')){global.showToast?.('Você não possui acesso a esta aba.','error');return;} if(name==='produtos')selectedProduct=''; if(name==='fornecedores')cf.selecionadoId=''; document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('on'));el?.classList.add('on');const page=document.getElementById('page-compras-'+name);page?.classList.add('on');const title=document.getElementById('page-title');if(title)title.textContent='Compras · '+(pageMeta[name]?.[0]||name);render(name).catch(e=>{if(page)page.innerHTML='<div class="empty">Falha: '+esc(e.message||e)+'</div>';}); }
  function comprasSetProduto(k) { selectedProduct=k||''; document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('on'));document.getElementById('nav-compras-produtos')?.classList.add('on');const page=document.getElementById('page-compras-produtos');page?.classList.add('on');const title=document.getElementById('page-title');if(title)title.textContent='Compras · '+(pageMeta.produtos?.[0]||'Produtos');render('produtos').catch(e=>{if(page)page.innerHTML='<div class="empty">Falha: '+esc(e.message||e)+'</div>';}); }
  function comprasClearSelectedProduct(){ selectedProduct=''; }
  function comprasGetSelectedProduct(){ return selectedProduct; }
  global._comprasIrParaPaginaOriginal=global.comprasIrParaPagina; global.comprasIrParaPagina=navigate; global.renderComprasProfissional=render;
  global.comprasSetProduto=comprasSetProduto;global.comprasClearSelectedProduct=comprasClearSelectedProduct;global.comprasGetSelectedProduct=comprasGetSelectedProduct;
  document.addEventListener('click',e=>{const p=e.target.closest('[data-cp-product]');if(p){comprasSetProduto(p.dataset.cpProduct);return;}if(e.target.closest('[data-cp-refresh]')){Object.keys(cache).forEach(k=>cache[k]=[]);cf.carregado=false;cf.conciliacao=null;const active=document.querySelector('#setor-compras-shell .nav-item.on');navigate((active?.id||'').replace('nav-compras-','')||'solicitacoes',active);return;}if(e.target.closest('[data-cp-open-central]')){global._comprasIrParaPaginaOriginal?.('central',document.getElementById('nav-compras-central'));return;}const an=e.target.closest('[data-cp-req-analise]');if(an){marcarEmAnalise(an.dataset.cpReqAnalise).catch(x=>global.showToast?.(x.message,'error'));return;}const co=e.target.closest('[data-cp-req-comprar]');if(co){modalRegistrarCompra(co.dataset.cpReqComprar);return;}const sv=e.target.closest('[data-cp-req-save]');if(sv){salvarCompraSolicitacao(sv.dataset.cpReqSave).catch(x=>global.showToast?.(x.message,'error'));return;}if(e.target.closest('[data-cp-req-modal-close]')){const h=document.getElementById('cp-req-modal-host');if(h)h.innerHTML='';return;}const cot=e.target.closest('[data-cp-cotar]');if(cot){modalCotacao(cot.dataset.cpCotar);return;}if(e.target.closest('[data-cp-cotacao-fechar]')){const h=document.getElementById('cp-cotacao-modal-host');if(h)h.innerHTML='';cotacaoAtivaId='';return;}const cadd=e.target.closest('[data-cp-cotacao-add]');if(cadd){adicionarCotacao(cadd.dataset.cpCotacaoAdd).catch(x=>global.showToast?.(x.message,'error'));return;}const cuse=e.target.closest('[data-cp-cotacao-usar]');if(cuse){usarCotacaoIdx(Number(cuse.dataset.cpCotacaoUsar));return;}const cdel=e.target.closest('[data-cp-cotacao-remover]');if(cdel){removerCotacaoIdx(Number(cdel.dataset.cpCotacaoRemover)).catch(x=>global.showToast?.(x.message,'error'));return;}const pi=e.target.closest('[data-cp-pedido-itens]');if(pi){modalItensPedido(pi.dataset.cpPedidoItens);return;}if(e.target.closest('[data-cp-pedido-itens-fechar]')){const h=document.getElementById('cp-pedido-itens-modal-host');if(h)h.innerHTML='';return;}});
  document.addEventListener('change',e=>{const f=e.target.closest('[data-cp-rec-filter]');if(!f)return;filtrosReceb[f.dataset.cpRecFilter]=f.value;render('recebimentos');});
  document.addEventListener('input',e=>{if(e.target.matches('[data-cp-search]')){query=e.target.value.toLowerCase();const active=document.querySelector('#setor-compras-shell .nav-item.on');render((active?.id||'').replace('nav-compras-','')||'produtos');}});
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
  });
  document.addEventListener('input', e => { if (e.target.matches('[data-cf-busca]')) { cf.busca = e.target.value; cf.carregado = false; render('fornecedores'); } });
  document.addEventListener('change', e => { if (e.target.matches('[data-cf-filtro-situacao]')) { cf.filtroSituacao = e.target.value; render('fornecedores'); } });
})(window);
