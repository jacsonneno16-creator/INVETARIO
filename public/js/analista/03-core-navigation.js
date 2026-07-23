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
  produtos:         'Base de Produtos',
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

function _callPage(fnName, fallback) {
  const fn = window[fnName];
  if (typeof fn === 'function') return fn();
  console.warn('[Navegação] Função ausente:', fnName);
  if (typeof fallback === 'function') return fallback();
}
function renderPage(id) {
  try {
    switch(id) {
      case 'dashboard':          return _callPage('renderDashboard');
      case 'inventarios':        return _callPage('renderInvTable');
      case 'acompanhamento':     return _callPage('renderAcompanhamento');
      case 'contagens':
        if (typeof window.getInventariosAtivos === 'function' && getInventariosAtivos().length > 0 && window.AnalistaFirebaseService?.start) window.AnalistaFirebaseService.start();
        return _callPage('renderContagens');
      case 'pendencias':         return _callPage('renderPendencias');
      case 'divergencias':       return _callPage('renderDivergencias');
      case 'recontagens':        return _callPage('renderRecontagens');
      case 'rel-divergencias':   return _callPage('renderRelDivergencias');
      case 'capas-duplicadas':   return _callPage('renderCapasDuplicadas');
      case 'produtividade':      return _callPage('renderProdutividade');
      case 'enderecos':          return _callPage('atualizarEnderecos');
      case 'produtos':           return _callPage('renderBaseProdutos');
      case 'coletores':
        if (typeof window.inicializarAbaColetores === 'function') window.inicializarAbaColetores();
        return _callPage('renderColetores');
      case 'operadores':         return _callPage('listarOperadores');
      case 'auditoria':          return _callPage('renderAuditoriaOperacional');
      case 'rastreabilidade':    return _callPage('renderRastreabilidade');
      case 'importar-exportar':  return _callPage('ieAbrirPagina');
    }
  } catch (e) {
    console.error('[Navegação] Falha ao renderizar a página "' + id + '":', e);
    const pageEl = document.getElementById('page-' + id);
    if (pageEl) {
      const msg = String(e && (e.message || e)).replace(/[<>&]/g, '');
      const alert = document.createElement('div');
      alert.className='empty'; alert.innerHTML='<div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar esta página</div><div class="empty-sub">'+msg+'</div>';
      pageEl.prepend(alert);
    }
  }
}

// ───────────────────────────────────────────────────────────────────
window.AnalistaNavigation = { goPage, renderCurrentPage, renderPage, PAGE_NAMES };
