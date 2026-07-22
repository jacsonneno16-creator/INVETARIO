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
  try {
    switch(id) {
      case 'dashboard':         renderDashboard();        break;
      case 'inventarios':       renderInvTable();          break;
      case 'acompanhamento':    renderAcompanhamento();    break;
      case 'contagens':
        if (getInventariosAtivos().length > 0 && window.AnalistaFirebaseService?.start) {
          window.AnalistaFirebaseService.start();
        }
        renderContagens();
        break;
      case 'pendencias':        renderPendencias();        break;
      case 'divergencias':      renderDivergencias();      break;
      case 'recontagens':       renderRecontagens();       break;
      case 'rel-divergencias':  renderRelDivergencias();   break;
      case 'capas-duplicadas':  renderCapasDuplicadas();   break;
      case 'produtividade':     renderProdutividade();     break;
      case 'enderecos':         atualizarEnderecos();      break;
      case 'coletores':         renderColetores();         break;
      case 'operadores':        listarOperadores(); opVerificarMinhaConta(); opCarregarOperadoresParaFiltro(); break;
      case 'auditoria':         renderAuditoriaOperacional();  break;
      case 'rastreabilidade':   renderRastreabilidade();       break;
      case 'importar-exportar': ieAbrirPagina();           break;
    }
  } catch (e) {
    console.error('[Navegação] Falha ao renderizar a página "' + id + '":', e);
    const pageEl = document.getElementById('page-' + id);
    if (pageEl) {
      pageEl.innerHTML = '<div class="empty"><div class="empty-icon">🚧</div>'
        + '<div class="empty-title">Esta página ainda não foi implementada</div>'
        + '<div class="empty-sub">Detalhe técnico: ' + (e.message || e) + '</div></div>';
    }
  }
}

// ───────────────────────────────────────────────────────────────────
window.AnalistaNavigation = { goPage, renderCurrentPage, renderPage, PAGE_NAMES };
