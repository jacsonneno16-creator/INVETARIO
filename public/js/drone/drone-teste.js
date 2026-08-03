(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const AUTH = getDTAuth();
  const RAW = getDTRawFirestore();
  let stream = null;
  let recorder = null;
  let chunks = [];
  let facingMode = 'environment';
  let detector = null;
  let scanTimer = null;
  let user = null;
  let acesso = null;
  let sessionId = 'cam_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
  const seen = new Map();
  const reads = [];

  function status(msg, type){ const el=$('status'); el.textContent=msg; el.className='status'+(type?' '+type:''); }
  function lojaId(){ return $('lojaSelect').value || ''; }
  function nowText(){ return new Date().toLocaleTimeString('pt-BR'); }

  async function init(){
    try {
      user = await new Promise(resolve=>{
        const off=AUTH.onAuthStateChanged(u=>{off();resolve(u||null);});
        setTimeout(()=>resolve(AUTH.currentUser||null),5000);
      });
      if(!user){ status('Usuário não autenticado. Abra o Coletor, faça login e volte para esta página.','error'); return; }
      const doc=await RAW.collection('usuarios_acessos').doc(user.uid).get();
      acesso=doc.exists?doc.data():null;
      window.DT_USUARIO_ACESSO_ATUAL=acesso;
      if(!acesso){ status('Seu usuário não possui documento em usuarios_acessos.','error'); return; }
      await carregarLojas();
      if('BarcodeDetector' in window){
        let formatos;
        try{ formatos=await BarcodeDetector.getSupportedFormats(); }catch(_){ formatos=undefined; }
        detector=new BarcodeDetector(formatos?{formats:formatos.filter(f=>['qr_code','ean_13','ean_8','code_128','code_39','itf','upc_a','upc_e','data_matrix'].includes(f))}:undefined);
        status('Pronto. Abra a câmera e aponte para QR Code ou código de barras.','ok');
      }else{
        status('Este navegador não possui leitura automática. A gravação funciona e você pode usar o campo de leitura manual.','error');
      }
    }catch(e){ console.error(e); status('Falha ao iniciar: '+e.message,'error'); }
  }

  async function carregarLojas(){
    const lojas=await window.DTLoja.listar(true);
    const s=$('lojaSelect'); s.innerHTML='';
    lojas.forEach(l=>{const o=document.createElement('option');o.value=l.id;o.textContent=l.nome||l.id;s.appendChild(o);});
    const ativa=getDTLojaAtiva();
    if(ativa&&lojas.some(l=>l.id===ativa))s.value=ativa;else if(lojas[0]){s.value=lojas[0].id;setDTLojaAtiva(lojas[0].id);}
    s.onchange=()=>setDTLojaAtiva(s.value);
  }

  async function abrirCamera(){
    try{
      if(stream) stream.getTracks().forEach(t=>t.stop());
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facingMode},width:{ideal:1920},height:{ideal:1080}},audio:true});
      $('camera').srcObject=stream; await $('camera').play();
      $('btnGravar').disabled=false; $('btnTrocar').disabled=false;
      status('Câmera aberta. A leitura automática está ativa.','ok');
      iniciarScanner();
    }catch(e){ console.error(e); status('Não foi possível abrir a câmera: '+e.message,'error'); }
  }

  function iniciarScanner(){
    clearInterval(scanTimer);
    if(!detector)return;
    let busy=false;
    scanTimer=setInterval(async()=>{
      if(busy||!stream||$('camera').readyState<2)return;
      busy=true;
      try{
        const found=await detector.detect($('camera'));
        for(const code of found){ if(code.rawValue) await registrarLeitura(code.rawValue,code.format||'desconhecido'); }
      }catch(e){ if(e.name!=='NotSupportedError') console.debug('[scanner]',e.message); }
      finally{busy=false;}
    },650);
  }

  async function registrarLeitura(codigo, formato){
    codigo=String(codigo||'').trim(); if(!codigo)return;
    const key=formato+'|'+codigo; const last=seen.get(key)||0;
    if(Date.now()-last<5000)return; seen.set(key,Date.now());
    const item={codigo,formato,horario:nowText()}; reads.unshift(item); renderReads();
    if(!user||!lojaId()){status('Leitura local realizada, mas falta autenticação ou loja para enviar.','error');return;}
    try{
      await RAW.collection('lojas').doc(lojaId()).collection('dt_leituras_drone').add({
        codigo:codigo,
        formato:formato,
        fonte:'CAMERA_CELULAR',
        tipo:'TESTE_DRONE',
        loja_id:lojaId(),
        inventario_id:String($('inventarioId').value||'').trim(),
        sessao_id:sessionId,
        sessao_nome:String($('sessaoNome').value||'Teste câmera celular').trim().slice(0,120),
        operador_uid:user.uid,
        operador_email:user.email||'',
        status:'NOVO',
        capturado_em:firebase.firestore.FieldValue.serverTimestamp(),
        criado_em_local:new Date().toISOString()
      });
      status('Leitura enviada: '+codigo,'ok');
      if(navigator.vibrate)navigator.vibrate(100);
    }catch(e){console.error(e);status('Leitura detectada, mas o Firestore recusou: '+e.message,'error');}
  }

  function renderReads(){
    $('totalReads').textContent=String(reads.length);
    $('readList').innerHTML=reads.length?reads.map(x=>`<div class="read"><div><b>${escapeHtml(x.codigo)}</b><div class="muted">${escapeHtml(x.formato)} · ${x.horario}</div></div><span>✓</span></div>`).join(''):'<div class="muted">Nenhuma leitura ainda.</div>';
  }
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  function iniciarGravacao(){
    if(!stream)return;
    chunks=[];
    let mime='';
    for(const m of ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']){if(MediaRecorder.isTypeSupported(m)){mime=m;break;}}
    try{recorder=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);}catch(e){status('Este navegador não conseguiu iniciar a gravação: '+e.message,'error');return;}
    recorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
    recorder.onstop=()=>{
      const blob=new Blob(chunks,{type:recorder.mimeType||'video/webm'}); const url=URL.createObjectURL(blob);
      $('preview').src=url;$('downloadVideo').href=url;$('downloadVideo').download='teste-drone-'+new Date().toISOString().replace(/[:.]/g,'-')+'.webm';$('videoPanel').hidden=false;
    };
    recorder.start(1000);$('btnGravar').disabled=true;$('btnParar').disabled=false;status('Gravando. Aponte para os códigos.','ok');
  }
  function parar(){if(recorder&&recorder.state!=='inactive')recorder.stop();$('btnGravar').disabled=false;$('btnParar').disabled=true;status('Gravação encerrada. O vídeo está disponível abaixo.','ok');}
  async function trocar(){facingMode=facingMode==='environment'?'user':'environment';await abrirCamera();}

  $('btnCamera').onclick=abrirCamera;
  $('btnGravar').onclick=iniciarGravacao;
  $('btnParar').onclick=parar;
  $('btnTrocar').onclick=trocar;
  $('btnManual').onclick=()=>{const v=$('manualCode').value.trim();if(v){registrarLeitura(v,'manual');$('manualCode').value='';}};
  $('manualCode').addEventListener('keydown',e=>{if(e.key==='Enter')$('btnManual').click();});
  window.addEventListener('beforeunload',()=>{clearInterval(scanTimer);if(stream)stream.getTracks().forEach(t=>t.stop());});
  init();
})();
