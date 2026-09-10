// Recebimento > Notas Retornadas > Indicadores de Devoluções (BI)
// PEDIDO AO VIVO (2026-08-31): as devoluções auto-gravadas por
// 100-consulta-notas-fiscais.js (origem:'AUTOMATICO' — motivo impróprio/
// falta/errado/desacordo, gravadas sem passar pelo Coletor) estavam
// aparecendo misturadas com os retornos físicos de verdade em Notas
// Retornadas/Indicadores de Retornos/Status de Retornos — "é para criar
// um indicador parecido com aquele HTML [painel_devolucoes] separado das
// notas recebidas pelo coletor". Esta tela é essa separação: lê só
// recebimento_recusas com origem:'AUTOMATICO' (98/97/99 agora excluem
// esses registros).
//
// PEDIDO AO VIVO (2026-08-31, 2ª rodada): "os indicadores tem que ser
// idêntico a esse aqui [painel_devolucoes.html], mas com o card do calor
// [a matriz Motivo×Mês] a cada vez que clica no motivo atualizar" — ou
// seja, todo o cross-filter clicável do HTML de referência: clicar no
// total do mês filtra o mês; clicar num segmento filtra mês+motivo;
// clicar numa barra de Motivo/Rede filtra aquela dimensão; a matriz
// (o "card do calor") e as barras se recalculam a cada clique excluindo a
// própria dimensão (mesmo comportamento de crossfilter do HTML de
// referência), e a matriz mostra só o motivo selecionado quando um motivo
// está ativo. Período continua filtrando pela dataEmissao real da nota.
//
// PEDIDO AO VIVO (2026-09-01): "impróprio pra consumo também não é pra
// gravar" — Impróprio para consumo/venda saiu da lista de motivos
// auto-gravados (ver CATEGORIAS_MOTIVO_PRECISAM_COLETOR em
// 100-consulta-notas-fiscais.js) e passou pro grupo descartado. Os
// registros já gravados ANTES dessa mudança continuam nesta tela até
// serem limpos manualmente — ver [[notas-retornadas-improprio-descartar]].
(function (global) {
  'use strict';
  const COL_RECUSAS = 'recebimento_recusas';
  const PAGE_SIZE = 50;
  const PALETA_MOTIVO = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7', '#e34948', '#008300'];

  let _recusas = [];
  let _periodoInicio = '';
  let _periodoFim = '';
  let _filtroMes = '';
  let _filtroMotivo = '';
  let _filtroRede = '';
  let _filtroRetorno = ''; // '' | 'sim' | 'nao'
  let _busca = '';
  let _pagina = 0;

  function fs() { return global.getDTFirestore(); }
  function raw() { return typeof global.getDTRawFirestore === 'function' ? global.getDTRawFirestore() : fs(); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s])); }
  function fmtBRL(v) { return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDataBR(iso) { return iso ? String(iso).split('-').reverse().join('/') : '—'; }
  function mesAnoDe(iso) {
    const s = String(iso || '').slice(0, 7); // "AAAA-MM"
    if (!/^\d{4}-\d{2}$/.test(s)) return '';
    const [ano, mes] = s.split('-');
    return mes + '/' + ano;
  }
  function _corMotivo(mo) {
    let h = 0;
    const s = String(mo || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETA_MOTIVO[h % PALETA_MOTIVO.length];
  }

  // PEDIDO AO VIVO (2026-08-31, 3ª rodada): "só veio 93, muito pouco" —
  // o campo `origem:'AUTOMATICO'` só passou a ser gravado numa rodada
  // posterior desta mesma sessão; os registros auto-salvos ANTES disso
  // (a maioria) não têm esse campo e, como a chave já existe em
  // `chavesJaComRecebimento`, nunca são regravados pra ganhar o campo
  // novo. `motivoAutomaticoTexto` sempre existiu nesse fluxo (é exclusivo
  // dele — nenhum outro caminho de código grava esse campo), então serve
  // de marcador retroativo confiável pros registros antigos.
  function _ehDevolucaoAutomatica(x) { return x.origem === 'AUTOMATICO' || x.motivoAutomaticoTexto != null; }

  // PEDIDO AO VIVO (2026-09-03): "as notas podem gravar direto, mas ainda
  // vai continuar recebendo por aqui também... vai ter que criar uma coluna
  // de notas que retornaram... quando o conferência receber ela, muda o
  // gráfico pra recebida" — gravar automático (por motivo, ex.: falta de
  // produto) só confirma que a NOTA existe, nunca que a carga física
  // voltou de verdade. O Coletor (24-recebimento-recusas.js/adicionarChave)
  // agora aceita bipar a MESMA chave de uma devolução automática e grava um
  // segundo recebimento_recusas (origem:'COLETOR') quando isso acontece —
  // aqui só precisa achar, pra cada chave AUTOMATICO, se já existe algum
  // outro registro (qualquer origem != 'AUTOMATICO') com a mesma chave.
  function _chavesComRetornoFisico(todos) {
    const set = new Set();
    todos.forEach(r => {
      if (r.origem === 'AUTOMATICO') return;
      (r.chaves || []).forEach(c => { if (c) set.add(c); });
    });
    return set;
  }
  function _retornouFisicamente(r, chavesComRetorno) {
    return (r.chaves || []).some(c => chavesComRetorno.has(c));
  }

  // PEDIDO AO VIVO (2026-09-01): "impróprio pra consumo também não é pra
  // gravar... pode descartar também" — motivo Impróprio saiu da lista de
  // auto-gravação em 100-consulta-notas-fiscais.js, mas os registros já
  // gravados ANTES dessa mudança continuam aqui até serem apagados. Botão
  // de limpeza manual (confirmação com a contagem exata antes de apagar).
  const MOTIVO_IMPROPRIO = 'Impróprio para consumo/venda';
  async function _limparImproprios() {
    const alvos = _recusas.filter(r => r.motivoNome === MOTIVO_IMPROPRIO);
    if (!alvos.length) { global.showToast?.('Nenhum registro de Impróprio para consumo/venda para limpar.', 'success'); return; }
    if (!confirm(`Apagar ${alvos.length} registro(s) de devolução com motivo "Impróprio para consumo/venda" já gravados automaticamente? Essa ação não pode ser desfeita.`)) return;
    const rawFs = raw();
    for (let i = 0; i < alvos.length; i += 300) {
      const lote = alvos.slice(i, i + 300);
      const batch = rawFs.batch();
      lote.forEach(r => batch.delete(fs().collection(COL_RECUSAS).doc(r._id)));
      await batch.commit();
    }
    global.showToast?.(`${alvos.length} registro(s) apagado(s).`, 'success');
    await carregarDevolucoesIndicadores(true);
    desenhar();
  }

  async function carregarDevolucoesIndicadores(forcar) {
    if (_recusas.length && !forcar) return;
    const snap = await fs().collection(COL_RECUSAS).get();
    const todos = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    const chavesComRetorno = _chavesComRetornoFisico(todos);
    _recusas = todos.filter(_ehDevolucaoAutomatica).map(r => ({ ...r, retornouFisicamente: _retornouFisicamente(r, chavesComRetorno) }));
  }

  // Data real da nota (dataEmissao) — não `criadoEm` (quando este app
  // importou). Pedido ao vivo: "puxar a data por lá também pra saber o
  // dia certo que foi emitida".
  function _dataEmissaoDe(r) { return r.dataEmissao || (r.notas && r.notas[0] && r.notas[0].dataEmissao) || ''; }
  // PEDIDO AO VIVO (2026-08-31, 3ª rodada): "tem o valor e lá não tá
  // mostrando, tem a loja e lá não tá mostrando" — os mesmos registros
  // antigos que não tinham `origem` (ver _ehDevolucaoAutomatica) também
  // foram gravados ANTES de destinatario/rede/valorTotal virarem campos
  // no nível raiz do documento. Esses dados sempre existiram aninhados em
  // `notas[0]` (é assim que o payload sempre gravou a nota em si) — os
  // três getters abaixo usam o campo raiz quando existe e caem pro
  // aninhado quando não.
  function _extrairRedeDoTexto(destinatario) {
    const s = String(destinatario || '').trim();
    const idx = s.indexOf(' - ');
    return (idx > -1 ? s.slice(0, idx) : s).trim();
  }
  function _destinatarioDe(r) { return r.destinatario || (r.notas && r.notas[0] && r.notas[0].destinatario) || ''; }
  function _redeDe(r) { return r.rede || _extrairRedeDoTexto(_destinatarioDe(r)); }
  function _valorDe(r) {
    if (r.valorTotal != null) return Number(r.valorTotal) || 0;
    const v = r.notas && r.notas[0] && r.notas[0].valorTotal;
    return Number(v) || 0;
  }
  function _passaPeriodo(r) {
    if (!_periodoInicio && !_periodoFim) return true;
    const d = _dataEmissaoDe(r);
    if (!d) return false;
    if (_periodoInicio && d < _periodoInicio) return false;
    if (_periodoFim && d > _periodoFim) return false;
    return true;
  }

  // Crossfilter: `excluir` marca quais dimensões NÃO devem ser aplicadas
  // nesta checagem — cada gráfico exclui sua própria dimensão, pra poder
  // clicar e trocar de seleção sem "zerar" a própria lista de opções.
  function _match(r, excluir) {
    excluir = excluir || {};
    if (!_passaPeriodo(r)) return false;
    if (!excluir.mes && _filtroMes && mesAnoDe(_dataEmissaoDe(r)) !== _filtroMes) return false;
    if (!excluir.motivo && _filtroMotivo && (r.motivoNome || '—') !== _filtroMotivo) return false;
    if (!excluir.rede && _filtroRede && _redeDe(r) !== _filtroRede) return false;
    if (_filtroRetorno === 'sim' && !r.retornouFisicamente) return false;
    if (_filtroRetorno === 'nao' && r.retornouFisicamente) return false;
    if (_busca) {
      const q = _busca.trim().toUpperCase();
      if (q) {
        const cli = _destinatarioDe(r).toUpperCase();
        const rede = _redeDe(r).toUpperCase();
        if (cli.indexOf(q) === -1 && rede.indexOf(q) === -1) return false;
      }
    }
    return true;
  }
  function _filtradas() { return _recusas.filter(r => _match(r, {})); }

  function kpis(itens) {
    const totalDevolucoes = itens.length;
    const somaValor = itens.reduce((a, r) => a + _valorDe(r), 0);
    const redes = new Set(itens.map(r => _redeDe(r)).filter(Boolean));
    const mercados = new Set(itens.map(r => _destinatarioDe(r)).filter(Boolean));
    const contagemMotivo = new Map();
    itens.forEach(r => { const m = r.motivoNome || '—'; contagemMotivo.set(m, (contagemMotivo.get(m) || 0) + 1); });
    let motivoTop = '—', motivoTopQtd = 0;
    contagemMotivo.forEach((qtd, nome) => { if (qtd > motivoTopQtd) { motivoTopQtd = qtd; motivoTop = nome; } });
    // PEDIDO AO VIVO (2026-09-03): "ter controle de quem, das notas que
    // estão sendo entregues aqui ou não" — grava automático só confirma que
    // a nota existe; retornouFisicamente (ver _chavesComRetornoFisico) é
    // quem realmente diz se a carga já apareceu no Coletor.
    const aguardandoRetorno = itens.filter(r => !r.retornouFisicamente).length;
    return { totalDevolucoes, somaValor, redesUnicas: redes.size, mercadosUnicos: mercados.size, motivoTop, aguardandoRetorno };
  }

  function resumoHtml(k) {
    return `<div style="display:grid;grid-template-columns:repeat(6,minmax(140px,1fr));gap:10px;margin:12px 0 4px">
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">DEVOLUÇÕES</div><div style="font-size:1.45rem;font-weight:850">${k.totalDevolucoes.toLocaleString('pt-BR')}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">VALOR TOTAL</div><div style="font-size:1.3rem;font-weight:850">${fmtBRL(k.somaValor)}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">REDES ÚNICAS</div><div style="font-size:1.45rem;font-weight:850">${k.redesUnicas.toLocaleString('pt-BR')}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">MERCADOS ÚNICOS</div><div style="font-size:1.45rem;font-weight:850">${k.mercadosUnicos.toLocaleString('pt-BR')}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">MOTIVO MAIS COMUM</div><div style="font-size:.95rem;font-weight:850">${esc(k.motivoTop)}</div></div>
      <div class="tc" style="padding:14px;${k.aguardandoRetorno ? 'border-color:#7a4a1f' : ''}"><div style="font-size:.72rem;color:var(--muted)">AGUARDANDO RETORNO FÍSICO</div><div style="font-size:1.45rem;font-weight:850;${k.aguardandoRetorno ? 'color:#ffd18a' : ''}">${k.aguardandoRetorno.toLocaleString('pt-BR')}</div></div>
    </div>`;
  }

  function _agrupar(itens, campoFn) {
    const m = new Map();
    itens.forEach(r => { const v = String(campoFn(r) || '').trim(); if (!v) return; m.set(v, (m.get(v) || 0) + 1); });
    return [...m.entries()].map(([label, value]) => ({ label, value }));
  }

  // Barra horizontal ranqueada, clicável quando `opts.filterKey` é
  // passado — clicar aplica/remove o filtro daquela dimensão e redesenha
  // a tela inteira (matriz incluída).
  function barChart(pares, opts) {
    opts = opts || {};
    const limit = opts.limit || 10;
    if (!pares.length) return '<div class="empty"><div class="empty-title">Sem dados para exibir</div><div class="empty-sub">Nenhuma devolução com esse dado preenchido ainda.</div></div>';
    const dados = (opts.cronologico ? pares : [...pares].sort((a, b) => b.value - a.value)).slice(0, limit);
    const max = Math.max(...dados.map(x => x.value), 1);
    const filtroAtivo = opts.filtroAtivo || '';
    const filterKey = opts.filterKey || '';
    return `<div style="display:flex;flex-direction:column;gap:6px">${dados.map((x, idx) => {
      const selecionado = !!filtroAtivo && filtroAtivo === x.label;
      const dim = !!filtroAtivo && !selecionado;
      const clique = filterKey ? ` data-devind-filtro="${esc(filterKey)}" data-devind-valor="${esc(x.label)}" role="button" tabindex="0"` : '';
      const cor = filterKey === 'motivo' ? _corMotivo(x.label) : 'var(--orange)';
      return `<div${filterKey ? ' class="devind-barrow' + (selecionado ? ' sel' : '') + (dim ? ' dim' : '') + '"' : ''}${clique}>
        <div style="display:flex;justify-content:space-between;font-size:.74rem;margin-bottom:2px"><span><em style="color:var(--muted)">${idx + 1}.</em> ${esc(x.label)}</span><b>${x.value.toLocaleString('pt-BR')}</b></div>
        <div style="height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.max(2, (x.value / max) * 100)}%;background:${cor}"></div></div>
      </div>`;
    }).join('')}</div>`;
  }

  function _mesesDisponiveis() {
    const set = new Set();
    _recusas.forEach(r => { if (_match(r, { mes: true, motivo: true })) { const m = mesAnoDe(_dataEmissaoDe(r)); if (m) set.add(m); } });
    return [...set].sort((a, b) => {
      const [ma, ya] = a.split('/').map(Number), [mb, yb] = b.split('/').map(Number);
      return (ya * 12 + ma) - (yb * 12 + mb);
    });
  }

  // O "card do calor" — matriz Motivo×Mês. PEDIDO AO VIVO (2026-09-02):
  // "colocar uma coluna para cada motivo e ali onde fica a quantidade de
  // notas colocar também o valor" — virou tabela de verdade (linha por
  // mês, uma COLUNA por motivo + Total), cada célula com quantidade E
  // valor (antes só a quantidade aparecia, o valor só dava pra ver
  // passando o mouse). Clique nas células/cabeçalhos continua fazendo o
  // mesmo crossfilter de antes (célula filtra mês+motivo, cabeçalho de
  // motivo filtra motivo, célula "Mês" filtra o mês).
  function _matrizHtml() {
    const meses = _mesesDisponiveis();
    if (!meses.length) return '<div class="empty"><div class="empty-title">Sem dados para exibir</div><div class="empty-sub">Nenhuma devolução no período/filtros selecionados.</div></div>';
    const motivosBase = [...new Set(_recusas.filter(r => _match(r, { mes: true, motivo: true })).map(r => r.motivoNome || '—'))];
    const motivoAtivo = !!_filtroMotivo;
    const motivos = motivoAtivo ? [_filtroMotivo] : motivosBase;
    const grid = new Map(); // mes -> motivo -> {qtd, valor}
    meses.forEach(m => grid.set(m, new Map()));
    _recusas.forEach(r => {
      if (!_match(r, { mes: true, motivo: true })) return;
      const m = mesAnoDe(_dataEmissaoDe(r));
      if (!grid.has(m)) return;
      const mo = r.motivoNome || '—';
      const cel = grid.get(m).get(mo) || { qtd: 0, valor: 0 };
      cel.qtd++; cel.valor += _valorDe(r);
      grid.get(m).set(mo, cel);
    });
    const celTxt = c => c ? `${c.qtd.toLocaleString('pt-BR')}<br><small style="color:var(--muted);font-weight:400">${fmtBRL(c.valor)}</small>` : '<span style="color:var(--muted)">—</span>';
    const somaCels = arr => arr.reduce((a, c) => c ? { qtd: a.qtd + c.qtd, valor: a.valor + c.valor } : a, { qtd: 0, valor: 0 });
    const totalPorMotivo = new Map(motivos.map(mo => [mo, somaCels(meses.map(m => grid.get(m).get(mo)))]));
    const totalGeral = somaCels([...totalPorMotivo.values()]);
    const header = `<th style="padding:6px 10px;text-align:left">Mês</th>${motivos.map(mo => `<th class="devind-mtx-cell" data-devind-filtro="motivo" data-devind-valor="${esc(mo)}" role="button" tabindex="0" style="padding:6px 10px;text-align:center;cursor:pointer;${motivoAtivo ? 'background:var(--surface-2)' : ''}"><span class="dot" style="background:${_corMotivo(mo)};display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px"></span>${esc(mo)}</th>`).join('')}<th style="padding:6px 10px;text-align:center">Total</th>`;
    const linhas = meses.map(m => {
      const mesSelecionado = _filtroMes === m;
      const cel = grid.get(m);
      const totalMes = somaCels(motivos.map(mo => cel.get(mo)));
      const tds = motivos.map(mo => {
        const c = cel.get(mo);
        return `<td class="devind-mtx-cell" data-devind-mes="${esc(m)}" data-devind-motivo="${esc(mo)}" role="button" tabindex="0" title="${esc(m)} · ${esc(mo)}" style="padding:6px 10px;text-align:center;cursor:pointer">${celTxt(c)}</td>`;
      }).join('');
      return `<tr style="border-top:1px solid var(--surface-2)">
        <td class="devind-mtx-cell" data-devind-mes-total="${esc(m)}" role="button" tabindex="0" style="padding:6px 10px;cursor:pointer;font-weight:${mesSelecionado ? 800 : 600}">${esc(m)}</td>
        ${tds}
        <td style="padding:6px 10px;text-align:center;font-weight:700">${celTxt(totalMes)}</td>
      </tr>`;
    }).join('');
    const linhaTotal = `<tr style="border-top:2px solid var(--surface-2);font-weight:700">
      <td style="padding:6px 10px">Total</td>
      ${motivos.map(mo => `<td style="padding:6px 10px;text-align:center">${celTxt(totalPorMotivo.get(mo))}</td>`).join('')}
      <td style="padding:6px 10px;text-align:center">${celTxt(totalGeral)}</td>
    </tr>`;
    return `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.76rem"><thead><tr style="border-bottom:1px solid var(--surface-2)">${header}</tr></thead><tbody>${linhas}${linhaTotal}</tbody></table></div>`;
  }

  function _tabelaHtml() {
    const itens = [..._filtradas()].sort((a, b) => (_dataEmissaoDe(b) || '').localeCompare(_dataEmissaoDe(a) || ''));
    const total = itens.length;
    const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (_pagina >= totalPaginas) _pagina = totalPaginas - 1;
    if (_pagina < 0) _pagina = 0;
    const slice = itens.slice(_pagina * PAGE_SIZE, _pagina * PAGE_SIZE + PAGE_SIZE);
    const linhas = slice.map(r => {
      const d = _dataEmissaoDe(r);
      const numeroNota = (r.notas && r.notas[0] && r.notas[0].numeroNota) || '—';
      return `<tr>
        <td style="padding:6px 8px">${esc(_destinatarioDe(r) || '—')}</td>
        <td style="padding:6px 8px">${esc(_redeDe(r) || '—')}</td>
        <td style="padding:6px 8px">${esc(numeroNota)}</td>
        <td style="padding:6px 8px">${fmtDataBR(d)}</td>
        <td style="padding:6px 8px">${esc(mesAnoDe(d))}</td>
        <td style="padding:6px 8px;text-align:right;white-space:nowrap">${fmtBRL(_valorDe(r))}</td>
        <td style="padding:6px 8px"><span class="devind-tag"><span class="dot" style="background:${_corMotivo(r.motivoNome)}"></span>${esc(r.motivoNome || '—')}</span></td>
        <td style="padding:6px 8px">${r.retornouFisicamente ? '<span class="badge" style="background:#123a24;color:#8fdcb0;font-size:.65rem">✓ Recebida</span>' : '<span class="badge" style="background:#4a3114;color:#ffd18a;font-size:.65rem">Aguardando retorno</span>'}</td>
      </tr>`;
    }).join('');
    const de = total === 0 ? 0 : _pagina * PAGE_SIZE + 1, ate = Math.min(total, _pagina * PAGE_SIZE + PAGE_SIZE);
    return `<div class="tc" style="padding:16px;margin-top:14px">
      <div class="tc-title">🧾 Notas de devolução (${total.toLocaleString('pt-BR')})</div>
      <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.78rem">
        <thead><tr style="text-align:left;border-bottom:1px solid var(--surface-2)">
          <th style="padding:6px 8px">Loja</th><th style="padding:6px 8px">Rede</th><th style="padding:6px 8px">NF</th><th style="padding:6px 8px">Emissão</th><th style="padding:6px 8px">Mês</th><th style="padding:6px 8px;text-align:right">Valor</th><th style="padding:6px 8px">Motivo</th><th style="padding:6px 8px">Retorno físico</th>
        </tr></thead>
        <tbody>${linhas || '<tr><td colspan="8" style="padding:10px;color:var(--muted)">Nenhuma nota para os filtros aplicados.</td></tr>'}</tbody>
      </table></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:.74rem;color:var(--muted)">
        <span>Mostrando ${de}–${ate} de ${total}</span>
        <span style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm" data-devind-pagina="-1" ${_pagina <= 0 ? 'disabled' : ''}>‹ Anterior</button>
          <button class="btn btn-ghost btn-sm" data-devind-pagina="1" ${_pagina >= totalPaginas - 1 ? 'disabled' : ''}>Próxima ›</button>
        </span>
      </div>
    </div>`;
  }

  function _estilosHtml() {
    return `<style>
      .devind-mtx-cell{transition:background .12s}
      .devind-mtx-cell:hover{background:var(--surface-2)}
      .devind-barrow{cursor:pointer;border-radius:6px;padding:3px;transition:opacity .12s,background .12s}
      .devind-barrow:hover{background:var(--surface-2)}
      .devind-barrow.dim{opacity:.4}
      .devind-barrow.sel{background:var(--surface-2)}
      .devind-tag{display:inline-flex;align-items:center;gap:5px;font-size:.68rem;white-space:nowrap}
      .devind-tag .dot{width:7px;height:7px;border-radius:2px;flex:none}
    </style>`;
  }

  let _devindCarregando = false;
  let _devindErro = '';
  function _devindCarregandoHtml() {
    return _devindCarregando ? '<div style="font-size:.76rem;color:var(--muted);padding:6px 0">⏳ Atualizando...</div>' : '';
  }
  function _devindErroHtml() {
    if (_devindErro) return '<div style="font-size:.76rem;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;margin:8px 0;display:flex;justify-content:space-between;align-items:center;gap:10px"><span>⚠️ Não foi possível atualizar: ' + esc(_devindErro) + '</span><button type="button" class="btn btn-ghost btn-sm" data-devind-tentar-de-novo="1">Tentar de novo</button></div>';
    return '';
  }

  function desenhar() {
    const pagina = document.getElementById('page-recebimento-devolucoes-indicadores');
    if (!pagina) return;
    const itens = _filtradas();
    const k = kpis(itens);
    const porMotivo = _agrupar(_recusas.filter(r => _match(r, { motivo: true })), r => r.motivoNome);
    const porMes = _agrupar(_recusas.filter(r => _match(r, { mes: true })), r => mesAnoDe(_dataEmissaoDe(r))).sort((a, b) => {
      const [ma, ya] = a.label.split('/').map(Number), [mb, yb] = b.label.split('/').map(Number);
      return (ya * 12 + ma) - (yb * 12 + mb);
    });
    const porRede = _agrupar(_recusas.filter(r => _match(r, { rede: true })), r => _redeDe(r));
    const porMercado = _agrupar(itens, r => _destinatarioDe(r));
    const temFiltro = !!(_filtroMes || _filtroMotivo || _filtroRede || _filtroRetorno || _busca);
    pagina.innerHTML = `
      ${_estilosHtml()}
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h2 style="margin:0">📊 Indicadores de Devoluções (BI)</h2><div style="color:var(--muted);font-size:.78rem;margin-top:4px">Só devoluções gravadas automaticamente (motivo falta/errado/desacordo) — separado dos retornos físicos processados pelo Coletor. Gravar automático só confirma a nota; "Retorno físico" mostra se a carga já foi bipada de verdade no Coletor. Clique em qualquer coluna, barra ou segmento para filtrar; período filtra pela data de emissão real da nota.</div></div>
        <div style="display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap">
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">EMISSÃO — DE</div><input type="date" class="field" id="devind-periodo-ini" value="${esc(_periodoInicio)}" style="padding:7px"></div>
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">ATÉ</div><input type="date" class="field" id="devind-periodo-fim" value="${esc(_periodoFim)}" style="padding:7px"></div>
          ${(_periodoInicio || _periodoFim) ? '<button class="btn btn-ghost btn-sm" data-devind-limpar-periodo="1">✕ período</button>' : ''}
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">RETORNO FÍSICO</div><select class="field" id="devind-filtro-retorno" style="padding:7px">
            <option value="" ${_filtroRetorno === '' ? 'selected' : ''}>Todas</option>
            <option value="nao" ${_filtroRetorno === 'nao' ? 'selected' : ''}>Aguardando retorno</option>
            <option value="sim" ${_filtroRetorno === 'sim' ? 'selected' : ''}>Já retornou</option>
          </select></div>
          ${_recusas.some(r => r.motivoNome === MOTIVO_IMPROPRIO) ? '<button class="btn btn-ghost btn-sm" data-devind-limpar-improprios="1" title="Impróprio para consumo/venda não é mais gravado automaticamente — apaga os registros antigos">🗑 Limpar Impróprios</button>' : ''}
          <button class="btn btn-ghost" data-devind-atualizar="1">↻ Atualizar</button>
        </div>
      </div>
      ${_devindCarregandoHtml()}
      ${_devindErroHtml()}
      ${resumoHtml(k)}
      <div class="tc" style="padding:16px;margin-top:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div class="tc-title" style="margin:0">🔥 Motivo por mês</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input type="search" class="field" id="devind-busca" placeholder="Buscar loja ou rede…" value="${esc(_busca)}" style="padding:6px 8px;font-size:.78rem;min-width:200px">
            ${temFiltro ? '<button class="btn btn-ghost btn-sm" data-devind-limpar-filtros="1">✕ limpar filtros</button>' : ''}
          </div>
        </div>
        ${_matrizHtml()}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;margin-top:10px">
        <div class="tc" style="padding:16px"><div class="tc-title">↩️ Motivo da devolução</div>${barChart(porMotivo, { limit: 10, filterKey: 'motivo', filtroAtivo: _filtroMotivo })}</div>
        <div class="tc" style="padding:16px"><div class="tc-title">📅 Devoluções por mês</div>${barChart(porMes, { cronologico: true, limit: 24, filterKey: 'mes', filtroAtivo: _filtroMes })}</div>
        <div class="tc" style="padding:16px"><div class="tc-title">🏬 Top redes/bandeiras</div>${barChart(porRede, { limit: 10, filterKey: 'rede', filtroAtivo: _filtroRede })}</div>
        <div class="tc" style="padding:16px"><div class="tc-title">🏪 Top mercados/lojas</div>${barChart(porMercado, { limit: 10 })}</div>
      </div>
      ${_tabelaHtml()}`;
    global.aplicarPermissoesAnalista?.();
  }

  // Shell-first (mesmo padrão de 99-recebimento-retornos-status.js): desenhar()
  // já é seguro com _recusas vazio, então chama ela ANTES do fetch (título/
  // filtros/botão aparecem na hora) e de novo depois, nunca escondendo a
  // estrutura atrás de um "Carregando..." de página inteira.
  async function _atualizarDadosDevInd(forcar) {
    _devindCarregando = true;
    _devindErro = '';
    desenhar();
    try { await carregarDevolucoesIndicadores(forcar); } catch (e) { _devindErro = e.message || String(e); }
    _devindCarregando = false;
    desenhar();
  }

  async function renderDevolucoesBiIndicadores() {
    const pagina = document.getElementById('page-recebimento-devolucoes-indicadores');
    if (!pagina) return;
    await _atualizarDadosDevInd();
  }

  document.addEventListener('click', e => {
    if (e.target.closest('[data-devind-atualizar]') || e.target.closest('[data-devind-tentar-de-novo]')) { _atualizarDadosDevInd(true); return; }
    if (e.target.closest('[data-devind-limpar-improprios]')) { _limparImproprios(); return; }
    if (e.target.closest('[data-devind-limpar-periodo]')) { _periodoInicio = ''; _periodoFim = ''; _pagina = 0; desenhar(); return; }
    if (e.target.closest('[data-devind-limpar-filtros]')) { _filtroMes = ''; _filtroMotivo = ''; _filtroRede = ''; _filtroRetorno = ''; _busca = ''; _pagina = 0; desenhar(); return; }

    const mesTotal = e.target.closest('[data-devind-mes-total]');
    if (mesTotal) { const m = mesTotal.getAttribute('data-devind-mes-total'); _filtroMes = (_filtroMes === m) ? '' : m; _pagina = 0; desenhar(); return; }

    const seg = e.target.closest('.devind-mtx-cell[data-devind-mes]');
    if (seg) {
      const m = seg.getAttribute('data-devind-mes'), mo = seg.getAttribute('data-devind-motivo');
      if (_filtroMes === m && _filtroMotivo === mo) { _filtroMes = ''; _filtroMotivo = ''; }
      else { _filtroMes = m; _filtroMotivo = mo; }
      _pagina = 0; desenhar(); return;
    }

    const barra = e.target.closest('[data-devind-filtro]');
    if (barra) {
      const chave = barra.getAttribute('data-devind-filtro');
      const valor = barra.getAttribute('data-devind-valor');
      if (chave === 'motivo') _filtroMotivo = (_filtroMotivo === valor) ? '' : valor;
      else if (chave === 'rede') _filtroRede = (_filtroRede === valor) ? '' : valor;
      else if (chave === 'mes') _filtroMes = (_filtroMes === valor) ? '' : valor;
      _pagina = 0; desenhar(); return;
    }

    if (e.target.closest('[data-devind-pagina="-1"]')) { _pagina = Math.max(0, _pagina - 1); desenhar(); return; }
    if (e.target.closest('[data-devind-pagina="1"]')) { _pagina++; desenhar(); return; }
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const alvo = e.target.closest('[data-devind-mes-total],.devind-mtx-cell,[data-devind-filtro]');
    if (alvo) { e.preventDefault(); alvo.click(); }
  });
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'devind-periodo-ini') { _periodoInicio = e.target.value || ''; _pagina = 0; desenhar(); }
    if (e.target && e.target.id === 'devind-periodo-fim') { _periodoFim = e.target.value || ''; _pagina = 0; desenhar(); }
    if (e.target && e.target.id === 'devind-filtro-retorno') { _filtroRetorno = e.target.value || ''; _pagina = 0; desenhar(); }
  });
  document.addEventListener('input', e => {
    if (e.target && e.target.id === 'devind-busca') { _busca = e.target.value || ''; _pagina = 0; desenhar(); }
  });

  global.renderDevolucoesBiIndicadores = renderDevolucoesBiIndicadores;
  global._DevolucoesBiIndicadoresInternals = { kpis, _agrupar, mesAnoDe, _dataEmissaoDe, carregarDevolucoesIndicadores, getRecusas: () => _recusas, _corMotivo, _limparImproprios, MOTIVO_IMPROPRIO, _chavesComRetornoFisico, _retornouFisicamente };
  global.DTProducao?.registrarInvalidacao?.(() => { _recusas = []; });
})(window);
