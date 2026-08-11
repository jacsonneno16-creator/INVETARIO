// Setor Produção — Gantt semanal (fase 3c: grade somente-leitura; fase 3d:
// arrastar-e-soltar). Usa o motor de agenda simplificado
// (`buildProducaoSchedule`, 63-producao-agenda.js) pra distribuir as OPs de
// `producao_registros` pelos dias da semana, respeitando os turnos de cada
// máquina (editados no modal de Máquinas). Barras com largura/posição
// proporcional ao tempo ocupado dentro do dia (sem texto de produto dentro
// da barra, só no tooltip). Clicar numa barra abre o mesmo modal de edição
// já usado na Programação.
//
// Arrastar-e-soltar (fase 3d) replica os DOIS mecanismos distintos da
// original, com o mesmo drag-and-drop HTML5 nativo (sem lib):
// - Arrastar uma barra pra outro dia (mesma máquina) muda só o campo `data`
//   do registro.
// - Modal "Reordenar fila" (por máquina) muda só o campo `sortOrder`, sem
//   tocar em `data`/`maquina`.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_MAQUINAS = 'producao_maquinas';
  const COL_REGISTROS = 'producao_registros';
  const COL_SETUP = 'producao_setup';
  const DIA_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const PALETA_CORES = ['#E8751A', '#1E56D4', '#15803D', '#8A5C00', '#5B21B6', '#0A5E56', '#9E1A1A', '#3E5168', '#C45E0E', '#1A4BAD', '#116235', '#873608'];
  const STATUS_INFO = { pendente: { label: 'Pendente', cor: 'b-orange' }, em_andamento: { label: 'Em andamento', cor: 'b-blue' }, concluido: { label: 'Concluído', cor: 'b-green' } };

  let _maquinas = [];
  let _registros = [];
  let _setups = [];
  let _carregado = false;
  let _weekStart = _domingoDaSemana(new Date());
  let _modoGantt = 'semanal';
  let _mesRef = new Date();
  let _diagnosticoAberto = false;
  const _corPorRegistro = {};
  let _reorderItems = [];
  let _dragReorderIdx = null;

  function fs() { return global.getDTFirestore(); }
  function podeEditarGantt() { return typeof global.temPermissao !== 'function' || global.temPermissao('producao-gantt', 'editar'); }
  function podeReordenarGantt() { return typeof global.temPermissao !== 'function' || global.temPermissao('producao-gantt', 'reordenar'); }

  function _domingoDaSemana(d) {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    r.setDate(r.getDate() - r.getDay());
    return r;
  }
  function _isoData(d) { return d.toISOString().slice(0, 10); }

  function _corDoRegistro(registroId) {
    if (!_corPorRegistro[registroId]) {
      const idx = Object.keys(_corPorRegistro).length % PALETA_CORES.length;
      _corPorRegistro[registroId] = PALETA_CORES[idx];
    }
    return _corPorRegistro[registroId];
  }

  async function carregarProducaoGantt(forcar) {
    if (_carregado && !forcar) return;
    const [snapMaq, snapReg, snapSetup] = await Promise.all([
      fs().collection(COL_MAQUINAS).get(),
      fs().collection(COL_REGISTROS).get(),
      fs().collection(COL_SETUP).get(),
    ]);
    _maquinas = snapMaq.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _registros = snapReg.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _setups = snapSetup.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    _carregado = true;
  }

  async function renderProducaoGantt() {
    const pagina = document.getElementById('page-producao-gantt');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoGantt(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoGantt();
  }

  function _fmtDataCurta(d) { return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }

  function _numTurnosAtivos(maquina, diasSemana) {
    if (typeof global.getTurnoMinutosDoDia !== 'function') return 0;
    return diasSemana.filter(d => global.getTurnoMinutosDoDia(maquina, d.getDay()) > 0).length;
  }

  function _toolbarComum() {
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.1rem">📅 Gantt — Programação</div>
          <div style="font-size:.72rem;color:var(--muted)">${_modoGantt === 'semanal' ? _fmtDataCurta(_weekStart) + ' a ' + _fmtDataCurta(_fimSemana()) : _mesRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button type="button" class="btn ${_modoGantt === 'semanal' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-pgantt-modo="semanal">Semanal</button>
          <button type="button" class="btn ${_modoGantt === 'mensal' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-pgantt-modo="mensal">Mensal</button>
          ${_modoGantt === 'semanal' ? `
            <button type="button" class="btn btn-ghost btn-sm" data-pgantt-semana="-1">‹ Semana anterior</button>
            <button type="button" class="btn btn-ghost btn-sm" data-pgantt-hoje="1">Hoje</button>
            <button type="button" class="btn btn-ghost btn-sm" data-pgantt-semana="1">Próxima semana ›</button>
            ${podeReordenarGantt() ? `<button type="button" class="btn btn-ghost btn-sm" data-pgantt-reordenar="1">⇅ Reordenar fila</button>` : ''}
          ` : `
            <button type="button" class="btn btn-ghost btn-sm" data-pgantt-mes="-1">‹ Mês anterior</button>
            <button type="button" class="btn btn-ghost btn-sm" data-pgantt-mes-hoje="1">Hoje</button>
            <button type="button" class="btn btn-ghost btn-sm" data-pgantt-mes="1">Próximo mês ›</button>
          `}
        </div>
      </div>
      <div class="tc" style="margin-bottom:14px">
        <div style="padding:8px 12px;display:flex;align-items:center;justify-content:space-between;cursor:pointer" data-pgantt-diagnostico-toggle="1">
          <div style="font-size:.76rem;font-weight:600">🔧 Diagnóstico de setup faltando</div>
          <div style="font-size:.7rem;color:var(--muted)">${_diagnosticoAberto ? '▲ ocultar' : '▼ mostrar'}</div>
        </div>
        ${_diagnosticoAberto ? _painelDiagnosticoSetup() : ''}
      </div>
    `;
  }

  function _fimSemana() { const f = new Date(_weekStart); f.setDate(f.getDate() + 6); return f; }

  function _painelDiagnosticoSetup() {
    const maquinasPorNome = {}; _maquinas.forEach(m => { maquinasPorNome[m.nome] = m; });
    const pares = [];
    const vistos = new Set();
    Object.keys(maquinasPorNome).forEach(nomeMaquina => {
      const fila = _registros.filter(r => r.maquina === nomeMaquina && r.status !== 'concluido').sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      let anterior = null;
      fila.forEach(rec => {
        if (anterior && anterior !== rec.produto) {
          const chave = nomeMaquina + '||' + anterior + '||' + rec.produto;
          if (!vistos.has(chave)) {
            vistos.add(chave);
            const temEspecifico = _setups.some(s => s.maquina === nomeMaquina && s.produtoOrigem === anterior && s.produtoDestino === rec.produto);
            if (!temEspecifico) {
              const maquina = maquinasPorNome[nomeMaquina];
              const padrao = Number(maquina?.setupPadraoMin) || 0;
              pares.push({ maquina: nomeMaquina, origem: anterior, destino: rec.produto, assumido: padrao });
            }
          }
        }
        anterior = rec.produto;
      });
    });
    if (!pares.length) return '<div style="padding:0 12px 10px;font-size:.72rem;color:var(--muted)">Todos os pares de troca de produto na fila têm tempo de setup específico cadastrado. 👍</div>';
    return `<div style="padding:0 12px 10px;overflow:auto"><table class="dt-table" style="font-size:.72rem">
      <thead><tr><th>Máquina</th><th>De</th><th>Para</th><th>Assumido</th></tr></thead>
      <tbody>${pares.map(p => `<tr><td>${esc(p.maquina)}</td><td>${esc(p.origem)}</td><td>${esc(p.destino)}</td><td>${p.assumido > 0 ? p.assumido + 'min (padrão da máquina)' : '0min assumido'}</td></tr>`).join('')}</tbody>
      </table></div>`;
  }

  function _desenharProducaoGantt() {
    const pagina = document.getElementById('page-producao-gantt');
    if (!pagina) return;
    if (typeof global.buildProducaoSchedule !== 'function') {
      pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Motor de agenda não carregado</div></div>';
      return;
    }
    pagina.innerHTML = _toolbarComum() + (_modoGantt === 'mensal' ? _corpoMensal() : _corpoSemanal());
  }

  function _corpoSemanal() {
    const maquinasPorNome = {};
    _maquinas.forEach(m => { maquinasPorNome[m.nome] = m; });
    const resultado = global.buildProducaoSchedule(_weekStart, _registros, maquinasPorNome, _setups);
    const nomesComOPs = Object.keys(resultado.porMaquina)
      .filter(nome => resultado.porMaquina[nome].porDia.some(dia => dia.length))
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));

    const diasSemana = Array.from({ length: 7 }, (_, i) => { const d = new Date(_weekStart); d.setDate(d.getDate() + i); return d; });
    const hojeStr = new Date().toDateString();
    const arrastavel = podeEditarGantt();

    if (!nomesComOPs.length) return `<div class="empty"><div class="empty-icon">📅</div><div class="empty-title">Nenhuma OP agendada nesta semana</div><div class="empty-sub">Cadastre uma Ordem de Produção com data dentro deste período (Programação) e configure os turnos da máquina (Máquinas)</div></div>`;

    return `
      <div class="gantt-head-row" style="display:grid;grid-template-columns:170px repeat(7,1fr);gap:6px;padding:0 2px;margin-bottom:6px">
        <div></div>
        ${diasSemana.map(d => `<div style="text-align:center;font-size:.66rem;font-weight:700;color:${d.toDateString() === hojeStr ? 'var(--orange)' : 'var(--muted)'}">${DIA_LABEL[d.getDay()]}<br>${_fmtDataCurta(d)}</div>`).join('')}
      </div>
      ${nomesComOPs.map(nome => {
        const maquina = maquinasPorNome[nome] || {};
        const dados = resultado.porMaquina[nome];
        const ocupacao = dados.capacidadeMinutosSemana > 0 ? Math.round((dados.totalMinutosUsados / dados.capacidadeMinutosSemana) * 100) : 0;
        const turnosAtivos = _numTurnosAtivos(maquina, diasSemana);
        return `
        <div class="tc" style="padding:10px 12px;margin-bottom:10px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap">
            <div style="font-weight:700">🏭 ${esc(nome)}</div>
            <div style="font-size:.68rem;color:var(--muted);display:flex;gap:10px">
              <span>${turnosAtivos} dia(s) com turno</span>
              <span>${ocupacao}% ocupada</span>
            </div>
          </div>
          <div style="height:5px;border-radius:4px;background:var(--border);overflow:hidden;margin-bottom:10px">
            <div style="height:100%;width:${ocupacao}%;background:var(--orange)"></div>
          </div>
          <div style="display:grid;grid-template-columns:170px repeat(7,1fr);gap:6px;align-items:stretch">
            <div style="font-size:.68rem;color:var(--muted);align-self:center">Ocupação do dia</div>
            ${dados.porDia.map((segmentosDoDia, dayIdx) => {
              const capacidadeDia = segmentosDoDia[0]?.capacidadeDoDiaMin || (typeof global.getTurnoMinutosDoDia === 'function' ? global.getTurnoMinutosDoDia(maquina, dayIdx) : 0);
              return `
              <div data-pgantt-day-drop="${dayIdx}" data-pgantt-day-maquina="${esc(nome)}" style="position:relative;height:26px;background:var(--surface-2);border-radius:5px;overflow:hidden">
                ${capacidadeDia > 0 ? segmentosDoDia.map(seg => {
                  const leftPct = Math.max(0, Math.min(100, (seg.inicioMin / capacidadeDia) * 100));
                  const widthPct = Math.max(2, Math.min(100 - leftPct, (seg.minutosNoDia / capacidadeDia) * 100));
                  const ehSetup = seg.tipo === 'setup';
                  const arrastavelBar = arrastavel && !ehSetup;
                  return `<div data-pgantt-bar="${esc(seg.registroId)}" data-pgantt-bar-maquina="${esc(nome)}" data-pgantt-bar-produto="${esc(seg.produto)}" data-pgantt-bar-caixas="${esc(seg.caixasNoDia)}" data-pgantt-bar-horas="${(seg.minutosNoDia / 60).toFixed(1)}" data-pgantt-bar-tipo="${ehSetup ? 'setup' : 'producao'}" ${arrastavelBar ? 'draggable="true"' : ''}
                    style="position:absolute;top:${ehSetup ? '7px' : '2px'};bottom:${ehSetup ? '7px' : '2px'};left:${leftPct}%;width:${widthPct}%;background:${ehSetup ? 'repeating-linear-gradient(45deg,#9CA3AF,#9CA3AF 4px,#D1D5DB 4px,#D1D5DB 8px)' : _corDoRegistro(seg.registroId)};border-radius:3px;cursor:${arrastavelBar ? 'grab' : 'pointer'}"></div>`;
                }).join('') : ''}
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
    `;
  }

  function _corpoMensal() {
    const maquinasPorNome = {};
    _maquinas.forEach(m => { maquinasPorNome[m.nome] = m; });
    const ano = _mesRef.getFullYear(), mes = _mesRef.getMonth();
    const primeiroDia = new Date(ano, mes, 1), ultimoDia = new Date(ano, mes + 1, 0);
    const semanas = [];
    let cursor = _domingoDaSemana(primeiroDia);
    while (cursor <= ultimoDia) { semanas.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 7); }

    const matriz = {}; // { 'maquina||produto': [totalPorSemana...] }
    let capacidadeTotalPorSemana = semanas.map(() => 0);
    semanas.forEach((semanaInicio, wIdx) => {
      const resultado = global.buildProducaoSchedule(semanaInicio, _registros, maquinasPorNome, _setups);
      Object.keys(resultado.porMaquina).forEach(nome => {
        const dados = resultado.porMaquina[nome];
        capacidadeTotalPorSemana[wIdx] += dados.capacidadeMinutosSemana;
        dados.porDia.forEach(segs => segs.forEach(seg => {
          if (seg.tipo !== 'producao') return;
          const chave = nome + '||' + seg.produto;
          (matriz[chave] = matriz[chave] || semanas.map(() => 0))[wIdx] += seg.caixasNoDia;
        }));
      });
    });

    const linhas = Object.keys(matriz).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (!linhas.length) return '<div class="empty"><div class="empty-icon">📅</div><div class="empty-title">Nenhuma OP agendada neste mês</div></div>';
    return `<div class="tc"><div style="overflow:auto"><table class="dt-table">
      <thead><tr><th>Máquina</th><th>Produto</th>${semanas.map((s, i) => `<th>Sem ${i + 1}<br><span style="font-size:.6rem;color:var(--muted)">${_fmtDataCurta(s)}</span></th>`).join('')}</tr></thead>
      <tbody>
        ${linhas.map(chave => {
          const [maquina, produto] = chave.split('||');
          return `<tr><td>${esc(maquina)}</td><td>${esc(produto)}</td>${matriz[chave].map(v => `<td>${v ? v.toLocaleString('pt-BR') : '—'}</td>`).join('')}</tr>`;
        }).join('')}
        <tr style="background:var(--surface-2);font-weight:700"><td colspan="2">CAP. (h/semana, todas as máquinas)</td>${capacidadeTotalPorSemana.map(v => `<td>${Math.round(v / 60).toLocaleString('pt-BR')}h</td>`).join('')}</tr>
      </tbody>
      </table></div></div>`;
  }

  // ── Tooltip rico ao passar o mouse na barra (produto, caixas, horas,
  // status) — a original tinha um painel de detalhe parecido
  // (gantt-interactive.js); aqui é um card leve, sem exigir clique. ──
  function _tooltipEl() {
    let el = document.getElementById('pgantt-tooltip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pgantt-tooltip';
      el.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.14);padding:8px 10px;font-size:.74rem;max-width:240px;display:none';
      document.body.appendChild(el);
    }
    return el;
  }
  function _mostrarTooltipBar(barEl, event) {
    const registroId = barEl.getAttribute('data-pgantt-bar');
    const registro = _registros.find(r => r._firestoreId === registroId);
    const ehSetup = barEl.getAttribute('data-pgantt-bar-tipo') === 'setup';
    const el = _tooltipEl();
    if (ehSetup) {
      el.innerHTML = `<div style="font-weight:700;margin-bottom:3px">🔧 ${esc(barEl.getAttribute('data-pgantt-bar-produto'))}</div>
        <div style="color:var(--muted)">${esc(barEl.getAttribute('data-pgantt-bar-horas'))}h de setup</div>`;
    } else {
      const status = STATUS_INFO[registro?.status] || STATUS_INFO.pendente;
      el.innerHTML = `<div style="font-weight:700;margin-bottom:3px">${esc(barEl.getAttribute('data-pgantt-bar-produto'))}</div>
        <div style="color:var(--muted)">${esc(barEl.getAttribute('data-pgantt-bar-caixas'))} cx · ${esc(barEl.getAttribute('data-pgantt-bar-horas'))}h</div>
        <div style="margin-top:4px"><span class="badge ${status.cor}">${status.label}</span></div>`;
    }
    el.style.display = 'block';
    _posicionarTooltip(el, event);
  }
  function _posicionarTooltip(el, event) {
    const margem = 14;
    let x = event.clientX + margem, y = event.clientY + margem;
    const rect = el.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) x = event.clientX - rect.width - margem;
    if (y + rect.height > window.innerHeight) y = event.clientY - rect.height - margem;
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }
  function _escondertooltip() { const el = document.getElementById('pgantt-tooltip'); if (el) el.style.display = 'none'; }

  function pganttSemana(dir) {
    _weekStart.setDate(_weekStart.getDate() + dir * 7);
    _desenharProducaoGantt();
  }
  function pganttHoje() {
    _weekStart = _domingoDaSemana(new Date());
    _desenharProducaoGantt();
  }
  function pganttModo(modo) { _modoGantt = modo; _desenharProducaoGantt(); }
  function pganttMes(dir) { _mesRef.setMonth(_mesRef.getMonth() + dir); _desenharProducaoGantt(); }
  function pganttMesHoje() { _mesRef = new Date(); _desenharProducaoGantt(); }
  function pganttDiagnosticoToggle() { _diagnosticoAberto = !_diagnosticoAberto; _desenharProducaoGantt(); }

  // ── Arrastar barra pra outro dia (mesma máquina) — muda só `data` ──────
  let _arrastando = null; // {registroId, maquina}

  function _onDragStartBar(event, el) {
    _arrastando = { registroId: el.getAttribute('data-pgantt-bar'), maquina: el.getAttribute('data-pgantt-bar-maquina') };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', _arrastando.registroId);
    _escondertooltip();
  }
  async function _onDropDay(event, el) {
    event.preventDefault();
    if (!_arrastando) return;
    if (el.getAttribute('data-pgantt-day-maquina') !== _arrastando.maquina) { _arrastando = null; return; }
    const dayIdx = Number(el.getAttribute('data-pgantt-day-drop'));
    const novaData = new Date(_weekStart); novaData.setDate(novaData.getDate() + dayIdx);
    const novaDataStr = _isoData(novaData);
    const registroId = _arrastando.registroId;
    _arrastando = null;
    const executar = async () => {
      try {
        await fs().collection(COL_REGISTROS).doc(registroId).set({ data: novaDataStr, atualizadoEm: new Date().toISOString() }, { merge: true });
        global.showToast?.('OP movida.', 'success');
        await carregarProducaoGantt(true);
        _desenharProducaoGantt();
      } catch (e) {
        global.showToast?.('Erro ao mover: ' + (e.message || e), 'error');
      }
    };
    const msg = `Mover essa produção para ${DIA_LABEL[novaData.getDay()]} (${_fmtDataCurta(novaData)})?`;
    if (global.showConfirm) global.showConfirm(msg, executar, { title: 'Mover OP', icon: '📅', okLabel: 'Mover' });
    else if (confirm(msg)) await executar();
  }

  // ── Modal "Reordenar fila" — muda só `sortOrder` ────────────────────────
  function pganttReordenarAbrir() {
    const sel = document.getElementById('pgantt-reorder-maquina');
    sel.innerHTML = _maquinas.map(m => `<option value="${esc(m.nome)}">${esc(m.nome)}</option>`).join('');
    global.openModal?.('modal-pgantt-reorder');
    _carregarFilaReorder(sel.value);
  }
  function _carregarFilaReorder(maquinaNome) {
    _reorderItems = _registros
      .filter(r => r.maquina === maquinaNome && r.status !== 'concluido')
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    _redesenharFilaReorder();
  }
  function _redesenharFilaReorder() {
    const wrap = document.getElementById('pgantt-reorder-list');
    if (!wrap) return;
    wrap.innerHTML = _reorderItems.length ? _reorderItems.map((r, i) => `
      <div draggable="true" data-pgantt-reorder-item="${i}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;cursor:grab;background:var(--surface)">
        <span style="color:var(--muted)">⠿</span><b>${esc(r.produto)}</b><span style="font-size:.68rem;color:var(--muted)">${esc(r.qntCaixas)} cx — ${esc(r.data)}</span>
      </div>`).join('') : '<div style="font-size:.75rem;color:var(--muted)">Nenhuma OP ativa nesta máquina.</div>';
  }
  async function pganttReorderSalvar() {
    try {
      for (let i = 0; i < _reorderItems.length; i++) {
        await fs().collection(COL_REGISTROS).doc(_reorderItems[i]._firestoreId).set({ sortOrder: i, atualizadoEm: new Date().toISOString() }, { merge: true });
      }
      global.closeModal?.('modal-pgantt-reorder');
      global.showToast?.('Ordem da fila salva.', 'success');
      await carregarProducaoGantt(true);
      _desenharProducaoGantt();
    } catch (e) {
      global.showToast?.('Erro ao salvar ordem: ' + (e.message || e), 'error');
    }
  }

  global.renderProducaoGantt = renderProducaoGantt;
  global._desenharProducaoGantt = _desenharProducaoGantt;
  global.pganttSemana = pganttSemana;
  global.pganttHoje = pganttHoje;
  global.pganttModo = pganttModo;
  global.pganttMes = pganttMes;
  global.pganttMesHoje = pganttMesHoje;
  global.pganttDiagnosticoToggle = pganttDiagnosticoToggle;
  global.pganttReordenarAbrir = pganttReordenarAbrir;
  global.pganttReorderSalvar = pganttReorderSalvar;

  // Tudo abaixo é gerado via innerHTML (grade, barras, navegação de semana,
  // lista de reordenação) — usa data-* + escutador delegado, mesma correção
  // obrigatória desde a Fase 2.
  document.addEventListener('click', function (event) {
    const semana = event.target.closest('[data-pgantt-semana]');
    if (semana) { pganttSemana(Number(semana.getAttribute('data-pgantt-semana'))); return; }
    const hoje = event.target.closest('[data-pgantt-hoje]');
    if (hoje) { pganttHoje(); return; }
    const modo = event.target.closest('[data-pgantt-modo]');
    if (modo) { pganttModo(modo.getAttribute('data-pgantt-modo')); return; }
    const mes = event.target.closest('[data-pgantt-mes]');
    if (mes) { pganttMes(Number(mes.getAttribute('data-pgantt-mes'))); return; }
    const mesHoje = event.target.closest('[data-pgantt-mes-hoje]');
    if (mesHoje) { pganttMesHoje(); return; }
    const diagToggle = event.target.closest('[data-pgantt-diagnostico-toggle]');
    if (diagToggle) { pganttDiagnosticoToggle(); return; }
    const reordenar = event.target.closest('[data-pgantt-reordenar]');
    if (reordenar) { pganttReordenarAbrir(); return; }
    const bar = event.target.closest('[data-pgantt-bar]');
    if (bar && typeof global.pprogEditar === 'function') { global.pprogEditar(bar.getAttribute('data-pgantt-bar')); return; }
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'pgantt-reorder-maquina') _carregarFilaReorder(event.target.value);
  });
  document.addEventListener('mouseover', function (event) {
    const bar = event.target.closest('[data-pgantt-bar]');
    if (bar) _mostrarTooltipBar(bar, event);
  });
  document.addEventListener('mousemove', function (event) {
    const el = document.getElementById('pgantt-tooltip');
    if (el && el.style.display === 'block' && event.target.closest('[data-pgantt-bar]')) _posicionarTooltip(el, event);
  });
  document.addEventListener('mouseout', function (event) {
    if (event.target.closest('[data-pgantt-bar]')) _escondertooltip();
  });
  document.addEventListener('dragstart', function (event) {
    const bar = event.target.closest('[data-pgantt-bar]');
    if (bar) { _onDragStartBar(event, bar); return; }
    const item = event.target.closest('[data-pgantt-reorder-item]');
    if (item) { _dragReorderIdx = Number(item.getAttribute('data-pgantt-reorder-item')); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(_dragReorderIdx)); }
  });
  document.addEventListener('dragover', function (event) {
    if (event.target.closest('[data-pgantt-day-drop]') || event.target.closest('[data-pgantt-reorder-item]')) event.preventDefault();
  });
  document.addEventListener('drop', function (event) {
    const dayDrop = event.target.closest('[data-pgantt-day-drop]');
    if (dayDrop) { _onDropDay(event, dayDrop); return; }
    const item = event.target.closest('[data-pgantt-reorder-item]');
    if (item && _dragReorderIdx != null) {
      event.preventDefault();
      const destIdx = Number(item.getAttribute('data-pgantt-reorder-item'));
      if (destIdx !== _dragReorderIdx) {
        const [movido] = _reorderItems.splice(_dragReorderIdx, 1);
        _reorderItems.splice(destIdx, 0, movido);
        _redesenharFilaReorder();
      }
      _dragReorderIdx = null;
    }
  });
})(window);
