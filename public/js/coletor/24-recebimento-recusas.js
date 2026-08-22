// Coletor > Recebimento > Notas Retornadas
(function (global) {
  'use strict';

  const COL_NOTAS = 'recebimento_recusas_notas';
  const COL_RECUSAS = 'recebimento_recusas';
  const COL_MOTORISTAS = 'recebimento_recusas_motoristas';
  const COL_MOTIVOS = 'recebimento_recusas_motivos';
  // Pedido ao vivo do usuário (planilha real de controle): "Conferente" é a
  // pessoa da equipe que confere a carga na chegada — cadastro próprio,
  // mesmo molde de Motorista/Motivo.
  const COL_CONFERENTES = 'recebimento_recusas_conferentes';
  const COL_TAREFAS = 'recebimento_recusas_tarefas_conferencia';
  let S = { etapa:'chave', notas:[], motoristas:[], motivos:[], conferentes:[], motoristaId:'', motivoId:'', conferenteId:'', buscaMotorista:null, buscaMotivo:null, buscaConferente:null, volume:'', box:'', pallets:'', modoConferencia:null, itensConferidos:[], tarefasPendentes:[], modoTarefa:false, tarefaId:'', recusaIdOriginal:'', carregando:false };

  function fs(){
    if (typeof global.getDTFirestore === 'function') return global.getDTFirestore();
    if (global.firebase && typeof global.firebase.firestore === 'function') return global.firebase.firestore();
    throw new Error('Firestore ainda não foi inicializado. Recarregue a página.');
  }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
  function _norm(v){ return String(v||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim(); }
  function chaveValida(chave) {
    const c=String(chave||'').replace(/\D/g,''); if(c.length!==44)return false;
    let soma=0,p=2; for(let i=42;i>=0;i--){soma+=Number(c[i])*p;p=p===9?2:p+1;} const r=soma%11,d=(r===0||r===1)?0:11-r; return d===Number(c[43]);
  }
  function usuario(){ const u=global.firebase?.auth?.().currentUser; return u?{uid:u.uid||'',email:u.email||''}:{uid:'',email:''}; }
  function toast(m,t){ if(global.showToast) global.showToast(m,t); else alert(m); }
  function reset(){ S={etapa:'chave',notas:[],motoristas:[],motivos:[],conferentes:[],motoristaId:'',motivoId:'',conferenteId:'',buscaMotorista:null,buscaMotivo:null,buscaConferente:null,volume:'',box:'',pallets:'',modoConferencia:null,itensConferidos:[],tarefasPendentes:[],modoTarefa:false,tarefaId:'',recusaIdOriginal:'',carregando:false}; }
  // Config genérica dos combos com busca (motorista/motivo/conferente) —
  // um lugar só listando qual campo de S guarda o id selecionado e qual
  // guarda o texto digitado, pra ligarCombosBusca()/comboItens() não
  // precisarem de um if/else por combo.
  const COMBO_CAMPOS = {
    'recusa-motorista': { itens:'motoristas', id:'motoristaId', busca:'buscaMotorista' },
    'recusa-motivo': { itens:'motivos', id:'motivoId', busca:'buscaMotivo' },
    'recusa-conferente': { itens:'conferentes', id:'conferenteId', busca:'buscaConferente' },
  };
  // PEDIDO AO VIVO (usuário: "quando clico em cima [motorista/motivo], tem
  // que deixar a pessoa digitar também para não ficar procurando durante
  // um tempão") — os dois <select> nativos viraram uma busca com lista
  // filtrada, porque com ~30 motoristas cadastrados rolar um <select>
  // nativo num coletor é lento. Estado (S.buscaMotorista/buscaMotivo)
  // guarda o texto digitado à parte do ID selecionado, porque render()
  // reconstrói o HTML inteiro a cada mudança de etapa — sem isso o texto
  // digitado sumiria ao trocar de campo.
  function comboBuscaHtml(prefixo, itens, selecionadoId, busca) {
    const selecionado = itens.find(x => x._id === selecionadoId);
    const termo = busca != null ? busca : (selecionado ? (selecionado.nome || '') : '');
    const termoNorm = _norm(termo);
    const filtrados = termoNorm ? itens.filter(x => _norm(x.nome).includes(termoNorm)) : itens;
    return `<div style="position:relative">
      <input class="field" id="${prefixo}-busca" autocomplete="off" placeholder="Digite para buscar ou toque pra ver todos" value="${esc(termo)}" data-combo-input="${prefixo}">
      <div id="${prefixo}-lista" class="combo-lista" style="display:none;position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:40;max-height:230px;overflow:auto;background:var(--surface);border:1.5px solid var(--border);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.45)">${comboOpcoesHtml(prefixo, filtrados)}</div>
    </div>`;
  }
  function comboOpcoesHtml(prefixo, filtrados) {
    if (!filtrados.length) return '<div style="padding:12px 14px;font-size:.85rem;color:var(--muted)">Nenhum resultado</div>';
    return filtrados.map(x => `<div class="combo-opcao" data-combo-opcao="${prefixo}" data-combo-valor="${esc(x._id)}" style="padding:13px 14px;font-size:.88rem;border-bottom:1px solid var(--border);cursor:pointer">${esc(x.nome)}</div>`).join('');
  }
  function comboItens(prefixo) { return S[COMBO_CAMPOS[prefixo].itens]; }

  async function carregarCadastros(){
    const [m,mo,c]=await Promise.all([fs().collection(COL_MOTORISTAS).get(),fs().collection(COL_MOTIVOS).get(),fs().collection(COL_CONFERENTES).get()]);
    S.motoristas=m.docs.map(d=>({_id:d.id,...d.data()})).filter(x=>x.ativo!==false).sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'));
    S.motivos=mo.docs.map(d=>({_id:d.id,...d.data()})).filter(x=>x.ativo!==false).sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'));
    S.conferentes=c.docs.map(d=>({_id:d.id,...d.data()})).filter(x=>x.ativo!==false).sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'));
  }
  // FASE 8 — tarefas de conferência que o Analista delegou pra ESTE
  // operador (matching por e-mail do login, mesmo padrão simples de
  // dt_atribuicoes_contagem). Nunca trava a entrada na tela se falhar
  // (rede fraca, etc.) — só fica sem a lista de tarefas.
  async function carregarTarefasPendentes(){
    const email=usuario().email;
    if(!email){ S.tarefasPendentes=[]; return; }
    try{
      const snap=await fs().collection(COL_TAREFAS).where('atribuidoPara','==',email).get();
      S.tarefasPendentes=snap.docs.map(d=>({_id:d.id,...d.data()})).filter(t=>t.status==='PENDENTE');
    }catch(e){ S.tarefasPendentes=[]; }
  }

  async function abrirRecusasRecebimento(){
    reset();
    global.goScreen?.('recebimento-recusas');
    render();
    try { await Promise.all([carregarCadastros(),carregarTarefasPendentes()]); render(); focarScan(); } catch(e){ toast('Não foi possível carregar motoristas/motivos: '+(e.message||e),'error'); }
  }
  function focarScan(){ setTimeout(()=>document.getElementById('recusa-chave-input')?.focus(),80); }

  // Pula direto pra conferência de itens de uma tarefa já delegada pelo
  // Analista — motorista/motivo/volume/box já foram preenchidos na
  // recusa original, só falta bipar os produtos. Refaz o merge de itens[]
  // (mesma lógica de 'recusa-conf-itens') a partir das notas ORIGINAIS
  // (a recusa não guarda itens, só a nota guarda).
  async function iniciarConferenciaDelegada(tarefa){
    reset();
    S.modoTarefa=true; S.tarefaId=tarefa._id; S.recusaIdOriginal=tarefa.recusaId; S.box=tarefa.box||'';
    global.goScreen?.('recebimento-recusas');
    S.etapa='itens'; render();
    try{
      const chaves=(tarefa.notas||[]).map(n=>n.chave).filter(Boolean);
      const docs=await Promise.all(chaves.map(c=>fs().collection(COL_NOTAS).doc(c).get()));
      const itens=[];
      docs.forEach((doc,i)=>{
        if(!doc.exists)return;
        const d=doc.data()||{}; const numeroNota=(tarefa.notas||[])[i]?.numeroNota||'';
        (d.itens||[]).forEach(it=>itens.push({
          produtoKey:it.produtoKey??null, descricao:it.descricao||'', gtin:it.gtin||'',
          qtdPrevista:Number(it.quantidade)||0, qtdConferida:0, notaChave:chaves[i], notaNumero:numeroNota,
        }));
      });
      S.modoConferencia='ITENS'; S.itensConferidos=itens;
      render();
      setTimeout(()=>document.getElementById('recusa-conf-scan')?.focus(),80);
    }catch(e){ toast('Erro ao carregar produtos da conferência: '+(e.message||e),'error'); }
  }
  function tarefasPendentesHtml(){
    if(!S.tarefasPendentes.length)return '';
    return `<div class="card" style="padding:12px;border:1px solid #7a4a1f;background:#2a1c0c">
      <div style="font-size:.76rem;font-weight:800;margin-bottom:8px;color:#ffd18a">📋 Conferências pendentes pra você</div>
      ${S.tarefasPendentes.map(t=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-top:1px solid rgba(255,255,255,.08)"><div><div style="font-weight:800">${esc((t.notas||[]).map(n=>'NF '+n.numeroNota).join(' • ')||'—')}</div><div style="font-size:.7rem;color:#9eb4cb">Box ${esc(t.box||'—')}</div></div><button type="button" class="btn btn-primary" style="padding:8px 12px" data-tarefa-iniciar="${esc(t._id)}">Iniciar</button></div>`).join('')}
    </div>`;
  }

  // Badge só informativo (pedido explícito do usuário: o operador NUNCA
  // classifica a nota) — só aparece quando a nota veio da sincronização
  // Bluesoft (só ali existe o sinal pareceDevolucao); nota importada por
  // PDF fica sem badge (sem dado pra opinar).
  function badgeIdentificacao(n){
    if (n.origemImportacao !== 'BLUESOFT') return '';
    return n.pareceDevolucao
      ? '<div style="margin-top:4px"><span class="badge" style="background:#4a3114;color:#ffd18a;font-size:.62rem">↩️ Nota de devolução identificada</span></div>'
      : '<div style="margin-top:4px"><span class="badge" style="background:#132a1d;color:#8fd9a8;font-size:.62rem">Nota de venda identificada</span></div>';
  }
  function notasHtml(){
    if(!S.notas.length) return '<div style="border:1px dashed #284567;border-radius:10px;padding:16px;text-align:center;color:#6f89a6;font-size:.82rem">Nenhuma nota lida ainda.</div>';
    return S.notas.map((n,i)=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:#101f34;border:1px solid #284567;border-radius:10px;padding:11px 12px"><div><div style="font-weight:850">NF ${esc(n.numeroNota)}</div><div style="font-size:.7rem;color:#6f89a6">${esc(n.destinatario||'Nota identificada')}</div>${badgeIdentificacao(n)}</div><button type="button" class="btn btn-ghost" style="padding:7px 10px;color:#ff7b7b" data-recusa-remover="${i}">×</button></div>`).join('');
  }

  function etapaChave(){ return `
    ${tarefasPendentesHtml()}
    <div><div class="screen-title">↩️ Notas Retornadas</div><div class="screen-sub">Bipe a chave de acesso da NF-e. Você pode incluir várias notas no mesmo retorno.</div></div>
    <input id="recusa-chave-input" class="field" inputmode="numeric" autocomplete="off" placeholder="Bipe a chave de acesso (44 dígitos)" style="font-size:1rem;padding:15px;text-align:center">
    <button class="btn btn-primary" id="recusa-add-chave" style="padding:14px">Adicionar nota</button>
    <div id="recusa-notas-lista" style="display:flex;flex-direction:column;gap:7px">${notasHtml()}</div>
    <button class="btn btn-primary" id="recusa-continuar-1" ${S.notas.length?'':'disabled'} style="padding:15px">Continuar (${S.notas.length} nota${S.notas.length===1?'':'s'}) →</button>`; }
  function etapaMotorista(){ return `
    <div><div class="screen-title">Motorista e motivo</div><div class="screen-sub">Selecione quem retornou com a carga e o motivo da devolução.</div></div>
    <div class="card" style="padding:12px"><div style="font-size:.72rem;color:#6f89a6;margin-bottom:5px">NOTAS LIDAS</div><div style="font-weight:800">${S.notas.map(n=>'NF '+esc(n.numeroNota)).join(' • ')}</div></div>
    <div><div style="font-size:.76rem;font-weight:800;margin-bottom:5px">MOTORISTA</div>${comboBuscaHtml('recusa-motorista', S.motoristas, S.motoristaId, S.buscaMotorista)}</div>
    <div><div style="font-size:.76rem;font-weight:800;margin-bottom:5px">MOTIVO DA VOLTA</div>${comboBuscaHtml('recusa-motivo', S.motivos, S.motivoId, S.buscaMotivo)}</div>
    <div><div style="font-size:.76rem;font-weight:800;margin-bottom:5px">CONFERENTE (opcional)</div>${comboBuscaHtml('recusa-conferente', S.conferentes, S.conferenteId, S.buscaConferente)}</div>
    ${!S.motoristas.length||!S.motivos.length?'<div style="padding:10px;border-radius:9px;background:#4a3114;color:#ffd18a;font-size:.78rem">O Analista precisa cadastrar pelo menos um motorista e um motivo na aba Notas Retornadas.</div>':''}
    <button class="btn btn-ghost" id="recusa-voltar-2" style="padding:12px">← Voltar</button>
    <button class="btn btn-primary" id="recusa-continuar-2" style="padding:15px">Continuar →</button>`; }
  // Pedido ao vivo do usuário: "quando coloca o volume, ele tem que mostrar
  // pro conferente se colocou o volume certo ou não, mostrar tipo o volume
  // correto da nota" — inverteu o comportamento anterior (que escondia de
  // propósito o volume esperado). Agora mostra sempre o esperado, e compara
  // ao vivo (a cada dígito) com o que foi contado.
  function volumeEsperadoTotal(){ return S.notas.reduce((s,n)=>s+Number(n.volumes||0),0); }
  function feedbackVolumeHtml(){
    const esperado=volumeEsperadoTotal();
    const v=String(S.volume==null?'':S.volume).trim();
    if(v===''){
      return `<div style="padding:12px;border-radius:10px;background:#15263f;border:1px solid #29486d;font-size:.82rem;color:#9eb4cb">Volume esperado da nota: <b>${esperado}</b></div>`;
    }
    const n=Number(v);
    const dif=n-esperado;
    if(!Number.isFinite(n)) return '';
    return dif===0
      ? `<div style="padding:12px;border-radius:10px;background:#132a1d;border:1px solid #1e6f4e;font-size:.85rem;color:#8fd9a8">✅ Confere — volume esperado: ${esperado}</div>`
      : `<div style="padding:12px;border-radius:10px;background:#4a1f1f;border:1px solid #7a2b2b;font-size:.85rem;color:#ffb3b3">⚠️ Divergente — esperado ${esperado}, contado ${n} (${dif>0?'+':''}${dif})</div>`;
  }
  function etapaVolume(){ return `
    <div><div class="screen-title">Conferência de volumes</div><div class="screen-sub">Conte fisicamente os volumes devolvidos e informe o total encontrado.</div></div>
    <div id="recusa-volume-feedback">${feedbackVolumeHtml()}</div>
    <input id="recusa-volume" class="field" type="number" min="0" step="1" inputmode="numeric" placeholder="Quantidade de volumes contados" value="${esc(S.volume)}" style="font-size:1.15rem;padding:17px;text-align:center;font-weight:850">
    <button class="btn btn-ghost" id="recusa-voltar-3" style="padding:12px">← Voltar</button>
    <button class="btn btn-primary" id="recusa-continuar-3" style="padding:15px">Continuar →</button>`; }
  function etapaBox(){ return `
    <div><div class="screen-title">Box e pallets</div><div class="screen-sub">Informe onde a carga retornada ficará armazenada.</div></div>
    <input id="recusa-box" class="field" autocomplete="off" placeholder="Ex.: BOX 12" value="${esc(S.box)}" style="font-size:1.1rem;padding:17px;text-align:center;font-weight:850;text-transform:uppercase">
    <input id="recusa-pallets" class="field" type="number" min="0" step="1" inputmode="numeric" placeholder="Quantidade de pallets (opcional)" value="${esc(S.pallets)}" style="font-size:1.05rem;padding:15px;text-align:center">
    <div class="card" style="padding:13px"><div style="font-size:.72rem;color:#6f89a6">RESUMO</div><div style="margin-top:5px;font-weight:800">${S.notas.map(n=>'NF '+esc(n.numeroNota)).join(' • ')}</div><div style="margin-top:5px;font-size:.78rem;color:#9eb4cb">Motorista: ${esc(S.motoristas.find(x=>x._id===S.motoristaId)?.nome||'—')}<br>Motivo: ${esc(S.motivos.find(x=>x._id===S.motivoId)?.nome||'—')}${S.conferenteId?'<br>Conferente: '+esc(S.conferentes.find(x=>x._id===S.conferenteId)?.nome||'—'):''}<br>Volumes contados: ${esc(S.volume)}</div></div>
    <button class="btn btn-ghost" id="recusa-voltar-4" style="padding:12px">← Voltar</button>
    <button class="btn btn-primary" id="recusa-continuar-4" style="padding:15px">Continuar →</button>`; }
  // Escolha entre conferir item a item (só possível quando pelo menos uma
  // nota trouxe itens[] — hoje só a sincronização Bluesoft traz isso) ou
  // receber só o volume (o caminho padrão de sempre, sem mudança de
  // comportamento pra quem não usa conferência de produtos).
  function temItensDisponiveis(){ return S.notas.some(n => (n.itens||[]).length); }
  function etapaConferenciaEscolha(){ return `
    <div><div class="screen-title">Conferência de produtos</div><div class="screen-sub">Escolha como registrar o recebimento desta carga.</div></div>
    ${temItensDisponiveis() ? '' : '<div style="padding:10px;border-radius:9px;background:#15263f;color:#9eb4cb;font-size:.78rem">Nenhuma nota lida tem lista de produtos disponível (só vem da sincronização Bluesoft) — só é possível receber o volume.</div>'}
    <button class="btn btn-primary" id="recusa-conf-itens" ${temItensDisponiveis()?'':'disabled'} style="padding:16px">📦 Conferir produtos</button>
    <button class="btn btn-ghost" id="recusa-conf-somente-volume" style="padding:16px">Receber somente o volume</button>
    <button class="btn btn-ghost" id="recusa-voltar-conferencia" style="padding:12px">← Voltar</button>`; }
  function etapaItens(){
    const total = S.itensConferidos.length;
    const conferidos = S.itensConferidos.filter(it => Number(it.qtdConferida) > 0).length;
    return `
    <div><div class="screen-title">Bipe os produtos</div><div class="screen-sub">Bipe o GTIN de cada produto (soma 1 por bipagem) ou digite a quantidade direto. ${conferidos}/${total} produto(s) já conferido(s).</div></div>
    <input id="recusa-conf-scan" class="field" inputmode="numeric" autocomplete="off" placeholder="Bipe o GTIN do produto" style="font-size:1rem;padding:15px;text-align:center">
    <div style="display:flex;flex-direction:column;gap:7px;max-height:340px;overflow:auto">${S.itensConferidos.map((it,i) => {
      const divergente = Number(it.qtdConferida) !== Number(it.qtdPrevista);
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:#101f34;border:1px solid ${divergente?'#7a4a1f':'#284567'};border-radius:10px;padding:10px 12px">
        <div style="flex:1;min-width:0"><div style="font-weight:800;font-size:.85rem">${esc(it.descricao || ('Produto ' + (it.gtin || it.produtoKey || '')))}</div><div style="font-size:.68rem;color:#6f89a6">GTIN ${esc(it.gtin || '—')} · NF ${esc(it.notaNumero)} · Previsto ${it.qtdPrevista}</div></div>
        <input class="field" type="number" min="0" step="1" style="width:80px;padding:7px;text-align:center" value="${esc(it.qtdConferida)}" data-conf-item-qtd="${i}">
      </div>`;
    }).join('')}</div>
    <button class="btn btn-primary" id="recusa-conf-concluir" style="padding:16px">Concluir conferência →</button>
    ${S.modoTarefa?'':'<button class="btn btn-ghost" id="recusa-voltar-itens" style="padding:12px">← Voltar</button>'}`;
  }
  function etapaSucesso(){
    const titulo = S.modoTarefa ? 'Conferência concluída' : 'Nota retornada registrada';
    const detalhe = S.modoTarefa
      ? `<div style="font-weight:850">Box ${esc(S.box)}</div>`
      : `<div style="font-weight:850">${S.notas.map(n=>'NF '+esc(n.numeroNota)).join(' • ')}</div><div style="margin-top:7px;color:#9eb4cb">Box ${esc(S.box)}</div>`;
    return `<div style="text-align:center;font-size:3rem">✅</div><div class="screen-title" style="text-align:center">${titulo}</div><div class="card" style="padding:16px;text-align:center">${detalhe}</div><button class="btn btn-primary" id="recusa-nova" style="padding:16px">Registrar outra nota retornada</button><button class="btn btn-ghost" id="recusa-voltar-recebimento" style="padding:14px">Voltar ao Recebimento</button>`;
  }

  const ETAPAS = { chave:etapaChave, motorista:etapaMotorista, volume:etapaVolume, box:etapaBox, conferencia:etapaConferenciaEscolha, itens:etapaItens, sucesso:etapaSucesso };

  function render(){
    const host=document.getElementById('recusa-fluxo-host'); if(!host)return;
    host.innerHTML=(ETAPAS[S.etapa]||etapaChave)();
    ligar();
  }
  // Filtragem ao digitar troca só o innerHTML da lista (nunca host.innerHTML
  // inteiro, que recriaria o <input> e derrubaria o foco/cursor no meio da
  // digitação). Seleção via mousedown (não click) — dispara ANTES do blur
  // do input esconder a lista, senão o toque nunca chega a registrar.
  function ligarCombosBusca() {
    Object.keys(COMBO_CAMPOS).forEach(prefixo => {
      const campo = COMBO_CAMPOS[prefixo];
      const input = document.getElementById(prefixo + '-busca');
      const lista = document.getElementById(prefixo + '-lista');
      if (!input || !lista) return;
      input.addEventListener('focus', () => { lista.style.display = 'block'; });
      input.addEventListener('input', () => {
        S[campo.busca] = input.value;
        const itens = comboItens(prefixo);
        const selecionadoAtual = itens.find(x => x._id === S[campo.id]);
        // se o texto não bate mais com o item que estava selecionado, limpa
        // a seleção — evita salvar um motorista/motivo/conferente que não é
        // mais o que está escrito na tela.
        if (!selecionadoAtual || _norm(selecionadoAtual.nome) !== _norm(input.value)) S[campo.id] = '';
        const termoNorm = _norm(input.value);
        const filtrados = termoNorm ? itens.filter(x => _norm(x.nome).includes(termoNorm)) : itens;
        lista.innerHTML = comboOpcoesHtml(prefixo, filtrados);
        lista.style.display = 'block';
      });
      input.addEventListener('blur', () => { setTimeout(() => { lista.style.display = 'none'; }, 150); });
      lista.addEventListener('mousedown', e => {
        const opcao = e.target.closest('[data-combo-opcao]');
        if (!opcao) return;
        e.preventDefault();
        const valor = opcao.dataset.comboValor;
        const item = comboItens(prefixo).find(x => x._id === valor);
        S[campo.id] = valor; S[campo.busca] = item?.nome || '';
        render();
      });
    });
  }
  function ligar(){
    const input=document.getElementById('recusa-chave-input');
    input?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();adicionarChave();}});
    document.getElementById('recusa-add-chave')?.addEventListener('click',adicionarChave);
    document.querySelectorAll('[data-recusa-remover]').forEach(b=>b.addEventListener('click',()=>{S.notas.splice(Number(b.dataset.recusaRemover),1);render();focarScan();}));
    document.querySelectorAll('[data-tarefa-iniciar]').forEach(b=>b.addEventListener('click',()=>{
      const t=S.tarefasPendentes.find(x=>x._id===b.dataset.tarefaIniciar);
      if(t)iniciarConferenciaDelegada(t);
    }));
    document.getElementById('recusa-continuar-1')?.addEventListener('click',()=>{if(!S.notas.length)return;S.etapa='motorista';render();});
    ligarCombosBusca();
    document.getElementById('recusa-continuar-2')?.addEventListener('click',()=>{if(!S.motoristaId)return toast('Selecione o motorista.','error');if(!S.motivoId)return toast('Selecione o motivo da volta.','error');S.etapa='volume';render();setTimeout(()=>document.getElementById('recusa-volume')?.focus(),80);});
    // Pedido ao vivo do usuário: "aperto em voltar para ajustar o anterior
    // ele volta tudo e tem que refazer tudo" — nenhum passo tinha botão de
    // voltar antes disso; só mudam S.etapa, nunca reset(), então tudo que
    // já foi preenchido continua lá quando o operador volta a avançar.
    document.getElementById('recusa-voltar-2')?.addEventListener('click',()=>{S.etapa='chave';render();focarScan();});
    document.getElementById('recusa-voltar-3')?.addEventListener('click',()=>{S.volume=String(document.getElementById('recusa-volume')?.value||S.volume||'');S.etapa='motorista';render();});
    document.getElementById('recusa-voltar-4')?.addEventListener('click',()=>{S.etapa='volume';render();setTimeout(()=>document.getElementById('recusa-volume')?.focus(),80);});
    document.getElementById('recusa-voltar-conferencia')?.addEventListener('click',()=>{S.etapa='box';render();});
    document.getElementById('recusa-voltar-itens')?.addEventListener('click',()=>{S.etapa='conferencia';render();});
    // Feedback de volume ao vivo (a cada dígito) — só troca o innerHTML do
    // bloco de feedback, nunca o input inteiro, senão perde o foco/cursor
    // no meio da digitação.
    document.getElementById('recusa-volume')?.addEventListener('input',e=>{
      S.volume=e.target.value===''?'':Number(e.target.value);
      const alvo=document.getElementById('recusa-volume-feedback');
      if(alvo)alvo.innerHTML=feedbackVolumeHtml();
    });
    document.getElementById('recusa-continuar-3')?.addEventListener('click',()=>{const v=String(document.getElementById('recusa-volume')?.value||'').trim();const n=Number(v);if(v===''||!Number.isInteger(n)||n<0)return toast('Informe a quantidade de volumes contados.','error');S.volume=n;S.etapa='box';render();setTimeout(()=>document.getElementById('recusa-box')?.focus(),80);});
    document.getElementById('recusa-continuar-4')?.addEventListener('click',()=>{
      const box=String(document.getElementById('recusa-box')?.value||'').trim().toUpperCase();
      if(!box)return toast('Informe o número do Box.','error');
      const pallets=String(document.getElementById('recusa-pallets')?.value||'').trim();
      S.box=box; S.pallets=pallets; S.etapa='conferencia'; render();
    });
    document.getElementById('recusa-conf-itens')?.addEventListener('click',()=>{
      S.modoConferencia='ITENS';
      S.itensConferidos=S.notas.flatMap(n=>(n.itens||[]).map(it=>({
        produtoKey:it.produtoKey ?? null, descricao:it.descricao||'', gtin:it.gtin||'',
        qtdPrevista:Number(it.quantidade)||0, qtdConferida:0, notaChave:n.chave, notaNumero:n.numeroNota,
      })));
      S.etapa='itens'; render();
      setTimeout(()=>document.getElementById('recusa-conf-scan')?.focus(),80);
    });
    document.getElementById('recusa-conf-somente-volume')?.addEventListener('click',()=>{ S.modoConferencia='SOMENTE_VOLUME'; S.itensConferidos=[]; finalizar(); });
    document.getElementById('recusa-conf-scan')?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();bipagemConferencia();}});
    document.querySelectorAll('[data-conf-item-qtd]').forEach(el=>el.addEventListener('input',()=>{
      const i=Number(el.dataset.confItemQtd); const v=Number(el.value);
      if(S.itensConferidos[i]) S.itensConferidos[i].qtdConferida=(Number.isFinite(v)&&v>=0)?v:0;
    }));
    document.getElementById('recusa-conf-concluir')?.addEventListener('click',finalizar);
    document.getElementById('recusa-nova')?.addEventListener('click',abrirRecusasRecebimento);
    document.getElementById('recusa-voltar-recebimento')?.addEventListener('click',()=>global.goScreen?.('recebimento-modo'));
  }

  // Bipagem item a item — mesmo padrão já usado nesta tela (listener local
  // de Enter no campo focado, sem precisar de câmera/ZXing: o leitor de
  // hardware funciona como teclado). Cada bipagem soma 1 na quantidade
  // conferida do item cujo GTIN bateu.
  function bipagemConferencia(){
    const input=document.getElementById('recusa-conf-scan');
    const codigo=String(input?.value||'').trim();
    if(!codigo)return;
    const idx=S.itensConferidos.findIndex(it=>it.gtin && it.gtin===codigo);
    if(idx<0){toast('Produto não encontrado nesta carga.','error');input.value='';return;}
    S.itensConferidos[idx].qtdConferida=Number(S.itensConferidos[idx].qtdConferida||0)+1;
    input.value='';
    render();
    setTimeout(()=>document.getElementById('recusa-conf-scan')?.focus(),80);
  }

  async function adicionarChave(){
    if(S.carregando)return;
    const input=document.getElementById('recusa-chave-input');
    const chave=String(input?.value||'').replace(/\D/g,'');
    if(chave.length!==44 || !chaveValida(chave)){toast('Chave de acesso inválida. Bipe os 44 dígitos da NF-e.','error');input?.select();return;}
    if(S.notas.some(n=>n.chave===chave)){toast('Essa nota já foi adicionada neste retorno.','error');input.value='';focarScan();return;}
    S.carregando=true;
    try{
      const doc=await fs().collection(COL_NOTAS).doc(chave).get();
      if(!doc.exists){toast('Nota não encontrada. Importe o PDF desta NF no Analista antes da conferência.','error');return;}
      const hist=await fs().collection(COL_RECUSAS).where('chaves','array-contains',chave).limit(1).get();
      if(!hist.empty){toast('ATENÇÃO: esta NF já possui um retorno registrado. Procure o Analista antes de lançar novamente.','error');return;}
      const d=doc.data()||{};
      S.notas.push({
        chave,numeroNota:d.numeroNota||'',destinatario:d.destinatario||'',volumes:Number(d.volumes||0),
        pareceDevolucao:!!d.pareceDevolucao, tipoOperacao:d.tipoOperacao||'', origemImportacao:d.origemImportacao||'',
        itens:Array.isArray(d.itens)?d.itens:[],
      });
      input.value='';render();focarScan();
    }catch(e){toast('Erro ao consultar a nota: '+(e.message||e),'error');}
    finally{S.carregando=false;}
  }

  // FASE 8 — conclui uma conferência DELEGADA: atualiza a recusa original
  // (nunca cria um segundo registro pra mesma carga) e marca a tarefa como
  // concluída. Caminho totalmente separado do finalizar() normal — os dois
  // só dividem o cálculo de divergência.
  async function concluirConferenciaDelegada(){
    const u=usuario();
    const temDivergenciaItens=S.itensConferidos.some(it=>Number(it.qtdConferida)!==Number(it.qtdPrevista));
    const statusConferenciaOperacional=temDivergenciaItens?'CONFERIDA_COM_DIVERGENCIA':'CONFERIDA';
    try{
      const btn=document.getElementById('recusa-conf-concluir'); if(btn)btn.disabled=true;
      await fs().collection(COL_RECUSAS).doc(S.recusaIdOriginal).update({
        statusConferenciaOperacional, itensConferidos:S.itensConferidos,
        conferenciaConcluidaEm:new Date().toISOString(), conferenciaConcluidaPorUid:u.uid, conferenciaConcluidaPorEmail:u.email,
      });
      await fs().collection(COL_TAREFAS).doc(S.tarefaId).update({ status:'CONCLUIDA', concluidaEm:new Date().toISOString(), concluidaPorUid:u.uid, concluidaPorEmail:u.email });
      S.etapa='sucesso'; render();
    }catch(e){
      toast('Erro ao concluir conferência: '+(e.message||e),'error');
      const btn=document.getElementById('recusa-conf-concluir'); if(btn)btn.disabled=false;
    }
  }

  async function finalizar(){
    if(S.modoTarefa) return concluirConferenciaDelegada();
    const mot=S.motoristas.find(x=>x._id===S.motoristaId), motivo=S.motivos.find(x=>x._id===S.motivoId);
    if(!mot||!motivo)return toast('Motorista ou motivo inválido. Volte e selecione novamente.','error');
    if(!S.box)return toast('Informe o número do Box.','error');
    const esperado=S.notas.reduce((s,n)=>s+Number(n.volumes||0),0), informado=Number(S.volume||0), dif=informado-esperado, u=usuario();
    let statusConferenciaOperacional='NAO_REALIZADA';
    if(S.modoConferencia==='ITENS'){
      const temDivergenciaItens=S.itensConferidos.some(it=>Number(it.qtdConferida)!==Number(it.qtdPrevista));
      statusConferenciaOperacional=temDivergenciaItens?'CONFERIDA_COM_DIVERGENCIA':'CONFERIDA';
    }
    const conferente=S.conferentes.find(x=>x._id===S.conferenteId);
    const payload={
      chaves:S.notas.map(n=>n.chave),
      notas:S.notas.map(n=>({chave:n.chave,numeroNota:n.numeroNota,volumeEsperado:Number(n.volumes||0),destinatario:n.destinatario||''})),
      motoristaId:mot._id,motoristaNome:mot.nome||'',motivoId:motivo._id,motivoNome:motivo.nome||'',
      conferenteId:conferente?._id||'',conferenteNome:conferente?.nome||'',
      volumeEsperado:esperado,volumeInformado:informado,diferencaVolumes:dif,conferenciaStatus:dif===0?'CONFERIDO':'DIVERGENTE',box:S.box,
      pallets:S.pallets!==''?Number(S.pallets):null, statusConferenciaOperacional, itensConferidos:S.itensConferidos,
      criadoEm:new Date().toISOString(),criadoPorUid:u.uid,criadoPorEmail:u.email,origem:'COLETOR'
    };
    try{
      const btn=document.getElementById('recusa-conf-concluir')||document.getElementById('recusa-conf-somente-volume');
      if(btn){btn.disabled=true;}
      await fs().collection(COL_RECUSAS).add(payload);
      S.etapa='sucesso';render();
    }catch(e){
      toast('Erro ao registrar nota retornada: '+(e.message||e),'error');
      const btn=document.getElementById('recusa-conf-concluir')||document.getElementById('recusa-conf-somente-volume');
      if(btn){btn.disabled=false;}
    }
  }

  // Navegação hierárquica (pedido ao vivo do usuário): a entrada não é mais
  // um botão dentro da tela do Transbordo — virou um card na nova tela de
  // escolha (screen-recebimento-modo, onclick="abrirRecusasRecebimento()"),
  // mesmo padrão simples já usado por abrirModoInventario()/
  // abrirModoAuditoria(). Sem mais wiring por listener delegado.
  global.abrirRecusasRecebimento=abrirRecusasRecebimento;
})(window);
