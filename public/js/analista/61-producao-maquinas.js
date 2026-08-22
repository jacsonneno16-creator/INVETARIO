// Setor Produção — Máquinas (fase 3a; turnos na fase 3c; fase 3e traz o
// restante que a original tinha: ocupação total + seleção múltipla,
// atalhos de turno T1/T2/T3 editáveis, copiar/resetar turnos, e o campo de
// tempo de setup padrão usado pelo motor de agenda quando não há tempo
// específico cadastrado em Tempos de Setup).
//
// Turnos por máquina/dia da semana entram como campo `turnos` do próprio
// doc de máquina (Firestore-backed, ao contrário do original que só usava
// localStorage e não sincronizava entre dispositivos) — os atalhos T1/T2/T3
// (que na original também eram só localStorage) agora ficam num doc único
// por loja (`producao_config/turnos_atalhos`).
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_MAQUINAS = 'producao_maquinas';
  const COL_REGISTROS = 'producao_registros';
  const COL_CONFIG = 'producao_config';
  const COL_SETUP = 'producao_setup';
  const COL_CATEGORIAS = 'producao_categorias';
  const DIA_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const ATALHOS_DEFAULT = { T1: { ini: '06:00', fim: '14:00' }, T2: { ini: '14:00', fim: '22:00' }, T3: { ini: '22:00', fim: '06:00' } };

  let _maquinas = [];
  let _registros = [];
  let _setups = [];
  let _categorias = [];
  let _carregado = false;
  let _produtosEditando = [];
  let _turnosEditando = {};
  let _atalhos = null;
  const _selecionadas = new Set();

  function fs() { return global.getDTFirestore(); }

  async function carregarProducaoMaquinas(forcar) {
    if (_carregado && !forcar) return;
    const [snapMaq, snapReg, snapSetup, snapCat] = await Promise.all([
      fs().collection(COL_MAQUINAS).get(),
      fs().collection(COL_REGISTROS).get(),
      fs().collection(COL_SETUP).get(),
      fs().collection(COL_CATEGORIAS).get().catch(() => ({ docs: [] })),
    ]);
    _maquinas = snapMaq.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _registros = snapReg.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _setups = snapSetup.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _categorias = snapCat.docs.map(d => ({ _firestoreId: d.id, ...d.data() })).filter(c => c.ativo !== false).sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    _carregado = true;
  }

  async function _carregarAtalhos(forcar) {
    if (_atalhos && !forcar) return _atalhos;
    try {
      const doc = await fs().collection(COL_CONFIG).doc('turnos_atalhos').get();
      _atalhos = doc.exists ? { ...ATALHOS_DEFAULT, ...doc.data() } : { ...ATALHOS_DEFAULT };
    } catch (e) {
      _atalhos = { ...ATALHOS_DEFAULT };
    }
    return _atalhos;
  }

  function _domingoDaSemanaAtual() {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    hoje.setDate(hoje.getDate() - hoje.getDay());
    return hoje;
  }

  function _agendaSemanaAtual() {
    if (typeof global.buildProducaoSchedule !== 'function') return { porMaquina: {} };
    const maquinasPorNome = {};
    _maquinas.forEach(m => { maquinasPorNome[m.nome] = m; });
    return global.buildProducaoSchedule(_domingoDaSemanaAtual(), _registros, maquinasPorNome, _setups);
  }

  // Ocupação real desde a fase 3c: usa o motor de agenda (mesmo usado pelo
  // Gantt) pra distribuir as OPs ativas da semana atual pelos turnos da
  // máquina, e compara minutos usados vs. capacidade da semana.
  function calcOcupacaoMaquina(maquina) {
    const resultado = _agendaSemanaAtual();
    const dados = resultado.porMaquina[maquina.nome];
    if (!dados || dados.capacidadeMinutosSemana <= 0) return 0;
    return Math.min(100, Math.round((dados.totalMinutosUsados / dados.capacidadeMinutosSemana) * 100));
  }

  // Ocupação agregada de um conjunto de máquinas (ou de todas, se nomes for
  // vazio) — usada no resumo do topo e na seleção múltipla, mesma ideia do
  // "Ocupação total da semana"/"Máquinas selecionadas" da tela original.
  function _calcOcupacaoAgregada(nomes) {
    const resultado = _agendaSemanaAtual();
    const alvo = nomes && nomes.length ? nomes : Object.keys(resultado.porMaquina);
    let usados = 0, capacidade = 0, caixas = 0, qtdMaquinas = 0;
    alvo.forEach(nome => {
      const d = resultado.porMaquina[nome];
      if (d) {
        usados += d.totalMinutosUsados; capacidade += d.capacidadeMinutosSemana; qtdMaquinas++;
        (d.porDia || []).forEach(dia => (dia || []).forEach(seg => { if (seg.tipo === 'producao') caixas += Number(seg.caixasNoDia) || 0; }));
      }
    });
    const pct = capacidade > 0 ? Math.min(100, Math.round((usados / capacidade) * 100)) : 0;
    return { pct, horasUsadas: usados / 60, horasDisp: capacidade / 60, caixas, qtdMaquinas };
  }

  const STATUS_INFO = {
    ativa: { label: 'Ativa', cor: 'b-green' },
    manutencao: { label: 'Em manutenção', cor: 'b-yellow' },
    inativa: { label: 'Inativa', cor: 'b-red' },
  };

  // PEDIDO AO VIVO (comparação com o original achou isso faltando no card):
  // contagem + lista de solicitações ativas (pendente/em andamento) daquela
  // máquina — antes só mostrava a barra de ocupação, sem dizer o quê tá
  // pendente ali.
  function _pedidosAtivosMaquina(nome) {
    return _registros.filter(r => r.maquina === nome && (r.status === 'pendente' || r.status === 'em_andamento' || !r.status));
  }

  // PEDIDO AO VIVO (comparação com o original: Config lá é um hub que
  // mostra o conteúdo da seção DENTRO da mesma tela, não navega pra outra
  // página do menu principal). Aceita um id de container opcional — sem
  // ele, comportamento 100% igual a antes (renderiza na própria página do
  // menu principal).
  let _containerMaq = 'page-producao-maquinas';
  async function renderProducaoMaquinas(containerId) {
    _containerMaq = containerId || 'page-producao-maquinas';
    const pagina = document.getElementById(_containerMaq);
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoMaquinas(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoMaquinas();
  }

  function _desenharProducaoMaquinas() {
    const pagina = document.getElementById(_containerMaq);
    if (!pagina) return;
    const busca = String(document.getElementById('pmaq-busca')?.value || '').trim().toLowerCase();
    const catFiltro = String(document.getElementById('pmaq-filtro-categoria')?.value || '');
    const cards = _maquinas
      .filter(m => !busca || String(m.nome || '').toLowerCase().includes(busca) || String(m.categoria || '').toLowerCase().includes(busca))
      .filter(m => !catFiltro || m.categoria === catFiltro)
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    const ocupacaoTotal = _calcOcupacaoAgregada([]);
    const nomesSelecionados = [..._selecionadas];
    const ocupacaoSelecionadas = nomesSelecionados.length ? _calcOcupacaoAgregada(nomesSelecionados) : null;
    const categoriasFiltro = [...new Set(_maquinas.map(m => m.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    pagina.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.1rem">⚙️ Máquinas</div>
          <div style="font-size:.72rem;color:var(--muted)">${cards.length.toLocaleString('pt-BR')} máquina(s)</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="pmaq-busca" placeholder="Buscar nome ou categoria..." value="${esc(busca)}" class="field" style="min-width:220px">
          <select id="pmaq-filtro-categoria" class="field"><option value="">Todas as categorias</option>${categoriasFiltro.map(c => `<option value="${esc(c)}" ${catFiltro === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <button type="button" class="btn btn-ghost btn-sm" data-pmaq-resetar-turnos="1">↺ Resetar turnos de todas</button>
          <button type="button" class="btn btn-ghost btn-sm" data-pexcel-template-baixar="1">📄 Template</button>
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0">📥 Excel<input type="file" id="pexcel-template-input" accept=".xlsx,.xls" style="display:none"></label>
          <button type="button" class="btn btn-primary btn-sm" data-pmaq-novo="1">+ Nova Máquina</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px">
        <div class="tc" style="padding:12px 16px">
          <div style="font-size:.68rem;color:var(--muted)">Ocupação total da semana</div>
          <div style="font-size:1.3rem;font-weight:700">${ocupacaoTotal.pct}%</div>
          <div style="height:6px;border-radius:4px;background:var(--border);overflow:hidden;margin:5px 0 4px"><div style="height:100%;width:${ocupacaoTotal.pct}%;background:var(--orange)"></div></div>
          <div style="font-size:.66rem;color:var(--muted)">${ocupacaoTotal.horasUsadas.toFixed(1)}h prog. / ${ocupacaoTotal.horasDisp.toFixed(1)}h disp. · ${ocupacaoTotal.qtdMaquinas} máquina(s) · ${Math.round(ocupacaoTotal.caixas).toLocaleString('pt-BR')} cx programadas</div>
        </div>
        <div class="tc" style="padding:12px 16px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="font-size:.68rem;color:var(--muted)">Máquinas selecionadas (${nomesSelecionados.length})</div>
            ${nomesSelecionados.length ? '<button type="button" class="btn btn-ghost btn-sm" data-pmaq-limpar-selecao="1" style="padding:2px 8px">✕ Limpar</button>' : ''}
          </div>
          <div style="font-size:1.3rem;font-weight:700">${ocupacaoSelecionadas ? ocupacaoSelecionadas.pct + '%' : '—'}</div>
          ${ocupacaoSelecionadas ? `<div style="height:6px;border-radius:4px;background:var(--border);overflow:hidden;margin:5px 0 4px"><div style="height:100%;width:${ocupacaoSelecionadas.pct}%;background:var(--orange)"></div></div><div style="font-size:.66rem;color:var(--muted)">${ocupacaoSelecionadas.horasUsadas.toFixed(1)}h prog. / ${ocupacaoSelecionadas.horasDisp.toFixed(1)}h disp. · ${Math.round(ocupacaoSelecionadas.caixas).toLocaleString('pt-BR')} cx programadas</div>` : ''}
        </div>
      </div>
      ${cards.length ? `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px">
        ${cards.map(m => {
          const status = STATUS_INFO[m.status] || STATUS_INFO.ativa;
          const ocupacao = calcOcupacaoMaquina(m);
          const produtos = m.produtosCompativeis || [];
          const selecionada = _selecionadas.has(m.nome);
          const pedidosAtivos = _pedidosAtivosMaquina(m.nome);
          const caixasAtivas = pedidosAtivos.reduce((s, r) => s + (Number(r.qntCaixas) || 0), 0);
          return `
          <div class="tc" style="padding:14px;display:flex;flex-direction:column;gap:8px;${selecionada ? 'border:2px solid var(--orange)' : ''}">
            <div style="display:flex;align-items:start;justify-content:space-between;gap:8px">
              <div>
                <div style="font-weight:600">${esc(m.nome)}</div>
                <div style="font-size:.72rem;color:var(--muted)">${esc(m.categoria || '—')} · ${pedidosAtivos.length} solicit. · ${Math.round(caixasAtivas).toLocaleString('pt-BR')} cx</div>
              </div>
              <span class="badge ${status.cor}" style="font-size:.62rem">${status.label}</span>
            </div>
            ${pedidosAtivos.length ? `<div style="font-size:.68rem;color:var(--muted);display:flex;flex-direction:column;gap:2px">${pedidosAtivos.slice(0, 4).map(r => `<div>• ${esc(r.produto)} — ${Math.round(Number(r.qntCaixas) || 0).toLocaleString('pt-BR')} cx</div>`).join('')}${pedidosAtivos.length > 4 ? `<div>+ ${pedidosAtivos.length - 4} outra(s)</div>` : ''}</div>` : ''}
            <div style="font-size:.72rem;color:var(--muted)">
              ${produtos.length ? produtos.map(p => esc(p.produto) + ' (' + esc(p.velocidade) + '/min)').join(', ') : 'Nenhum produto compatível cadastrado'}
            </div>
            ${ocupacao > 100 ? `<div style="font-size:.66rem;color:var(--danger);font-weight:700">⚠ Excede em ${ocupacao - 100}%</div>` : ''}
            <div>
              <div style="display:flex;justify-content:space-between;font-size:.68rem;color:var(--muted);margin-bottom:3px">
                <span>Ocupação da semana</span><span>${ocupacao}%</span>
              </div>
              <div style="height:6px;border-radius:4px;background:var(--border);overflow:hidden">
                <div style="height:100%;width:${Math.min(100, ocupacao)}%;background:${ocupacao > 100 ? 'var(--danger)' : 'var(--orange)'}"></div>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;margin-top:4px">
              <button type="button" class="btn ${selecionada ? 'btn-primary' : 'btn-ghost'} btn-sm" data-pmaq-selecionar="${esc(m.nome)}" style="padding:3px 10px;font-size:.68rem">${selecionada ? 'Selecionado' : 'Selecionar'}</button>
              <div>
                <button type="button" class="acao-lapis" title="Editar" data-pmaq-editar="${esc(m._firestoreId)}">✏️</button>
                <button type="button" class="acao-lapis" title="Excluir" data-pmaq-excluir="${esc(m._firestoreId)}">🗑️</button>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>` : `<div class="empty"><div class="empty-icon">⚙️</div><div class="empty-title">Nenhuma máquina cadastrada</div><div class="empty-sub">Clique em "+ Nova Máquina" pra começar</div></div>`}
    `;
  }

  function _turnosDefault() {
    return { 0: [], 1: [{ ini: '08:00', fim: '17:00' }], 2: [{ ini: '08:00', fim: '17:00' }], 3: [{ ini: '08:00', fim: '17:00' }], 4: [{ ini: '08:00', fim: '17:00' }], 5: [{ ini: '08:00', fim: '17:00' }], 6: [] };
  }

  function _calcCapacidade() {
    const pcMin = Number(document.getElementById('pmaq-pcmin')?.value) || 0;
    const hTurno = Number(document.getElementById('pmaq-hturno')?.value) || 0;
    const nTurnos = Number(document.getElementById('pmaq-nturnos')?.value) || 0;
    const porHora = pcMin * 60, porTurno = porHora * hTurno, porDia = porTurno * nTurnos;
    const elHora = document.getElementById('pmaq-calc-hora'), elTurno = document.getElementById('pmaq-calc-turno'), elDia = document.getElementById('pmaq-calc-dia');
    if (elHora) elHora.textContent = porHora > 0 ? Math.round(porHora).toLocaleString('pt-BR') : '—';
    if (elTurno) elTurno.textContent = porTurno > 0 ? Math.round(porTurno).toLocaleString('pt-BR') : '—';
    if (elDia) elDia.textContent = porDia > 0 ? Math.round(porDia).toLocaleString('pt-BR') : '—';
  }

  async function _abrirModalPmaq(item) {
    // PEDIDO AO VIVO: o original mostra "Editar: NOME_DA_MÁQUINA" no título,
    // não um "Editar máquina" genérico.
    document.getElementById('pmaq-title').textContent = item._novo ? 'Nova Máquina' : 'Editar: ' + (item.nome || '');
    document.getElementById('pmaq-doc-id').value = item._firestoreId || '';
    document.getElementById('pmaq-nome').value = item.nome || '';
    document.getElementById('pmaq-codigo').value = item.codigo || '';
    document.getElementById('pmaq-tipo').value = item.tipo || '';
    document.getElementById('pmaq-setor').value = item.setor || '';
    const selCat = document.getElementById('pmaq-categoria');
    const opcoesCat = _categorias.map(c => c.nome).filter(Boolean);
    if (item.categoria && !opcoesCat.includes(item.categoria)) opcoesCat.push(item.categoria);
    selCat.innerHTML = '<option value="">— Sem categoria —</option>' + opcoesCat.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    selCat.value = item.categoria || '';
    document.getElementById('pmaq-classificacao').value = item.classificacao || '';
    document.getElementById('pmaq-pcmin').value = item.pcMin ?? '';
    document.getElementById('pmaq-hturno').value = item.hTurno ?? 8;
    document.getElementById('pmaq-nturnos').value = item.nTurnos ?? 1;
    document.getElementById('pmaq-status').value = item.status || 'ativa';
    document.getElementById('pmaq-eficiencia').value = item.eficiencia ?? 100;
    document.getElementById('pmaq-setup-padrao').value = item.setupPadraoMin ?? item.tempoSetupPadrao ?? '';
    _produtosEditando = (item.produtosCompativeis || []).map(p => ({ produto: p.produto || '', velocidade: p.velocidade || 0 }));
    _redesenharProdutosEditando();
    _turnosEditando = item.turnos ? JSON.parse(JSON.stringify(item.turnos)) : _turnosDefault();
    for (let d = 0; d <= 6; d++) if (!Array.isArray(_turnosEditando[d])) _turnosEditando[d] = [];
    await _carregarAtalhos();
    _redesenharTurnosEditando();
    _calcCapacidade();
    global.openModal?.('modal-pmaq');
  }

  function _redesenharProdutosEditando() {
    const wrap = document.getElementById('pmaq-produtos-list');
    if (!wrap) return;
    wrap.innerHTML = _produtosEditando.map((p, i) => `
      <div style="display:flex;gap:6px;align-items:center">
        <input class="field" style="flex:2" placeholder="Produto" value="${esc(p.produto)}" data-pmaq-campo="produto" data-pmaq-idx="${i}">
        <input class="field" style="flex:1" type="number" step="any" min="0" placeholder="Velocidade/min" value="${esc(p.velocidade)}" data-pmaq-campo="velocidade" data-pmaq-idx="${i}">
        <button type="button" class="btn btn-ghost btn-sm" data-pmaq-remover-produto="${i}">✕</button>
      </div>`).join('') || '<div style="font-size:.75rem;color:var(--muted)">Nenhum produto compatível ainda.</div>';
  }

  function _redesenharTurnosEditando() {
    const wrap = document.getElementById('pmaq-turnos-list');
    if (!wrap) return;
    const atalhos = _atalhos || ATALHOS_DEFAULT;
    const botoesAtalho = dia => Object.keys(atalhos).map(chave => `<button type="button" class="btn btn-ghost btn-sm" style="padding:2px 6px;font-size:.62rem" data-pmaq-turno-atalho-dia="${dia}" data-pmaq-turno-atalho-chave="${chave}" title="${esc(atalhos[chave].ini)}-${esc(atalhos[chave].fim)}">${chave}</button>`).join('');
    wrap.innerHTML = DIA_LABEL.map((label, dia) => {
      const faixas = _turnosEditando[dia] || [];
      return `
      <div style="display:flex;gap:8px;align-items:start;padding:4px 0;border-bottom:1px solid var(--border)">
        <div style="width:36px;font-size:.72rem;color:var(--muted);padding-top:6px">${label}</div>
        <div style="flex:1;display:flex;flex-direction:column;gap:4px">
          ${faixas.map((f, i) => `
            <div style="display:flex;gap:6px;align-items:center">
              <input class="field" style="flex:1" type="time" value="${esc(f.ini)}" data-pmaq-turno-dia="${dia}" data-pmaq-turno-idx="${i}" data-pmaq-turno-campo="ini">
              <input class="field" style="flex:1" type="time" value="${esc(f.fim)}" data-pmaq-turno-dia="${dia}" data-pmaq-turno-idx="${i}" data-pmaq-turno-campo="fim">
              <button type="button" class="btn btn-ghost btn-sm" data-pmaq-turno-remover-dia="${dia}" data-pmaq-turno-remover-idx="${i}">✕</button>
            </div>`).join('') || '<div style="font-size:.68rem;color:var(--muted)">Sem turno neste dia.</div>'}
          <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
            <button type="button" class="btn btn-ghost btn-sm" data-pmaq-turno-add-dia="${dia}">+ faixa</button>
            ${botoesAtalho(dia)}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  function pmaqProdutoAlterado(i, campo, valor) {
    if (!_produtosEditando[i]) return;
    _produtosEditando[i][campo] = campo === 'velocidade' ? (parseFloat(String(valor).replace(',', '.')) || 0) : valor;
  }
  function pmaqAdicionarProduto() { _produtosEditando.push({ produto: '', velocidade: 0 }); _redesenharProdutosEditando(); }
  function pmaqRemoverProduto(i) { _produtosEditando.splice(i, 1); _redesenharProdutosEditando(); }

  function pmaqTurnoFaixaAlterada(dia, idx, campo, valor) {
    if (!_turnosEditando[dia] || !_turnosEditando[dia][idx]) return;
    _turnosEditando[dia][idx][campo] = valor;
  }
  function pmaqTurnoAdicionarFaixa(dia) {
    (_turnosEditando[dia] = _turnosEditando[dia] || []).push({ ini: '08:00', fim: '17:00' });
    _redesenharTurnosEditando();
  }
  function pmaqTurnoRemoverFaixa(dia, idx) {
    if (!_turnosEditando[dia]) return;
    _turnosEditando[dia].splice(idx, 1);
    _redesenharTurnosEditando();
  }
  // Atalho T1/T2/T3 — substitui TODAS as faixas daquele dia por uma única
  // faixa igual ao horário do atalho clicado (mesma semântica da original).
  function pmaqTurnoAplicarAtalho(dia, chave) {
    const atalho = (_atalhos || ATALHOS_DEFAULT)[chave];
    if (!atalho) return;
    _turnosEditando[dia] = [{ ini: atalho.ini, fim: atalho.fim }];
    _redesenharTurnosEditando();
  }

  function pmaqEditar(docId) {
    const item = _maquinas.find(m => m._firestoreId === docId);
    if (!item) return;
    _abrirModalPmaq(item);
  }

  function pmaqNovaMaquina() {
    _abrirModalPmaq({ _novo: true, nome: '', codigo: '', tipo: '', setor: '', categoria: '', classificacao: '', status: 'ativa', pcMin: 0, eficiencia: 100, hTurno: 8, nTurnos: 1, tempoSetupPadrao: 0, produtosCompativeis: [] });
  }

  function pmaqSelecionarToggle(nome) {
    if (_selecionadas.has(nome)) _selecionadas.delete(nome); else _selecionadas.add(nome);
    _desenharProducaoMaquinas();
  }
  function pmaqLimparSelecao() { _selecionadas.clear(); _desenharProducaoMaquinas(); }

  async function pmaqSalvar() {
    const nome = String(document.getElementById('pmaq-nome').value || '').trim().toUpperCase();
    if (!nome) { global.showToast?.('Informe o nome da máquina.', 'error'); return; }
    const docId = document.getElementById('pmaq-doc-id').value || '';
    const duplicada = _maquinas.find(m => String(m.nome || '').trim().toUpperCase() === nome && m._firestoreId !== docId);
    if (duplicada) { global.showToast?.('Máquina já cadastrada.', 'error'); return; }
    const codigo = String(document.getElementById('pmaq-codigo').value || '').trim();
    const tipo = String(document.getElementById('pmaq-tipo').value || '').trim();
    const setor = String(document.getElementById('pmaq-setor').value || '').trim();
    const categoria = String(document.getElementById('pmaq-categoria').value || '').trim();
    const classificacao = String(document.getElementById('pmaq-classificacao').value || '').trim();
    const pcMin = Math.max(0, Number(document.getElementById('pmaq-pcmin').value) || 0);
    const hTurno = Math.max(0, Number(document.getElementById('pmaq-hturno').value) || 8);
    const nTurnos = Math.max(1, Number(document.getElementById('pmaq-nturnos').value) || 1);
    const status = document.getElementById('pmaq-status').value || 'ativa';
    const eficiencia = Math.max(0, Math.min(100, Number(document.getElementById('pmaq-eficiencia').value) || 100));
    const setupPadraoMinVal = document.getElementById('pmaq-setup-padrao').value;
    const setupPadraoMin = setupPadraoMinVal === '' ? 0 : Math.max(0, Number(setupPadraoMinVal) || 0);
    const produtosCompativeis = _produtosEditando.filter(p => p.produto);
    const turnos = {};
    for (let d = 0; d <= 6; d++) turnos[d] = (_turnosEditando[d] || []).filter(f => f.ini && f.fim);
    const agora = new Date().toISOString();
    // Compatibilidade total com o modelo da Produção original.
    // Mantemos os aliases setupPadraoMin/tempoSetupPadrao porque módulos antigos e novos
    // usam nomes diferentes para o mesmo dado.
    const payload = { nome, codigo, tipo, setor, categoria, classificacao, status, pcMin, eficiencia, hTurno, nTurnos, setupPadraoMin, tempoSetupPadrao: setupPadraoMin, produtosCompativeis, turnos, ativo: status === 'ativa', atualizadoEm: agora };

    try {
      if (docId) {
        await fs().collection(COL_MAQUINAS).doc(docId).set(payload, { merge: true });
      } else {
        payload.criadoEm = agora;
        await fs().collection(COL_MAQUINAS).add(payload);
      }
      global.closeModal?.('modal-pmaq');
      global.showToast?.('Máquina salva.', 'success');
      await carregarProducaoMaquinas(true);
      _desenharProducaoMaquinas();
    } catch (e) {
      global.showToast?.('Erro ao salvar: ' + (e.message || e), 'error');
    }
  }

  async function pmaqExcluir(docId) {
    const maquina = _maquinas.find(m => m._firestoreId === docId);
    if (!maquina) return;
    const executar = async () => {
      try {
        await fs().collection(COL_MAQUINAS).doc(docId).delete();
        global.showToast?.('Máquina excluída.', 'success');
        await carregarProducaoMaquinas(true);
        _desenharProducaoMaquinas();
      } catch (e) {
        global.showToast?.('Erro ao excluir: ' + (e.message || e), 'error');
      }
    };
    if (global.showConfirm) global.showConfirm('Excluir a máquina "' + maquina.nome + '"?', executar, { title: 'Excluir máquina', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
    else if (confirm('Excluir a máquina "' + maquina.nome + '"?')) await executar();
  }

  // ── Copiar turnos da máquina em edição pra todas as outras ──────────────
  async function pmaqCopiarTurnos() {
    const docIdAtual = document.getElementById('pmaq-doc-id').value || '';
    const turnos = {};
    for (let d = 0; d <= 6; d++) turnos[d] = (_turnosEditando[d] || []).filter(f => f.ini && f.fim);
    const destino = _maquinas.filter(m => m._firestoreId !== docIdAtual);
    if (!destino.length) { global.showToast?.('Não há outras máquinas cadastradas.', 'error'); return; }
    const executar = async () => {
      try {
        await Promise.all(destino.map(m => fs().collection(COL_MAQUINAS).doc(m._firestoreId).set({ turnos, atualizadoEm: new Date().toISOString() }, { merge: true })));
        global.showToast?.('Turnos copiados pra ' + destino.length + ' máquina(s).', 'success');
        await carregarProducaoMaquinas(true);
      } catch (e) {
        global.showToast?.('Erro ao copiar: ' + (e.message || e), 'error');
      }
    };
    const msg = 'Copiar esses turnos pra TODAS as outras ' + destino.length + ' máquina(s)? Isso substitui a configuração atual delas.';
    if (global.showConfirm) global.showConfirm(msg, executar, { title: 'Copiar turnos', icon: '📋', okLabel: 'Copiar' });
    else if (confirm(msg)) await executar();
  }

  // ── Resetar turnos de todas as máquinas pro default ─────────────────────
  async function pmaqResetarTurnos() {
    if (!_maquinas.length) return;
    const executar = async () => {
      try {
        const turnosPadrao = _turnosDefault();
        await Promise.all(_maquinas.map(m => fs().collection(COL_MAQUINAS).doc(m._firestoreId).set({ turnos: turnosPadrao, atualizadoEm: new Date().toISOString() }, { merge: true })));
        global.showToast?.('Turnos resetados pro padrão em todas as máquinas.', 'success');
        await carregarProducaoMaquinas(true);
        _desenharProducaoMaquinas();
      } catch (e) {
        global.showToast?.('Erro ao resetar: ' + (e.message || e), 'error');
      }
    };
    const msg = 'Resetar os turnos de TODAS as ' + _maquinas.length + ' máquina(s) pro padrão (Seg-Sex 08h-17h, fim de semana sem turno)? Essa ação não pode ser desfeita.';
    if (global.showConfirm) global.showConfirm(msg, executar, { title: 'Resetar turnos', icon: '↺', okLabel: 'Resetar', okClass: 'btn-danger' });
    else if (confirm(msg)) await executar();
  }

  // ── Modal de atalhos T1/T2/T3 (editáveis, Firestore-backed por loja) ────
  async function pmaqAtalhosAbrir() {
    await _carregarAtalhos();
    const wrap = document.getElementById('pmaq-atalhos-list');
    wrap.innerHTML = Object.keys(_atalhos).map(chave => `
      <div style="display:flex;gap:8px;align-items:center">
        <div style="width:28px;font-weight:700">${chave}</div>
        <input class="field" style="flex:1" type="time" value="${esc(_atalhos[chave].ini)}" data-pmaq-atalho-campo="ini" data-pmaq-atalho-chave="${chave}">
        <input class="field" style="flex:1" type="time" value="${esc(_atalhos[chave].fim)}" data-pmaq-atalho-campo="fim" data-pmaq-atalho-chave="${chave}">
      </div>`).join('');
    global.openModal?.('modal-pmaq-atalhos');
  }
  function pmaqAtalhoCampoAlterado(chave, campo, valor) {
    if (!_atalhos || !_atalhos[chave]) return;
    _atalhos[chave][campo] = valor;
  }
  async function pmaqAtalhosSalvar() {
    try {
      await fs().collection(COL_CONFIG).doc('turnos_atalhos').set(_atalhos, { merge: true });
      global.closeModal?.('modal-pmaq-atalhos');
      global.showToast?.('Atalhos de turno salvos.', 'success');
      _redesenharTurnosEditando();
    } catch (e) {
      global.showToast?.('Erro ao salvar atalhos: ' + (e.message || e), 'error');
    }
  }

  global.renderProducaoMaquinas = renderProducaoMaquinas;
  global._desenharProducaoMaquinas = _desenharProducaoMaquinas;
  global.pmaqAdicionarProduto = pmaqAdicionarProduto;
  global.pmaqRemoverProduto = pmaqRemoverProduto;
  global.pmaqProdutoAlterado = pmaqProdutoAlterado;
  global.pmaqEditar = pmaqEditar;
  global.pmaqNovaMaquina = pmaqNovaMaquina;
  global.pmaqSalvar = pmaqSalvar;
  global.pmaqExcluir = pmaqExcluir;
  global.pmaqAtalhosAbrir = pmaqAtalhosAbrir;
  global.pmaqAtalhosSalvar = pmaqAtalhosSalvar;

  // Tudo abaixo é gerado via innerHTML (grid de cards, linhas de produto
  // compatível, linhas de turno) — usa data-* + escutador delegado em vez de
  // onclick/oninput/onchange inline, que não dispara de forma confiável
  // quando injetado dinamicamente (mesma correção aplicada na Ficha
  // Técnica, fase 2).
  document.addEventListener('click', function (event) {
    const novo = event.target.closest('[data-pmaq-novo]');
    if (novo) { pmaqNovaMaquina(); return; }
    const editar = event.target.closest('[data-pmaq-editar]');
    if (editar) { pmaqEditar(editar.getAttribute('data-pmaq-editar')); return; }
    const excluir = event.target.closest('[data-pmaq-excluir]');
    if (excluir) { pmaqExcluir(excluir.getAttribute('data-pmaq-excluir')); return; }
    const remover = event.target.closest('[data-pmaq-remover-produto]');
    if (remover) { pmaqRemoverProduto(Number(remover.getAttribute('data-pmaq-remover-produto'))); return; }
    const addFaixa = event.target.closest('[data-pmaq-turno-add-dia]');
    if (addFaixa) { pmaqTurnoAdicionarFaixa(Number(addFaixa.getAttribute('data-pmaq-turno-add-dia'))); return; }
    const remFaixa = event.target.closest('[data-pmaq-turno-remover-dia]');
    if (remFaixa) { pmaqTurnoRemoverFaixa(Number(remFaixa.getAttribute('data-pmaq-turno-remover-dia')), Number(remFaixa.getAttribute('data-pmaq-turno-remover-idx'))); return; }
    const atalhoDia = event.target.closest('[data-pmaq-turno-atalho-dia]');
    if (atalhoDia) { pmaqTurnoAplicarAtalho(Number(atalhoDia.getAttribute('data-pmaq-turno-atalho-dia')), atalhoDia.getAttribute('data-pmaq-turno-atalho-chave')); return; }
    const selecionar = event.target.closest('[data-pmaq-selecionar]');
    if (selecionar) { pmaqSelecionarToggle(selecionar.getAttribute('data-pmaq-selecionar')); return; }
    const limparSel = event.target.closest('[data-pmaq-limpar-selecao]');
    if (limparSel) { pmaqLimparSelecao(); return; }
    const copiarTurnos = event.target.closest('[data-pmaq-copiar-turnos]');
    if (copiarTurnos) { pmaqCopiarTurnos(); return; }
    const resetarTurnos = event.target.closest('[data-pmaq-resetar-turnos]');
    if (resetarTurnos) { pmaqResetarTurnos(); return; }
  });
  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'pmaq-busca') _desenharProducaoMaquinas();
    if (event.target && ['pmaq-pcmin', 'pmaq-hturno', 'pmaq-nturnos'].includes(event.target.id)) _calcCapacidade();
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'pmaq-filtro-categoria') { _desenharProducaoMaquinas(); return; }
    const campo = event.target.closest('[data-pmaq-campo]');
    if (campo) { pmaqProdutoAlterado(Number(campo.getAttribute('data-pmaq-idx')), campo.getAttribute('data-pmaq-campo'), campo.value); return; }
    const turnoCampo = event.target.closest('[data-pmaq-turno-campo]');
    if (turnoCampo) { pmaqTurnoFaixaAlterada(Number(turnoCampo.getAttribute('data-pmaq-turno-dia')), Number(turnoCampo.getAttribute('data-pmaq-turno-idx')), turnoCampo.getAttribute('data-pmaq-turno-campo'), turnoCampo.value); return; }
    const atalhoCampo = event.target.closest('[data-pmaq-atalho-campo]');
    if (atalhoCampo) pmaqAtalhoCampoAlterado(atalhoCampo.getAttribute('data-pmaq-atalho-chave'), atalhoCampo.getAttribute('data-pmaq-atalho-campo'), atalhoCampo.value);
  });
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _maquinas=[]; _registros=[]; _setups=[]; _produtosEditando=[]; _turnosEditando={}; _atalhos=null; _selecionadas.clear(); });
})(window);
