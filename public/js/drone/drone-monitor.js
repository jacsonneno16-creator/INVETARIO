(function(){
'use strict';
const $=id=>document.getElementById(id),AUTH=getDTAuth(),RAW=getDTRawFirestore();let dados=[],off=null;
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function init(){
 const user=await new Promise(resolve=>{const u=AUTH.onAuthStateChanged(x=>{u();resolve(x||null)});setTimeout(()=>resolve(AUTH.currentUser||null),5000)});
 if(!user){$('tbody').innerHTML='<tr><td colspan="6">Faça login no Analista e abra novamente.</td></tr>';return;}
 const d=await RAW.collection('usuarios_acessos').doc(user.uid).get();window.DT_USUARIO_ACESSO_ATUAL=d.exists?d.data():null;
 const lojas=await DTLoja.listar(true),s=$('lojaSelect');s.innerHTML=lojas.map(l=>`<option value="${esc(l.id)}">${esc(l.nome||l.id)}</option>`).join('');
 const ativa=getDTLojaAtiva();if(ativa&&lojas.some(l=>l.id===ativa))s.value=ativa;else if(lojas[0]){s.value=lojas[0].id;setDTLojaAtiva(s.value)}
 s.onchange=()=>{setDTLojaAtiva(s.value);escutar()};$('filtro').oninput=render;escutar();
}
function escutar(){if(off)off();const loja=$('lojaSelect').value;if(!loja)return;off=RAW.collection('lojas').doc(loja).collection('dt_leituras_drone').orderBy('capturado_em','desc').limit(200).onSnapshot(s=>{dados=s.docs.map(d=>({id:d.id,...d.data()}));render();},e=>{$('tbody').innerHTML=`<tr><td colspan="6">Erro: ${esc(e.message)}</td></tr>`;});}
function dataHora(x){const d=x&&x.toDate?x.toDate():x?new Date(x):null;return d&&!isNaN(d)?d.toLocaleString('pt-BR'):'—';}
function render(){const f=$('filtro').value.trim().toLowerCase();const rows=dados.filter(x=>!f||String(x.codigo||'').toLowerCase().includes(f));$('resumo').textContent=rows.length+' leituras';$('tbody').innerHTML=rows.length?rows.map(x=>`<tr><td>${esc(dataHora(x.capturado_em||x.criado_em_local))}</td><td><b>${esc(x.codigo)}</b></td><td>${esc(x.formato)}</td><td>${esc(x.sessao_nome||x.sessao_id)}</td><td>${esc(x.operador_email||x.operador_uid)}</td><td>${esc(x.inventario_id||'—')}</td></tr>`).join(''):'<tr><td colspan="6">Nenhuma leitura encontrada.</td></tr>';}
init();
})();
