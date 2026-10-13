// Compras — Fase 3: requisições direcionadas pelo PCP e regras de comprador.
(function(global){'use strict';
const CREQ='pcp_requisicoes_compra', CREGR='compras_regras_comprador', CPROD='producao_produtos', CPRODBI='pcp_produtos_bluesoft', CAGE='pcp_agendamentos';let reqs=[],regras=[],usuarios=[],produtos=[],agendamentos=[],compradoresBluesoft=[],semComprador=[],aba='historico';
let historicoTodos=false,historicoBusca='',historicoGeral=[];
let usuariosComprasCarregados=false,usuariosComprasPendente=null;let agendamentosCarregados=false,agendamentosPendente=null;
// PEDIDO AO VIVO (2026-09-18): "eu não quero ter que ir lá e pegar produto
// por produto... se tem um fornecedor, ele tem aqueles produtos, cadastra
// no nome de quem mais compra" — sugestão automática de comprador por
// fornecedor a partir do histórico real de compras (BigQuery), em vez de
// digitar regra por regra. `sugestoes` guarda o resultado cru da consulta;
// `sugestoesSelecionadas` (Set de nome de fornecedor) controla os
// checkboxes marcados no modal de revisão antes de aplicar em lote.
let sugestoes=null,sugestoesCarregando=false,sugestoesErro='',sugestoesSelecionadas=new Set(),sugestoesBusca='';
let sugestoesProduto=null,sugestoesProdutoCarregando=false,sugestoesProdutoErro='';
let sincronizandoAutomatico=false;
// PEDIDO AO VIVO (2026-09-18): "o gerente vai poder pegar o login de uma
// pessoa que vai sair de férias e unificar na outra... os pedidos dela
// aparecem TAMBÉM pra quem tá cobrindo, pra não ficar parado — e o produto
// continua aparecendo pro comprador REGISTRADO, não pra quem fez o pedido."
// Cobertura temporária entre 2 compradores (compras_cobertura_temporaria,
// coleção GLOBAL — relação entre pessoas, não entre lojas). O 2º ponto
// (produto sempre roteado pelo comprador CADASTRADO, nunca por quem criou
// a requisição) já é assim hoje: resolverComprador() só olha
// produto/categoria/fornecedor → compras_regras_comprador, nunca quem
// solicitou — nada a mudar aí, só confirmar que continua valendo.
let coberturas=[],coberturasCarregadas=false;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const n=v=>Number(v)||0;const fs=()=>global.getDTFirestore();const raw=()=>global.getDTRawFirestore();const tem=a=>typeof global.temPermissao!=='function'||global.temPermissao('compras-central',a);const now=()=>new Date().toISOString();
const money=v=>(Number(v)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const nomeCompradorNorm=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');const primeiroNome=v=>nomeCompradorNorm(v).normalize('NFD').replace(/[̀-ͯ]/g,'').split(/[.\s_-]+/)[0]||'';const seletorComprador=v=>nomeCompradorNorm(v);const nomeBateSeletor=(nome,seletor)=>{const n0=nomeCompradorNorm(nome),s0=nomeCompradorNorm(seletor);return !!s0&&(s0.includes(' ')?n0===s0:primeiroNome(n0)===primeiroNome(s0));};
async function fornecedorIdPorNome(nome){try{const f=await global._fornecedoresService?.resolverFornecedorAptoPorNome?.(String(nome||'').trim());return String(f?.fornecedorId||'');}catch(_){return '';}}
function resolverUsuarioPorNome(compradorChave){const bruto=String(compradorChave||'').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');if(!bruto)return null;const exatos=usuarios.filter(u=>String(u.nome||u.email||'').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')===bruto);if(exatos.length===1)return exatos[0];const alvo=primeiroNome(compradorChave),porPrimeiro=usuarios.filter(u=>primeiroNome(u.nome||u.email||'')===alvo);return porPrimeiro.length===1?porPrimeiro[0]:null;}
function papelComprasAtual(){const a=global.DT_USUARIO_ACESSO_ATUAL||{};if(a.admin_mestre===true||a.administrador_mestre===true||a.perfil==='administrador')return'admin';return a.papelCompras||'';}
function compradorAtualNome(){const a=global.DT_USUARIO_ACESSO_ATUAL||{};return seletorComprador(a.nome||global._currentAnalistaUser?.nome||global._currentAnalistaUser?.displayName||String(global._currentAnalistaUser?.email||'').split('@')[0]||'');}
function linhaNoEscopoCompras(x){const papel=papelComprasAtual();if(papel==='admin'||tem('configurar'))return true;const uid=global._currentAnalistaUser?.uid||global.firebase?.auth?.().currentUser?.uid||'',linhaUid=String(x?.compradorUid||'');const coberturasMinhas=coberturas.filter(c=>c.ativo!==false&&String(c.substitutoUid||'')===String(uid)),uidsCobertos=coberturasMinhas.map(c=>String(c.origemUid||'')).filter(Boolean);if(linhaUid){if(linhaUid===String(uid)||uidsCobertos.includes(linhaUid))return true;}const nome=seletorComprador(x?.compradorNome||x?.bluesoftCompradorNome||x?.comprador||x?.compradorEmail||'');if(!nome)return !linhaUid;const cobertos=coberturasMinhas.map(c=>seletorComprador(c.origemNome||'')).filter(Boolean);if(papel==='gerente'){const a=global.DT_USUARIO_ACESSO_ATUAL||{};const geridos=(Array.isArray(a.compradoresGerenciados)?a.compradoresGerenciados:[]).map(seletorComprador).filter(Boolean),visiveis=[...new Set([...geridos,...cobertos])];return !visiveis.length||visiveis.some(sel=>nomeBateSeletor(nome,sel));}const atual=compradorAtualNome();return [atual,...cobertos].filter(Boolean).some(sel=>nomeBateSeletor(nome,sel));}
function requisicaoSemComprador(x){const st=String(x?.status||'').toLowerCase();return st==='sem_comprador'||(!x?.compradorUid&&!x?.compradorNome&&!/final|comprad|cancel|rejeit/i.test(st));}
async function carregar(){const vazio={docs:[]};await carregarCoberturas();const [r,rg,pr,pb]=await Promise.all([fs().collection(CREQ).get().catch(()=>vazio),fs().collection(CREGR).get().catch(()=>vazio),fs().collection(CPROD).get().catch(()=>vazio),fs().collection(CPRODBI).get().catch(()=>vazio)]);const todas=r.docs.map(d=>({_id:d.id,...d.data()}));reqs=todas.filter(linhaNoEscopoCompras);regras=rg.docs.map(d=>({_id:d.id,...d.data()}));const porChave=new Map();[...pb.docs,...pr.docs].forEach(d=>{const x={_id:d.id,...d.data()},k=String(x.cod||x.prodKey||x.bluesoftProdutoKey||x.nome||d.id);porChave.set(k,{...(porChave.get(k)||{}),...x});});produtos=[...porChave.values()];semComprador=todas.filter(requisicaoSemComprador);}
async function carregarAgendamentos(forcar=false){if(agendamentosCarregados&&!forcar)return agendamentos;if(agendamentosPendente)return agendamentosPendente;agendamentosPendente=(async()=>{const ag=await fs().collection(CAGE).get().catch(()=>({docs:[]}));agendamentos=ag.docs.map(d=>({_id:d.id,...d.data()}));const bm=new Map();agendamentos.forEach(x=>{const k=String(x.bluesoftCompradorKey||'').trim();if(k)bm.set(k,{key:k,nome:x.bluesoftCompradorNome||('Comprador '+k)});});compradoresBluesoft=[...bm.values()].sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));agendamentosCarregados=true;return agendamentos;})();try{return await agendamentosPendente;}finally{agendamentosPendente=null;}}
// PEDIDO AO VIVO (2026-09-18): "cada fornecedor tem seu comprador... grave
// automático" — o seletor de comprador aqui só listava quem tinha o setor
// Compras marcado nas Permissões; agora também entra quem foi marcado
// como "Comprador" no Papel em Compras (37-usuarios-permissoes.js), sem
// precisar das duas coisas.
async function carregarUsuariosCompras(forcar=false){if(!tem('configurar')){usuarios=[];return usuarios;}if(usuariosComprasCarregados&&!forcar)return usuarios;if(usuariosComprasPendente)return usuariosComprasPendente;usuariosComprasPendente=(async()=>{const us=await raw().collection('usuarios_acessos').get().catch(()=>({docs:[]}));usuarios=us.docs.map(d=>({_id:d.id,...d.data()})).filter(x=>x.ativo!==false&&(x.setores_permitidos?.compras===true||x.papelCompras==='comprador'||x.perfil==='administrador'||x.admin_mestre===true));usuariosComprasCarregados=true;return usuarios;})();try{return await usuariosComprasPendente;}finally{usuariosComprasPendente=null;}}
function badge(s){const c=/cancel|rejeit/i.test(s)?'b-red':/parcial/i.test(s)?'b-orange':/comprad|final/i.test(s)?'b-green':/analise|andamento/i.test(s)?'b-blue':'b-orange';return `<span class="badge ${c}">${esc(s||'solicitada')}</span>`;}
// PEDIDO AO VIVO (2026-08-27): "Minhas requisições" foi tirada daqui —
// virou "Solicitações PCP" (121-compras-profissional.js), mesma base de
// dados (pcp_requisicoes_compra), só que num lugar só, com a ação de
// registrar compra. `reqs` continua sendo carregado aqui porque
// historicoBase() ainda usa como padrão do Histórico operacional de compras.
function tabs(){return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px"><button class="btn ${aba==='historico'?'btn-primary':'btn-ghost'} btn-sm" data-comp-tab="historico">📊 Histórico operacional de compras</button>${tem('configurar')?`<button class="btn ${aba==='regras'?'btn-primary':'btn-ghost'} btn-sm" data-comp-tab="regras">Regras de compradores</button>`:''}</div>`;}
// Base de compras já efetivadas (quantidadeComprada>0) — por padrão só as
// do comprador logado (mesmas requisições de "Minhas requisições"); quem
// tem 'configurar' pode alternar pra ver de todos os compradores da loja.
// Esta seção é histórico OPERACIONAL do PCP (requisições), não histórico fiscal/real.
function historicoBase(){return (historicoTodos&&tem('configurar'))?historicoGeral:reqs;}
function historicoCompras(){return historicoBase().filter(x=>n(x.quantidadeComprada)>0);}
function historicoPedidosCompra(){const out=[];historicoCompras().forEach(r=>{const pedidos=Array.isArray(r.pedidosCompra)&&r.pedidosCompra.length?r.pedidosCompra:null;if(!pedidos){out.push(r);return;}pedidos.forEach((p,i)=>out.push({...r,_pedidoIndice:i,numeroCompra:p.numeroCompra||r.numeroCompra||'',fornecedor:p.fornecedor||r.fornecedor||'',fornecedorId:p.fornecedorId||r.fornecedorId||'',quantidadeComprada:n(p.quantidade),precoUnitario:n(p.precoUnitario),valorTotal:n(p.subtotal??p.valorTotal),valorTotalEfetivo:n(p.valorTotalEfetivo??p.valorTotal??p.subtotal),dataPrevista:p.dataPrevista||r.dataPrevista||'',compradoEm:p.compradoEm||r.compradoEm||'',compradoPor:p.compradoPor||r.compradoPor||'',compradoPorUid:p.compradoPorUid||r.compradoPorUid||''}));});return out;}
async function carregarHistoricoGeral(forcar){if(!tem('configurar'))return;if(historicoGeral.length&&!forcar)return;const snap=await fs().collection(CREQ).get().catch(()=>({docs:[]}));historicoGeral=snap.docs.map(d=>({_id:d.id,...d.data()}));}
function agruparHistorico(lista){const map=new Map();lista.forEach(x=>{const key=String(x.prodKey||x.cod||'').trim()||String(x.produto||'').trim().toLowerCase();if(!map.has(key))map.set(key,{key,produto:x.produto,cod:x.prodKey||x.cod||'',totalCx:0,compras:0,ultima:null});const g=map.get(key);g.totalCx+=n(x.quantidadeComprada);g.compras++;if(!g.ultima||String(x.compradoEm||'')>String(g.ultima.compradoEm||''))g.ultima=x;});return [...map.values()].sort((a,b)=>b.totalCx-a.totalCx);}
function historicoHtml(){const busca=historicoBusca.trim().toLowerCase();const lista=historicoPedidosCompra().filter(x=>!busca||String(x.produto||'').toLowerCase().includes(busca)||String(x.prodKey||x.cod||'').toLowerCase().includes(busca));const grupos=agruparHistorico(lista);const totalCx=grupos.reduce((s,g)=>s+g.totalCx,0);const top=grupos[0];return `<div class="tc" style="padding:12px;margin-bottom:12px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><input class="field" id="comp-hist-busca" placeholder="Buscar produto ou código..." value="${esc(historicoBusca)}" style="flex:1;min-width:220px">${tem('configurar')?`<label style="display:flex;align-items:center;gap:6px;font-size:.78rem;color:var(--muted);white-space:nowrap"><input type="checkbox" id="comp-hist-todos" ${historicoTodos?'checked':''}> Ver de todos os compradores</label>`:''}</div><div class="kpi-grid"><div class="kpi blue"><div class="kpi-val">${grupos.length}</div><div class="kpi-lbl">Produtos comprados</div></div><div class="kpi teal"><div class="kpi-val">${lista.length}</div><div class="kpi-lbl">Compras registradas</div></div><div class="kpi green"><div class="kpi-val">${totalCx.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Caixas compradas (total)</div></div><div class="kpi orange"><div class="kpi-val" style="font-size:.95rem">${top?esc(top.produto):'—'}</div><div class="kpi-lbl">Produto mais comprado</div></div></div></div><div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Produto</th><th>Total comprado</th><th>Nº compras</th><th>Última compra</th><th>Fornecedor</th><th>Comprador</th><th></th></tr></thead><tbody>${grupos.length?grupos.map(g=>`<tr><td><b>${esc(g.produto)}</b>${g.cod?`<div style="font-size:.68rem;color:var(--muted)">${esc(g.cod)}</div>`:''}</td><td>${g.totalCx.toLocaleString('pt-BR')}</td><td>${g.compras}</td><td>${esc(String(g.ultima?.compradoEm||'').slice(0,10)||'—')}${g.ultima?' · '+n(g.ultima.quantidadeComprada).toLocaleString('pt-BR')+'cx':''}</td><td>${esc(g.ultima?.fornecedor||'')}</td><td>${esc(g.ultima?.compradorNome||g.ultima?.compradorEmail||'')}</td><td><button class="btn btn-ghost btn-sm" data-comp-hist-ver="${esc(g.key)}">Ver histórico</button></td></tr>`).join(''):'<tr><td colspan="7">Nenhuma compra registrada ainda.</td></tr>'}</tbody></table></div></div>`;}
function modalHistorico(key){const lista=historicoPedidosCompra().filter(x=>(String(x.prodKey||x.cod||'').trim()||String(x.produto||'').trim().toLowerCase())===key).sort((a,b)=>String(b.compradoEm||'').localeCompare(String(a.compradoEm||'')));const h=document.getElementById('compras-modal-host');if(!h||!lista.length)return;h.innerHTML=`<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:760px"><div class="modal-header"><b>Histórico de compras — ${esc(lista[0].produto)}</b><button class="modal-x" data-comp-close>×</button></div><div class="modal-body"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Data compra</th><th>Nº compra</th><th>Fornecedor</th><th>Qtd</th><th>Previsão entrega</th><th>Comprador</th><th>Status</th></tr></thead><tbody>${lista.map(x=>`<tr><td>${esc(String(x.compradoEm||'').slice(0,10))}</td><td>${esc(x.numeroCompra||'')}</td><td>${esc(x.fornecedor||'')}</td><td>${n(x.quantidadeComprada).toLocaleString('pt-BR')}</td><td>${esc(x.dataPrevista||'')}</td><td>${esc(x.compradorNome||x.compradorEmail||'')}</td><td>${badge(x.status)}</td></tr>`).join('')}</tbody></table></div></div><div class="modal-footer"><button class="btn btn-ghost" data-comp-close>Fechar</button></div></div></div>`;}
function valoresRegra(tipo){if(tipo==='bluesoft_comprador')return compradoresBluesoft.map(x=>x.key);const vals=new Set();produtos.forEach(p=>{if(tipo==='produto'){if(p.cod)vals.add(String(p.cod));if(p.nome)vals.add(String(p.nome));}else if(tipo==='categoria'){if(p.categoria)vals.add(String(p.categoria));if(p.classificacao)vals.add(String(p.classificacao));}else{if(p.fornecedor)vals.add(String(p.fornecedor));if(p.fornecedorPadrao)vals.add(String(p.fornecedorPadrao));}});return [...vals].sort((a,b)=>a.localeCompare(b,'pt-BR'));}
function regrasHtml(){return `<div class="tc" style="padding:12px;margin-bottom:12px"><div style="display:grid;grid-template-columns:1fr 2fr 2fr auto;gap:7px"><select class="field" id="comp-reg-tipo"><option value="produto">Produto</option><option value="categoria">Categoria</option><option value="fornecedor">Fornecedor</option></select><input class="field" id="comp-reg-valor" placeholder="Código/produto/categoria/fornecedor"><select class="field" id="comp-reg-user"><option value="">Comprador...</option>${usuarios.map(u=>`<option value="${esc(u.uid||u._id)}" data-email="${esc(u.email||'')}" data-nome="${esc(u.nome||u.email||'')}">${esc(u.nome||u.email||u.uid)}</option>`).join('')}</select><button class="btn btn-primary btn-sm" data-comp-reg-save>+ Regra</button></div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:.7rem;color:var(--muted);margin-top:8px"><span>Prioridade de resolução: Produto → Categoria → Fornecedor.</span><span class="badge ${semComprador.length?'b-orange':'b-green'}">${semComprador.length} sem comprador</span>${semComprador.length?'<button class="btn btn-ghost btn-sm" data-comp-reprocessar>↻ Reprocessar pendentes</button>':''}</div></div><div class="tc"><div style="overflow:auto"><table class="dt-table"><thead><tr><th>Tipo</th><th>Valor</th><th>Comprador</th><th></th></tr></thead><tbody>${regras.length?regras.map(x=>`<tr><td>${esc(x.tipo)}</td><td><b>${esc(x.valor)}</b></td><td>${esc(x.compradorNome||x.compradorEmail||x.compradorUid)}</td><td><button class="acao-lapis" data-comp-reg-del="${esc(x._id)}">🗑️</button></td></tr>`).join(''):'<tr><td colspan="4">Nenhuma regra cadastrada.</td></tr>'}</tbody></table></div></div>`;}
async function reprocessarSemComprador(){if(!tem('configurar'))return 0;const resolver=global._pcpInternals?.resolverComprador;if(typeof resolver!=='function')throw new Error('Motor de roteamento do PCP indisponível.');let alteradas=0;for(const r of semComprador){const prod=produtos.find(p=>String(p.cod||'')===String(r.prodKey||r.cod||''))||produtos.find(p=>String(p.nome||'').trim().toLowerCase()===String(r.produto||'').trim().toLowerCase())||{};const rota=resolver(prod,regras,produtos);if(!rota.compradorUid)continue;await fs().collection(CREQ).doc(r._id).set({...rota,status:'solicitada',roteadoEm:now(),roteadoPor:global._currentAnalistaUser?.email||'',atualizadoEm:now()},{merge:true});alteradas++;}return alteradas;}
async function salvarRegra(){if(!tem('configurar'))return;const tipo=document.getElementById('comp-reg-tipo')?.value||'produto',valor=document.getElementById('comp-reg-valor')?.value.trim()||'',sel=document.getElementById('comp-reg-user'),uid=sel?.value||'',op=sel?.selectedOptions?.[0],email=op?.dataset?.email||'',nome=op?.dataset?.nome||'';if(!valor||!uid)return global.showToast?.('Informe o valor da regra e o comprador.','warning');let fornecedorId=tipo==='fornecedor'?await fornecedorIdPorNome(valor):'';const duplicada=regras.find(r=>String(r.tipo||'')===tipo&&((fornecedorId&&String(r.fornecedorId||'')===fornecedorId)||String(r.valor||'').trim().toLowerCase()===valor.toLowerCase()));const payload={tipo,valor,fornecedorId,compradorUid:uid,compradorEmail:email,compradorNome:nome,ativo:true};if(duplicada){await fs().collection(CREGR).doc(duplicada._id).set({...payload,atualizadoEm:now(),atualizadoPor:global._currentAnalistaUser?.email||''},{merge:true});}else{await fs().collection(CREGR).add({...payload,criadoEm:now(),criadoPor:global._currentAnalistaUser?.email||''});}await carregar();const qtd=await reprocessarSemComprador();if(qtd)global.showToast?.(qtd+' requisição(ões) pendente(s) foram direcionadas.','success');await render();}
async function excluirRegra(id){if(!tem('configurar')||!confirm('Excluir regra de comprador?'))return;await fs().collection(CREGR).doc(id).delete();await render();}
// PEDIDO AO VIVO (2026-09-18): "escrevo Ebrali e ele nem traz os
// fornecedores" — a sugestão do campo (comp-reg-valores) SEMPRE tinha só
// os compradores BlueSoft (bug: a variável `lista` nunca usava
// valoresRegra(tipo), então produto/categoria/fornecedor ficavam com um
// datalist vazio de verdade). Agora o datalist reflete o tipo selecionado
// e se atualiza sozinho quando o tipo muda (listener 'change' abaixo).
function datalistOptionsRegra(tipo){if(tipo==='bluesoft_comprador')return compradoresBluesoft.map(x=>({v:x.key,label:x.nome+' ('+x.key+')'}));return valoresRegra(tipo).map(v=>({v,label:v}));}
function datalistHtmlRegra(tipo){return datalistOptionsRegra(tipo).map(o=>`<option value="${esc(o.v)}">${esc(o.label)}</option>`).join('');}
const _regrasHtmlBase=regrasHtml;
regrasHtml=function(){const html=_regrasHtmlBase(),tipoAtual=document.getElementById('comp-reg-tipo')?.value||'produto';return html.replace('<option value="fornecedor">Fornecedor</option>','<option value="fornecedor">Fornecedor</option><option value="bluesoft_comprador">Comprador BlueSoft</option>').replace('<input class="field" id="comp-reg-valor" placeholder="Código/produto/categoria/fornecedor">',`<div><input class="field" id="comp-reg-valor" list="comp-reg-valores" placeholder="Código/produto/categoria/fornecedor/comprador" autocomplete="off"><datalist id="comp-reg-valores">${datalistHtmlRegra(tipoAtual)}</datalist></div>`).replace('<span>Prioridade de resolução: Produto → Categoria → Fornecedor.</span>',`<span>Prioridade de resolução: Produto → Categoria → Fornecedor.</span><button class="btn btn-ghost btn-sm" data-comp-reg-sugestoes>🤖 Sugerir por histórico (fornecedor)</button><button class="btn btn-ghost btn-sm" data-comp-sync-auto ${sincronizandoAutomatico?'disabled':''}>${sincronizandoAutomatico?'Sincronizando...':'🔄 Sincronizar tudo automaticamente (produto + fornecedor)'}</button>`);};
// PEDIDO AO VIVO (2026-09-18): "eu não quero pegar produto por produto...
// pega o histórico e cadastra no nome de quem mais compra" — consulta 1x
// o histórico real agregado por fornecedor no BigQuery
// (sugerirRegrasCompradorPorFornecedorBigQuery, functions/index.js: SOMA
// TUDO no servidor, nunca baixa nota por nota) e mostra num modal de
// revisão — nunca grava regra nenhuma sozinha, só sugere; quem decide
// aplicar (e o quê) é sempre a pessoa, marcando os checkboxes.
async function carregarSugestoesRegra(forcar){if(sugestoes&&!forcar)return sugestoes;sugestoesCarregando=true;sugestoesErro='';try{const callable=global.firebase.app().functions('southamerica-east1').httpsCallable('sugerirRegrasCompradorPorFornecedorBigQuery');const resp=await callable({});sugestoes=resp?.data?.fornecedores||[];sugestoesSelecionadas=new Set(sugestoes.filter(f=>f.sugerido&&resolverUsuarioPorNome(f.sugerido.compradorChave)&&!regras.find(r=>r.tipo==='fornecedor'&&String(r.valor||'').trim().toLowerCase()===String(f.fornecedor||'').trim().toLowerCase())).map(f=>f.fornecedor));}catch(e){sugestoesErro=e.message||String(e);sugestoes=[];}finally{sugestoesCarregando=false;}return sugestoes;}
function sugestoesModalHtml(){
  // `sugestoes===null` cobre o 1º render síncrono do modal (o clique já
  // mostra o modal ANTES de carregarSugestoesRegra() rodar de verdade —
  // sem isso, essa 1ª pintura cairia direto em "nenhum fornecedor
  // encontrado" por meio segundo, antes do resultado real chegar).
  if(sugestoesCarregando||sugestoes===null)return `<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:860px"><div class="modal-header"><b>🤖 Sugestão de comprador por fornecedor</b><button class="modal-x" data-comp-close>×</button></div><div class="modal-body"><div class="empty">Consultando o histórico real de compras (BigQuery)...</div></div></div></div>`;
  if(sugestoesErro)return `<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:860px"><div class="modal-header"><b>🤖 Sugestão de comprador por fornecedor</b><button class="modal-x" data-comp-close>×</button></div><div class="modal-body"><div class="tc" style="padding:12px;border:1px solid var(--danger)">Falha ao consultar o histórico: ${esc(sugestoesErro)}</div></div></div></div>`;
  const busca=sugestoesBusca.trim().toLowerCase();
  const linhas=(sugestoes||[]).filter(f=>!busca||String(f.fornecedor||'').toLowerCase().includes(busca));
  const semContaCount=linhas.filter(f=>f.sugerido&&!resolverUsuarioPorNome(f.sugerido.compradorChave)).length;
  const linhasHtml=linhas.length?linhas.map(f=>{
    const usuario=f.sugerido?resolverUsuarioPorNome(f.sugerido.compradorChave):null;
    const jaTemRegra=regras.find(r=>r.tipo==='fornecedor'&&String(r.valor||'').trim().toLowerCase()===String(f.fornecedor||'').trim().toLowerCase());
    const pct=f.sugerido?f.sugerido.participacaoPct:0;
    const corPct=pct>=80?'b-green':pct>=50?'b-orange':'b-red';
    const marcado=sugestoesSelecionadas.has(f.fornecedor);
    const desabilitado=!f.sugerido||!usuario;
    return `<tr><td><input type="checkbox" data-comp-sug-check="${esc(f.fornecedor)}" ${marcado?'checked':''} ${desabilitado?'disabled':''}></td><td><b>${esc(f.fornecedor)}</b>${jaTemRegra?'<div><span class="badge b-blue" style="font-size:.62rem">já tem regra manual</span></div>':''}</td><td>${f.sugerido?esc(f.sugerido.compradorNome):'—'}${f.sugerido&&!usuario?'<div style="font-size:.62rem;color:var(--danger)">sem conta cadastrada em Compras</div>':''}</td><td><span class="badge ${corPct}">${f.sugerido?pct.toLocaleString('pt-BR',{maximumFractionDigits:0})+'%':'—'}</span></td><td style="font-size:.72rem">${f.sugerido?(f.sugerido.notas??''):''}</td><td style="font-size:.68rem;color:var(--muted)">${f.totalValor?money(f.totalValor):''}</td></tr>`;
  }).join(''):'<tr><td colspan="6">Nenhum fornecedor encontrado.</td></tr>';
  return `<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:900px;max-height:88vh;display:flex;flex-direction:column"><div class="modal-header"><b>🤖 Sugestão de comprador por fornecedor (últimos 24 meses)</b><button class="modal-x" data-comp-close>×</button></div><div class="modal-body" style="overflow:auto;flex:1"><p style="font-size:.78rem;color:var(--muted);margin-top:0">Pra cada fornecedor, o comprador que mais comprou dele (por valor) no histórico real de compras. Quem já tem regra manual aparece desmarcado — marque pra sobrescrever.${semContaCount?` <b>${semContaCount} sugestão(ões)</b> apontam alguém sem conta cadastrada em Compras — crie a conta antes, ou ficam sem aplicar.`:''}</p><div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;align-items:center"><input class="field" id="comp-sug-busca" placeholder="Buscar fornecedor..." value="${esc(sugestoesBusca)}" style="flex:1;min-width:200px"><button class="btn btn-ghost btn-sm" data-comp-sug-desmarcar-todos>Desmarcar todos</button></div><div style="overflow:auto"><table class="dt-table"><thead><tr><th></th><th>Fornecedor</th><th>Comprador sugerido</th><th>Participação</th><th>Notas</th><th>Valor (24m)</th></tr></thead><tbody>${linhasHtml}</tbody></table></div></div><div class="modal-footer"><span style="font-size:.72rem;color:var(--muted);margin-right:auto">${sugestoesSelecionadas.size} selecionado(s)</span><button class="btn btn-ghost" data-comp-close>Fechar</button><button class="btn btn-primary" data-comp-sug-aplicar ${sugestoesSelecionadas.size?'':'disabled'}>Aplicar regras selecionadas</button></div></div></div>`;
}
async function aplicarSugestoesRegra(){
  if(!tem('configurar'))return {aplicadas:0};
  let aplicadas=0;
  for(const fornecedor of [...sugestoesSelecionadas]){
    const item=(sugestoes||[]).find(x=>x.fornecedor===fornecedor);
    if(!item||!item.sugerido)continue;
    const usuario=resolverUsuarioPorNome(item.sugerido.compradorChave);
    if(!usuario)continue;
    const existente=regras.find(r=>r.tipo==='fornecedor'&&String(r.valor||'').trim().toLowerCase()===String(fornecedor).trim().toLowerCase());
    const fornecedorId=await fornecedorIdPorNome(fornecedor);
    const payload={tipo:'fornecedor',valor:fornecedor,fornecedorId,compradorUid:usuario.uid||usuario._id,compradorEmail:usuario.email||'',compradorNome:usuario.nome||usuario.email||'',ativo:true,atualizadoEm:now(),atualizadoPor:global._currentAnalistaUser?.email||'',origem:'auto_historico'};
    if(existente){await fs().collection(CREGR).doc(existente._id).set(payload,{merge:true});}
    else{await fs().collection(CREGR).add({...payload,criadoEm:now(),criadoPor:global._currentAnalistaUser?.email||''});}
    aplicadas++;
  }
  return {aplicadas};
}
async function carregarSugestoesProduto(forcar){if(sugestoesProduto&&!forcar)return sugestoesProduto;sugestoesProdutoCarregando=true;sugestoesProdutoErro='';try{const callable=global.firebase.app().functions('southamerica-east1').httpsCallable('sugerirRegrasCompradorPorProdutoBigQuery');const resp=await callable({});sugestoesProduto=resp?.data?.produtos||[];}catch(e){sugestoesProdutoErro=e.message||String(e);sugestoesProduto=[];}finally{sugestoesProdutoCarregando=false;}return sugestoesProduto;}
// PEDIDO AO VIVO (2026-09-18): "o comprador de fubá mimoso é Dilma, aí no
// sistema muda pra Marta — o sistema tem que identificar e alterar
// sozinho, pra não ficar aparecendo pra pessoa errada" — ao contrário do
// modal de fornecedor (poucas dezenas de linhas, revisão manual faz
// sentido), aqui aplica direto: produto tem mais de mil linhas, ninguém
// vai revisar uma por uma. Só NUNCA sobrescreve uma regra manual (sem
// origem:'auto_historico') — essa sempre vence, mesmo desatualizada; quem
// decide mudar uma regra manual é uma pessoa, não o sincronismo.
async function sincronizarRegrasAutomaticamente(){
  if(!tem('configurar'))return {criadas:0,atualizadas:0,puladasManual:0,semConta:0};
  const [porFornecedor,porProduto]=await Promise.all([carregarSugestoesRegra(true),carregarSugestoesProduto(true)]);
  let criadas=0,atualizadas=0,puladasManual=0,semConta=0;
  const aplicar=async(lista,tipo,chaveDe)=>{
    for(const item of (lista||[])){
      if(!item.sugerido)continue;
      const valor=chaveDe(item);
      if(!valor)continue;
      const usuario=resolverUsuarioPorNome(item.sugerido.compradorChave);
      if(!usuario){semConta++;continue;}
      const fornecedorId=tipo==='fornecedor'?await fornecedorIdPorNome(valor):'';
      const existente=regras.find(r=>r.tipo===tipo&&((fornecedorId&&String(r.fornecedorId||'')===fornecedorId)||String(r.valor||'').trim().toLowerCase()===String(valor).trim().toLowerCase()));
      if(existente&&existente.origem!=='auto_historico'){puladasManual++;continue;}
      const compradorUid=usuario.uid||usuario._id;
      if(existente){
        if(existente.compradorUid===compradorUid)continue;
        await fs().collection(CREGR).doc(existente._id).set({fornecedorId,compradorUid,compradorEmail:usuario.email||'',compradorNome:usuario.nome||usuario.email||'',ativo:true,origem:'auto_historico',atualizadoEm:now(),atualizadoPor:global._currentAnalistaUser?.email||''},{merge:true});
        atualizadas++;
      }else{
        await fs().collection(CREGR).add({tipo,valor,fornecedorId,compradorUid,compradorEmail:usuario.email||'',compradorNome:usuario.nome||usuario.email||'',ativo:true,origem:'auto_historico',criadoEm:now(),criadoPor:global._currentAnalistaUser?.email||''});
        criadas++;
      }
    }
  };
  await aplicar(porFornecedor,'fornecedor',x=>x.fornecedor);
  await aplicar(porProduto,'produto',x=>x.produtoKey);
  return {criadas,atualizadas,puladasManual,semConta};
}
// PEDIDO AO VIVO (2026-09-18): "o gerente vai poder pegar o login de uma
// pessoa que vai sair de férias e unificar na outra... os pedidos dela
// aparecem TAMBÉM pra quem tá cobrindo". Cobertura temporária entre 2
// compradores cadastrados — nada é unificado de verdade (as contas
// continuam separadas), só a VISIBILIDADE: enquanto ativa, 121-compras-
// profissional.js e 89-compras-dashboard.js passam a considerar o nome de
// quem está ausente como "meu" também, pra quem está cobrindo.
async function carregarCoberturas(forcar){if(coberturasCarregadas&&!forcar)return coberturas;try{const snap=await raw().collection('compras_cobertura_temporaria').where('ativo','==',true).get();coberturas=snap.docs.map(d=>({_id:d.id,...d.data()}));}catch(_e){coberturas=[];}coberturasCarregadas=true;return coberturas;}
function coberturasHtml(){
  return `<div class="tc" style="padding:12px;margin-top:14px"><b>🏖️ Cobertura temporária (férias/ausência)</b><p style="font-size:.72rem;color:var(--muted);margin:4px 0 10px">Enquanto ativa, tudo que apareceria pro comprador ausente (Dashboard, Solicitações, Pedidos, Recebimentos, Análise de Preços...) passa a aparecer TAMBÉM pra quem está cobrindo. As duas contas continuam separadas — isto não transfere nem apaga nada, só soma visibilidade.</p><div style="display:grid;grid-template-columns:2fr 2fr 2fr auto;gap:7px"><select class="field" id="comp-cob-origem"><option value="">Quem está ausente...</option>${usuarios.map(u=>`<option value="${esc(u.uid||u._id)}" data-nome="${esc(u.nome||u.email||'')}">${esc(u.nome||u.email||u.uid)}</option>`).join('')}</select><select class="field" id="comp-cob-substituto"><option value="">Quem vai cobrir...</option>${usuarios.map(u=>`<option value="${esc(u.uid||u._id)}" data-nome="${esc(u.nome||u.email||'')}">${esc(u.nome||u.email||u.uid)}</option>`).join('')}</select><input class="field" id="comp-cob-motivo" placeholder="Motivo (opcional, ex.: férias)"><button class="btn btn-primary btn-sm" data-comp-cob-ativar>Ativar cobertura</button></div><div style="overflow:auto;margin-top:10px"><table class="dt-table"><thead><tr><th>Ausente</th><th>Cobrindo</th><th>Motivo</th><th>Desde</th><th></th></tr></thead><tbody>${coberturas.length?coberturas.map(c=>`<tr><td><b>${esc(c.origemNome)}</b></td><td>${esc(c.substitutoNome)}</td><td>${esc(c.motivo||'—')}</td><td>${esc(String(c.criadoEm||'').slice(0,10))}</td><td><button class="btn btn-ghost btn-sm" data-comp-cob-encerrar="${esc(c._id)}">Encerrar</button></td></tr>`).join(''):'<tr><td colspan="5">Nenhuma cobertura ativa.</td></tr>'}</tbody></table></div></div>`;
}
async function ativarCobertura(){
  if(!tem('configurar'))return;
  const selOrigem=document.getElementById('comp-cob-origem'),selSub=document.getElementById('comp-cob-substituto');
  const origemUid=selOrigem?.value||'',substitutoUid=selSub?.value||'';
  const origemNome=selOrigem?.selectedOptions?.[0]?.dataset?.nome||'',substitutoNome=selSub?.selectedOptions?.[0]?.dataset?.nome||'';
  const motivo=document.getElementById('comp-cob-motivo')?.value.trim()||'';
  if(!origemUid||!substitutoUid)return global.showToast?.('Selecione quem está ausente e quem vai cobrir.','warning');
  if(origemUid===substitutoUid)return global.showToast?.('Selecione duas pessoas diferentes.','warning');
  const jaExiste=coberturas.find(c=>c.origemUid===origemUid);
  if(jaExiste)return global.showToast?.(origemNome+' já tem uma cobertura ativa ('+jaExiste.substitutoNome+'). Encerre antes de criar outra.','warning');
  const coberturaId=String(origemUid).replace(/[^a-zA-Z0-9_-]/g,'_')+'__'+String(substitutoUid).replace(/[^a-zA-Z0-9_-]/g,'_');
  await raw().collection('compras_cobertura_temporaria').doc(coberturaId).set({origemUid,origemNome,substitutoUid,substitutoNome,motivo,ativo:true,criadoEm:now(),criadoPor:global._currentAnalistaUser?.email||''},{merge:true});
  await carregarCoberturas(true);
  await desenhar();
  global.showToast?.('Cobertura ativada — os pedidos de '+origemNome+' também vão aparecer pra '+substitutoNome+'.','success');
}
async function encerrarCobertura(id){
  if(!tem('configurar')||!confirm('Encerrar esta cobertura?'))return;
  await raw().collection('compras_cobertura_temporaria').doc(id).set({ativo:false,encerradoEm:now(),encerradoPor:global._currentAnalistaUser?.email||''},{merge:true});
  await carregarCoberturas(true);
  await desenhar();
}
async function reprocessarCompradoresBluesoft(){if(!tem('configurar'))return 0;let alteradas=0;for(const x of agendamentos){const k=String(x.bluesoftCompradorKey||'').trim();if(!k)continue;const r=regras.find(y=>y.tipo==='bluesoft_comprador'&&String(y.valor||'').trim()===k&&y.ativo!==false);if(!r)continue;await fs().collection(CAGE).doc(x._id).set({compradorUid:r.compradorUid||'',compradorEmail:r.compradorEmail||'',compradorNome:r.compradorNome||'',regraCompradorId:r._id,atualizadoEm:now()},{merge:true});alteradas++;}return alteradas;}
const _salvarRegraBase=salvarRegra;
salvarRegra=async function(){await _salvarRegraBase();const q=await reprocessarCompradoresBluesoft();if(q){global.showToast?.(q+' pedido(s) BlueSoft vinculado(s) ao comprador.','success');await carregar();await desenhar();}};
async function desenhar(){const p=document.getElementById('page-compras-central');if(!p)return;if(aba==='historico'&&historicoTodos)await carregarHistoricoGeral();if(aba==='regras')await Promise.all([carregarUsuariosCompras(),carregarAgendamentos(),carregarCoberturas()]);p.innerHTML=`<div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:14px"><div><div class="page-title" style="font-size:1.15rem">🛒 Compras</div><div style="font-size:.74rem;color:var(--muted)">Requisições direcionadas automaticamente pelo PCP</div></div><button class="btn btn-ghost btn-sm" data-comp-refresh>↻ Atualizar</button></div>${tabs()}${aba==='regras'?regrasHtml()+coberturasHtml():historicoHtml()}<div id="compras-modal-host"></div>`;}
async function render(){const p=document.getElementById('page-compras-central');if(!p)return;p.innerHTML='<div class="empty">Carregando Compras...</div>';try{await carregar();await desenhar();}catch(e){p.innerHTML='<div class="empty">Falha em Compras: '+esc(e.message||e)+'</div>';}}
document.addEventListener('click',e=>{const t=e.target.closest('[data-comp-tab]');if(t){comprasSetAbaCentral(t.dataset.compTab);return;}if(e.target.closest('[data-comp-refresh]')){historicoGeral=[];usuariosComprasCarregados=false;agendamentosCarregados=false;render();return;}if(e.target.closest('[data-comp-close]')){const h=document.getElementById('compras-modal-host');if(h)h.innerHTML='';return;}if(e.target.closest('[data-comp-reg-save]')){salvarRegra().catch(x=>global.showToast?.(x.message,'error'));return;}if(e.target.closest('[data-comp-reprocessar]')){reprocessarSemComprador().then(async q=>{global.showToast?.(q?q+' requisição(ões) direcionada(s).':'Nenhuma requisição encontrou regra compatível.',q?'success':'warning');await render();}).catch(x=>global.showToast?.(x.message,'error'));return;}const d=e.target.closest('[data-comp-reg-del]');if(d){excluirRegra(d.dataset.compRegDel);return;}const hv=e.target.closest('[data-comp-hist-ver]');if(hv){modalHistorico(hv.dataset.compHistVer);return;}
  if(e.target.closest('[data-comp-reg-sugestoes]')){const h=document.getElementById('compras-modal-host');if(!h)return;h.innerHTML=sugestoesModalHtml();carregarSugestoesRegra().then(()=>{const h2=document.getElementById('compras-modal-host');if(h2)h2.innerHTML=sugestoesModalHtml();}).catch(x=>global.showToast?.(x.message,'error'));return;}
  const sc=e.target.closest('[data-comp-sug-check]');if(sc){const forn=sc.dataset.compSugCheck;if(sugestoesSelecionadas.has(forn))sugestoesSelecionadas.delete(forn);else sugestoesSelecionadas.add(forn);const h=document.getElementById('compras-modal-host');if(h)h.innerHTML=sugestoesModalHtml();return;}
  if(e.target.closest('[data-comp-sug-desmarcar-todos]')){sugestoesSelecionadas=new Set();const h=document.getElementById('compras-modal-host');if(h)h.innerHTML=sugestoesModalHtml();return;}
  if(e.target.closest('[data-comp-sug-aplicar]')){aplicarSugestoesRegra().then(async r=>{global.showToast?.(r.aplicadas?r.aplicadas+' regra(s) de comprador aplicada(s).':'Nenhuma regra aplicada.',r.aplicadas?'success':'warning');const h=document.getElementById('compras-modal-host');if(h)h.innerHTML='';await carregar();await desenhar();}).catch(x=>global.showToast?.(x.message,'error'));return;}
  if(e.target.closest('[data-comp-sync-auto]')){if(sincronizandoAutomatico)return;sincronizandoAutomatico=true;desenhar();sincronizarRegrasAutomaticamente().then(async r=>{sincronizandoAutomatico=false;const partes=[];if(r.criadas)partes.push(r.criadas+' criada(s)');if(r.atualizadas)partes.push(r.atualizadas+' atualizada(s) (comprador mudou)');if(r.puladasManual)partes.push(r.puladasManual+' já manual (não mexida)');if(r.semConta)partes.push(r.semConta+' sem conta cadastrada');global.showToast?.(partes.length?partes.join(', ')+'.':'Nada pra sincronizar — tudo já está em dia.',(r.criadas||r.atualizadas)?'success':'warning');await carregar();await desenhar();}).catch(x=>{sincronizandoAutomatico=false;global.showToast?.(x.message,'error');desenhar();});return;}
  if(e.target.closest('[data-comp-cob-ativar]')){ativarCobertura().catch(x=>global.showToast?.(x.message,'error'));return;}
  const ce=e.target.closest('[data-comp-cob-encerrar]');if(ce){encerrarCobertura(ce.dataset.compCobEncerrar).catch(x=>global.showToast?.(x.message,'error'));return;}
});
document.addEventListener('input',e=>{if(e.target&&e.target.id==='comp-hist-busca'){historicoBusca=e.target.value;desenhar();}
  if(e.target&&e.target.id==='comp-sug-busca'){sugestoesBusca=e.target.value;const pos=e.target.selectionStart;const h=document.getElementById('compras-modal-host');if(h)h.innerHTML=sugestoesModalHtml();const campo=document.getElementById('comp-sug-busca');if(campo){campo.focus();campo.setSelectionRange(pos,pos);}}
});
document.addEventListener('change',e=>{if(e.target&&e.target.id==='comp-hist-todos'){historicoTodos=e.target.checked;desenhar().catch(x=>global.showToast?.(x.message,'error'));}
  if(e.target&&e.target.id==='comp-reg-tipo'){const dl=document.getElementById('comp-reg-valores');if(dl)dl.innerHTML=datalistHtmlRegra(e.target.value);}
});
// Fase 10 — Dashboard de Compras (89) vive numa página própria dentro do
// mesmo setor. Mesmo padrão leve do pcpIrParaAba (78): troca de página sem
// depender de goPage()/permissão por id de página — só a permissão única
// 'compras-central' já existente.
function comprasIrParaPagina(nome,el){
  if(typeof global.temPermissao==='function'&&!global.temPermissao('compras-central','visualizar')){global.showToast?.('Você não possui acesso a esta aba.','error');return;}
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('on'));
  if(el)el.classList.add('on');
  const tituloEl=document.getElementById('page-title');
  if(nome==='dashboard'){
    const pageEl=document.getElementById('page-compras-dashboard');if(pageEl)pageEl.classList.add('on');
    if(tituloEl)tituloEl.textContent='Compras · Dashboard';
    global.renderComprasDashboard?.();
    return;
  }
  const pageEl=document.getElementById('page-compras-central');if(pageEl)pageEl.classList.add('on');
  if(tituloEl)tituloEl.textContent='Compras · Central';
  render();
}
function comprasSetAbaCentral(v){aba=v||'minhas';render();}
function comprasGetAbaCentral(){return aba;}
global.comprasSetAbaCentral=comprasSetAbaCentral;global.comprasGetAbaCentral=comprasGetAbaCentral;
global.renderComprasCentral=render;global.comprasIrParaPagina=comprasIrParaPagina;global._comprasInternals={reprocessarSemComprador,requisicaoSemComprador,historicoCompras,historicoPedidosCompra,agruparHistorico,historicoBase,carregar,linhaNoEscopoCompras,agendamentos:()=>agendamentos,carregarSugestoesRegra,carregarSugestoesProduto,aplicarSugestoesRegra,sincronizarRegrasAutomaticamente,resolverUsuarioPorNome,sugestoesSelecionadas:()=>sugestoesSelecionadas,sugestoes:()=>sugestoes,sugestoesProduto:()=>sugestoesProduto,carregarCoberturas,ativarCobertura,encerrarCobertura,coberturas:()=>coberturas,regras:()=>regras};
})(window);
