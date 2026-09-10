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
  auditoria:        'Auditoria',
  'importar-exportar': 'Importar / Exportar',
  'producao-dashboard': 'Dashboard (Produção)',
  'producao-ficha-tecnica': 'Ficha Técnica (Produção)',
  'producao-maquinas': 'Máquinas (Produção)',
  'producao-programacao': 'Programação (Produção)',
  'producao-gantt': 'Gantt (Produção)',
  'producao-realizado': 'Realizado (Produção)',
  'producao-insumos': 'Insumos (Produção)',
  'producao-projecao': 'Projeção de Vendas (Produção)',
  'producao-prog-automatica': 'Programação Automática (Produção)',
  'producao-funcionarios': 'Funcionários (Produção)',
  'producao-relatorios': 'Relatórios (Produção)',
  'producao-setup': 'Tempos de Setup (Produção)',
  'producao-mapa-fabrica': 'Mapa da Fábrica (Produção)',
  'producao-config': 'Configurações (Produção)',
  'producao-importacao': 'Importação / API (Produção)',
  'producao-estoque': 'Estoque (Produção)',
  'pcp-central': 'Central de Planejamento (PCP)',
  'compras-central': 'Central de Compras',
  'recebimento-dashboard': 'Recebimento · Dashboard',
  'recebimento-operacao': 'Recebimento · Recebimentos',
  'recebimento-notas': 'Recebimento · Notas Fiscais',
  'recebimento-fornecedores': 'Recebimento · Fornecedores',
  'recebimento-agendamentos': 'Recebimento · Agenda / Cargas',
  'recebimento-transbordo': 'Recebimento · Transbordo',
  'recebimento-cargas':     'Recebimento · Cargas (Montagem/Expedição)',
  'recebimento-paletes':    'Recebimento · Paletes',
  'recebimento-recusas': 'Recebimento · Recusas',
  'recebimento-recusas-cadastros': 'Recebimento · Notas Retornadas · Cadastros',
  'recebimento-tempos': 'Recebimento · Tempos / Performance',
  'recebimento-historico': 'Recebimento · Histórico',
  'recebimento-config': 'Recebimento · Configurações',
};

let _currentPage = 'dashboard';
let _renderPageSeq = 0;

