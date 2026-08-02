(function (global) {
  'use strict';

  const esc = value => global.DTUtils?.escapeHTML
    ? global.DTUtils.escapeHTML(value)
    : String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      })[char]);
  const debounceTimers = new Map();
  function _debounce(key, callback, delay) {
    const timerKey = String(key || 'default');
    clearTimeout(debounceTimers.get(timerKey));
    debounceTimers.set(timerKey, setTimeout(() => {
      debounceTimers.delete(timerKey);
      if (typeof callback === 'function') callback();
    }, Number(delay) || 180));
  }

  function baixarTabela(linhas, nome, aba) {
    if (!Array.isArray(linhas) || !linhas.length) {
      global.showToast?.('Nenhum registro disponível para exportar.', 'warning');
      return;
    }
    const seguro = value => /^[=+\-@]/.test(String(value ?? '')) ? "'" + value : value;
    const dados = linhas.map(row => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, seguro(value)])
    ));
    if (global.XLSX?.utils?.json_to_sheet && global.XLSX?.writeFile) {
      const worksheet = XLSX.utils.json_to_sheet(dados);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, aba || 'Dados');
      XLSX.writeFile(workbook, nome);
      return;
    }
    const colunas = Object.keys(dados[0]);
    const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = '\uFEFF' + [colunas, ...dados.map(row => colunas.map(key => row[key]))]
      .map(row => row.map(csvCell).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = nome.replace(/\.xlsx$/i, '.csv');
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportarPendencias() {
    const linhas = (global.__pendenciasVisiveis || []).map(item => ({
      Inventário: item.inventario || '',
      Endereço: item.endereco || '',
      Produto: item.produto || '',
      Quantidade: item.quantidade ?? '',
      Local: item.local || '',
      Rua: item.rua || '',
      Status: item.status || ''
    }));
    baixarTabela(linhas, `pendencias-${new Date().toISOString().slice(0,10)}.xlsx`, 'Pendências');
  }

  function filtrarInvLoja(value) {
    global.__filtroInventarioLoja = String(value || '');
    global.renderInvTable?.();
  }

  function exportSetFormato(formato) {
    const value = formato === 'csv' ? 'csv' : 'xlsx';
    document.querySelectorAll('input[name="export-fmt"]').forEach(input => {
      input.checked = input.value === value;
    });
    ['xlsx', 'csv'].forEach(item => {
      const label = document.getElementById(`fmt-${item}-label`);
      if (!label) return;
      const active = item === value;
      label.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
      label.style.background = active ? 'rgba(0,229,255,.06)' : 'transparent';
    });
  }

  function executarExportacaoBluesoft() {
    if (typeof global.exportarContagens === 'function') global.exportarContagens();
    global.closeModal?.('modal-validar-exportacao');
  }

  let filtroRua = 'todos';
  function filtrarModalRua(filtro) {
    filtroRua = ['todos', 'pend', 'cont', 'rec'].includes(filtro) ? filtro : 'todos';
    document.querySelectorAll('[id^="mr-btn-"]').forEach(button => {
      button.classList.toggle('btn-ghost', button.id !== `mr-btn-${filtroRua}`);
    });
    document.querySelectorAll('#modal-rua-content [data-status-rua]').forEach(row => {
      row.hidden = filtroRua !== 'todos' && row.dataset.statusRua !== filtroRua;
    });
  }

  function lojaAbrirModalCriar() { global.abrirCadastroLoja?.(); }
  function lojaFecharModalCriar() { const m=document.getElementById('loja-modal-bg'); if(m)m.style.display='none'; }
  function lojaFecharModalEditar() { const m=document.getElementById('loja-edit-modal-bg'); if(m)m.style.display='none'; }
  async function lojaCriar() {
    const nome=document.getElementById('loja-nome')?.value?.trim(), codigo=document.getElementById('loja-codigo')?.value?.trim().toUpperCase();
    const feedback=document.getElementById('loja-modal-feedback'), btn=document.getElementById('btn-criar-loja');
    if(!nome||!codigo)return global.showToast?.('Informe o código e o nome da loja.','error');
    try{
      if(btn){btn.disabled=true;btn.textContent='⏳ Criando...';}
      const id=global.DTLoja?.slug?global.DTLoja.slug(codigo):codigo.toLowerCase().replace(/[^a-z0-9]+/g,'_');
      await global.getDTRawFirestore().collection('lojas').doc(id).set({id,nome,codigo,ativa:true,responsavel:document.getElementById('loja-responsavel')?.value?.trim()||'',observacao:document.getElementById('loja-obs')?.value?.trim()||'',criada_em:new Date().toISOString(),atualizada_em:new Date().toISOString()},{merge:true});
      lojaFecharModalCriar(); global.showToast?.('Loja criada com sucesso.','success'); await global.renderGestaoLojas?.();
    }catch(e){if(feedback){feedback.style.display='block';feedback.innerHTML='<div class="alert danger">'+String(e.message||e)+'</div>';}global.showToast?.('Erro ao criar loja: '+(e.message||e),'error');}
    finally{if(btn){btn.disabled=false;btn.textContent='🏪 Criar Loja';}}
  }
  async function lojaSalvarEdicao() {
    const id=document.getElementById('loja-edit-id')?.value, nome=document.getElementById('loja-edit-nome')?.value?.trim();
    if(!id||!nome)return global.showToast?.('Loja inválida ou nome não informado.','error');
    try{
      await global.getDTRawFirestore().collection('lojas').doc(id).set({nome,responsavel:document.getElementById('loja-edit-responsavel')?.value?.trim()||'',observacao:document.getElementById('loja-edit-obs')?.value?.trim()||'',atualizada_em:new Date().toISOString()},{merge:true});
      lojaFecharModalEditar();global.showToast?.('Loja atualizada.','success');await global.renderGestaoLojas?.();
    }catch(e){global.showToast?.('Erro ao atualizar loja: '+(e.message||e),'error');}
  }
  function lojaFiltrarEnderecos() {
    const busca = String(document.getElementById('loja-end-busca')?.value || '').toLowerCase();
    const setor = String(document.getElementById('loja-end-filtro-setor')?.value || '');
    document.querySelectorAll('#loja-enderecos-wrap [data-endereco]').forEach(row => {
      row.hidden = !(row.textContent.toLowerCase().includes(busca) &&
        (!setor || row.dataset.setor === setor));
    });
  }

  Object.assign(global, {
    exportarPendencias, filtrarInvLoja, exportSetFormato,
    executarExportacaoBluesoft, filtrarModalRua,
    lojaAbrirModalCriar, lojaFecharModalCriar, lojaFecharModalEditar,
    lojaCriar, lojaSalvarEdicao, lojaFiltrarEnderecos,
    _debounce, DTBaixarTabelaSegura: baixarTabela, DTEscapeHTML: esc
  });
})(window);
