// AUDITORIA OPERACIONAL V22 — módulo isolado do Inventário
// Importação: Endereço + DUN + Produto. Comparação e resultados pelo DUN.
(function(){
  'use strict';

  const DB = () => window.FS_AN || (window.getDTFirestore && window.getDTFirestore());
  const STATUS = ['PENDENTE','OK','DIVERGENTE','ENDERECO_VAZIO'];
  let auditoriaAtual = '';
  let metaAtual = null;
  let itensAtuais = [];
  let unsubscribeItens = null;
  let assinaturaAnterior = '';
  let importacaoPendente = null;

  const txt = v => String(v == null ? '' : v).trim();
  const esc = v => txt(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const semAcento = v => txt(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const cab = v => semAcento(v).toUpperCase().replace(/[^A-Z0-9]/g,'');
  const dun = v => txt(v).replace(/[^0-9A-Za-z]/g,'').toUpperCase();
  const endNorm = v => txt(v).toUpperCase().replace(/\s+/g,'').replace(/[^A-Z0-9.\-_/]/g,'');
  const agora = () => new Date().toISOString();
  const usuario = () => window._currentAnalistaUser?.email || localStorage.getItem('dt_analista_email') || 'analista';
  const loja = () => window.DTMultiStore?.getLojaAtual?.()?.id || window.getLojaAtual?.()?.id || localStorage.getItem('dt_loja_atual') || '';
  const docId = (auditoriaId, endereco) => `${auditoriaId}__${endNorm(endereco).replace(/[^A-Z0-9]/g,'_')}`;
  const fmt = v => {
    if (!v) return '—';
    const d = v?.toDate ? v.toDate() : new Date(v);
    return isNaN(d) ? txt(v) : d.toLocaleString('pt-BR');
  };
  const toast = (m,t='i') => typeof window.showToast === 'function' ? window.showToast(m,t) : alert(m);

  function normalizarItem(raw, id){
    const statusRaw = txt(raw.status || 'PENDENTE').toUpperCase();
    const compatStatus = statusRaw === 'VAZIO' ? 'ENDERECO_VAZIO' :
      ['CONFIRMADO_SEM_AJUSTE','APROVADO','CORRETO','CONFERIDO','FINALIZADO'].includes(statusRaw) ? 'OK' :
      ['CONFIRMADO_COM_AJUSTE','ERRO'].includes(statusRaw) ? 'DIVERGENTE' : statusRaw;
    return {
      id,
      auditoriaId: txt(raw.auditoriaId || raw.auditoria_id || auditoriaAtual),
      endereco: txt(raw.endereco || raw.local || raw.posicao),
      dunEsperado: txt(raw.dunEsperado || raw.dun_esperado || raw.dun || raw.codigoProduto || raw.codigo_produto || raw.gtin),
      produtoEsperado: txt(raw.produtoEsperado || raw.produto_esperado || raw.descricaoProdutoEsperado || raw.produto_nome || raw.descricao || raw.produto),
      dunLido: raw.dunLido == null ? txt(raw.dun_lido || raw.produtoEncontrado || raw.produto_encontrado || raw.codigoLido) || null : txt(raw.dunLido) || null,
      produtoLido: raw.produtoLido == null ? (txt(raw.produto_lido || raw.descricaoProdutoLido) || (window.DTProdutos?.buscarSync(raw.dunLido || raw.dun_lido || raw.codigoLido)?.nomeProduto) || null) : txt(raw.produtoLido) || null,
      status: STATUS.includes(compatStatus) ? compatStatus : 'PENDENTE',
      operadorId: txt(raw.operadorId || raw.operador_id || raw.usuario) || null,
      operadorNome: txt(raw.operadorNome || raw.operador_nome || raw.operador || raw.confirmado_por) || null,
      lidoEm: raw.lidoEm || raw.lido_em || raw.dataHora || raw.data_hora || null,
      loja: txt(raw.loja || loja()),
      disponivel_coletor: raw.disponivel_coletor !== false
    };
  }

  function resumo(lista=itensAtuais){
    const r = {total:lista.length, PENDENTE:0, OK:0, DIVERGENTE:0, ENDERECO_VAZIO:0};
    lista.forEach(i => r[i.status]++);
    r.auditados = r.OK + r.DIVERGENTE + r.ENDERECO_VAZIO;
    r.percentual = r.total ? Math.round((r.auditados / r.total) * 100) : 0;
    return r;
  }

  function assinatura(lista){
    return JSON.stringify(lista.map(i => [i.id,i.status,i.dunLido,i.produtoLido,i.operadorNome,i.lidoEm?.seconds || i.lidoEm || '']));
  }

  async function listarMetas(){
    const snap = await DB().collection('dt_auditorias').get();
    return snap.docs.map(d => ({id:d.id,...d.data()})).sort((a,b)=>txt(b.criadoEm||b.importado_em).localeCompare(txt(a.criadoEm||a.importado_em)));
  }

  async function popularSelect(){
    const sel = document.getElementById('aud-op-auditoria');
    if (!sel) return;
    const atual = auditoriaAtual || sel.value;
    const metas = await listarMetas().catch(() => []);
    sel.innerHTML = '<option value="">Selecione uma auditoria...</option>' + metas.map(m => `<option value="${esc(m.id)}">${esc(m.nome || m.auditoria_nome || m.id)}</option>`).join('');
    if (atual && [...sel.options].some(o=>o.value===atual)) sel.value = atual;
  }

  function encerrarListener(){
    if (unsubscribeItens) { try { unsubscribeItens(); } catch(e){} }
    unsubscribeItens = null;
    assinaturaAnterior = '';
  }

  async function selecionarAuditoria(id){
    encerrarListener();
    auditoriaAtual = txt(id);
    itensAtuais = [];
    metaAtual = null;
    renderizar();
    if (!auditoriaAtual) return;
    const ref = DB().collection('dt_auditorias').doc(auditoriaAtual);
    const metaSnap = await ref.get();
    metaAtual = metaSnap.exists ? {id:metaSnap.id,...metaSnap.data()} : null;
    unsubscribeItens = ref.collection('enderecos').onSnapshot(snap => {
      const nova = snap.docs.map(d => normalizarItem(d.data(), d.id));
      const sig = assinatura(nova);
      if (sig === assinaturaAnterior) return;
      assinaturaAnterior = sig;
      itensAtuais = nova;
      renderizar();
      sincronizarResumoMeta().catch(e => console.warn('[AUDITORIA] resumo:',e));
    }, error => {
      console.error('[AUDITORIA] listener:', error);
      toast('Não foi possível acompanhar os resultados da auditoria.','e');
    });
  }

  async function sincronizarResumoMeta(){
    if (!auditoriaAtual) return;
    const r = resumo();
    const statusAtual = txt(metaAtual?.status || 'RASCUNHO').toUpperCase();
    const status = statusAtual === 'FINALIZADA' ? 'FINALIZADA' : (r.auditados ? 'EM_ANDAMENTO' : statusAtual);
    await DB().collection('dt_auditorias').doc(auditoriaAtual).set({
      totalItens:r.total,totalPendentes:r.PENDENTE,totalOk:r.OK,totalDivergentes:r.DIVERGENTE,totalVazios:r.ENDERECO_VAZIO,status,atualizadoEm:agora()
    },{merge:true});
    metaAtual = {...metaAtual,totalItens:r.total,totalPendentes:r.PENDENTE,totalOk:r.OK,totalDivergentes:r.DIVERGENTE,totalVazios:r.ENDERECO_VAZIO,status};
  }

  function filtros(){
    return {
      status:txt(document.getElementById('aud-op-status')?.value).toUpperCase(),
      busca:txt(document.getElementById('aud-op-busca')?.value).toLowerCase(),
      dunEsperado:txt(document.getElementById('aud-f-dun-esperado')?.value).toLowerCase(),
      dunLido:txt(document.getElementById('aud-f-dun-lido')?.value).toLowerCase(),
      operador:txt(document.getElementById('aud-f-operador')?.value).toLowerCase(),
      data:txt(document.getElementById('aud-f-data')?.value)
    };
  }

  function aplicarFiltros(lista){
    const f = filtros();
    return lista.filter(i => {
      if (f.status && i.status !== f.status) return false;
      if (f.dunEsperado && !i.dunEsperado.toLowerCase().includes(f.dunEsperado)) return false;
      if (f.dunLido && !txt(i.dunLido).toLowerCase().includes(f.dunLido)) return false;
      if (f.operador && !txt(i.operadorNome).toLowerCase().includes(f.operador)) return false;
      if (f.data && i.lidoEm) {
        const d = i.lidoEm?.toDate ? i.lidoEm.toDate() : new Date(i.lidoEm);
        if (!isNaN(d) && d.toISOString().slice(0,10) !== f.data) return false;
      } else if (f.data && !i.lidoEm) return false;
      if (f.busca) {
        const hay = [i.endereco,i.dunEsperado,i.produtoEsperado,i.dunLido,i.produtoLido,i.operadorNome,i.status].join(' ').toLowerCase();
        if (!hay.includes(f.busca)) return false;
      }
      return true;
    });
  }

  function rotuloStatus(s){ return ({PENDENTE:'Pendente',OK:'OK',DIVERGENTE:'Divergente',ENDERECO_VAZIO:'Endereço vazio'})[s] || s; }
  function classeStatus(s){ return s==='OK'?'ok':s==='DIVERGENTE'?'err':s==='ENDERECO_VAZIO'?'warn':'pending'; }

  function renderizar(){
    const r = resumo();
    const set = (id,v) => { const e=document.getElementById(id); if(e)e.textContent=v; };
    set('audop-k-total',r.total); set('audop-k-auditados',r.auditados); set('audop-k-pend',r.PENDENTE);
    set('audop-k-ok',r.OK); set('audop-k-div',r.DIVERGENTE); set('audop-k-vaz',r.ENDERECO_VAZIO); set('audop-k-perc',`${r.percentual}%`);
    const tbody = document.getElementById('auditoria-op-tbody');
    if (!tbody) return;
    const lista = aplicarFiltros(itensAtuais);
    tbody.innerHTML = lista.length ? lista.map(i => `<tr>
      <td class="mono">${esc(i.endereco)}</td>
      <td class="mono">${esc(i.dunEsperado)}</td>
      <td>${esc(i.produtoEsperado)}</td>
      <td class="mono">${esc(i.dunLido || '—')}</td>
      <td>${esc(i.produtoLido || '—')}</td>
      <td><span class="badge ${classeStatus(i.status)}">${esc(rotuloStatus(i.status))}</span></td>
      <td>${esc(i.operadorNome || '—')}</td>
      <td>${esc(fmt(i.lidoEm))}</td>
    </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px">Nenhum item encontrado.</td></tr>';
    const resumoFinal = document.getElementById('auditoria-resumo-finalizacao');
    if (resumoFinal) resumoFinal.textContent = `Total ${r.total} · OK ${r.OK} · Divergentes ${r.DIVERGENTE} · Vazios ${r.ENDERECO_VAZIO} · Pendentes ${r.PENDENTE}`;
  }

  function detectarColunas(headers){
    const map = {};
    headers.forEach(h => map[cab(h)] = h);
    const escolher = nomes => nomes.map(cab).find(n => map[n]);
    return {
      endereco: map[escolher(['ENDEREÇO','ENDERECO','LOCAL','POSIÇÃO','POSICAO'])],
      dun: map[escolher(['DUN','CÓDIGO DUN','CODIGO DUN','CÓDIGO DO PRODUTO','CODIGO DO PRODUTO'])],
      produto: map[escolher(['PRODUTO','DESCRIÇÃO','DESCRICAO','NOME DO PRODUTO'])]
    };
  }

  async function lerArquivo(file){
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), {type:'array',raw:false});
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});
  }

  async function processarArquivo(file){
    if (!file) return;
    try {
      const rows = await lerArquivo(file);
      if (!rows.length) throw new Error('O arquivo não possui linhas de dados.');
      const col = detectarColunas(Object.keys(rows[0]));
      const ausentes = [!col.endereco&&'Endereço',!col.dun&&'DUN',!col.produto&&'Produto'].filter(Boolean);
      if (ausentes.length) throw new Error(`Colunas obrigatórias ausentes: ${ausentes.join(', ')}.`);
      const erros=[]; const vistos=new Map(); const validos=[];
      rows.forEach((r,idx) => {
        const linha=idx+2, endereco=txt(r[col.endereco]), dunEsperado=txt(r[col.dun]), produtoEsperado=txt(r[col.produto]);
        const motivos=[];
        if(!endereco) motivos.push('endereço vazio');
        if(endereco && !/[0-9]/.test(endereco)) motivos.push('endereço inválido');
        if(!dunEsperado) motivos.push('DUN vazio');
        if(!produtoEsperado) motivos.push('nome do produto vazio');
        const chave=endNorm(endereco);
        if(chave && vistos.has(chave)) motivos.push(`endereço duplicado (também na linha ${vistos.get(chave)})`);
        else if(chave) vistos.set(chave,linha);
        if(motivos.length) erros.push({linha,endereco:endereco||'—',motivo:motivos.join('; ')});
        else validos.push({endereco,dunEsperado,produtoEsperado});
      });
      importacaoPendente={file,validos,erros};
      const status=document.getElementById('auditoria-import-status');
      const preview=document.getElementById('auditoria-import-preview');
      const actions=document.getElementById('auditoria-import-actions');
      if(status) status.innerHTML = erros.length ? `<div class="alert error"><div>⚠️</div><div><b>Base inválida:</b> ${erros.length} erro(s). Corrija antes de importar.</div></div>` : `<div class="alert success"><div>✅</div><div>${validos.length} linha(s) válidas prontas para importação.</div></div>`;
      if(preview){ preview.style.display=''; preview.innerHTML = erros.length ? `<div class="tbl-wrap"><table><thead><tr><th>Linha</th><th>Endereço</th><th>Motivo</th></tr></thead><tbody>${erros.map(e=>`<tr><td>${e.linha}</td><td>${esc(e.endereco)}</td><td>${esc(e.motivo)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="alert info"><div>📄</div><div>Arquivo: <b>${esc(file.name)}</b><br>Campos reconhecidos: Endereço, DUN e Produto.</div></div>`; }
      if(actions) actions.style.display = erros.length ? 'none' : 'flex';
    } catch(e){ console.error(e); toast(e.message || 'Erro ao ler arquivo.','e'); }
  }

  async function criarNova(){
    const nome=txt(prompt('Nome da nova auditoria:'));
    if(!nome) return;
    const id=`AUD-${Date.now()}`;
    await DB().collection('dt_auditorias').doc(id).set({
      nome,loja:loja(),status:'RASCUNHO',totalItens:0,totalPendentes:0,totalOk:0,totalDivergentes:0,totalVazios:0,criadoEm:agora(),criadoPor:usuario()
    });
    auditoriaAtual=id;
    await popularSelect();
    const sel=document.getElementById('aud-op-auditoria'); if(sel)sel.value=id;
    await selecionarAuditoria(id);
    toast('Auditoria criada. Agora importe a base.','s');
  }

  async function confirmarImportacao(){
    if(!importacaoPendente || importacaoPendente.erros.length) return;
    if(!auditoriaAtual) return toast('Crie ou selecione uma auditoria antes de importar.','w');
    const ref=DB().collection('dt_auditorias').doc(auditoriaAtual);
    const itensRef=ref.collection('enderecos');
    const old=await itensRef.get();
    for(let i=0;i<old.docs.length;i+=350){const b=DB().batch();old.docs.slice(i,i+350).forEach(d=>b.delete(d.ref));await b.commit();}
    const lista=importacaoPendente.validos;
    for(let i=0;i<lista.length;i+=350){
      const b=DB().batch();
      lista.slice(i,i+350).forEach(row=>{
        const id=docId(auditoriaAtual,row.endereco);
        b.set(itensRef.doc(id),{
          auditoriaId:auditoriaAtual,endereco:row.endereco,dunEsperado:row.dunEsperado,produtoEsperado:row.produtoEsperado,
          dunLido:null,produtoLido:null,status:'PENDENTE',operadorId:null,operadorNome:null,lidoEm:null,loja:loja(),disponivel_coletor:false
        });
      });
      await b.commit();
    }
    await ref.set({status:'RASCUNHO',totalItens:lista.length,totalPendentes:lista.length,totalOk:0,totalDivergentes:0,totalVazios:0,arquivo:importacaoPendente.file.name,importadoEm:agora(),importadoPor:usuario()},{merge:true});
    importacaoPendente=null;
    const actions=document.getElementById('auditoria-import-actions'); if(actions)actions.style.display='none';
    toast('Base importada com sucesso. Todos os itens estão PENDENTES.','s');
  }

  async function liberar(){
    if(!auditoriaAtual) return toast('Selecione uma auditoria.','w');
    if(!itensAtuais.length) return toast('Importe uma base válida antes de liberar.','w');
    const ref=DB().collection('dt_auditorias').doc(auditoriaAtual);
    const snap=await ref.collection('enderecos').get();
    for(let i=0;i<snap.docs.length;i+=350){const b=DB().batch();snap.docs.slice(i,i+350).forEach(d=>b.set(d.ref,{disponivel_coletor:true},{merge:true}));await b.commit();}
    await ref.set({status:'LIBERADA',liberada_coletor:true,liberadaEm:agora(),liberadaPor:usuario()},{merge:true});
    metaAtual={...metaAtual,status:'LIBERADA'};
    toast('Auditoria liberada para os coletores.','s');
  }

  async function finalizar(){
    if(!auditoriaAtual) return toast('Selecione uma auditoria.','w');
    const r=resumo();
    if(r.PENDENTE>0) return toast(`Não é possível finalizar. Ainda faltam ${r.PENDENTE} item(ns).`,'w');
    if(!r.total) return toast('A auditoria não possui itens.','w');
    if(!confirm(`Finalizar auditoria?\nTotal: ${r.total}\nOK: ${r.OK}\nDivergentes: ${r.DIVERGENTE}\nVazios: ${r.ENDERECO_VAZIO}`)) return;
    await DB().collection('dt_auditorias').doc(auditoriaAtual).set({status:'FINALIZADA',finalizadaEm:agora(),finalizadaPor:usuario(),liberada_coletor:false},{merge:true});
    metaAtual={...metaAtual,status:'FINALIZADA'};
    toast('Auditoria finalizada.','s');
  }

  function exportar(){
    if(!auditoriaAtual || !itensAtuais.length) return toast('Selecione uma auditoria com dados.','w');
    const rows=aplicarFiltros(itensAtuais).map(i=>({
      Auditoria:metaAtual?.nome||metaAtual?.auditoria_nome||auditoriaAtual,Loja:i.loja||metaAtual?.loja||loja(),Endereço:i.endereco,
      'DUN esperado':i.dunEsperado,'Produto esperado':i.produtoEsperado,'DUN lido':i.dunLido||'','Produto lido':i.produtoLido||'',
      Resultado:rotuloStatus(i.status),Operador:i.operadorNome||'','Data e hora':fmt(i.lidoEm)
    }));
    const ws=XLSX.utils.json_to_sheet(rows), wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Auditoria');
    XLSX.writeFile(wb,`auditoria-${auditoriaAtual}.xlsx`);
  }

  // Sobrescreve apenas as funções públicas da aba Auditoria.
  window.processFileAuditoria=processarArquivo;
  window.confirmarImportAuditoria=confirmarImportacao;
  window.criarNovaAuditoriaStandalone=criarNova;
  window.liberarAuditoriaColetores=liberar;
  window.finalizarAuditoriaOperacional=finalizar;
  window.exportarAuditoriaOperacional=exportar;
  window.renderAuditoriaOperacional=renderizar;

  document.addEventListener('DOMContentLoaded', async () => {
    const sel=document.getElementById('aud-op-auditoria');
    if(sel){ sel.onchange=()=>selecionarAuditoria(sel.value); }
    ['aud-op-status','aud-op-busca','aud-f-dun-esperado','aud-f-dun-lido','aud-f-operador','aud-f-data'].forEach(id=>{
      const e=document.getElementById(id); if(e)e.addEventListener(e.tagName==='SELECT'?'change':'input',renderizar);
    });
    await popularSelect();
    const first=sel?.value || '';
    if(first) await selecionarAuditoria(first); else renderizar();
  });
  window.addEventListener('beforeunload',encerrarListener);
})();
