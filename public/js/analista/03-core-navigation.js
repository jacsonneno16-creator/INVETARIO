// ───────────────────────────────────────────────────────────────────
//  4. NAVEGAÇÃO
// ───────────────────────────────────────────────────────────────────
const PAGE_NAMES = {
  dashboard:        'Dashboard',
  inventarios:      'Inventários',
  acompanhamento:   'Acompanhamento',
  contagens:        'Contagens',
  pendencias:       'Pendências',
  divergencias:     'Recontagem',
  recontagens:      'Recontagem',
  'rel-divergencias':'Relatório de Conflitos',
  'capas-duplicadas': 'Capas Duplicadas',
  produtividade:    'Produtividade de Operadores',
  enderecos:        'Endereços do Armazém',
  produtos:         'Base de Produtos',
  coletores:        'Coletores / Operadores',
  operadores:       'Usuários',
  lojas:            'Gestão de Lojas',
  auditoria:        'Auditoria',
  rastreabilidade:  'Rastreabilidade',
  'importar-exportar': 'Importar / Exportar',
};

let _currentPage = 'dashboard';

function goPage(id, el) {
  if (typeof window.temPermissao === 'function' && !window.temPermissao(id, 'visualizar')) {
    if (typeof window.showToast === 'function') window.showToast('Você não possui acesso a esta aba.', 'error');
    return;
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('on'));
  const pageEl = document.getElementById('page-' + id);
  if (!pageEl) { console.warn('Página não encontrada:', id); return; }
  pageEl.classList.add('on');
  if (el) el.classList.add('on');

  // Garante que toda página comece no topo real da área de conteúdo.
  // Remove estilos residuais aplicados por versões anteriores e por páginas visitadas antes.
  const contentEl = document.querySelector('.content');
  if (contentEl) {
    contentEl.classList.remove('admin-page-top');
    contentEl.style.display = 'block';
    contentEl.style.paddingTop = '20px';
    contentEl.style.justifyContent = 'flex-start';
    contentEl.style.alignItems = 'stretch';
    contentEl.scrollTop = 0;
  }
  pageEl.style.setProperty('position', 'relative', 'important');
  pageEl.style.setProperty('top', '0', 'important');
  pageEl.style.setProperty('left', '0', 'important');
  pageEl.style.setProperty('right', 'auto', 'important');
  pageEl.style.setProperty('margin', '0', 'important');
  pageEl.style.setProperty('padding-top', '0', 'important');
  pageEl.style.setProperty('transform', 'none', 'important');
  pageEl.style.setProperty('min-height', '0', 'important');
  pageEl.style.setProperty('height', 'auto', 'important');
  pageEl.style.setProperty('justify-content', 'flex-start', 'important');
  pageEl.style.setProperty('align-items', 'stretch', 'important');
  window.scrollTo(0, 0);

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
      case 'divergencias':
      case 'recontagens':        return _callPage('renderDivergencias');
      case 'rel-divergencias':   return _callPage('renderRelDivergencias');
      case 'capas-duplicadas':   return _callPage('renderCapasDuplicadas');
      case 'produtividade':      return _callPage('renderProdutividade');
      case 'enderecos':          return _callPage('atualizarEnderecos');
      case 'produtos':           return _callPage('renderBaseProdutos');
      case 'coletores':
        if (typeof window.inicializarAbaColetores === 'function') window.inicializarAbaColetores();
        return _callPage('renderColetores');
      case 'operadores':         return _callPage('listarOperadores');
      case 'lojas':              return _callPage('renderGestaoLojas');
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
