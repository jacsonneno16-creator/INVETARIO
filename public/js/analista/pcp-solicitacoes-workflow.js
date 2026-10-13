// Workflow compartilhado PCP <-> Compras para alterações em solicitações.
(function(global){'use strict';
  const CREQ='pcp_requisicoes_compra', CAGE='pcp_agendamentos';
  const fs=()=>global.getDTFirestore();
  const n=v=>Number(v)||0;
  const now=()=>new Date().toISOString();
  function ator(){return {uid:global._currentAnalistaUser?.uid||global.firebase?.auth?.().currentUser?.uid||'',email:global._currentAnalistaUser?.email||'',nome:global._currentAnalistaUser?.nome||global._currentAnalistaUser?.displayName||''};}
  function evento(tipo,detalhes={}){const a=ator();return {tipo,data:now(),porUid:a.uid,por:a.email||a.nome||'',...detalhes};}
  function historicoCom(req,ev){const h=Array.isArray(req?.historicoSolicitacao)?req.historicoSolicitacao.slice():[];h.push(ev);return h.slice(-200);}
  async function obter(id){const d=await fs().collection(CREQ).doc(id).get();return d?.exists?{_id:d.id,...d.data()}:null;}
  async function setReq(id,payload){await fs().collection(CREQ).doc(id).set({...payload,atualizadoEm:now()},{merge:true});}
  function totalComprado(req){return Array.isArray(req?.pedidosCompra)&&req.pedidosCompra.length?req.pedidosCompra.reduce((s,p)=>s+n(p.quantidade),0):n(req?.quantidadeComprada);}
  async function cancelarOuSolicitar(id,motivo=''){
    const req=await obter(id);if(!req)throw new Error('Solicitação não encontrada.');
    const comprado=totalComprado(req),a=ator();
    if(comprado<=0){
      await setReq(id,{status:'cancelada',canceladoEm:now(),canceladoPor:a.email||a.nome||'',cancelamentoMotivo:motivo,pcpAlteracaoPendente:null,historicoSolicitacao:historicoCom(req,evento('cancelada_pcp',{motivo}))});
      return {direto:true};
    }
    const pend={tipo:'cancelamento',status:'pendente',motivo,solicitadoEm:now(),solicitadoPor:a.email||a.nome||'',solicitadoPorUid:a.uid};
    await setReq(id,{pcpAlteracaoPendente:pend,historicoSolicitacao:historicoCom(req,evento('cancelamento_solicitado',{motivo}))});
    return {direto:false};
  }
  async function postergarOuSolicitar(id,novaData,motivo=''){
    if(!novaData)throw new Error('Informe a nova data.');
    const req=await obter(id);if(!req)throw new Error('Solicitação não encontrada.');
    const comprado=totalComprado(req),a=ator(),anterior=req.dataNecessaria||'';
    if(comprado<=0){
      await setReq(id,{dataNecessaria:novaData,postergadaEm:now(),postergadaPor:a.email||a.nome||'',postergacaoMotivo:motivo,pcpAlteracaoPendente:null,historicoSolicitacao:historicoCom(req,evento('postergada_pcp',{de:anterior,para:novaData,motivo}))});
      return {direto:true};
    }
    const pend={tipo:'postergacao',status:'pendente',novaData,dataAnterior:anterior,motivo,solicitadoEm:now(),solicitadoPor:a.email||a.nome||'',solicitadoPorUid:a.uid};
    await setReq(id,{pcpAlteracaoPendente:pend,historicoSolicitacao:historicoCom(req,evento('postergacao_solicitada',{de:anterior,para:novaData,motivo}))});
    return {direto:false};
  }
  async function alterarQuantidadeOuSolicitar(id,novaQuantidade,motivo=''){
    novaQuantidade=Math.max(0,n(novaQuantidade));if(!(novaQuantidade>0))throw new Error('Informe uma quantidade válida.');
    const req=await obter(id);if(!req)throw new Error('Solicitação não encontrada.');
    const comprado=totalComprado(req),a=ator(),anterior=n(req.quantidade);
    if(comprado<=0){
      await setReq(id,{quantidade:novaQuantidade,saldoComprar:novaQuantidade,quantidadeAlteradaEm:now(),quantidadeAlteradaPor:a.email||a.nome||'',quantidadeAlteracaoMotivo:motivo,pcpAlteracaoPendente:null,historicoSolicitacao:historicoCom(req,evento('quantidade_alterada_pcp',{de:anterior,para:novaQuantidade,motivo}))});
      return {direto:true};
    }
    if(novaQuantidade<comprado)throw new Error('A nova quantidade não pode ser menor que o total já comprado ('+comprado.toLocaleString('pt-BR')+').');
    const pend={tipo:'quantidade',status:'pendente',novaQuantidade,quantidadeAnterior:anterior,motivo,solicitadoEm:now(),solicitadoPor:a.email||a.nome||'',solicitadoPorUid:a.uid};
    await setReq(id,{pcpAlteracaoPendente:pend,historicoSolicitacao:historicoCom(req,evento('quantidade_alteracao_solicitada',{de:anterior,para:novaQuantidade,motivo}))});
    return {direto:false};
  }
  async function responderAlteracao(id,aceitar,observacao=''){
    const req=await obter(id);if(!req)throw new Error('Solicitação não encontrada.');
    const pend=req.pcpAlteracaoPendente;if(!pend||pend.status!=='pendente')throw new Error('Não existe alteração pendente nesta solicitação.');
    const a=ator(),baseRet={tipo:pend.tipo,aceita:!!aceitar,observacao,respondidoEm:now(),respondidoPor:a.email||a.nome||'',respondidoPorUid:a.uid};
    let payload={pcpAlteracaoPendente:null,pcpUltimoRetornoCompras:baseRet};
    if(!aceitar){payload.historicoSolicitacao=historicoCom(req,evento('alteracao_pcp_recusada',{alteracao:pend.tipo,observacao}));await setReq(id,payload);return {aceita:false,tipo:pend.tipo};}
    if(pend.tipo==='cancelamento'){
      payload={...payload,status:'cancelada',canceladoEm:now(),canceladoPor:a.email||a.nome||'',cancelamentoMotivo:pend.motivo||observacao,historicoSolicitacao:historicoCom(req,evento('cancelamento_confirmado_compras',{observacao}))};
      await setReq(id,payload);
      const snap=await fs().collection(CAGE).where('requisicaoId','==',id).get().catch(()=>({docs:[]}));
      await Promise.all((snap.docs||[]).map(d=>d.ref.set({status:'cancelada',canceladoEm:now(),canceladoPor:a.email||a.nome||'',atualizadoEm:now()},{merge:true})));
    }else if(pend.tipo==='postergacao'){
      payload={...payload,dataNecessaria:pend.novaData,postergadaEm:now(),postergadaPor:a.email||a.nome||'',postergacaoMotivo:pend.motivo||'',historicoSolicitacao:historicoCom(req,evento('postergacao_confirmada_compras',{de:pend.dataAnterior||req.dataNecessaria||'',para:pend.novaData,observacao}))};
      await setReq(id,payload);
      const snap=await fs().collection(CAGE).where('requisicaoId','==',id).get().catch(()=>({docs:[]}));
      await Promise.all((snap.docs||[]).map(d=>d.ref.set({dataPrevista:pend.novaData,atualizadoEm:now()},{merge:true})));
    }else if(pend.tipo==='quantidade'){
      const comprado=totalComprado(req);if(n(pend.novaQuantidade)<comprado)throw new Error('A nova quantidade ficou abaixo do que já foi comprado.');
      payload={...payload,quantidade:n(pend.novaQuantidade),saldoComprar:Math.max(0,n(pend.novaQuantidade)-comprado),quantidadeAlteradaEm:now(),quantidadeAlteradaPor:a.email||a.nome||'',historicoSolicitacao:historicoCom(req,evento('quantidade_alteracao_confirmada_compras',{de:pend.quantidadeAnterior||req.quantidade,para:n(pend.novaQuantidade),observacao}))};
      await setReq(id,payload);
    }
    return {aceita:true,tipo:pend.tipo};
  }
  async function registrarEvento(id,tipo,detalhes={}){const req=await obter(id);if(!req)return;await setReq(id,{historicoSolicitacao:historicoCom(req,evento(tipo,detalhes))});}
  global.DTPCPSolicitacoesWorkflow={obter,totalComprado,cancelarOuSolicitar,postergarOuSolicitar,alterarQuantidadeOuSolicitar,responderAlteracao,registrarEvento};
})(window);
