// Setor Produção — Estoque via Bluesoft (fase 3f da unificação com o
// Sistema de Produção). A original tinha SUA PRÓPRIA configuração Bluesoft
// (token/URL num projeto Firebase separado, "programacao-producao"). Aqui
// não duplicamos nada disso: reaproveitamos a MESMA configuração
// (`dt_config/integracao_api`), a MESMA Cloud Function de proxy
// (`bluesoftProxy`, já existente neste projeto) e o MESMO vínculo
// loja→Bluesoft (`bluesoft_loja_key`/`bluesoft_loja_cd` em `lojas`, editado
// em Gestão de Lojas) que o Inventário já usa pra abrir inventário via API.
// Só a consulta “quanto tem agora” é nova aqui — sem gerar inventário, sem
// tocar em endereços/lotes.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BLUESOFT_PROXY_URL = 'https://southamerica-east1-daterrinha-inventario.cloudfunctions.net/bluesoftProxy';
  const TAMANHO_PAGINA = 200;
  const CONCORRENCIA_PAGINAS = 5;
  const LIMITE_PAGINAS = 300;

  let _lojas = [];
  let _lojaSelecionada = '';
  let _carregado = false;
  let _consultando = false;
  let _ultimoResultado = null; // { itens, lojaNome, atualizadoEm }

  function raw() { return global.getDTRawFirestore(); }

  async function _config() {
    try {
      const snap = await raw().collection('dt_config').doc('integracao_api').get();
      return snap.exists ? snap.data() || {} : {};
    } catch (e) { return {}; }
  }

  async function carregarProducaoEstoque(forcar) {
    if (_carregado && !forcar) return;
    const snap = await raw().collection('lojas').get();
    _lojas = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(l => l.bluesoft_loja_key);
    _carregado = true;
  }

  async function renderProducaoEstoque() {
    const pagina = document.getElementById('page-producao-estoque');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoEstoque(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoEstoque();
  }

  function _desenharProducaoEstoque() {
    const pagina = document.getElementById('page-producao-estoque');
    if (!pagina) return;

    if (!_lojas.length) {
      pagina.innerHTML = `
        <div style="margin-bottom:16px">
          <div class="page-title" style="font-size:1.1rem">📦 Estoque (Bluesoft)</div>
        </div>
        <div class="empty">
          <div class="empty-icon">🔗</div>
          <div class="empty-title">Nenhuma loja vinculada à Bluesoft</div>
          <div class="empty-sub">Vá em Gestão de Lojas e vincule ao menos uma loja a um código da Bluesoft para consultar estoque aqui.</div>
        </div>`;
      return;
    }

    const opcoes = _lojas.map(l => `<option value="${esc(l.id)}" ${_lojaSelecionada === l.id ? 'selected' : ''}>${esc(l.nome || l.codigo || l.id)}</option>`).join('');
    const resultado = _ultimoResultado;

    pagina.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.1rem">📦 Estoque (Bluesoft)</div>
          <div style="font-size:.72rem;color:var(--muted)">Consulta em tempo real do saldo de estoque por loja/CD, via integração Bluesoft já configurada em Importar/Exportar.</div>
        </div>
      </div>

      <div class="tc" style="padding:14px;margin-bottom:16px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <select id="pest-loja-sel" class="field" style="min-width:240px">
            <option value="">Selecione a loja...</option>
            ${opcoes}
          </select>
          <button type="button" class="btn btn-primary btn-sm" id="pest-btn-atualizar" ${_consultando ? 'disabled' : ''}>${_consultando ? '⏳ Buscando...' : '🔄 Consultar estoque'}</button>
          <span style="font-size:.76rem;color:var(--muted)" id="pest-status">${resultado ? resultado.itens.length.toLocaleString('pt-BR') + ' produto(s) — ' + esc(resultado.lojaNome) + ' · atualizado ' + esc(resultado.atualizadoEm) : ''}</span>
        </div>
      </div>

      <div class="tc">
        <div style="overflow:auto;max-height:65vh">
          <table class="dt-table">
            <thead><tr><th>Código</th><th>Produto</th><th style="text-align:right">Quantidade</th></tr></thead>
            <tbody id="pest-tbody">
              ${resultado ? _linhasTabela(resultado.itens) : `<tr><td colspan="3"><div class="empty"><div class="empty-icon">📦</div><div class="empty-title">Selecione uma loja e clique em Consultar</div></div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function _linhasTabela(itens) {
    if (!itens.length) return `<tr><td colspan="3"><div class="empty"><div class="empty-title">Nenhum produto encontrado</div></div></td></tr>`;
    return itens
      .slice()
      .sort((a, b) => (b.quantidade || 0) - (a.quantidade || 0))
      .map(i => `<tr>
        <td style="font-family:monospace">${esc(i.codigo_produto)}</td>
        <td>${esc(i.descricao || '—')}</td>
        <td style="text-align:right;font-weight:700">${Number(i.quantidade || 0).toLocaleString('pt-BR')}</td>
      </tr>`).join('');
  }

  async function _requestBluesoft(pathComQuery, cfg) {
    const idToken = await global.firebase.auth().currentUser?.getIdToken();
    if (!idToken) throw new Error('Faça login novamente para usar a integração Bluesoft.');
    const baseUrl = cfg.ambiente === 'producao' ? (cfg.url_prd || '') : (cfg.url_hml || '');
    if (!baseUrl) throw new Error('Configure a URL da Bluesoft (Homologação/Produção) em Importar/Exportar → Configuração da API.');
    if (!cfg.token) throw new Error('Configure o Token/API Key da Bluesoft em Importar/Exportar → Configuração da API.');
    const resposta = await fetch(BLUESOFT_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
      body: JSON.stringify({ method: 'GET', path: pathComQuery, baseUrl: baseUrl.replace(/\/+$/, ''), token: cfg.token }),
    });
    const texto = await resposta.text();
    let dados;
    try { dados = texto ? JSON.parse(texto) : null; } catch (_) { dados = texto; }
    if (!resposta.ok) {
      const detalhe = dados && dados.erro ? dados.erro : String(texto).slice(0, 200);
      throw new Error('HTTP ' + resposta.status + (detalhe ? ': ' + detalhe : ''));
    }
    return dados;
  }

  function _normalizarItem(item) {
    const out = {};
    Object.keys(item || {}).forEach(k => {
      const norm = String(k).normalize('NFD').replace(/\p{Mark}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      out[norm] = item[k];
    });
    return out;
  }
  function _linhasDe(body) {
    if (Array.isArray(body)) return body;
    if (!body || typeof body !== 'object') return [];
    return body.data || body.items || body.results || [];
  }

  async function _paginarTudo(path, params, cfg, semPaginacao) {
    if (semPaginacao) {
      const qs = new URLSearchParams(params).toString();
      const body = await _requestBluesoft(path + (qs ? '?' + qs : ''), cfg);
      return _linhasDe(body).map(_normalizarItem);
    }
    const itens = [];
    const vistos = new Set();
    let pagina = 0, acabou = false, paginasSemNovidade = 0;
    while (!acabou) {
      const indices = Array.from({ length: CONCORRENCIA_PAGINAS }, (_, i) => pagina + i);
      const respostas = await Promise.all(indices.map(p => {
        const qs = new URLSearchParams(Object.assign({}, params, { currentPage: p, pageSize: TAMANHO_PAGINA })).toString();
        return _requestBluesoft(path + '?' + qs, cfg);
      }));
      for (const body of respostas) {
        const linhas = _linhasDe(body).map(_normalizarItem);
        if (!linhas.length) { acabou = true; break; }
        let novos = 0;
        linhas.forEach(item => {
          const chaveItem = JSON.stringify(item);
          if (!vistos.has(chaveItem)) { vistos.add(chaveItem); itens.push(item); novos++; }
        });
        if (novos === 0) { paginasSemNovidade++; if (paginasSemNovidade >= 5) { acabou = true; break; } }
        else paginasSemNovidade = 0;
        if (linhas.length < TAMANHO_PAGINA) { acabou = true; break; }
      }
      pagina += CONCORRENCIA_PAGINAS;
      if (pagina > LIMITE_PAGINAS) throw new Error('A busca passou do limite de segurança sem terminar — fale com o suporte da Bluesoft.');
    }
    return itens;
  }

  // Estoque de UMA loja — só "quanto tem" por produto, sem endereço, lote ou
  // validade (isso é específico do fluxo de abertura de inventário, em
  // 43-importar-exportar-api.js). Escolhe a rota certa conforme o tipo da
  // loja na Bluesoft (CD com endereçamento vs loja comum).
  async function _consultarEstoqueLoja(loja, cfg) {
    const lojaKey = loja.bluesoft_loja_key;
    if (loja.bluesoft_loja_cd === true) {
      const itens = await _paginarTudo('/api/wms/ajuste-estoque-logistico', { lojaKey }, cfg, true);
      const porProduto = new Map();
      itens.forEach(item => {
        const cod = String(item.produtokey || '').trim();
        if (!cod) return;
        const atual = porProduto.get(cod) || { codigo_produto: cod, descricao: item.descricaoproduto || '', quantidade: 0 };
        atual.quantidade += Math.max(0, parseFloat(String(item.quantidadedisponivelemunidades || 0).replace(',', '.')) || 0);
        porProduto.set(cod, atual);
      });
      return Array.from(porProduto.values());
    }
    const itens = await _paginarTudo('/api/comercial/estoques/ficha-estoque', { lojaKey }, cfg);
    return itens.map(item => ({
      codigo_produto: String(item.produtokey || '').trim(),
      descricao: '',
      quantidade: Math.max(0, parseFloat(String(item.quantidade || 0).replace(',', '.')) || 0),
    })).filter(r => r.codigo_produto);
  }

  async function pestAtualizar() {
    const lojaId = document.getElementById('pest-loja-sel')?.value || '';
    if (!lojaId) { global.showToast?.('Selecione uma loja.', 'error'); return; }
    const loja = _lojas.find(l => l.id === lojaId);
    if (!loja) return;
    _lojaSelecionada = lojaId;
    _consultando = true;
    _desenharProducaoEstoque();
    try {
      const cfg = await _config();
      const itens = await _consultarEstoqueLoja(loja, cfg);
      _ultimoResultado = { itens, lojaNome: loja.nome || loja.codigo || loja.id, atualizadoEm: new Date().toLocaleString('pt-BR') };
      global.showToast?.(itens.length.toLocaleString('pt-BR') + ' produto(s) encontrado(s).', 'success');
    } catch (e) {
      global.showToast?.('Erro ao buscar estoque: ' + (e.message || e), 'error');
    } finally {
      _consultando = false;
      _desenharProducaoEstoque();
    }
  }

  global.renderProducaoEstoque = renderProducaoEstoque;
  global.pestAtualizar = pestAtualizar;

  document.addEventListener('click', function (event) {
    if (event.target.closest('#pest-btn-atualizar')) { pestAtualizar(); }
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'pest-loja-sel') { _lojaSelecionada = event.target.value; }
  });
})(window);
