// Setor Produção — Gantt semanal (fase 3c: grade somente-leitura; fase 3d:
// arrastar-e-soltar). Usa o motor de agenda V341
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
  const STATUS_INFO = { pendente: { label: 'Pendente', cor: 'b-orange' }, em_andamento: { label: 'Em Andamento', cor: 'b-blue' }, concluido: { label: 'Concluído', cor: 'b-green' } };

  let _maquinas = [];
  let _registros = [];
  let _setups = [];
  let _carregado = false;
  let _weekStart = _segundaDaSemana(new Date());
  let _modoGantt = 'semanal';
  let _mesRef = new Date();
  let _diagnosticoAberto = false;
  const _corPorRegistro = {};
  let _reorderItems = [];
  let _dragReorderIdx = null;
  // Largura das colunas Produto/Observação da grade semanal — arrastável,
  // igual à original (persistida por usuário, mesmo padrão de localStorage).
  let _larguraColProduto = parseInt(localStorage.getItem('dt-pgantt-produto-w') || '220', 10) || 220;
  let _larguraColObs = parseInt(localStorage.getItem('dt-pgantt-obs-w') || '130', 10) || 130;
  let _resizeGanttAtivo = null; // {campo, startX, startW}

  function fs() { return global.getDTFirestore(); }
  function podeEditarGantt() { return typeof global.temPermissao !== 'function' || global.temPermissao('producao-gantt', 'editar'); }
  function podeReordenarGantt() { return typeof global.temPermissao !== 'function' || global.temPermissao('producao-gantt', 'reordenar'); }

  function _segundaDaSemana(d) {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    const dia = r.getDay();
    r.setDate(r.getDate() - (dia === 0 ? 6 : dia - 1));
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

  function _semanasDoMes() {
    const base = new Date(_weekStart);
    const ano = base.getFullYear(), mes = base.getMonth();
    const primeiro = new Date(ano, mes, 1, 12);
    let cursor = _segundaDaSemana(primeiro);
    const semanas = [];
    while (cursor.getMonth() <= mes || (cursor.getFullYear() === ano && cursor.getMonth() === mes)) {
      semanas.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 7);
      if (semanas.length > 6) break;
    }
    return semanas;
  }

  function _pillsSemana() {
    const atual = _isoData(_weekStart);
    return _semanasDoMes().map((s, i) => {
      const fim = new Date(s); fim.setDate(fim.getDate() + 6);
      const ativo = _isoData(s) === atual;
      return `<button type="button" class="btn ${ativo ? 'btn-primary' : 'btn-ghost'} btn-sm" data-pgantt-week-pick="${_isoData(s)}" style="border-radius:18px">S${i+1} · ${_fmtDataCurta(s)}–${_fmtDataCurta(fim)}</button>`;
    }).join('');
  }

  function _legendaGantt() {
    return `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:.68rem;color:var(--muted);margin:0 0 12px">
      <span><i style="display:inline-block;width:11px;height:7px;border-radius:2px;background:var(--orange);margin-right:4px"></i>Produção</span>
      <span><i style="display:inline-block;width:11px;height:7px;border-radius:2px;background:repeating-linear-gradient(45deg,#9CA3AF,#9CA3AF 3px,#D1D5DB 3px,#D1D5DB 6px);margin-right:4px"></i>Setup</span>
      <span>🖱️ Clique na barra: editar OP</span><span>↔ Arraste: reprogramar dia</span><span>⇅ Reordenar: prioridade da fila</span>
    </div>`;
  }

  function _toolbarComum() {
    const periodo = _modoGantt === 'semanal'
      ? _fmtDataCurta(_weekStart) + ' a ' + _fmtDataCurta(_fimSemana())
      : _mesRef.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return `
      <div class="tc" style="padding:14px 16px;margin-bottom:12px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap">
          <div><div class="page-title" style="font-size:1.18rem;margin:0">📅 Gantt — Programação de Produção</div>
            <div style="font-size:.72rem;color:var(--muted);margin-top:3px">${periodo} · agenda calculada por turnos, velocidade e setup</div></div>
          <div style="display:flex;align-items:center;gap:5px"><span style="font-size:.66rem;font-weight:700;color:var(--muted);text-transform:uppercase">Visualização</span>
            <button type="button" class="btn ${_modoGantt === 'semanal' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-pgantt-modo="semanal">Semanal</button>
            <button type="button" class="btn ${_modoGantt === 'mensal' ? 'btn-primary' : 'btn-ghost'} btn-sm" data-pgantt-modo="mensal">Mensal</button></div>
        </div>
        ${_modoGantt === 'semanal' ? `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <button class="btn btn-ghost btn-sm" data-pgantt-semana="-1">‹ Ant.</button>
              <div style="font-family:monospace;font-weight:700;color:var(--orange);padding:6px 10px;border:1px solid var(--border);border-radius:7px">${periodo}</div>
              <button class="btn btn-ghost btn-sm" data-pgantt-semana="1">Próx. ›</button>
              <button class="btn btn-ghost btn-sm" data-pgantt-hoje="1">Hoje</button>
              <input type="date" class="field" data-pgantt-data value="${_isoData(_weekStart)}" title="Ir para semana" style="width:145px;padding:5px 8px">
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${podeReordenarGantt() ? `<button class="btn btn-ghost btn-sm" data-pgantt-reordenar="1">⇅ Reordenar</button>` : ''}
              <button class="btn btn-ghost btn-sm" data-pgantt-export="1">📊 Excel</button><button class="btn btn-ghost btn-sm" data-pgantt-pdf="1">📄 PDF</button>
            </div>
          </div>
          <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:9px"><span style="font-size:.65rem;font-weight:700;color:var(--muted);text-transform:uppercase">Semana:</span>${_pillsSemana()}</div>
        ` : `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
            <div style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" data-pgantt-mes="-1">‹ Mês Ant.</button><button class="btn btn-ghost btn-sm" data-pgantt-mes-hoje="1">Hoje</button><button class="btn btn-ghost btn-sm" data-pgantt-mes="1">Próx. Mês ›</button></div>
            <div style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" data-pgantt-export="1">📊 Excel</button><button class="btn btn-ghost btn-sm" data-pgantt-pdf="1">📄 PDF</button></div>
          </div>`}
      </div>
      ${_legendaGantt()}
      ${_painelDiagnosticoVelocidade()}
      <div class="tc" style="margin-bottom:14px"><div style="padding:8px 12px;display:flex;align-items:center;justify-content:space-between;cursor:pointer" data-pgantt-diagnostico-toggle="1"><div style="font-size:.76rem;font-weight:600">🔧 Diagnóstico de setup faltando</div><div style="font-size:.7rem;color:var(--muted)">${_diagnosticoAberto ? '▲ ocultar' : '▼ mostrar'}</div></div>${_diagnosticoAberto ? _painelDiagnosticoSetup() : ''}</div>`;
  }

  // PEDIDO AO VIVO (usuário reclamou que o Gantt "tá faltando informação"
  // quando aparece vazio): a causa mais comum é OP sem velocidade (pcMin)
  // cadastrada — o motor de agenda descarta esses registros em silêncio
  // (63-producao-agenda.js). Sem isso, o Gantt vazio não dava nenhuma
  // pista do motivo. Mostra aqui, na própria tela, quais OPs da semana
  // estão sumindo por causa disso.
  function _painelDiagnosticoVelocidade() {
    if (_modoGantt !== 'semanal') return '';
    const ini = _isoData(_weekStart), fim = _isoData(_fimSemana());
    const semVelocidade = _registros.filter(r => r.status !== 'concluido' && r.data >= ini && r.data <= fim && (Number(r.pcMin) || 0) <= 0);
    if (!semVelocidade.length) return '';
    return `<div class="tc" style="margin-bottom:14px;border-left:4px solid var(--danger)">
      <div style="padding:10px 12px">
        <div style="font-size:.76rem;font-weight:700;color:var(--danger)">⚠️ ${semVelocidade.length} OP(s) desta semana sem velocidade cadastrada — não aparecem na grade abaixo</div>
        <div style="font-size:.68rem;color:var(--muted);margin-top:2px">Sem velocidade (pcMin) o motor de agenda não sabe quanto tempo a OP ocupa, então ela é ignorada. Edite a OP em Programação e escolha uma máquina/produto com velocidade cadastrada, ou cadastre a velocidade em Máquinas → Produtos compatíveis.</div>
        <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:5px">${semVelocidade.slice(0, 10).map(r => `<span class="badge b-red" style="font-size:.62rem">${esc(r.produto)} · ${esc(r.maquina || 'sem máquina')} · ${esc(r.data)}</span>`).join('')}${semVelocidade.length > 10 ? `<span style="font-size:.62rem;color:var(--muted)">+${semVelocidade.length - 10}</span>` : ''}</div>
      </div>
    </div>`;
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
            const temEspecifico = _setups.some(s => s.maquina === nomeMaquina && (s.produtoOrigem ?? s.produto_origem) === anterior && (s.produtoDestino ?? s.produto_destino) === rec.produto);
            if (!temEspecifico) {
              const maquina = maquinasPorNome[nomeMaquina];
              const padrao = Number(maquina?.setupPadraoMin ?? maquina?.tempoSetupPadrao) || 0;
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

  // Colunas da grade semanal: Máquina | Produto (resizável) | Qtd cx | Tempo h |
  // Setup h | H.Prog | Observação (resizável) | 7 dias — igual à grade densa
  // da original (uma linha por produto dentro de cada máquina, não uma
  // linha só por máquina), pra expor qtd/tempo/setup/obs sem precisar
  // passar o mouse ou clicar em nada.
  function _gridColsGantt() {
    return `84px ${_larguraColProduto}px 52px 56px 56px 64px ${_larguraColObs}px repeat(7,1fr)`;
  }
  function _aplicarGridGantt() {
    const g = _gridColsGantt();
    document.querySelectorAll('.pgantt-grid-row').forEach(el => { el.style.gridTemplateColumns = g; });
  }

  function _legendaOPsSemana(resultado) {
    const vistos = new Set();
    const itens = [];
    Object.values(resultado.porMaquina).forEach(dados => dados.porDia.forEach(segs => segs.forEach(seg => {
      if (seg.tipo !== 'producao' || vistos.has(seg.registroId)) return;
      vistos.add(seg.registroId);
      itens.push({ registroId: seg.registroId, produto: seg.produto });
    })));
    if (!itens.length) return '';
    return `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      ${itens.slice(0, 12).map(it => `<div style="display:flex;align-items:center;gap:5px;font-size:.66rem;color:var(--muted)">
        <span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${_corDoRegistro(it.registroId)}"></span>
        <span style="max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.produto)}</span>
      </div>`).join('')}
      ${itens.length > 12 ? `<span style="font-size:.66rem;color:var(--muted)">+${itens.length - 12} produto(s)</span>` : ''}
    </div>`;
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

    const registrosPorId = {};
    _registros.forEach(r => { registrosPorId[r._firestoreId] = r; });
    const gridCols = _gridColsGantt();

    return `
      ${_legendaOPsSemana(resultado)}
      ${nomesComOPs.map(nome => {
        const maquina = maquinasPorNome[nome] || {};
        const dados = resultado.porMaquina[nome];
        const ocupPct = dados.capacidadeMinutosSemana > 0 ? Math.round((dados.totalMinutosUsados / dados.capacidadeMinutosSemana) * 100) : 0;
        const ocupCor = ocupPct > 100 ? 'var(--danger)' : ocupPct >= 80 ? 'var(--warn)' : 'var(--success)';
        const turnosAtivos = _numTurnosAtivos(maquina, diasSemana);

        // Agrupa os segmentos da semana por produto (+ observação, quando
        // manual) — igual à consolidação da original — pra virar UMA linha
        // por produto dentro da máquina, em vez de tudo empilhado numa
        // faixa só.
        const grupos = {};
        for (let di = 0; di < 7; di++) {
          dados.porDia[di].forEach(seg => {
            const reg = registrosPorId[seg.registroId];
            const nomeProduto = seg.tipo === 'setup' ? (reg?.produto || seg.produto) : seg.produto;
            const obsReg = (reg?.obs || '').trim();
            const chave = obsReg ? (nomeProduto.toLowerCase() + '||' + obsReg.toLowerCase()) : nomeProduto.toLowerCase();
            if (!grupos[chave]) grupos[chave] = { produto: nomeProduto, obs: obsReg, qtd: 0, minProd: 0, minSetup: 0, porDia: [[], [], [], [], [], [], []], registroIds: new Set() };
            const g = grupos[chave];
            g.registroIds.add(seg.registroId);
            if (seg.tipo === 'producao') { g.qtd += seg.caixasNoDia; g.minProd += seg.minutosNoDia; }
            else { g.minSetup += seg.minutosNoDia; }
            g.porDia[di].push(seg);
          });
        }
        const listaGrupos = Object.values(grupos).filter(g => g.minProd > 0 || g.minSetup > 0);

        return `
        <div class="tc" style="padding:0;margin-bottom:12px;overflow:hidden">
          <div style="padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:var(--surface-2);border-bottom:1px solid var(--border)">
            <div style="font-weight:700">🏭 ${esc(nome)}
              <span style="font-size:.65rem;color:var(--muted);font-weight:600">${turnosAtivos} dia(s) c/ turno · ${listaGrupos.length} produto(s)</span>
            </div>
            <div style="display:flex;align-items:center;gap:10px;font-family:monospace;font-size:.7rem">
              <span style="color:var(--muted)">${(dados.totalMinutosUsados / 60).toFixed(1)}h prog. / ${(dados.capacidadeMinutosSemana / 60).toFixed(1)}h disp.</span>
              <span style="font-weight:700;color:${ocupCor}">${ocupPct}% ocupação</span>
              <span style="display:inline-block;width:70px;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
                <span style="display:block;height:100%;width:${Math.min(100, ocupPct)}%;background:${ocupCor}"></span>
              </span>
            </div>
          </div>
          <div style="overflow:auto">
            <div class="pgantt-grid-row" style="display:grid;grid-template-columns:${gridCols};background:var(--surface-2);border-bottom:1px solid var(--border)">
              <div style="padding:5px 8px;font-size:.62rem;font-weight:700;color:var(--muted)">Máquina</div>
              <div style="padding:5px 8px;font-size:.62rem;font-weight:700;color:var(--muted);position:relative">Produto
                <div data-pgantt-resize="produto" title="Arraste para redimensionar" style="position:absolute;right:0;top:0;bottom:0;width:7px;cursor:col-resize"></div>
              </div>
              <div style="padding:5px 4px;font-size:.62rem;font-weight:700;color:var(--muted);text-align:center">Qtd<br>cx</div>
              <div style="padding:5px 4px;font-size:.62rem;font-weight:700;color:var(--muted);text-align:center">Tempo<br>h</div>
              <div style="padding:5px 4px;font-size:.62rem;font-weight:700;color:var(--muted);text-align:center">Set Up<br>h</div>
              <div style="padding:5px 4px;font-size:.62rem;font-weight:700;color:var(--muted);text-align:center">H.<br>Prog.</div>
              <div style="padding:5px 8px;font-size:.62rem;font-weight:700;color:var(--muted);position:relative">Observação
                <div data-pgantt-resize="obs" title="Arraste para redimensionar" style="position:absolute;right:0;top:0;bottom:0;width:7px;cursor:col-resize"></div>
              </div>
              ${diasSemana.map(d => `<div style="padding:5px 4px;font-size:.62rem;font-weight:700;text-align:center;color:${d.toDateString() === hojeStr ? 'var(--orange)' : 'var(--muted)'}">${DIA_LABEL[d.getDay()]}<br>${_fmtDataCurta(d)}</div>`).join('')}
            </div>
            ${listaGrupos.map((g, gi) => {
              const corGrupo = _corDoRegistro([...g.registroIds][0]);
              const tempoStr = (g.minProd / 60).toFixed(1) + 'h';
              const setupStr = g.minSetup > 0 ? (g.minSetup / 60).toFixed(1) + 'h' : '—';
              return `<div class="pgantt-grid-row" style="display:grid;grid-template-columns:${gridCols};border-bottom:1px solid var(--border)">
                <div style="padding:6px 8px;font-size:.68rem;color:var(--muted);display:flex;align-items:center">${gi === 0 ? esc(nome) : ''}</div>
                <div style="padding:6px 8px;font-size:.72rem;font-weight:600;display:flex;align-items:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(g.produto)}${g.obs ? ' — ' + esc(g.obs) : ''}">${esc(g.produto)}</div>
                <div style="padding:6px 4px;font-size:.7rem;text-align:center;display:flex;align-items:center;justify-content:center;font-family:monospace">${Math.round(g.qtd).toLocaleString('pt-BR')}</div>
                <div style="padding:6px 4px;font-size:.7rem;text-align:center;display:flex;align-items:center;justify-content:center;font-family:monospace;color:var(--warn)">${tempoStr}</div>
                <div style="padding:6px 4px;font-size:.7rem;text-align:center;display:flex;align-items:center;justify-content:center;font-family:monospace;color:${g.minSetup > 0 ? 'var(--orange)' : 'var(--muted)'}">${setupStr}</div>
                <div style="padding:6px 4px;font-size:.7rem;text-align:center;display:flex;align-items:center;justify-content:center;font-family:monospace;font-weight:700;color:${ocupCor}">${gi === 0 ? (dados.totalMinutosUsados / 60).toFixed(1) + 'h' : ''}</div>
                <div style="padding:6px 8px;font-size:.68rem;color:var(--muted);display:flex;align-items:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(g.obs)}">${esc(g.obs)}</div>
                ${g.porDia.map((segmentosDoDia, dayIdx) => {
                  const capacidadeDia = segmentosDoDia[0]?.capacidadeDoDiaMin || (typeof global.getTurnoMinutosDoDia === 'function' ? global.getTurnoMinutosDoDia(maquina, dayIdx) : 0);
                  return `
                  <div data-pgantt-day-drop="${dayIdx}" data-pgantt-day-maquina="${esc(nome)}" style="position:relative;height:30px;margin:4px 3px;background:var(--surface-2);border-radius:4px;overflow:hidden">
                    ${capacidadeDia > 0 ? segmentosDoDia.map(seg => {
                      const leftPct = Math.max(0, Math.min(100, (seg.inicioMin / capacidadeDia) * 100));
                      const widthPct = Math.max(2, Math.min(100 - leftPct, (seg.minutosNoDia / capacidadeDia) * 100));
                      const ehSetup = seg.tipo === 'setup';
                      const arrastavelBar = arrastavel && !ehSetup;
                      return `<div data-pgantt-bar="${esc(seg.registroId)}" data-pgantt-bar-maquina="${esc(nome)}" data-pgantt-bar-produto="${esc(seg.produto)}" data-pgantt-bar-caixas="${esc(seg.caixasNoDia)}" data-pgantt-bar-horas="${(seg.minutosNoDia / 60).toFixed(1)}" data-pgantt-bar-tipo="${ehSetup ? 'setup' : 'producao'}" ${arrastavelBar ? 'draggable="true"' : ''}
                        style="position:absolute;top:${ehSetup ? '7px' : '2px'};bottom:${ehSetup ? '7px' : '2px'};left:${leftPct}%;width:${widthPct}%;background:${ehSetup ? 'repeating-linear-gradient(45deg,#9CA3AF,#9CA3AF 4px,#D1D5DB 4px,#D1D5DB 8px)' : corGrupo};border-radius:3px;cursor:${arrastavelBar ? 'grab' : 'pointer'}"></div>`;
                    }).join('') : ''}
                  </div>`;
                }).join('')}
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
      ${_resumoSemanal(resultado, diasSemana)}
    `;
  }

  function _resumoSemanal(resultado, diasSemana) {
    const totais = diasSemana.map(() => 0);
    Object.values(resultado.porMaquina || {}).forEach(dados => dados.porDia.forEach((segs, i) => segs.forEach(seg => { if (seg.tipo === 'producao') totais[i] += Number(seg.caixasNoDia) || 0; })));
    return `<div class=\"tc\" style=\"padding:10px 12px;margin-top:12px\"><div style=\"font-size:.72rem;font-weight:700;margin-bottom:8px\">📦 Quantidade programada por dia</div><div style=\"display:grid;grid-template-columns:repeat(7,1fr);gap:6px\">${diasSemana.map((d,i)=>`<div style=\"background:var(--surface-2);border-radius:7px;padding:8px;text-align:center\"><div style=\"font-size:.62rem;color:var(--muted)\">${DIA_LABEL[d.getDay()]} ${_fmtDataCurta(d)}</div><div style=\"font-size:.9rem;font-weight:800;margin-top:2px\">${Math.round(totais[i]).toLocaleString('pt-BR')} cx</div></div>`).join('')}</div></div>`;
  }

  function _corpoMensal() {
    const maquinasPorNome = {};
    _maquinas.forEach(m => { maquinasPorNome[m.nome] = m; });
    const ano = _mesRef.getFullYear(), mes = _mesRef.getMonth();
    const primeiroDia = new Date(ano, mes, 1), ultimoDia = new Date(ano, mes + 1, 0);
    const semanas = [];
    let cursor = _segundaDaSemana(primeiroDia);
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
    _weekStart = _segundaDaSemana(new Date());
    _desenharProducaoGantt();
  }
  function pganttGoDate(valor) {
    if (!valor) return;
    const d = new Date(valor + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return;
    _weekStart = _segundaDaSemana(d);
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


  async function pganttEditarQuantidade(registroId) {
    if (!podeEditarGantt()) return;
    const r = _registros.find(x => x._firestoreId === registroId);
    if (!r) return;
    const atual = Number(r.qntCaixas) || 0;
    const valor = global.prompt ? global.prompt(`Nova quantidade para ${r.produto}:`, String(atual)) : prompt(`Nova quantidade para ${r.produto}:`, String(atual));
    if (valor == null) return;
    const nova = Number(String(valor).replace(',', '.'));
    if (!Number.isFinite(nova) || nova <= 0) { global.showToast?.('Quantidade inválida.', 'error'); return; }
    try {
      await fs().collection(COL_REGISTROS).doc(registroId).set({ qntCaixas: nova, atualizadoEm: new Date().toISOString() }, { merge: true });
      global.showToast?.('Quantidade atualizada.', 'success');
      await carregarProducaoGantt(true); _desenharProducaoGantt();
    } catch (e) { global.showToast?.('Erro ao atualizar quantidade: ' + (e.message || e), 'error'); }
  }


  function exportarProducaoGantt() {
    if (!global.XLSX) { global.showToast?.('Biblioteca Excel não carregada.', 'error'); return; }
    if (_modoGantt === 'semanal' && typeof global.buildProducaoSchedule === 'function') {
      const maquinasPorNome = {}; _maquinas.forEach(m => { maquinasPorNome[m.nome] = m; });
      const resultado = global.buildProducaoSchedule(_weekStart, _registros, maquinasPorNome, _setups);
      const rows = [];
      Object.entries(resultado.porMaquina || {}).forEach(([maquina,dados]) => dados.porDia.forEach((segs,idx) => {
        const data = new Date(_weekStart); data.setDate(data.getDate()+idx);
        segs.forEach(seg => rows.push({Data:_isoData(data),Dia:DIA_LABEL[data.getDay()],Maquina:maquina,Tipo:seg.tipo==='setup'?'Setup':'Produção',Produto:seg.produto||'',Caixas:seg.tipo==='producao'?Math.round(Number(seg.caixasNoDia)||0):0,Horas:Number((Number(seg.minutosNoDia||0)/60).toFixed(2)),OP:seg.registroId||''}));
      }));
      const wb = global.XLSX.utils.book_new(); global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(rows), 'Gantt Semanal'); global.XLSX.writeFile(wb, 'gantt_producao_'+_isoData(_weekStart)+'.xlsx'); return;
    }
    const inicio = _modoGantt === 'semanal' ? _isoData(_weekStart) : new Date(_mesRef.getFullYear(), _mesRef.getMonth(), 1).toISOString().slice(0,10);
    const fim = _modoGantt === 'semanal' ? _isoData(_fimSemana()) : new Date(_mesRef.getFullYear(), _mesRef.getMonth()+1, 0).toISOString().slice(0,10);
    const rows = _registros.filter(r => !r.data || (r.data >= inicio && r.data <= fim)).sort((a,b)=>(a.data||'').localeCompare(b.data||'') || (a.maquina||'').localeCompare(b.maquina||'') || (Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)).map(r => ({Data:r.data||'',Maquina:r.maquina||'',Ordem:r.sortOrder??'',Produto:r.produto||'',Caixas:Number(r.qntCaixas)||0,Realizado:Number(r.realizadoCaixas)||0,Status:r.status||'',SetupMin:r.configSnapshot?.setupPadraoMin??'',Velocidade:r.configSnapshot?.pc_min??''}));
    const wb = global.XLSX.utils.book_new(); global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(rows), 'Gantt'); global.XLSX.writeFile(wb, 'gantt_producao_'+inicio+'_'+fim+'.xlsx');
  }

  global.renderProducaoGantt = renderProducaoGantt;
  global.exportarProducaoGantt = exportarProducaoGantt;
  global._desenharProducaoGantt = _desenharProducaoGantt;
  global.pganttSemana = pganttSemana;
  global.pganttHoje = pganttHoje;
  global.pganttGoDate = pganttGoDate;
  global.pganttModo = pganttModo;
  global.pganttMes = pganttMes;
  global.pganttMesHoje = pganttMesHoje;
  global.pganttDiagnosticoToggle = pganttDiagnosticoToggle;
  global.pganttReordenarAbrir = pganttReordenarAbrir;
  global.pganttReorderSalvar = pganttReorderSalvar;
  global.pganttEditarQuantidade = pganttEditarQuantidade;

  // Tudo abaixo é gerado via innerHTML (grade, barras, navegação de semana,
  // lista de reordenação) — usa data-* + escutador delegado, mesma correção
  // obrigatória desde a Fase 2.
  document.addEventListener('click', function (event) {
    const pdf = event.target.closest('[data-pgantt-pdf]');
    if (pdf) { global.exportarElementoProducaoPDF?.('page-producao-gantt','gantt_producao.pdf'); return; }
    const exportar = event.target.closest('[data-pgantt-export]');
    if (exportar) { exportarProducaoGantt(); return; }
    const pick = event.target.closest('[data-pgantt-week-pick]');
    if (pick) { pganttGoDate(pick.getAttribute('data-pgantt-week-pick')); return; }
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
  document.addEventListener('dblclick', function (event) {
    const bar = event.target.closest('[data-pgantt-bar]');
    if (bar && bar.getAttribute('data-pgantt-bar-tipo') !== 'setup') { event.preventDefault(); pganttEditarQuantidade(bar.getAttribute('data-pgantt-bar')); }
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'pgantt-reorder-maquina') _carregarFilaReorder(event.target.value);
    if (event.target && event.target.matches('[data-pgantt-data]')) pganttGoDate(event.target.value);
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
  // ── Redimensionar colunas Produto/Observação da grade semanal (mousedown,
  // não dragstart nativo — igual ao redimensionador da original) ──────────
  document.addEventListener('mousedown', function (event) {
    const resizer = event.target.closest('[data-pgantt-resize]');
    if (!resizer) return;
    event.preventDefault();
    const campo = resizer.getAttribute('data-pgantt-resize');
    _resizeGanttAtivo = { campo, startX: event.clientX, startW: campo === 'produto' ? _larguraColProduto : _larguraColObs };
  });
  document.addEventListener('mousemove', function (event) {
    if (!_resizeGanttAtivo) return;
    const delta = event.clientX - _resizeGanttAtivo.startX;
    const novaLargura = Math.max(100, Math.min(480, _resizeGanttAtivo.startW + delta));
    if (_resizeGanttAtivo.campo === 'produto') { _larguraColProduto = novaLargura; localStorage.setItem('dt-pgantt-produto-w', String(novaLargura)); }
    else { _larguraColObs = novaLargura; localStorage.setItem('dt-pgantt-obs-w', String(novaLargura)); }
    _aplicarGridGantt();
  });
  document.addEventListener('mouseup', function () { _resizeGanttAtivo = null; });
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
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _registros=[]; _maquinas=[]; _setups=[]; });
})(window);
