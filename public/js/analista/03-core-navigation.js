// ───────────────────────────────────────────────────────────────────
//  4. NAVEGAÇÃO
// ───────────────────────────────────────────────────────────────────
const PAGE_NAMES = {
  dashboard:        'Dashboard',
  inventarios:      'Inventários',
  acompanhamento:   'Acompanhamento',
  contagens:        'Contagens',
  pendencias:       'Pendências',
  divergencias:     'Em Conflito',
  recontagens:      'Rodadas',
  'rel-divergencias':'Relatório de Conflitos',
  'capas-duplicadas': 'Capas Duplicadas',
  produtividade:    'Produtividade de Operadores',
  enderecos:        'Endereços do Armazém',
  coletores:        'Coletores / Operadores',
  auditoria:        'Auditoria',
  'importar-exportar': 'Importar / Exportar',
};

let _currentPage = 'dashboard';

function goPage(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('on'));
  const pageEl = document.getElementById('page-' + id);
  if (!pageEl) { console.warn('Página não encontrada:', id); return; }
  pageEl.classList.add('on');
  if (el) el.classList.add('on');
  document.getElementById('page-title').textContent = PAGE_NAMES[id] || id;
  _currentPage = id;
  renderPage(id);
}

function renderCurrentPage() { renderPage(_currentPage); }

function renderPage(id) {
  const call = (name, ...args) => {
    const fn = window[name];
    if (typeof fn === 'function') return fn(...args);
    console.warn('[Navegação] Função indisponível:', name);
    const page = document.getElementById('page-' + id);
    if (page && !page.querySelector('.module-warning')) {
      page.insertAdjacentHTML('afterbegin','<div class="module-warning" style="margin:12px;padding:10px;border:1px solid #f59e0b;background:#fffbeb;border-radius:8px;color:#92400e">Módulo ainda não carregado: '+name+'</div>');
    }
  };
  switch(id) {
    case 'dashboard': call('renderDashboard'); break;
    case 'inventarios': call('renderInvTable'); break;
    case 'acompanhamento': call('renderAcompanhamento'); break;
    case 'contagens':
      if (typeof window.getInventariosAtivos==='function' && window.getInventariosAtivos().length > 0) window.AnalistaFirebaseService?.start?.();
      call('renderContagens'); break;
    case 'pendencias': call('renderPendencias'); break;
    case 'divergencias': call('renderDivergencias'); break;
    case 'recontagens': call('renderRecontagens'); break;
    case 'rel-divergencias': call('renderRelDivergencias'); break;
    case 'capas-duplicadas': call('renderCapasDuplicadas'); break;
    case 'produtividade': call('renderProdutividade'); break;
    case 'enderecos': call('atualizarEnderecos'); break;
    case 'coletores':
      window.AnalistaFirebaseService?.start?.().finally(()=>call('renderColetores'));
      break;
    case 'operadores': call('listarOperadores'); call('opVerificarMinhaConta'); call('opCarregarOperadoresParaFiltro'); break;
    case 'auditoria': call('renderAuditoriaOperacional'); break;
    case 'rastreabilidade': call('renderRastreabilidade'); break;
    case 'importar-exportar': call('ieAbrirPagina'); break;
  }
}

// ───────────────────────────────────────────────────────────────────
window.AnalistaNavigation = { goPage, renderCurrentPage, renderPage, PAGE_NAMES };
