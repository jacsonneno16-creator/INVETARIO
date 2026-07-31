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
  function lojaFecharModalCriar() { global.closeModal?.('loja-modal-bg'); }
  function lojaFecharModalEditar() { global.closeModal?.('loja-edit-modal-bg'); }
  function lojaCriar() {
    const nome = document.getElementById('loja-nome')?.value?.trim();
    const codigo = document.getElementById('loja-codigo')?.value?.trim();
    if (!nome) return global.showToast?.('Informe o nome da loja.', 'error');
    document.getElementById('ml-id').value = '';
    document.getElementById('ml-nome').value = nome;
    document.getElementById('ml-codigo').value = codigo || '';
    document.getElementById('ml-ativa').value = 'true';
    global.salvarLoja?.();
    document.getElementById('loja-modal-bg').style.display = 'none';
  }
  function lojaSalvarEdicao() {
    document.getElementById('ml-id').value = document.getElementById('loja-edit-id')?.value || '';
    document.getElementById('ml-nome').value = document.getElementById('loja-edit-nome')?.value || '';
    document.getElementById('ml-codigo').value = document.getElementById('loja-edit-id')?.value || '';
    global.salvarLoja?.();
    document.getElementById('loja-edit-modal-bg').style.display = 'none';
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
