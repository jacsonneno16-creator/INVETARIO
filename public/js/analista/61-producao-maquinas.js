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
    await _carregarAtalhos();
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
  function _domingoDaSemana(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; }
  function _isoData(d) { return d.toISOString().slice(0, 10); }
  function _fmtDataCurta(d) { return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); }

  // PEDIDO AO VIVO (auditoria RELATORIO-COMPARACAO-PRODUCAO.md, item 5): o
  // original tem um filtro de semana no topo (maq-week-filter, populado com
  // as semanas que realmente têm OP cadastrada) — "Todas as semanas" no
  // original agrega TODAS as OPs ativas independente da data; aqui,
  // "Todas as semanas" mantém o comportamento já existente (semana atual),
  // porque agregar datas de semanas diferentes sob um único denominador de
  // capacidade seria enganoso — adaptação deliberada, não uma omissão.
  let _semanaMaqFiltro = '';
  function _semanasComOP() {
    const doms = new Set();
    _registros.forEach(r => { if (r.data) doms.add(_isoData(_domingoDaSemana(new Date(r.data + 'T12:00:00')))); });
    return [...doms].sort();
  }
  function _agendaSemanaAtual() {
    if (typeof global.buildProducaoSchedule !== 'function') return { porMaquina: {} };
    const maquinasPorNome = {};
    _maquinas.forEach(m => { maquinasPorNome[m.nome] = m; });
    const base = _semanaMaqFiltro ? new Date(_semanaMaqFiltro + 'T12:00:00') : _domingoDaSemanaAtual();
    return global.buildProducaoSchedule(base, _registros, maquinasPorNome, _setups);
  }
  // PEDIDO AO VIVO (auditoria, item 5): resumo "Turnos Seg: T1 + T2" no
  // card — compara a 1ª faixa de turno de segunda-feira (index 1) da
  // máquina com os atalhos T1/T2/T3 cadastrados; se não bater com nenhum
  // atalho, mostra o horário cru.
  function _resumoTurnosSegunda(m) {
    const faixas = (m.turnos && m.turnos[1]) || [];
    if (!faixas.length) return '';
    const atalhos = _atalhos || ATALHOS_DEFAULT;
    const nomes = faixas.map(f => {
      const chave = Object.keys(atalhos).find(k => atalhos[k].ini === f.ini && atalhos[k].fim === f.fim);
      return chave || `${f.ini}-${f.fim}`;
    });
    return `Turnos Seg: ${nomes.join(' + ')}`;
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
    const todos = _maquinas.map(m => m.nome);
    const alvo = nomes && nomes.length ? nomes : todos;
    // O original usa a capacidade do parque inteiro também no percentual da
    // seleção; só o numerador muda para as máquinas selecionadas.
    const capacidade = todos.reduce((soma, nome) => soma + (Number(resultado.porMaquina[nome]?.capacidadeMinutosSemana) || 0), 0);
    let usados = 0, caixas = 0, qtdMaquinas = 0;
    alvo.forEach(nome => {
      const d = resultado.porMaquina[nome];
      if (d) {
        usados += d.totalMinutosUsados; qtdMaquinas++;
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
  let _viewMaq = 'grid'; // 'grid' | 'list' — PEDIDO AO VIVO (auditoria, item 5): toggle Miniaturas/Lista do original
  let _containerMaq = 'page-producao-maquinas';
  // PEDIDO AO VIVO (usuário: "na tela de maquina e setup estao
  // misturados" — na verdade são a aba principal Máquinas e Configurações
  // → Cadastro de Máquinas que estavam misturadas numa tela só). No
  // original são DUAS telas diferentes: a aba principal (app.js:2326,
  // index.html:260-279) é só monitoramento — cards de carga/ocupação,
  // filtro categoria+semana, Miniaturas/Lista, botão "Selecionar" — sem
  // criar/editar/excluir máquina. O CRUD de verdade (+Adicionar, Template,
  // Excel, editar/excluir) só existe em Configurações → Cadastro de
  // Máquinas (app.js:9470, tabela própria). Aqui as duas telas continuam
  // reaproveitando o mesmo card/grid (não dá pra recriar a tabela exata
  // do CRUD original nesta rodada), mas os controles administrativos só
  // aparecem quando a tela é aberta a partir de Configurações — nunca na
  // aba principal.
  // PEDIDO AO VIVO (pendência #4, rodada de correção): o comentário
  // antigo aqui mesmo admitia "não dá pra recriar a tabela exata do CRUD
  // original nesta rodada" — os cards de monitoramento eram reaproveitados
  // visualmente pro Cadastro também (com busca/editar/excluir plugados
  // nos MESMOS cards). Agora são duas telas de verdade: a principal
  // continua só monitoramento (sem NENHUM controle de cadastro, como
  // sempre foi), e Configurações → Cadastro de Máquinas ganhou sua
  // própria tabela — _desenharCadastroMaquinasTabela() — reproduzindo
  // literalmente app.js:7866-7957/index.html:1082-1120 do original:
  // cabeçalho com Template/Excel/+Adicionar, aviso "Use Configurações →
  // Produtos → Excel...", tabela Nome/Tipo-Setor/Und-min/Cap-hora/
  // Cap-dia/Status/Ações, linha de detalhe expansível (▾) com Cap/hora,
  // Cap/turno, Cap/dia, Eficiência, Turnos, Hrs/turno, Setup padrão e
  // produtos compatíveis — sem filtro de categoria/semana, sem toggle
  // Miniaturas/Lista, sem busca (nenhum desses existe na tela real do
  // original; confirmado lendo o HTML/JS, não suposto).
  let _modoCadastroMaq = false;
  async function renderProducaoMaquinas(containerId) {
    _containerMaq = containerId || 'page-producao-maquinas';
    _modoCadastroMaq = !!containerId;
    const pagina = document.getElementById(_containerMaq);
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoMaquinas(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    if (_modoCadastroMaq) _desenharCadastroMaquinasTabela();
    else _desenharProducaoMaquinas();
  }

  // ── Cadastro de Máquinas (Configurações) — tabela própria, sem nada
  // reaproveitado visualmente do monitoramento ──────────────────────────
  function _capacidadeMaquina(m) {
    const efic = Number(m.eficiencia) || 100;
    const hTurno = Number(m.hTurno) || 8;
    const nTurnos = Number(m.nTurnos) || 1;
    const pcMin = Number(m.pcMin) || 0;
    const fator = efic / 100;
    const porHora = Math.round(pcMin * 60 * fator);
    const porTurno = Math.round(porHora * hTurno);
    const porDia = porTurno * nTurnos;
    return { porHora, porTurno, porDia };
  }
  const _detalhesCadastroAbertos = new Set();
  function _detalheCadastroMaquinaHtml(m, cap) {
    const nProds = Array.isArray(m.produtosCompativeis) ? m.produtosCompativeis.length : 0;
    const capSummary = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px 14px;background:var(--surface-2);font-size:.68rem;font-family:monospace">
      <div style="text-align:center"><div style="color:var(--muted);font-size:.58rem;text-transform:uppercase;letter-spacing:.05em">Cap/hora</div><div style="color:var(--orange);font-weight:700">${cap ? cap.porHora.toLocaleString('pt-BR') : '—'}</div></div>
      <div style="text-align:center"><div style="color:var(--muted);font-size:.58rem;text-transform:uppercase;letter-spacing:.05em">Cap/turno</div><div style="color:var(--orange);font-weight:700">${cap ? cap.porTurno.toLocaleString('pt-BR') : '—'}</div></div>
      <div style="text-align:center"><div style="color:var(--muted);font-size:.58rem;text-transform:uppercase;letter-spacing:.05em">Cap/dia</div><div style="color:var(--orange);font-weight:700">${cap ? cap.porDia.toLocaleString('pt-BR') : '—'}</div></div>
    </div>
    <div style="padding:4px 14px 8px;display:flex;gap:14px;flex-wrap:wrap;font-size:.66rem;font-family:monospace">
      <span><span style="color:var(--muted)">Efic:</span> ${m.eficiencia != null ? esc(m.eficiencia) + '%' : '—'}</span>
      <span><span style="color:var(--muted)">Turnos:</span> ${m.nTurnos || '—'}</span>
      <span><span style="color:var(--muted)">Hrs/turno:</span> ${m.hTurno || '—'}</span>
      <span><span style="color:var(--muted)">Setup padrão:</span> ${(m.setupPadraoMin || m.tempoSetupPadrao) ? esc(m.setupPadraoMin || m.tempoSetupPadrao) + ' min' : '—'}</span>
    </div>`;
    if (nProds > 0) {
      return capSummary + `<div style="padding:8px 14px;background:rgba(124,106,247,.06)">
        <div style="font-size:.6rem;text-transform:uppercase;letter-spacing:.05em;color:var(--purple);font-weight:700;margin-bottom:6px">Produtos Compatíveis (${nProds})</div>
        ${m.produtosCompativeis.map(p => `<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px solid var(--border);font-size:.68rem"><span>${esc(p.produto)}</span><span style="color:var(--orange)">${p.velocidade ? esc(p.velocidade) + ' und/min' : 'padrão' + (m.pcMin ? ' (' + esc(m.pcMin) + ')' : '')}</span></div>`).join('')}
      </div>`;
    }
    return capSummary + `<div style="padding:10px 14px;background:rgba(184,144,48,.08);font-size:.7rem;color:var(--warn)">⚠️ Essa máquina ainda não possui produtos vinculados. Clique em <b>Editar</b> → aba de produtos compatíveis para configurar.</div>`;
  }
  function _desenharCadastroMaquinasTabela() {
    const pagina = document.getElementById(_containerMaq);
    if (!pagina) return;
    const lista = [..._maquinas].sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    pagina.innerHTML = `
      <div class="tc" style="padding:0;overflow:hidden">
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:8px"><span>🏭</span><span style="font-weight:700">Cadastro de Máquinas</span></div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <button type="button" class="btn btn-ghost btn-sm" data-pexcel-template-baixar="1">📄 Template</button>
            <label class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0">📥 Excel<input type="file" id="pexcel-template-input" accept=".xlsx,.xls" style="display:none"></label>
            <button type="button" class="btn btn-primary btn-sm" data-pmaq-novo="1">+ Adicionar Máquina</button>
          </div>
        </div>
        <div style="padding:8px 16px;background:rgba(224,112,32,.08);border-bottom:1px solid var(--border);font-size:.7rem;color:var(--orange)">
          💡 <b>Dica:</b> Use <b>Configurações → Produtos → Excel</b> para importar produtos E máquinas juntos com velocidades específicas por produto.
        </div>
        ${lista.length ? `<div style="overflow-x:auto"><table class="dt-table">
          <thead><tr><th>Nome</th><th>Tipo / Setor</th><th style="text-align:right">Und/min</th><th style="text-align:right">Cap/hora</th><th style="text-align:right">Cap/dia</th><th style="text-align:center">Status</th><th style="text-align:right">Ações</th></tr></thead>
          <tbody>
          ${lista.map(m => {
            const cap = m.pcMin ? _capacidadeMaquina(m) : null;
            const tipoSetor = [m.tipo, m.setor].filter(Boolean).join(' / ') || '—';
            const catClass = [m.categoria, m.classificacao].filter(Boolean).join(' / ');
            const nProds = Array.isArray(m.produtosCompativeis) ? m.produtosCompativeis.length : 0;
            const aberto = _detalhesCadastroAbertos.has(m._firestoreId);
            const statusInfo = STATUS_INFO[m.status] || STATUS_INFO.ativa;
            return `<tr>
              <td class="mono">${esc(m.nome)}${m.codigo ? `<span style="font-size:.62rem;color:var(--muted);margin-left:6px">${esc(m.codigo)}</span>` : ''}</td>
              <td>${esc(tipoSetor)}${catClass ? `<div style="font-size:.62rem;color:var(--muted);margin-top:2px">${esc(catClass)}</div>` : ''}</td>
              <td style="text-align:right" class="mono">${m.pcMin ? esc(m.pcMin) + ' und/min' : '—'}</td>
              <td style="text-align:right" class="mono">${cap ? cap.porHora.toLocaleString('pt-BR') : '—'}</td>
              <td style="text-align:right" class="mono">${cap ? cap.porDia.toLocaleString('pt-BR') : '—'}</td>
              <td style="text-align:center"><span class="badge ${statusInfo.cor}">${statusInfo.label.toUpperCase()}</span></td>
              <td style="text-align:right;white-space:nowrap">
                <span class="badge ${nProds > 0 ? 'b-purple' : 'b-orange'}" style="font-size:.6rem">${nProds > 0 ? nProds + ' prod.' : 'Sem produtos'}</span>
                <button type="button" class="acao-lapis" data-pmaq-detalhe-cad="${esc(m._firestoreId)}" title="Ver produtos">${aberto ? '▴' : '▾'}</button>
                <button type="button" class="acao-lapis" data-pmaq-editar="${esc(m._firestoreId)}" title="Editar">✏️</button>
                <button type="button" class="acao-lapis" data-pmaq-excluir="${esc(m._firestoreId)}" title="Excluir">🗑️</button>
              </td>
            </tr>
            ${aberto ? `<tr><td colspan="7" style="padding:0">${_detalheCadastroMaquinaHtml(m, cap)}</td></tr>` : ''}`;
          }).join('')}
          </tbody>
        </table></div>` : `<div style="color:var(--muted);font-size:.8rem;padding:20px;text-align:center">Nenhuma máquina cadastrada.</div>`}
      </div>`;
  }

  function _desenharProducaoMaquinas() {
    const pagina = document.getElementById(_containerMaq);
    if (!pagina) return;
    const catFiltro = String(document.getElementById('pmaq-filtro-categoria')?.value || '');
    const cards = _maquinas
      .filter(m => !catFiltro || m.categoria === catFiltro)
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    const ocupacaoTotal = _calcOcupacaoAgregada([]);
    const nomesSelecionados = [..._selecionadas];
    const ocupacaoSelecionadas = nomesSelecionados.length ? _calcOcupacaoAgregada(nomesSelecionados) : null;
    const categoriasFiltro = [...new Set(_maquinas.map(m => m.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    pagina.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <div style="font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)">Carga por Máquina · Solicitações Ativas (Pendente + Em Andamento)</div>
        </div>
        <div class="pmaq-toolbar-actions" style="display:flex;gap:8px;align-items:center">
          <select id="pmaq-filtro-categoria" class="field"><option value="">Todas as categorias</option>${categoriasFiltro.map(c => `<option value="${esc(c)}" ${catFiltro === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <select id="pmaq-filtro-semana" class="field"><option value="">Todas as semanas</option>${_semanasComOP().map(s => { const d = new Date(s + 'T12:00:00'), sun = new Date(d); sun.setDate(d.getDate() + 6); return `<option value="${s}" ${_semanaMaqFiltro === s ? 'selected' : ''}>${_fmtDataCurta(d)} – ${_fmtDataCurta(sun)}</option>`; }).join('')}</select>
          <div style="display:flex;background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden">
            <button type="button" class="btn ${_viewMaq === 'grid' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="border-radius:0;border:none" data-pmaq-view="grid">⊞ Miniaturas</button>
            <button type="button" class="btn ${_viewMaq === 'list' ? 'btn-primary' : 'btn-ghost'} btn-sm" style="border-radius:0;border:none" data-pmaq-view="list">☰ Lista</button>
          </div>
        </div>
      </div>
      <div style="font-size:.66rem;color:var(--muted);margin:-8px 0 12px">Cadastro, edição e exclusão de máquinas ficam em <b>Configurações → Máquinas → Cadastro de Máquinas</b>.</div>
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
      ${cards.length ? (_viewMaq === 'list' ? _listaMaquinasHtml(cards) : `
      <div class="maq-grid">
        ${cards.map(m => {
          const ocupacao = calcOcupacaoMaquina(m);
          const horasProg = _horasProgMaquina(m);
          const horasDisp = _horasDispMaquina(m);
          const selecionada = _selecionadas.has(m.nome);
          const pedidosAtivos = _pedidosAtivosMaquina(m.nome);
          const caixasAtivas = pedidosAtivos.reduce((s, r) => s + (Number(r.qntCaixas) || 0), 0);
          const turnosResumo = _resumoTurnosSegunda(m);
          const expandidoDet = _detalhesAbertos.has(m.nome);
          return `
          <div class="tc pmaq-monitor-card" style="${selecionada ? 'border-color:var(--warn);box-shadow:0 0 0 1px rgba(255,184,0,.35),0 8px 24px rgba(0,0,0,.22)' : ''}">
            <button type="button" class="pmaq-select-card" data-pmaq-selecionar="${esc(m.nome)}" style="${selecionada?'border-color:rgba(255,184,0,.45);background:rgba(255,184,0,.18);color:var(--warn)':''}">${selecionada ? 'Selecionado' : 'Selecionar'}</button>
            <div style="font-family:'JetBrains Mono',monospace;font-weight:500;font-size:13px;color:var(--orange);padding-right:98px">${esc(m.nome)}</div>
            ${turnosResumo ? `<div style="font-size:9px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:2px">${esc(turnosResumo)}</div>` : ''}
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:4px"><span>${pedidosAtivos.length} solicit.</span><span><b style="color:${ocupacao>100?'var(--danger)':'var(--orange)'}">${Math.round(caixasAtivas).toLocaleString('pt-BR')}</b> caixas</span></div>
            ${pedidosAtivos.length ? `<div style="font-size:.68rem;color:var(--muted);display:flex;flex-direction:column;gap:2px">${pedidosAtivos.slice(0, 4).map(r => `<div>• ${esc(r.produto)} — ${Math.round(Number(r.qntCaixas) || 0).toLocaleString('pt-BR')} cx</div>`).join('')}${pedidosAtivos.length > 4 ? `<div>+ ${pedidosAtivos.length - 4} outra(s)</div>` : ''}</div>` : ''}
            ${ocupacao > 100 ? `<div style="font-size:.66rem;color:var(--danger);font-weight:700">⚠ Excede em ${ocupacao - 100}%</div>` : ''}
            <div>
              <div style="height:6px;border-radius:4px;background:var(--border);overflow:hidden">
                <div style="height:100%;width:${Math.min(100, ocupacao)}%;background:${ocupacao > 100 ? 'var(--danger)' : 'var(--orange)'}"></div>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:.68rem;margin-top:4px">
                <span style="color:var(--muted)">Prog:</span>
                <span style="color:${ocupacao > 100 ? 'var(--danger)' : 'var(--orange)'};font-weight:700">${horasProg.toFixed(1)}h</span>
                <span style="color:var(--muted)">/ ${horasDisp.toFixed(1)}h disp.</span>
                <span style="color:${ocupacao > 100 ? 'var(--danger)' : 'var(--orange)'};font-weight:700;font-size:.76rem">${ocupacao}%</span>
              </div>
            </div>
            <button type="button" data-pmaq-detalhes="${esc(m.nome)}" style="background:none;border:none;color:var(--muted);font-size:.66rem;cursor:pointer;text-align:center;padding:2px 0">${expandidoDet ? '▴' : '▾'} detalhes</button>
            ${expandidoDet ? _detalheMaquinaHtml(m) : ''}
          </div>`;
        }).join('')}
      </div>`) : `<div class="empty"><div class="empty-icon">⚙️</div><div class="empty-title">Nenhuma máquina cadastrada</div><div class="empty-sub">Clique em "+ Nova Máquina" pra começar</div></div>`}
    `;
  }
  function _horasProgMaquina(m) {
    const resultado = _agendaSemanaAtual();
    const d = resultado.porMaquina[m.nome];
    return d ? d.totalMinutosUsados / 60 : 0;
  }
  function _horasDispMaquina(m) {
    const resultado = _agendaSemanaAtual();
    const d = resultado.porMaquina[m.nome];
    return d ? d.capacidadeMinutosSemana / 60 : 0;
  }
  const _detalhesAbertos = new Set();
  // PEDIDO AO VIVO (auditoria, item 5): accordion "▾ detalhes" do card —
  // mesmos campos que buildMaqCardDetail() do original mostra (setor,
  // status, velocidade, eficiência, turnos/dia, setup padrão).
  function _detalheMaquinaHtml(m) {
    const cor = m.status === 'inativa' ? 'var(--danger)' : 'var(--success)';
    const diasComTurno = [0, 1, 2, 3, 4, 5, 6].filter(d => (m.turnos && m.turnos[d] || []).length).length;
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;font-size:.68rem;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
      <div><span style="color:var(--muted)">Setor:</span> ${esc(m.setor || '—')}</div>
      <div><span style="color:var(--muted)">Status:</span> <span style="color:${cor};font-weight:700">${esc((m.status || 'ativa').toUpperCase())}</span></div>
      <div><span style="color:var(--muted)">Vel. padrão:</span> ${m.pcMin ? esc(m.pcMin) + ' und/min' : '<span style="color:var(--danger)">⚠ não config.</span>'}</div>
      <div><span style="color:var(--muted)">Eficiência:</span> ${m.eficiencia != null ? esc(m.eficiencia) + '%' : '—'}</div>
      <div><span style="color:var(--muted)">Dias c/ turno:</span> ${diasComTurno}/7</div>
      <div><span style="color:var(--muted)">Setup padrão:</span> ${(m.setupPadraoMin || m.tempoSetupPadrao) ? esc(m.setupPadraoMin || m.tempoSetupPadrao) + ' min' : '—'}</div>
    </div>`;
  }
  // PEDIDO AO VIVO (auditoria 2ª rodada, seção 7): grid exata do original
  // (.maq-list-row, app.js:2518-2543) — 200px 1fr 120px 120px 100px, não
  // mais uma <table>. Mesmas colunas de sempre (Máquina/Ocupação/Caixas/
  // Prog. Disp./% Máquina), só a marcação mudou pra bater com o original.
  function _listaMaquinasHtml(cards) {
    const linhas = cards.map(m => {
      const ocupacao = calcOcupacaoMaquina(m);
      const horasProg = _horasProgMaquina(m), horasDisp = _horasDispMaquina(m);
      const pedidosAtivos = _pedidosAtivosMaquina(m.nome);
      const caixasAtivas = pedidosAtivos.reduce((s, r) => s + (Number(r.qntCaixas) || 0), 0);
      const cor = ocupacao > 100 ? 'var(--danger)' : ocupacao >= 80 ? 'var(--warn)' : 'var(--orange)';
      return `<div class="maq-list-row">
        <div style="font-family:'JetBrains Mono',monospace;font-weight:500;font-size:13px;color:var(--orange)">${esc(m.nome)}</div>
        <div>
          <div style="height:6px;border-radius:4px;background:var(--border);overflow:hidden;margin:0"><div style="height:100%;width:${Math.min(100, ocupacao)}%;background:${cor}"></div></div>
          <div style="font-size:10px;color:var(--muted);margin-top:3px;font-family:'JetBrains Mono',monospace">${pedidosAtivos.length} solicit.</div>
        </div>
        <div style="color:${cor};font-family:'JetBrains Mono',monospace;font-weight:600">${Math.round(caixasAtivas).toLocaleString('pt-BR')} cx</div>
        <div style="color:var(--muted);font-family:'JetBrains Mono',monospace;font-size:11px"><span style="color:${cor};font-weight:700">${horasProg.toFixed(1)}h</span> <span style="color:var(--muted)"> / ${horasDisp.toFixed(1)}h</span></div>
        <div style="color:${cor};font-family:'JetBrains Mono',monospace;font-weight:700">${ocupacao}%${ocupacao > 100 ? ` <span style="color:var(--danger);font-size:9px;margin-left:4px">+${ocupacao - 100}% over</span>` : ''}</div>
      </div>`;
    }).join('');
    return `<div class="maq-list-view">
      <div class="maq-list-row" style="background:var(--surface-2);font-family:'JetBrains Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted)">
        <span>Máquina</span><span>Ocupação da Semana</span><span>Caixas</span><span>Prog. / Disp.</span><span>% Máquina</span>
      </div>
      ${linhas}
    </div>`;
  }

  function _turnosDefault() {
    return { 0: [], 1: [{ ini: '08:00', fim: '17:00' }], 2: [{ ini: '08:00', fim: '17:00' }], 3: [{ ini: '08:00', fim: '17:00' }], 4: [{ ini: '08:00', fim: '17:00' }], 5: [{ ini: '08:00', fim: '17:00' }], 6: [] };
  }

  function _calcCapacidade() {
    const pcMin = Number(document.getElementById('pmaq-pcmin')?.value) || 0;
    const hTurno = Number(document.getElementById('pmaq-hturno')?.value) || 0;
    const nTurnos = Number(document.getElementById('pmaq-nturnos')?.value) || 0;
    const eficiencia = Math.max(0, Math.min(100, Number(document.getElementById('pmaq-eficiencia')?.value) || 100)) / 100;
    const porHora = pcMin * 60 * eficiencia, porTurno = porHora * hTurno, porDia = porTurno * nTurnos;
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
    pmaqMudarAba('dados');
    global.openModal?.('modal-pmaq');
  }

  function pmaqMudarAba(aba) {
    const modal = document.getElementById('modal-pmaq');
    if (!modal) return;
    modal.querySelectorAll('[data-pmaq-tab]').forEach(b => b.classList.toggle('on', b.getAttribute('data-pmaq-tab') === aba));
    modal.querySelectorAll('[data-pmaq-pane]').forEach(p => p.classList.toggle('on', p.getAttribute('data-pmaq-pane') === aba));
    const corpo = modal.querySelector('.modal-body');
    if (corpo) corpo.scrollTop = 0;
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

  // Ações de CRUD (salvar/excluir/reset em massa) só disparam a partir da
  // tabela de Cadastro (Configurações) desde a separação das duas telas —
  // mas usa o modo atual em vez de assumir, pra continuar correto se
  // algum fluxo futuro reabrir o modal a partir de outro lugar.
  function _redesenharMaquinasAtual() {
    if (_modoCadastroMaq) _desenharCadastroMaquinasTabela();
    else _desenharProducaoMaquinas();
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
      _redesenharMaquinasAtual();
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
        _redesenharMaquinasAtual();
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
        _redesenharMaquinasAtual();
      } catch (e) {
        global.showToast?.('Erro ao resetar: ' + (e.message || e), 'error');
      }
    };
    const msg = 'Resetar os turnos de TODAS as ' + _maquinas.length + ' máquina(s) pro padrão (Seg-Sex 08h-17h, fim de semana sem turno)? Essa ação não pode ser desfeita.';
    if (global.showConfirm) global.showConfirm(msg, executar, { title: 'Resetar turnos', icon: '↺', okLabel: 'Resetar', okClass: 'btn-danger' });
    else if (confirm(msg)) await executar();
  }

  // ── Turnos por Máquina: tela dedicada (Configurações → Máquinas → Turnos
  // por Máquina), matriz com TODAS as máquinas de uma vez — o mesmo dado já
  // dava pra editar máquina por máquina no modal (_turnosEditando acima),
  // mas faltava a visão de tabela única que o original tem (renderTurnosMaquinas
  // de turnosMaquinas.js). Grava direto no Firestore a cada alteração (sem
  // botão Salvar), igual ao comportamento do original.
  let _containerTurnos = 'pcfg-embed-host';
  function _horasFaixaTurno(f) {
    const [hi, mi] = String(f.ini || '0:0').split(':').map(Number);
    const [hf, mf] = String(f.fim || '0:0').split(':').map(Number);
    let ini = (hi || 0) * 60 + (mi || 0), fim = (hf || 0) * 60 + (mf || 0);
    if (fim <= ini) fim += 1440;
    return Math.max(0, (fim - ini) / 60);
  }
  function _horasSemanaMaquinaTurnos(m) {
    let t = 0;
    for (let d = 0; d <= 6; d++) t += ((m.turnos && m.turnos[d]) || []).reduce((a, f) => a + _horasFaixaTurno(f), 0);
    return Math.round(t * 10) / 10;
  }
  async function renderProducaoTurnosMaquinas(containerId) {
    _containerTurnos = containerId || 'pcfg-embed-host';
    const pagina = document.getElementById(_containerTurnos);
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarProducaoMaquinas(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharTurnosMatriz();
  }
  function _desenharTurnosMatriz() {
    const pagina = document.getElementById(_containerTurnos);
    if (!pagina) return;
    const maquinasOrd = [..._maquinas].sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    const atalhos = _atalhos || ATALHOS_DEFAULT;
    pagina.innerHTML = `<div class="tc" style="padding:0;overflow:hidden">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.1rem">🕐 Turnos por Máquina</div>
          <div style="font-size:.72rem;color:var(--muted)">Configure as faixas de horário reais de cada máquina por dia da semana.</div>
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" class="btn btn-ghost btn-sm" data-ptm-atalhos-abrir="1">⚡ Atalhos T1/T2/T3</button>
          <button type="button" class="btn btn-ghost btn-sm" data-ptm-resetar-tudo="1">↺ Resetar tudo</button>
        </div>
      </div>
      <div style="overflow-x:auto">
      <table class="dt-table" style="min-width:960px">
        <thead><tr>
          <th style="min-width:140px">Máquina</th>
          ${DIA_LABEL.map(d => `<th style="text-align:center;min-width:120px">${d}</th>`).join('')}
          <th style="text-align:center">H/sem</th>
          <th style="text-align:center">Copiar</th>
        </tr></thead>
        <tbody>
        ${maquinasOrd.length ? maquinasOrd.map(m => {
          const semana = _horasSemanaMaquinaTurnos(m);
          return `<tr>
            <td><b>${esc(m.nome)}</b></td>
            ${[0, 1, 2, 3, 4, 5, 6].map(d => {
              const faixas = (m.turnos && m.turnos[d]) || [];
              const horasDia = faixas.reduce((a, f) => a + _horasFaixaTurno(f), 0);
              return `<td style="vertical-align:top;padding:6px">
                ${faixas.length ? faixas.map((f, i) => `
                  <div style="display:flex;gap:3px;align-items:center;margin-bottom:3px">
                    <input type="time" value="${esc(f.ini)}" class="field" data-ptm-ini data-ptm-maq="${esc(m._firestoreId)}" data-ptm-dia="${d}" data-ptm-idx="${i}" style="width:74px;font-size:.65rem;padding:2px 4px">
                    <input type="time" value="${esc(f.fim)}" class="field" data-ptm-fim data-ptm-maq="${esc(m._firestoreId)}" data-ptm-dia="${d}" data-ptm-idx="${i}" style="width:74px;font-size:.65rem;padding:2px 4px">
                    <button type="button" data-ptm-del data-ptm-maq="${esc(m._firestoreId)}" data-ptm-dia="${d}" data-ptm-idx="${i}" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.8rem;padding:0 2px">×</button>
                  </div>`).join('') : `<div style="text-align:center;color:var(--muted);font-size:.62rem;padding:4px 0">— inativa</div>`}
                <div style="display:flex;gap:3px;flex-wrap:wrap;align-items:center;margin-top:2px">
                  <span style="font-size:.6rem;color:var(--muted);min-width:26px">${horasDia > 0 ? horasDia.toFixed(1) + 'h' : ''}</span>
                  <button type="button" data-ptm-add data-ptm-maq="${esc(m._firestoreId)}" data-ptm-dia="${d}" style="font-size:.58rem;padding:1px 5px;border:1px dashed var(--border);border-radius:4px;background:none;color:var(--muted);cursor:pointer">+faixa</button>
                  ${Object.keys(atalhos).map(k => `<button type="button" data-ptm-atalho data-ptm-maq="${esc(m._firestoreId)}" data-ptm-dia="${d}" data-ptm-chave="${k}" style="font-size:.55rem;padding:1px 4px;border:1px solid var(--border);border-radius:4px;background:none;color:var(--muted);cursor:pointer">${esc(k)}</button>`).join('')}
                </div>
              </td>`;
            }).join('')}
            <td style="text-align:center;font-weight:700">${semana > 0 ? semana + 'h' : '—'}</td>
            <td style="text-align:center"><button type="button" class="btn btn-ghost btn-sm" data-ptm-copiar-linha="${esc(m._firestoreId)}" style="font-size:.62rem;padding:3px 8px">→ Todas</button></td>
          </tr>`;
        }).join('') : `<tr><td colspan="9"><div class="empty"><div class="empty-icon">⚙️</div><div class="empty-title">Nenhuma máquina cadastrada</div></div></td></tr>`}
        </tbody>
      </table>
      </div>
      <div style="margin:10px 16px 16px;padding:10px 14px;background:var(--surface-2);border-radius:7px;font-size:.66rem;color:var(--muted);line-height:1.7">
        💡 Use <b>+faixa</b> pra múltiplos períodos no mesmo dia (ex.: manhã + tarde com intervalo). Use os atalhos T1/T2/T3 pra preencher rápido. As mudanças salvam direto ao editar.
      </div>
    </div>`;
  }
  async function _ptmSalvarMaquina(docId, dia, faixas) {
    const m = _maquinas.find(x => x._firestoreId === docId);
    if (!m) return;
    m.turnos = m.turnos || {};
    m.turnos[dia] = faixas;
    try {
      await fs().collection(COL_MAQUINAS).doc(docId).set({ turnos: m.turnos, atualizadoEm: new Date().toISOString() }, { merge: true });
    } catch (e) {
      global.showToast?.('Erro ao salvar: ' + (e.message || e), 'error');
    }
  }
  function ptmFaixaAlterada(docId, dia, idx, campo, valor) {
    const m = _maquinas.find(x => x._firestoreId === docId);
    if (!m) return;
    const faixas = (m.turnos && m.turnos[dia]) || [];
    if (!faixas[idx]) return;
    faixas[idx][campo] = valor;
    _ptmSalvarMaquina(docId, dia, faixas);
    _desenharTurnosMatriz();
  }
  function ptmAdicionarFaixa(docId, dia) {
    const m = _maquinas.find(x => x._firestoreId === docId);
    if (!m) return;
    m.turnos = m.turnos || {};
    const faixas = (m.turnos[dia] = m.turnos[dia] || []);
    faixas.push({ ini: '08:00', fim: '17:00' });
    _ptmSalvarMaquina(docId, dia, faixas);
    _desenharTurnosMatriz();
  }
  function ptmRemoverFaixa(docId, dia, idx) {
    const m = _maquinas.find(x => x._firestoreId === docId);
    if (!m) return;
    const faixas = (m.turnos && m.turnos[dia]) || [];
    faixas.splice(idx, 1);
    _ptmSalvarMaquina(docId, dia, faixas);
    _desenharTurnosMatriz();
  }
  function ptmAplicarAtalho(docId, dia, chave) {
    const atalho = (_atalhos || ATALHOS_DEFAULT)[chave];
    if (!atalho) return;
    _ptmSalvarMaquina(docId, dia, [{ ini: atalho.ini, fim: atalho.fim }]);
    _desenharTurnosMatriz();
  }
  async function ptmCopiarLinha(docId) {
    const origem = _maquinas.find(x => x._firestoreId === docId);
    if (!origem) return;
    const destino = _maquinas.filter(m => m._firestoreId !== docId);
    if (!destino.length) { global.showToast?.('Não há outras máquinas cadastradas.', 'error'); return; }
    const executar = async () => {
      try {
        const turnos = JSON.parse(JSON.stringify(origem.turnos || _turnosDefault()));
        await Promise.all(destino.map(m => fs().collection(COL_MAQUINAS).doc(m._firestoreId).set({ turnos, atualizadoEm: new Date().toISOString() }, { merge: true })));
        global.showToast?.('Turnos de "' + origem.nome + '" copiados pra ' + destino.length + ' máquina(s).', 'success');
        await carregarProducaoMaquinas(true);
        _desenharTurnosMatriz();
      } catch (e) {
        global.showToast?.('Erro ao copiar: ' + (e.message || e), 'error');
      }
    };
    const msg = 'Copiar os turnos de "' + origem.nome + '" pra TODAS as outras ' + destino.length + ' máquina(s)? Isso substitui a configuração atual delas.';
    if (global.showConfirm) global.showConfirm(msg, executar, { title: 'Copiar turnos', icon: '📋', okLabel: 'Copiar' });
    else if (confirm(msg)) await executar();
  }
  async function ptmResetarTudo() {
    if (!_maquinas.length) return;
    const executar = async () => {
      try {
        const turnosPadrao = _turnosDefault();
        await Promise.all(_maquinas.map(m => fs().collection(COL_MAQUINAS).doc(m._firestoreId).set({ turnos: turnosPadrao, atualizadoEm: new Date().toISOString() }, { merge: true })));
        global.showToast?.('Turnos resetados pro padrão em todas as máquinas.', 'success');
        await carregarProducaoMaquinas(true);
        _desenharTurnosMatriz();
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
  global.renderProducaoTurnosMaquinas = renderProducaoTurnosMaquinas;
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
  global.pmaqMudarAba = pmaqMudarAba;

  // Tudo abaixo é gerado via innerHTML (grid de cards, linhas de produto
  // compatível, linhas de turno) — usa data-* + escutador delegado em vez de
  // onclick/oninput/onchange inline, que não dispara de forma confiável
  // quando injetado dinamicamente (mesma correção aplicada na Ficha
  // Técnica, fase 2).
  document.addEventListener('click', function (event) {
    const tab = event.target.closest('[data-pmaq-tab]');
    if (tab) { pmaqMudarAba(tab.getAttribute('data-pmaq-tab')); return; }
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
    const viewBtn = event.target.closest('[data-pmaq-view]');
    if (viewBtn) { _viewMaq = viewBtn.getAttribute('data-pmaq-view'); _desenharProducaoMaquinas(); return; }
    const detBtn = event.target.closest('[data-pmaq-detalhes]');
    if (detBtn) { const nome = detBtn.getAttribute('data-pmaq-detalhes'); if (_detalhesAbertos.has(nome)) _detalhesAbertos.delete(nome); else _detalhesAbertos.add(nome); _desenharProducaoMaquinas(); return; }
    const detCadBtn = event.target.closest('[data-pmaq-detalhe-cad]');
    if (detCadBtn) { const id = detCadBtn.getAttribute('data-pmaq-detalhe-cad'); if (_detalhesCadastroAbertos.has(id)) _detalhesCadastroAbertos.delete(id); else _detalhesCadastroAbertos.add(id); _desenharCadastroMaquinasTabela(); return; }
    // Turnos por Máquina (tela dedicada, matriz com todas as máquinas)
    const ptmAtalhosBtn = event.target.closest('[data-ptm-atalhos-abrir]');
    if (ptmAtalhosBtn) { pmaqAtalhosAbrir(); return; }
    const ptmResetar = event.target.closest('[data-ptm-resetar-tudo]');
    if (ptmResetar) { ptmResetarTudo(); return; }
    const ptmAdd = event.target.closest('[data-ptm-add]');
    if (ptmAdd) { ptmAdicionarFaixa(ptmAdd.getAttribute('data-ptm-maq'), Number(ptmAdd.getAttribute('data-ptm-dia'))); return; }
    const ptmDel = event.target.closest('[data-ptm-del]');
    if (ptmDel) { ptmRemoverFaixa(ptmDel.getAttribute('data-ptm-maq'), Number(ptmDel.getAttribute('data-ptm-dia')), Number(ptmDel.getAttribute('data-ptm-idx'))); return; }
    const ptmAtalho = event.target.closest('[data-ptm-atalho]');
    if (ptmAtalho) { ptmAplicarAtalho(ptmAtalho.getAttribute('data-ptm-maq'), Number(ptmAtalho.getAttribute('data-ptm-dia')), ptmAtalho.getAttribute('data-ptm-chave')); return; }
    const ptmCopiar = event.target.closest('[data-ptm-copiar-linha]');
    if (ptmCopiar) { ptmCopiarLinha(ptmCopiar.getAttribute('data-ptm-copiar-linha')); return; }
  });
  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'pmaq-busca') _desenharProducaoMaquinas();
    if (event.target && ['pmaq-pcmin', 'pmaq-hturno', 'pmaq-nturnos', 'pmaq-eficiencia'].includes(event.target.id)) _calcCapacidade();
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'pmaq-filtro-categoria') { _desenharProducaoMaquinas(); return; }
    if (event.target && event.target.id === 'pmaq-filtro-semana') { _semanaMaqFiltro = event.target.value || ''; _desenharProducaoMaquinas(); return; }
    const campo = event.target.closest('[data-pmaq-campo]');
    if (campo) { pmaqProdutoAlterado(Number(campo.getAttribute('data-pmaq-idx')), campo.getAttribute('data-pmaq-campo'), campo.value); return; }
    const turnoCampo = event.target.closest('[data-pmaq-turno-campo]');
    if (turnoCampo) { pmaqTurnoFaixaAlterada(Number(turnoCampo.getAttribute('data-pmaq-turno-dia')), Number(turnoCampo.getAttribute('data-pmaq-turno-idx')), turnoCampo.getAttribute('data-pmaq-turno-campo'), turnoCampo.value); return; }
    const atalhoCampo = event.target.closest('[data-pmaq-atalho-campo]');
    if (atalhoCampo) { pmaqAtalhoCampoAlterado(atalhoCampo.getAttribute('data-pmaq-atalho-chave'), atalhoCampo.getAttribute('data-pmaq-atalho-campo'), atalhoCampo.value); return; }
    const ptmIni = event.target.closest('[data-ptm-ini]');
    if (ptmIni) { ptmFaixaAlterada(ptmIni.getAttribute('data-ptm-maq'), Number(ptmIni.getAttribute('data-ptm-dia')), Number(ptmIni.getAttribute('data-ptm-idx')), 'ini', ptmIni.value); return; }
    const ptmFim = event.target.closest('[data-ptm-fim]');
    if (ptmFim) { ptmFaixaAlterada(ptmFim.getAttribute('data-ptm-maq'), Number(ptmFim.getAttribute('data-ptm-dia')), Number(ptmFim.getAttribute('data-ptm-idx')), 'fim', ptmFim.value); return; }
  });
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _maquinas=[]; _registros=[]; _setups=[]; _produtosEditando=[]; _turnosEditando={}; _atalhos=null; _selecionadas.clear(); _semanaMaqFiltro=''; _detalhesAbertos.clear(); _detalhesCadastroAbertos.clear(); });
})(window);