// BUG AO VIVO REAL (2026-09-09): "nenhuma tela do sistema todo não mostra
// nada" — várias telas ficavam presas em "Carregando..." pra sempre quando
// a busca no Firestore rejeitava sem nenhum tratamento. Aviso genérico
// aqui, no ponto único por onde toda tela passa (_callPage), pega qualquer
// tela sem proteção própria. NÃO usa timeout artificial (ver histórico:
// chegou a usar um por um tempo) — Promise.race com timeout não cancela a
// busca real, só desiste de esperar; numa consulta grande que só demora
// (não trava de verdade), isso transformava "só lento" em "sempre falha".
// Só reage a REJEIÇÃO real do Firestore agora.
function _mostrarFalhaCarregamento(id, erro) {
  if (_currentPage !== id) return;
  const pageEl = document.getElementById('page-' + id);
  if (!pageEl || !pageEl.classList.contains('on')) return;
  const msg = String(erro && (erro.message || erro) || 'Falha desconhecida').replace(/[<>&]/g, '');
  pageEl.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Não foi possível carregar esta tela</div><div class="empty-sub">' + msg + '</div><button type="button" class="btn btn-primary btn-sm" data-recarregar-pagina="' + id + '" style="margin-top:12px">Tentar novamente</button></div>';
}

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
  const paginaDaChamada = _currentPage;
  const seq = ++_renderPageSeq;
  let resultado;
  if (typeof fn === 'function') resultado = fn();
  else {
    console.warn('[Navegação] Função ausente:', fnName);
    if (typeof fallback === 'function') resultado = fallback();
  }
  // O try/catch de renderPage só captura falhas SÍNCRONAS. A maioria das
  // telas retorna uma Promise; sem isto, uma REJEIÇÃO real do Firestore
  // (permission-denied, etc.) numa tela sem proteção própria não aparecia
  // pra ninguém — ficava só no console. Sem timeout artificial: consultas
  // grandes podem legitimamente levar mais tempo e ainda terminar bem;
  // Promise.race com timeout não cancela a busca real, só desiste de
  // esperar, então só reage a rejeição de verdade. Uma tela que já cuida
  // do próprio carregamento/erro (ex.: Recebimentos/93) marca a Promise
  // que devolve com `.__dtBackground = true` pra este aviso genérico não
  // cobrir por cima o aviso específico dela.
  if (resultado && typeof resultado.then === 'function' && resultado.__dtBackground !== true) {
    resultado.catch(erro => {
      if (seq !== _renderPageSeq || paginaDaChamada !== _currentPage) return;
      console.error('[Navegação] Falha assíncrona ao carregar "' + paginaDaChamada + '":', erro);
      _mostrarFalhaCarregamento(paginaDaChamada, erro);
    });
  }
  return resultado;
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
      case 'producao-dashboard':     return _callPage('renderProducaoDashboard');
      case 'producao-ficha-tecnica': return _callPage('renderProducaoFichaTecnica');
      case 'producao-maquinas':      return _callPage('renderProducaoMaquinas');
      case 'producao-programacao':   return _callPage('renderProducaoProgramacao');
      case 'producao-gantt':         return _callPage('renderProducaoGantt');
      case 'producao-realizado':     return _callPage('renderProducaoRealizado');
      case 'producao-insumos':       return _callPage('renderProducaoInsumos');
      case 'producao-projecao':      return _callPage('renderProducaoProjecao');
      case 'producao-prog-automatica': return _callPage('renderProducaoProgAutomatica');
      case 'producao-funcionarios':  return _callPage('renderProducaoFuncionarios');
      case 'producao-relatorios':    return _callPage('renderProducaoRelatorios');
      case 'producao-setup':         return _callPage('renderProducaoSetup');
      case 'producao-mapa-fabrica':  return _callPage('renderProducaoMapaFabrica');
      case 'producao-config':        return _callPage('renderProducaoConfig');
      case 'producao-importacao':    return _callPage('renderProducaoImportacao');
      case 'producao-estoque':       return _callPage('renderProducaoEstoque');
      case 'producao-relatorios-bi': return _callPage('renderRelatoriosBi');
      case 'pcp-central':            return _callPage('renderPCPCentral');
      case 'compras-central':        return _callPage('renderComprasCentral');
      case 'recebimento-dashboard':      return _callPage('renderRecebimentoDashboard');
      case 'recebimento-operacao':       return _callPage('renderRecebimentoOperacao');
      case 'recebimento-notas':          return _callPage('renderRecebimentoNotas');
      case 'recebimento-fornecedores':   return _callPage('renderRecebimentoFornecedores');
      case 'recebimento-agendamentos':   return _callPage('renderRecebimentoAgendamentos');
      case 'recebimento-transbordo':     return _callPage('renderRecebimentoTransbordo');
      case 'recebimento-cargas':         return _callPage('renderRecebimentoCargas');
      case 'recebimento-paletes':        return _callPage('renderRecebimentoPaletes');
      case 'recebimento-recusas':        return _callPage('renderRecebimentoRecusas');
      case 'recebimento-recusas-cadastros': return _callPage('renderRecebimentoRecusasCadastros');
      case 'recebimento-retornos-indicadores': return _callPage('renderRecebimentoRetornosIndicadores');
      case 'recebimento-retornos-status': return _callPage('renderRecebimentoRetornosStatus');
      case 'recebimento-recusas-indicadores': return _callPage('renderRecusasIndicadores');
      case 'recebimento-consulta-notas': return _callPage('renderConsultaNotasFiscais');
      case 'recebimento-devolucoes-indicadores': return _callPage('renderDevolucoesBiIndicadores');
      case 'recebimento-tempos':         return _callPage('renderRecebimentoTempos');
      case 'recebimento-historico':      return _callPage('renderRecebimentoHistorico');
      case 'recebimento-config':         return _callPage('renderRecebimentoConfig');
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

document.addEventListener('click', function (evento) {
  const botao = evento.target.closest && evento.target.closest('[data-recarregar-pagina]');
  if (!botao) return;
  const id = botao.getAttribute('data-recarregar-pagina');
  if (id && id === _currentPage) renderPage(id);
});

// ───────────────────────────────────────────────────────────────────
window.AnalistaNavigation = { goPage, renderCurrentPage, renderPage, PAGE_NAMES };
