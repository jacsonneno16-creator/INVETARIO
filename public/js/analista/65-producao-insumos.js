// Setor Produção — Insumos/MRP (paridade funcional V341).
// Mantém as visões Por Máquina e Geral e restaura estoque de insumos,
// saldo projetado, filtros e importação/exportação Excel sincronizados no
// Firestore multi-loja (em vez do localStorage do sistema antigo).
(function (global) {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const COL_MAQUINAS='producao_maquinas', COL_REGISTROS='producao_registros', COL_FICHAS='producao_ficha_tecnica', COL_ESTOQUE='producao_insumos_estoque', COL_ESTOQUE_LEGACY='insumos';
  let _maquinas=[],_registros=[],_fichas=[],_estoque=[],_carregado=false,_modo='maquina',_weekStart=domingo(new Date());
  function fs(){return global.getDTFirestore();}
  function domingo(d){const r=new Date(d);r.setHours(12,0,0,0);r.setDate(r.getDate()-r.getDay());return r;}
  function fmt(d){return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});}
  function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim();}
  function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
  function fichaCod(f){return String(f?.cod??f?.codigo??f?.produtoCod??f?.produto_key??'');}
  function fichaDesc(f){return f?.desc||f?.descricao||f?.produto||f?.nome||'';}
  function insNorm(i){i=i||{};return {insumo:i.insumo||i.nome||i.desc_insumo||i.descricao||'',categoria:i.categoria||i.cat||'Outros',qty:n(i.qty??i.qtd??i.quantidade??i.consumoPorCaixa),unidade:i.unidade||i.un||''};}
  function fichaInsumos(f){return (Array.isArray(f?.insumos)?f.insumos:[]).map(insNorm).filter(i=>i.insumo&&i.qty>0);}

  async function carregarProducaoInsumos(forcar){
    if(_carregado&&!forcar)return;
    const [m,r,f,e,el]=await Promise.all([
      fs().collection(COL_MAQUINAS).get(),fs().collection(COL_REGISTROS).get(),fs().collection(COL_FICHAS).get(),fs().collection(COL_ESTOQUE).get().catch(()=>({docs:[]})),fs().collection(COL_ESTOQUE_LEGACY).get().catch(()=>({docs:[]}))
    ]);
    _maquinas=m.docs.map(d=>({_firestoreId:d.id,...d.data()}));_registros=r.docs.map(d=>({_firestoreId:d.id,...d.data(),data:d.data().data||d.data().dtDesejada||d.data().dtSolicitacao||'',qntCaixas:n(d.data().qntCaixas??d.data().quantidadeCaixas??d.data().quantidade),prodCod:d.data().prodCod??d.data().cod??d.data().produtoCod??''}));_fichas=f.docs.map(d=>({_firestoreId:d.id,...d.data()}));const atual=e.docs.map(d=>({_firestoreId:d.id,...d.data()}));const antigo=el.docs.map(d=>({_firestoreId:d.id,...d.data(),insumo:d.data().insumo||d.data().nome||'',quantidade:n(d.data().quantidade??d.data().estoqueAtual),unidade:d.data().unidade||'',categoria:d.data().categoria||'Outros'}));_estoque=atual.length?atual:antigo;_carregado=true;
  }

  // PEDIDO AO VIVO (comparação com o original achou isso faltando): o
  // original mostra o consumo dia-a-dia (7 colunas), não só o total da
  // semana — cada folha agora carrega {total,porDia:[7]} em vez de um
  // número solto, pra alimentar as colunas diárias na tela.
  function calcularConsumoInsumosSemana(weekStart){
    if(typeof global.buildProducaoSchedule!=='function')return{porMaquina:{},geral:{}};
    const mp={},rp={},fp={};_maquinas.forEach(m=>mp[m.nome]=m);_registros.forEach(r=>rp[r._firestoreId]=r);_fichas.forEach(f=>{const c=fichaCod(f);if(c)fp[c]=f;});
    const resultado=global.buildProducaoSchedule(weekStart,_registros,mp,[]),porMaquina={},geral={};
    const addDia=(obj,cat,ins,di,tot)=>{obj[cat]=obj[cat]||{};obj[cat][ins]=obj[cat][ins]||{total:0,porDia:[0,0,0,0,0,0,0]};obj[cat][ins].total+=tot;obj[cat][ins].porDia[di]+=tot;};
    Object.keys(resultado.porMaquina||{}).forEach(maq=>{
      (resultado.porMaquina[maq].porDia||[]).forEach((dia,di)=>(dia||[]).forEach(seg=>{
        const r=rp[seg.registroId];if(!r)return;const ficha=fp[String(r.prodCod)]||_fichas.find(f=>norm(fichaDesc(f))===norm(r.produto));
        fichaInsumos(ficha).forEach(ins=>{const cat=ins.categoria||'Outros',tot=n(seg.caixasNoDia)*n(ins.qty);if(tot<=0)return;
          porMaquina[maq]=porMaquina[maq]||{};
          addDia(porMaquina[maq],cat,ins.insumo,di,tot);
          addDia(geral,cat,ins.insumo,di,tot);
        });
      }));
    });return{porMaquina,geral};
  }
  // PCP (fase 9) — diferente de calcularConsumoInsumosSemana (que depende
  // do motor de agenda em minutos, pensado pra visão semanal por máquina),
  // esta soma direto por OP num intervalo de datas arbitrário — necessário
  // porque o horizonte do PCP vai até 90 dias, não uma semana. Reaproveita
  // o mesmo mapeamento ficha↔registro (por cod, fallback por nome).
  function calcularNecessidadeInsumosPorOPs(registros,fichas,dataInicio,dataFim){
    const fp={};(fichas||[]).forEach(f=>{const c=fichaCod(f);if(c)fp[c]=f;});
    const porInsumoMap={},porOP=[];
    (registros||[]).filter(r=>r.status!=='concluido'&&r.data>=dataInicio&&r.data<=dataFim).forEach(r=>{
      const ficha=fp[String(r.prodCod)]||(fichas||[]).find(f=>norm(fichaDesc(f))===norm(r.produto||r.descricao));
      const caixasRestantes=Math.max(0,n(r.qntCaixas??r.quantidadeCaixas??r.quantidade)-n(r.realizadoCaixas??r.quantidadeRealizada));
      const insumosOP=fichaInsumos(ficha).map(ins=>{
        const necessidade=caixasRestantes*n(ins.qty);
        if(necessidade>0){
          const chave=ins.insumo;
          porInsumoMap[chave]=porInsumoMap[chave]||{insumo:chave,categoria:ins.categoria||'Outros',necessidade:0};
          porInsumoMap[chave].necessidade+=necessidade;
        }
        return {insumo:ins.insumo,categoria:ins.categoria||'Outros',necessidade};
      }).filter(x=>x.necessidade>0);
      if(insumosOP.length)porOP.push({registroId:r._firestoreId,produto:r.produto,maquina:r.maquina,data:r.data,qntCaixas:caixasRestantes,insumos:insumosOP});
    });
    return {porInsumo:Object.values(porInsumoMap),porOP};
  }
  function estoqueMap(){const m=new Map();_estoque.forEach(e=>m.set(norm(e.insumo||e.nome),e));return m;}
  function linhasGerais(geral){const em=estoqueMap(),out=[];Object.keys(geral).forEach(cat=>Object.keys(geral[cat]).forEach(ins=>{const est=em.get(norm(ins));const item=geral[cat][ins];const consumo=item.total,saldo=n(est?.quantidade)-consumo;out.push({categoria:cat,insumo:ins,consumo,porDia:item.porDia,estoque:n(est?.quantidade),unidade:est?.unidade||'',saldo});}));return out;}

  async function renderProducaoInsumos(){const p=document.getElementById('page-producao-insumos');if(!p)return;p.innerHTML='<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';try{await carregarProducaoInsumos();}catch(e){p.innerHTML='<div class="empty">⚠️ '+esc(e.message||e)+'</div>';return;}_desenhar();}
  function _desenhar(){
    const p=document.getElementById('page-producao-insumos');if(!p)return;const {porMaquina,geral}=calcularConsumoInsumosSemana(_weekStart);const fim=new Date(_weekStart);fim.setDate(fim.getDate()+6);
    const busca=String(document.getElementById('pins-busca')?.value||'').toLowerCase(),catSel=document.getElementById('pins-cat')?.value||'';
    const cats=[...new Set([...Object.keys(geral),..._estoque.map(x=>x.categoria||'Outros')])].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    const lg=linhasGerais(geral).filter(x=>(!busca||x.insumo.toLowerCase().includes(busca)||x.categoria.toLowerCase().includes(busca))&&(!catSel||x.categoria===catSel));
    const diasSemana = Array.from({ length: 7 }, (_, i) => { const d = new Date(_weekStart); d.setDate(d.getDate() + i); return d; });
    const DL = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const theadDias = diasSemana.map(d => `<th style="text-align:right">${DL[d.getDay()]}<br><span style="font-weight:400;color:var(--muted)">${fmt(d)}</span></th>`).join('');
    const tdDias = porDia => porDia.map(v => `<td style="text-align:right;color:${v ? 'inherit' : 'var(--muted)'}">${v ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'}</td>`).join('');
    let rows = '';
    if (_modo === 'geral') {
      // PEDIDO AO VIVO: original agrupa por categoria com uma linha
      // separadora e soma um subtotal quando a categoria tem mais de 1
      // insumo — e arredonda pra cima ("Math.ceil") só na categoria
      // MATERIA PRIMA. Faltava tudo isso, virava uma linha corrida só.
      const porCat = {}; lg.forEach(x => { (porCat[x.categoria] = porCat[x.categoria] || []).push(x); });
      rows = Object.keys(porCat).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(cat => {
        const itens = porCat[cat];
        const ehMateriaPrima = norm(cat) === 'MATERIA PRIMA';
        const linhasCat = itens.map(x => `<tr><td><b>${esc(x.insumo)}</b></td>${tdDias(x.porDia)}<td style="text-align:right;font-weight:600">${(ehMateriaPrima ? Math.ceil(x.consumo) : x.consumo).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td><td style="text-align:right">${x.estoque.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td><td>${esc(x.unidade || '')}</td><td style="text-align:right;font-weight:700;color:${x.saldo < 0 ? 'var(--danger)' : 'var(--green-mid)'}">${x.saldo.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td></tr>`).join('');
        let subtotal = '';
        if (itens.length > 1) {
          const somaDias = [0, 0, 0, 0, 0, 0, 0]; itens.forEach(x => x.porDia.forEach((v, i) => somaDias[i] += v));
          const somaCons = itens.reduce((s, x) => s + x.consumo, 0), somaEst = itens.reduce((s, x) => s + x.estoque, 0), somaSaldo = itens.reduce((s, x) => s + x.saldo, 0);
          subtotal = `<tr style="background:var(--surface-2);font-weight:700"><td>Subtotal ${esc(cat)}</td>${tdDias(somaDias)}<td style="text-align:right">${somaCons.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td><td style="text-align:right">${somaEst.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td><td></td><td style="text-align:right;color:${somaSaldo < 0 ? 'var(--danger)' : 'inherit'}">${somaSaldo.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td></tr>`;
        }
        return `<tr><td colspan="12" style="background:var(--surface-2);font-weight:700;color:var(--muted);text-transform:uppercase;font-size:.68rem">${esc(cat)}</td></tr>${linhasCat}${subtotal}`;
      }).join('');
    } else {
      Object.keys(porMaquina).sort().forEach(maq => {
        Object.keys(porMaquina[maq]).sort().forEach(cat => {
          Object.keys(porMaquina[maq][cat]).sort().forEach(ins => {
            if (busca && !ins.toLowerCase().includes(busca) && !cat.toLowerCase().includes(busca) && !maq.toLowerCase().includes(busca)) return;
            if (catSel && cat !== catSel) return;
            const item = porMaquina[maq][cat][ins];
            const est = estoqueMap().get(norm(ins));
            const consumo = item.total, saldo = n(est?.quantidade) - consumo;
            rows += `<tr><td>${esc(maq)}</td><td>${esc(cat)}</td><td><b>${esc(ins)}</b></td>${tdDias(item.porDia)}<td style="text-align:right;font-weight:700">${consumo.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td><td>${esc(est?.unidade || '')}</td><td style="text-align:right">${n(est?.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td><td style="text-align:right;color:${saldo < 0 ? 'var(--danger)' : 'inherit'}">${saldo.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td></tr>`;
          });
        });
      });
    }
    // PEDIDO AO VIVO (auditoria RELATORIO-COMPARACAO-PRODUCAO.md, item 8):
    // o original (index.html:393-417) NÃO tem cards de KPI nessa tela —
    // só navegação de semana (‹ Ant./label/Próx./Hoje) à esquerda e
    // data-goto + categoria + Excel/PDF à direita, igual ao padrão do
    // Realizado/Gantt. Removidos os 4 cards que eu tinha adicionado sem
    // corresponder a nada no original.
    p.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" data-pins-semana="-1">‹ Ant.</button>
        <div class="field" style="padding:8px 16px;color:var(--orange);font-weight:600">${fmt(_weekStart)} a ${fmt(fim)}</div>
        <button class="btn btn-ghost btn-sm" data-pins-semana="1">Próx. ›</button>
        <button class="btn btn-ghost btn-sm" data-pins-hoje="1">Hoje</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <input type="date" class="field" data-pins-data value="${_weekStart.toISOString().slice(0,10)}" title="Ir para data" style="width:145px;padding:5px 8px">
        <select id="pins-cat" class="field"><option value="">Todas as categorias</option>${cats.map(c=>`<option value="${esc(c)}" ${catSel===c?'selected':''}>${esc(c)}</option>`).join('')}</select>
        <button class="btn btn-ghost btn-sm" data-pins-export="1">📊 Excel</button>
        <button class="btn btn-ghost btn-sm" data-pins-pdf="1">📄 PDF</button>
      </div>
    </div>
    <div class="tc" style="padding:8px 10px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <input id="pins-busca" class="field" placeholder="Buscar insumo, categoria ou máquina..." value="${esc(busca)}" style="min-width:220px;flex:1">
      <label class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0;color:var(--muted)" title="Recurso extra desta integração — colunas: Insumo | Quantidade | Unidade | Categoria">📥 Estoque Excel<input id="pins-est-input" type="file" accept=".xlsx,.xls,.csv" style="display:none"></label>
    </div>
    ${rows?`<div class="tc"><div style="overflow:auto"><table class="dt-table" style="font-size:.74rem"><thead><tr>${_modo==='maquina'?'<th>Máquina</th><th>Categoria</th><th>Insumo</th>':'<th>Insumo</th>'}${theadDias}<th style="text-align:right">Total Sem.</th>${_modo==='maquina'?'<th>Un.</th>':''}<th style="text-align:right">Estoque</th>${_modo==='geral'?'<th>Un.</th>':''}<th style="text-align:right">Saldo</th></tr></thead><tbody>${rows}</tbody></table></div></div>`:`<div class="empty"><div class="empty-icon">🧪</div><div class="empty-title">Nenhum consumo encontrado para o período/filtro.</div></div>`}`;
  }

  async function importarEstoque(file){if(!file)return;if(!global.XLSX){global.showToast?.('Biblioteca Excel não carregada.','error');return;}try{const b=await file.arrayBuffer(),wb=global.XLSX.read(b,{type:'array'}),rows=global.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});let c=0,u=0;const agora=new Date().toISOString();for(const r of rows){const ins=String(r.Insumo??r.insumo??r.Nome??r.nome??'').trim();if(!ins)continue;const payload={insumo:ins,quantidade:n(r.Quantidade??r.quantidade??r.Estoque??r.estoque),unidade:String(r.Unidade??r.unidade??''),categoria:String(r.Categoria??r.categoria??'Outros'),atualizadoEm:agora};const ex=_estoque.find(x=>norm(x.insumo)===norm(ins));if(ex){await fs().collection(COL_ESTOQUE).doc(ex._firestoreId).set(payload,{merge:true});u++;}else{await fs().collection(COL_ESTOQUE).add({...payload,criadoEm:agora});c++;}}await carregarProducaoInsumos(true);_desenhar();global.showToast?.(`${c} criado(s), ${u} atualizado(s) no estoque de insumos.`,'success');}catch(e){global.showToast?.('Erro ao importar estoque de insumos: '+(e.message||e),'error');}}
  function exportar(){if(!global.XLSX){global.showToast?.('Biblioteca Excel não carregada.','error');return;}const {porMaquina,geral}=calcularConsumoInsumosSemana(_weekStart),linhas=linhasGerais(geral).map(x=>({Categoria:x.categoria,Insumo:x.insumo,Consumo:x.consumo,Estoque:x.estoque,Unidade:x.unidade,Saldo:x.saldo})),maq=[];Object.keys(porMaquina).forEach(m=>Object.keys(porMaquina[m]).forEach(c=>Object.keys(porMaquina[m][c]).forEach(i=>maq.push({Maquina:m,Categoria:c,Insumo:i,Consumo:porMaquina[m][c][i].total}))));const wb=global.XLSX.utils.book_new();global.XLSX.utils.book_append_sheet(wb,global.XLSX.utils.json_to_sheet(linhas),'Saldo_Geral');global.XLSX.utils.book_append_sheet(wb,global.XLSX.utils.json_to_sheet(maq),'Por_Maquina');global.XLSX.utils.book_append_sheet(wb,global.XLSX.utils.json_to_sheet(_estoque.map(e=>({Insumo:e.insumo,Quantidade:e.quantidade,Unidade:e.unidade||'',Categoria:e.categoria||''}))),'Estoque');global.XLSX.writeFile(wb,'insumos_mrp_'+_weekStart.toISOString().slice(0,10)+'.xlsx');}
  function pinsModo(m){_modo=m;_desenhar();}function pinsSemana(d){_weekStart.setDate(_weekStart.getDate()+d*7);_desenhar();}function pinsHoje(){_weekStart=domingo(new Date());_desenhar();}function pinsGoDate(v){if(!v)return;const d=new Date(v+'T12:00:00');if(Number.isNaN(d.getTime()))return;_weekStart=domingo(d);_desenhar();}
  global.renderProducaoInsumos=renderProducaoInsumos;global.carregarProducaoInsumos=carregarProducaoInsumos;global.calcularConsumoInsumosSemana=calcularConsumoInsumosSemana;global.calcularNecessidadeInsumosPorOPs=calcularNecessidadeInsumosPorOPs;global.importarEstoqueInsumosProducao=importarEstoque;global.exportarSaldoInsumosProducao=exportar;global._producaoInsumosInternals={getEstoque:()=>_estoque,getRegistros:()=>_registros,getFichas:()=>_fichas};
// PEDIDO AO VIVO (usuário: a original tem "Insumos / Máq." e "Insumos Geral"
// como DUAS abas separadas na barra principal — aqui é uma página só com
// modo interno). Expor pinsModo pra um segundo item de menu poder pré-
// selecionar o modo 'geral' antes de abrir a mesma página.
global.pinsModo=pinsModo;
  document.addEventListener('click',e=>{const m=e.target.closest('[data-pins-modo]');if(m)return pinsModo(m.dataset.pinsModo);const s=e.target.closest('[data-pins-semana]');if(s)return pinsSemana(Number(s.dataset.pinsSemana));if(e.target.closest('[data-pins-hoje]'))return pinsHoje();if(e.target.closest('[data-pins-export]'))return exportar();if(e.target.closest('[data-pins-pdf]'))return global.exportarElementoProducaoPDF?.('page-producao-insumos','insumos_mrp.pdf');});
  document.addEventListener('change',e=>{if(e.target.matches('[data-pins-data]'))pinsGoDate(e.target.value);});
  document.addEventListener('input',e=>{if(e.target?.id==='pins-busca')_desenhar();});document.addEventListener('change',e=>{if(e.target?.id==='pins-cat')_desenhar();if(e.target?.id==='pins-est-input'){importarEstoque(e.target.files?.[0]);e.target.value='';}});
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _maquinas=[]; _registros=[]; _fichas=[]; _estoque=[]; });
})(window);
