// PCP — Fase 7: parâmetros de cobertura/compra por produto. Edita o MESMO
// cadastro de produto que a Ficha Técnica usa (producao_produtos) — não cria
// um segundo cadastro. Ficha Técnica cuida de fabricação (BOM/velocidade);
// esta tela cuida de planejamento/compra (cobertura, mínimos, lead time,
// lote/múltiplo de compra, criticidade, fornecedor preferencial).
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => Number(v) || 0;
  const COL_PRODUTOS = 'producao_produtos';
  // Campos que esta tela é responsável por editar/rastrear — usado tanto na
  // gravação individual/em massa quanto na auditoria.
  const CAMPOS = ['metaCoberturaDias', 'estoqueMinimo', 'estoqueMaximo', 'estoqueSeguranca', 'leadTimeDias', 'loteMinimoCompra', 'multiploCompra', 'criticidade', 'fornecedorPadrao'];
  const CRITICIDADES = ['baixa', 'media', 'alta', 'critica'];

  let _produtos = [];
  let _lojas = []; // [{id,nome}] — pra montar o filtro de loja
  let _configEstoque = { locaisDetectados: [], locaisExcluidos: [] };
  let _carregado = false;
  let _busca = '';
  let _filtroLoja = ''; // '' = todas as lojas
  const _selecionados = new Set(); // chaves "lojaId|cod"

  function fs() { return global.getDTFirestore(); }
  function raw() { return global.getDTRawFirestore(); }
  function refProdutoCrossLoja(lojaId, docId) { return raw().collection('lojas').doc(lojaId).collection(COL_PRODUTOS).doc(docId); }
  function chaveSel(lojaId, cod) { return lojaId + '|' + cod; }
  function now() { return new Date().toISOString(); }
  function tem(acao) { return typeof global.temPermissao !== 'function' || global.temPermissao('pcp-central', acao); }

  // PEDIDO AO VIVO (2026-09-06): "nessa aba de parâmetros... coloca um
  // filtro por loja" — antes só lia a subcoleção da loja ATIVA no
  // navegador (fs(), proxy loja-scoped); um produto cadastrado como
  // produzido só na Matriz nunca aparecia se a loja ativa fosse outra.
  // Agora lê a subcoleção `producao_produtos` de TODAS as lojas (mesmo
  // padrão de recebimento-paletes-monitoramento.js: raw().collection('lojas')
  // .get() + loop, .catch(()=>vazio) por loja pra uma loja com erro/sem
  // permissão não derrubar as outras) e consolida tudo numa lista só, com
  // filtro de loja opcional.
  async function carregarPCPParametros(forcar) {
    if (_carregado && !forcar) return;
    const vazio = { docs: [] };
    const [lojasSnap, configSnap] = await Promise.all([
      raw().collection('lojas').get().catch(() => vazio),
      fs().collection('pcp_configuracoes').doc('estoque_bluesoft').get().catch(() => ({ exists: false })),
    ]);
    _lojas = lojasSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.ativa !== false);
    const porLoja = await Promise.all(_lojas.map(loja => raw().collection('lojas').doc(loja.id).collection(COL_PRODUTOS).get().catch(() => vazio)));
    _produtos = [];
    porLoja.forEach((snap, i) => {
      const loja = _lojas[i];
      snap.docs.forEach(d => _produtos.push({ _firestoreId: d.id, _lojaId: loja.id, _lojaNome: loja.nome || loja.codigo || loja.id, ...d.data() }));
    });
    _configEstoque = configSnap.exists ? { locaisDetectados: [], locaisExcluidos: [], ...configSnap.data() } : { locaisDetectados: [], locaisExcluidos: [] };
    _carregado = true;
  }

  // BUG AO VIVO REAL (2026-09-06): "muda a cobertura de estoque, salva, mas
  // quando mostra 'salvou' ele volta pro valor antigo" — um produto pode
  // ter VÁRIOS documentos em producao_produtos NA MESMA LOJA, um por
  // máquina compatível (mesmo cod, pc_min/maquina diferentes — convenção
  // já usada pela Ficha Técnica, não é bug de import). Os campos desta
  // tela (cobertura, mínimo/máximo, criticidade...) são do PRODUTO, não da
  // variante de máquina — mas a tela mostrava/editava cada variante como
  // linha separada e só a PRIMEIRA encontrada por cod, então salvar numa
  // variante nunca refletia na outra. Agrupa por (loja+cod) — 1 linha só
  // por produto POR LOJA (o mesmo cod pode ser um produto DIFERENTE em
  // cada loja produtora, cada um com seus próprios parâmetros) — e
  // _salvarProdutoComAuditoria() agora grava em TODAS as variantes daquela
  // loja juntas, nunca cruzando pra variantes de outra loja.
  function _linhas() {
    const busca = _busca.trim().toLowerCase();
    const porChave = new Map();
    _produtos.forEach(p => {
      if (_filtroLoja && p._lojaId !== _filtroLoja) return;
      if (busca && !String(p.cod).toLowerCase().includes(busca) && !String(p.nome || '').toLowerCase().includes(busca)) return;
      const chave = chaveSel(p._lojaId, p.cod);
      if (!porChave.has(chave)) porChave.set(chave, p);
    });
    return [...porChave.values()].sort((a, b) => String(a.cod).localeCompare(String(b.cod), 'pt-BR', { numeric: true }) || a._lojaNome.localeCompare(b._lojaNome, 'pt-BR'));
  }
  function _variantesDoCod(lojaId, cod) {
    return _produtos.filter(p => p._lojaId === lojaId && String(p.cod) === String(cod));
  }

  function _criticidadeBadge(c) {
    const cor = c === 'critica' ? 'b-red' : c === 'alta' ? 'b-orange' : c === 'media' ? 'b-yellow' : 'b-gray';
    return `<span class="badge ${cor}">${esc(c || 'baixa')}</span>`;
  }

  async function renderPCPParametros() {
    const pagina = document.getElementById('page-pcp-parametros');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarPCPParametros(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharPCPParametros();
  }

  function _desenharPCPParametros() {
    const pagina = document.getElementById('page-pcp-parametros');
    if (!pagina) return;
    const linhas = _linhas();
    const podeEditar = tem('configurar');
    pagina.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.1rem">⚙️ Parâmetros de Cobertura e Compra</div>
          <div style="font-size:.72rem;color:var(--muted)">${linhas.length.toLocaleString('pt-BR')} produto(s) — cobertura desejada, mínimo/máximo/segurança, lead time, lote/múltiplo de compra, criticidade e fornecedor preferencial</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select id="pcpp-f-loja" class="field" style="min-width:160px">
            <option value="">Todas as lojas</option>
            ${_lojas.map(l => `<option value="${esc(l.id)}" ${_filtroLoja === l.id ? 'selected' : ''}>${esc(l.nome || l.codigo || l.id)}</option>`).join('')}
          </select>
          <input id="pcpp-busca" placeholder="Buscar código ou produto..." value="${esc(_busca)}" class="field" style="min-width:220px">
          ${podeEditar && _selecionados.size ? `<button type="button" class="btn btn-primary btn-sm" data-pcpp-massa="1">✏️ Editar ${_selecionados.size} selecionado(s)</button>` : ''}
        </div>
      </div>
      <div class="tc" style="padding:10px 12px;margin-bottom:14px">
        <details class="pcpp-locais-dropdown">
          <summary style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:.76rem;list-style:none">
            <span><b>🏬 Locais considerados no saldo</b> <span style="color:var(--muted)">· ${Math.max(0,(_configEstoque.locaisDetectados||[]).length-(_configEstoque.locaisExcluidos||[]).length)} de ${(_configEstoque.locaisDetectados||[]).length} selecionados</span></span>
            <span style="color:var(--muted)">Selecionar ▾</span>
          </summary>
          <div style="margin-top:9px;border-top:1px solid var(--border);padding-top:8px">
            <div style="font-size:.66rem;color:var(--muted);margin-bottom:7px">Desmarque os locais que não entram na soma. A alteração vale na próxima busca.</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:3px;max-height:210px;overflow:auto;padding-right:4px">
              ${(_configEstoque.locaisDetectados||[]).length ? (_configEstoque.locaisDetectados||[]).map(l=>{const excl=(_configEstoque.locaisExcluidos||[]).map(String).includes(String(l.key));return `<label style="padding:5px 7px;display:flex;gap:6px;align-items:flex-start;border:1px solid var(--border);border-radius:7px;font-size:.68rem"><input type="checkbox" data-pcpp-local="${esc(l.key)}" ${excl?'':'checked'} ${podeEditar?'':'disabled'} style="width:13px;height:13px;margin-top:1px"><span><b>${esc(l.nome||('Local '+l.key))}</b>${l.exemploEndereco?`<small style="display:block;color:var(--muted);font-size:.6rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px" title="${esc(l.exemploEndereco)}">${esc(l.exemploEndereco)}</small>`:''}</span></label>`;}).join('') : '<span style="font-size:.68rem;color:var(--muted)">Execute uma busca para carregar os locais.</span>'}
            </div>
            ${podeEditar ? '<div style="display:flex;justify-content:flex-end;margin-top:8px"><button type="button" class="btn btn-primary btn-sm" data-pcpp-salvar-locais>Salvar locais</button></div>' : ''}
          </div>
        </details>
      </div>
      <div class="tc">
        <div style="overflow:auto">
          <table class="dt-table">
            <thead><tr>
              ${podeEditar ? '<th><input type="checkbox" id="pcpp-marcar-todos"></th>' : ''}
              <th>Cód.</th><th>Produto</th><th>Loja</th><th>Cobertura (d)</th><th>Mín.</th><th>Máx.</th><th>Segurança</th><th>Lead time (d)</th><th>Lote mín. compra</th><th>Múltiplo compra</th><th>Criticidade</th><th>Fornecedor pref.</th><th></th>
            </tr></thead>
            <tbody>
              ${linhas.length ? linhas.map(p => `
                <tr>
                  ${podeEditar ? `<td><input type="checkbox" class="pcpp-check" data-loja="${esc(p._lojaId)}" value="${esc(p.cod)}" ${_selecionados.has(chaveSel(p._lojaId, p.cod)) ? 'checked' : ''}></td>` : ''}
                  <td class="mono">${esc(p.cod)}</td>
                  <td><b>${esc(p.nome)}</b></td>
                  <td>${esc(p._lojaNome)}</td>
                  <td>${esc(p.metaCoberturaDias ?? '—')}</td>
                  <td>${esc(p.estoqueMinimo ?? '—')}</td>
                  <td>${esc(p.estoqueMaximo ?? '—')}</td>
                  <td>${esc(p.estoqueSeguranca ?? '—')}</td>
                  <td>${esc(p.leadTimeDias ?? '—')}</td>
                  <td>${esc(p.loteMinimoCompra ?? '—')}</td>
                  <td>${esc(p.multiploCompra ?? '—')}</td>
                  <td>${_criticidadeBadge(p.criticidade)}</td>
                  <td>${esc(p.fornecedorPadrao || '—')}</td>
                  <td style="white-space:nowrap">
                    ${podeEditar ? `<button type="button" class="acao-lapis" title="Editar" data-pcpp-editar-loja="${esc(p._lojaId)}" data-pcpp-editar="${esc(p.cod)}">✏️</button>` : ''}
                    <button type="button" class="acao-lapis" title="Histórico de alterações" data-pcpp-historico-loja="${esc(p._lojaId)}" data-pcpp-historico="${esc(p.cod)}">🕘</button>
                  </td>
                </tr>`).join('') : `<tr><td colspan="13"><div class="empty"><div class="empty-title">Nenhum produto encontrado</div></div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
      <div id="pcpp-modal-host"></div>`;
  }

  async function pcppSalvarLocais() {
    if (!tem('configurar')) return;
    const locaisExcluidos=Array.from(document.querySelectorAll('[data-pcpp-local]')).filter(x=>!x.checked).map(x=>x.getAttribute('data-pcpp-local'));
    try { await fs().collection('pcp_configuracoes').doc('estoque_bluesoft').set({locaisExcluidos,atualizadoEm:now(),atualizadoPor:global._currentAnalistaUser?.email||''},{merge:true});_configEstoque.locaisExcluidos=locaisExcluidos;global.showToast?.('Locais salvos. Execute Buscar para recalcular os saldos.','success'); }
    catch(e){global.showToast?.('Erro ao salvar locais: '+(e.message||e),'error');}
  }

  function _abrirModalIndividual(p) {
    const host = document.getElementById('pcpp-modal-host');
    if (!host) return;
    host.innerHTML = `<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:640px">
      <div class="modal-header"><b>Parâmetros — ${esc(p.nome)}</b><button class="modal-x" data-pcpp-modal-close>×</button></div>
      <div class="modal-body">
        <div style="font-size:.72rem;color:var(--muted);margin-bottom:8px">🏬 ${esc(p._lojaNome)}</div>
        <input type="hidden" id="pcpp-cod" value="${esc(p.cod)}">
        <input type="hidden" id="pcpp-loja-id" value="${esc(p._lojaId)}">
        <div class="grid2">
          <div class="form-group"><label>Cobertura desejada (dias)</label><input class="field" id="pcpp-cobertura" type="number" min="0" value="${esc(p.metaCoberturaDias ?? '')}"></div>
          <div class="form-group"><label>Estoque mínimo</label><input class="field" id="pcpp-min" type="number" min="0" value="${esc(p.estoqueMinimo ?? '')}"></div>
          <div class="form-group"><label>Estoque máximo</label><input class="field" id="pcpp-max" type="number" min="0" value="${esc(p.estoqueMaximo ?? '')}"></div>
          <div class="form-group"><label>Estoque de segurança</label><input class="field" id="pcpp-seguranca" type="number" min="0" value="${esc(p.estoqueSeguranca ?? '')}"></div>
          <div class="form-group"><label>Lead time (dias)</label><input class="field" id="pcpp-leadtime" type="number" min="0" value="${esc(p.leadTimeDias ?? '')}"></div>
          <div class="form-group"><label>Lote mínimo de compra</label><input class="field" id="pcpp-lote" type="number" min="0" value="${esc(p.loteMinimoCompra ?? '')}"></div>
          <div class="form-group"><label>Múltiplo de compra</label><input class="field" id="pcpp-multiplo" type="number" min="0" value="${esc(p.multiploCompra ?? '')}"></div>
          <div class="form-group"><label>Criticidade</label><select class="field" id="pcpp-criticidade">${CRITICIDADES.map(c => `<option value="${c}" ${String(p.criticidade || 'baixa') === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        </div>
        <div class="form-group"><label>Fornecedor preferencial</label><input class="field" id="pcpp-fornecedor" value="${esc(p.fornecedorPadrao || '')}"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-ghost" data-pcpp-modal-close>Cancelar</button><button class="btn btn-primary" data-pcpp-salvar-individual="1">Salvar</button></div>
    </div></div>`;
  }

  function pcppEditar(lojaId, cod) {
    const variantes = _variantesDoCod(lojaId, cod);
    if (!variantes.length) return;
    _abrirModalIndividual(variantes[0]);
  }

  // Grava o MESMO valor em TODAS as variantes de máquina deste cod DENTRO
  // DA MESMA LOJA (nunca cruza pra variante de outra loja, nem só a
  // primeira) — são campos de planejamento do produto, não da variante.
  // 1 registro de auditoria só por (loja+cod), não 1 por variante, pra não
  // duplicar o histórico. Escrita sempre via referência cross-loja
  // (raw()), nunca fs() — fs() só sabe escrever na loja ATIVA do
  // navegador, e aqui a linha editada pode ser de QUALQUER loja.
  async function _salvarProdutoComAuditoria(lojaId, cod, camposNovos, origem) {
    const variantes = _variantesDoCod(lojaId, cod);
    if (!variantes.length) return;
    const antes = {}; CAMPOS.forEach(c => { antes[c] = variantes[0][c] ?? null; });
    const payload = { ...camposNovos, atualizadoEm: now(), atualizadoPor: global._currentAnalistaUser?.email || '' };
    await Promise.all(variantes.map(v => refProdutoCrossLoja(lojaId, v._firestoreId).set(payload, { merge: true })));
    await global.registrarAuditoria?.({
      colecao: COL_PRODUTOS, docId: variantes[0]._firestoreId, produtoCod: cod, produtoNome: variantes[0].nome,
      antes, depois: { ...antes, ...camposNovos }, camposRastreados: CAMPOS, origem: origem || 'pcp-parametros',
    });
    variantes.forEach(v => Object.assign(v, camposNovos));
  }

  async function pcppSalvarIndividual() {
    if (!tem('configurar')) return;
    const cod = document.getElementById('pcpp-cod')?.value || '';
    const lojaId = document.getElementById('pcpp-loja-id')?.value || '';
    if (!cod || !lojaId || !_variantesDoCod(lojaId, cod).length) return;
    const camposNovos = {
      metaCoberturaDias: n(document.getElementById('pcpp-cobertura')?.value),
      estoqueMinimo: n(document.getElementById('pcpp-min')?.value),
      estoqueMaximo: n(document.getElementById('pcpp-max')?.value),
      estoqueSeguranca: n(document.getElementById('pcpp-seguranca')?.value),
      leadTimeDias: n(document.getElementById('pcpp-leadtime')?.value),
      loteMinimoCompra: n(document.getElementById('pcpp-lote')?.value),
      multiploCompra: n(document.getElementById('pcpp-multiplo')?.value),
      criticidade: document.getElementById('pcpp-criticidade')?.value || 'baixa',
      fornecedorPadrao: String(document.getElementById('pcpp-fornecedor')?.value || '').trim(),
    };
    try {
      await _salvarProdutoComAuditoria(lojaId, cod, camposNovos, 'pcp-parametros-individual');
      document.getElementById('pcpp-modal-host').innerHTML = '';
      global.showToast?.('Parâmetros salvos.', 'success');
      _desenharPCPParametros();
    } catch (e) { global.showToast?.('Erro ao salvar: ' + (e.message || e), 'error'); }
  }

  function _abrirModalMassa() {
    const host = document.getElementById('pcpp-modal-host');
    if (!host || !_selecionados.size) return;
    host.innerHTML = `<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:520px">
      <div class="modal-header"><b>Editar ${_selecionados.size} produto(s) selecionado(s)</b><button class="modal-x" data-pcpp-modal-close>×</button></div>
      <div class="modal-body">
        <div class="form-group"><label>Campo a alterar</label><select class="field" id="pcpp-massa-campo">
          <option value="metaCoberturaDias">Cobertura desejada (dias)</option>
          <option value="estoqueMinimo">Estoque mínimo</option>
          <option value="estoqueMaximo">Estoque máximo</option>
          <option value="estoqueSeguranca">Estoque de segurança</option>
          <option value="leadTimeDias">Lead time (dias)</option>
          <option value="loteMinimoCompra">Lote mínimo de compra</option>
          <option value="multiploCompra">Múltiplo de compra</option>
          <option value="criticidade">Criticidade</option>
          <option value="fornecedorPadrao">Fornecedor preferencial</option>
        </select></div>
        <div class="form-group" id="pcpp-massa-valor-wrap"><label>Novo valor</label><input class="field" id="pcpp-massa-valor" type="number" min="0"></div>
        <div style="font-size:.72rem;color:var(--muted)">Aplica o mesmo valor a todos os produtos marcados na tabela. Cada alteração fica registrada no histórico individualmente.</div>
      </div>
      <div class="modal-footer"><button class="btn btn-ghost" data-pcpp-modal-close>Cancelar</button><button class="btn btn-primary" data-pcpp-salvar-massa="1">Aplicar</button></div>
    </div></div>`;
    document.getElementById('pcpp-massa-campo')?.addEventListener('change', _atualizarCampoValorMassa);
    _atualizarCampoValorMassa();
  }

  function _atualizarCampoValorMassa() {
    const campo = document.getElementById('pcpp-massa-campo')?.value;
    const wrap = document.getElementById('pcpp-massa-valor-wrap');
    if (!wrap) return;
    if (campo === 'criticidade') {
      wrap.innerHTML = `<label>Novo valor</label><select class="field" id="pcpp-massa-valor">${CRITICIDADES.map(c => `<option value="${c}">${c}</option>`).join('')}</select>`;
    } else if (campo === 'fornecedorPadrao') {
      wrap.innerHTML = '<label>Novo valor</label><input class="field" id="pcpp-massa-valor">';
    } else {
      wrap.innerHTML = '<label>Novo valor</label><input class="field" id="pcpp-massa-valor" type="number" min="0">';
    }
  }

  async function pcppSalvarMassa() {
    if (!tem('configurar') || !_selecionados.size) return;
    const campo = document.getElementById('pcpp-massa-campo')?.value;
    const valorEl = document.getElementById('pcpp-massa-valor');
    const valor = campo === 'criticidade' || campo === 'fornecedorPadrao' ? String(valorEl?.value || '').trim() : n(valorEl?.value);
    if (!campo) return;
    let ok = 0;
    for (const chave of _selecionados) {
      const [lojaId, cod] = chave.split('|');
      try { await _salvarProdutoComAuditoria(lojaId, cod, { [campo]: valor }, 'pcp-parametros-massa'); ok++; }
      catch (e) { /* segue tentando os demais */ }
    }
    document.getElementById('pcpp-modal-host').innerHTML = '';
    _selecionados.clear();
    global.showToast?.(ok + ' produto(s) atualizado(s).', 'success');
    _desenharPCPParametros();
  }

  async function pcppHistorico(lojaId, cod) {
    const produto = _variantesDoCod(lojaId, cod)[0];
    const host = document.getElementById('pcpp-modal-host');
    if (!host || !produto) return;
    host.innerHTML = '<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:640px"><div class="modal-body">Carregando histórico...</div></div></div>';
    const registros = await global.listarAuditoria?.({ produtoCod: cod }) || [];
    host.innerHTML = `<div class="modal-overlay" style="display:flex"><div class="modal-card" style="max-width:680px">
      <div class="modal-header"><b>Histórico de alterações — ${esc(produto.nome)}</b><button class="modal-x" data-pcpp-modal-close>×</button></div>
      <div class="modal-body">
        <div style="overflow:auto;max-height:420px">
          <table class="dt-table"><thead><tr><th>Data</th><th>Usuário</th><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead><tbody>
          ${registros.length ? registros.flatMap(r => r.alteracoes.map(a => `<tr><td>${esc(String(r.criadoEm || '').replace('T', ' ').slice(0, 16))}</td><td>${esc(r.criadoPor)}</td><td>${esc(a.campo)}</td><td>${esc(a.valorAnterior ?? '—')}</td><td>${esc(a.valorNovo ?? '—')}</td></tr>`)).join('') : '<tr><td colspan="5">Nenhuma alteração registrada ainda.</td></tr>'}
          </tbody></table>
        </div>
      </div>
      <div class="modal-footer"><button class="btn btn-ghost" data-pcpp-modal-close>Fechar</button></div>
    </div></div>`;
  }

  global.pcpRegistrarPagina?.('parametros', { elId: 'page-pcp-parametros', render: 'renderPCPParametros', titulo: 'Parâmetros' });
  global.renderPCPParametros = renderPCPParametros;
  global.pcppEditar = pcppEditar;
  global.pcppSalvarIndividual = pcppSalvarIndividual;
  global.pcppSalvarMassa = pcppSalvarMassa;
  global.pcppHistorico = pcppHistorico;

  document.addEventListener('click', function (event) {
    const editar = event.target.closest('[data-pcpp-editar]');
    if (editar) { pcppEditar(editar.getAttribute('data-pcpp-editar-loja'), editar.getAttribute('data-pcpp-editar')); return; }
    const historico = event.target.closest('[data-pcpp-historico]');
    if (historico) { pcppHistorico(historico.getAttribute('data-pcpp-historico-loja'), historico.getAttribute('data-pcpp-historico')).catch(e => global.showToast?.(e.message || e, 'error')); return; }
    if (event.target.closest('[data-pcpp-modal-close]')) { const h = document.getElementById('pcpp-modal-host'); if (h) h.innerHTML = ''; return; }
    if (event.target.closest('[data-pcpp-salvar-individual]')) { pcppSalvarIndividual(); return; }
    if (event.target.closest('[data-pcpp-massa]')) { _abrirModalMassa(); return; }
    if (event.target.closest('[data-pcpp-salvar-massa]')) { pcppSalvarMassa(); return; }
    if (event.target.closest('[data-pcpp-salvar-locais]')) { pcppSalvarLocais(); return; }
  });
  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'pcpp-busca') { _busca = event.target.value; _desenharPCPParametros(); }
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'pcpp-f-loja') { _filtroLoja = event.target.value || ''; _desenharPCPParametros(); return; }
    if (event.target && event.target.id === 'pcpp-marcar-todos') {
      const marcar = event.target.checked;
      _linhas().forEach(p => { const chave = chaveSel(p._lojaId, p.cod); if (marcar) _selecionados.add(chave); else _selecionados.delete(chave); });
      _desenharPCPParametros();
      return;
    }
    if (event.target && event.target.classList?.contains('pcpp-check')) {
      const chave = chaveSel(event.target.getAttribute('data-loja'), event.target.value);
      if (event.target.checked) _selecionados.add(chave); else _selecionados.delete(chave);
      _desenharPCPParametros();
    }
  });
})(window);
