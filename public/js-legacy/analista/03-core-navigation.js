// ───────────────────────────────────────────────────────────────────
//  4. NAVEGAÇÃO
// ───────────────────────────────────────────────────────────────────
var PAGE_NAMES = {
    dashboard: 'Dashboard',
    inventarios: 'Inventários',
    acompanhamento: 'Acompanhamento',
    contagens: 'Contagens',
    pendencias: 'Pendências',
    divergencias: 'Em Conflito',
    recontagens: 'Rodadas',
    'rel-divergencias': 'Relatório de Conflitos',
    'capas-duplicadas': 'Capas Duplicadas',
    produtividade: 'Produtividade de Operadores',
    enderecos: 'Endereços do Armazém',
    produtos: 'Base de Produtos',
    coletores: 'Coletores / Operadores',
    auditoria: 'Auditoria',
    'importar-exportar': 'Importar / Exportar',
};
var _currentPage = 'dashboard';
function goPage(id, el) {
    document.querySelectorAll('.page').forEach(function (p) { return p.classList.remove('on'); });
    document.querySelectorAll('.nav-item').forEach(function (n) { return n.classList.remove('on'); });
    var pageEl = document.getElementById('page-' + id);
    if (!pageEl) {
        console.warn('Página não encontrada:', id);
        return;
    }
    pageEl.classList.add('on');
    if (el)
        el.classList.add('on');
    document.getElementById('page-title').textContent = PAGE_NAMES[id] || id;
    _currentPage = id;
    renderPage(id);
}
function renderCurrentPage() { renderPage(_currentPage); }
function _callPage(fnName, fallback) {
    var fn = window[fnName];
    if (typeof fn === 'function')
        return fn();
    console.warn('[Navegação] Função ausente:', fnName);
    if (typeof fallback === 'function')
        return fallback();
}
function renderPage(id) {
    var _a;
    try {
        switch (id) {
            case 'dashboard': return _callPage('renderDashboard');
            case 'inventarios': return _callPage('renderInvTable');
            case 'acompanhamento': return _callPage('renderAcompanhamento');
            case 'contagens':
                if (typeof window.getInventariosAtivos === 'function' && getInventariosAtivos().length > 0 && ((_a = window.AnalistaFirebaseService) === null || _a === void 0 ? void 0 : _a.start))
                    window.AnalistaFirebaseService.start();
                return _callPage('renderContagens');
            case 'pendencias': return _callPage('renderPendencias');
            case 'divergencias': return _callPage('renderDivergencias');
            case 'recontagens': return _callPage('renderRecontagens');
            case 'rel-divergencias': return _callPage('renderRelDivergencias');
            case 'capas-duplicadas': return _callPage('renderCapasDuplicadas');
            case 'produtividade': return _callPage('renderProdutividade');
            case 'enderecos': return _callPage('atualizarEnderecos');
            case 'produtos': return _callPage('renderBaseProdutos');
            case 'coletores':
                if (typeof window.inicializarAbaColetores === 'function')
                    window.inicializarAbaColetores();
                return _callPage('renderColetores');
            case 'operadores': return _callPage('listarOperadores');
            case 'auditoria': return _callPage('renderAuditoriaOperacional');
            case 'rastreabilidade': return _callPage('renderRastreabilidade');
            case 'importar-exportar': return _callPage('ieAbrirPagina');
        }
    }
    catch (e) {
        console.error('[Navegação] Falha ao renderizar a página "' + id + '":', e);
        var pageEl = document.getElementById('page-' + id);
        if (pageEl) {
            var msg = String(e && (e.message || e)).replace(/[<>&]/g, '');
            var alert_1 = document.createElement('div');
            alert_1.className = 'empty';
            alert_1.innerHTML = '<div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar esta página</div><div class="empty-sub">' + msg + '</div>';
            pageEl.prepend(alert_1);
        }
    }
}
// ───────────────────────────────────────────────────────────────────
window.AnalistaNavigation = { goPage: goPage, renderCurrentPage: renderCurrentPage, renderPage: renderPage, PAGE_NAMES: PAGE_NAMES };
