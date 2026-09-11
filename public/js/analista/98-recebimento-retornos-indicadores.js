// Recebimento > Notas Retornadas > Indicadores (FASE 11)
// "Quais mercados mais devolvem, quais gerentes, quais vendedores têm mais
// volta" — pedido ao vivo do usuário, modelado no mesmo estilo visual do
// Acompanhamento (dashRankedBarChart generaliza acompColumnChart de
// 41-dashboard-acomp-v37.js: CSS feito à mão, sem introduzir Chart.js).
//
// PEDIDO AO VIVO (2026-08-20, com print de um dashboard Power BI de
// referência): "quero que os indicadores de retorno funcionem com essas
// informações, e que sejam interativos caso clique em alguma informação as
// outras atualizem". Escopo combinado com o usuário (AskUserQuestion):
// - Construir agora com o que já é dado real (motivo, vendedor, supervisor,
//   mercado, pallets, volume, valor, mês) — "Ação"/"Status" do print ficam
//   de fora até a Fase 12 (fluxo liberado→fiscal→endereçado) existir, esta
//   ainda deliberadamente adiada.
// - "Transportadora" do print usa o campo Motorista (mais próximo que já
//   existe e é preenchido em toda nota).
// - Valor (R$) passou a ser gravado a partir de agora em
//   recebimento_recusas_notas (ver 97-recebimento-recusas.js e
//   functions/index.js) — notas salvas antes disso ficam com valorTotal=0.
//
// PEDIDO AO VIVO (2026-08-21, segundo print do mesmo dashboard de
// referência): a Fase 12 (Status de Retornos) já existe agora, então
// "Ação" (Tratamento) e "Status" saem do adiamento acima — MAS não como
// gráfico. Usuário corrigiu explicitamente: "como ta na imagem ação
// devolução pendente recusa reentregas nao sao graficos é um card que eu
// seleciono... é que nem os status, o que vira grafico é o que ja te
// mandei nas imagens". Confirmado abrindo o .pbix real (Report/Layout):
// os dois são visualType:"slicer", mode:"Basic" — um painel de checkbox
// multi-seleção, igual a um filtro, nunca uma barra. Implementados aqui
// como 2 painéis de checkbox (mesma ideia de "só aparece se tiver alguma
// nota real com aquele valor" — a lista de opções vem dos dados de
// verdade, nunca uma lista fixa com categoria vazia), combinados via E
// com o filtro de período e o filtro cruzado por clique-na-barra (esse
// sim continua só nos OUTROS gráficos: transportadora/motivo/mercado/
// vendedor/supervisor/mês). Reentrega não usa `statusRetorno` (fluxo
// próprio — ver 99-recebimento-retornos-status.js), então nunca aparece
// nas opções do painel de Status.
(function (global) {
  'use strict';

  // Ver mesmo bloco/comentário em 97-recebimento-recusas.js.
  global.DT_RETORNOS_DIRTY = global.DT_RETORNOS_DIRTY || { patio: false, indicadores: false, status: false, recusas: false };

  const COL_NOTAS = 'recebimento_recusas_notas';
  const COL_RECUSAS = 'recebimento_recusas';

  let _recusas = [];
  let _notas = [];
  let _notasPorChave = new Map();
  // PEDIDO AO VIVO (2026-09-09): "os indicadores que tá demorando" —
  // buscava recebimento_recusas do zero toda vez, mesmo que 97 (Notas
  // Retornadas) já tivesse acabado de carregar a mesma coleção segundos
  // antes. Sem cache compartilhado entre os arquivos (dado diferente:
  // aqui já vem filtrado/achatado do jeito que os indicadores precisam) —
  // pelo menos evita refazer a MESMA busca de novo ao voltar nesta tela.
  // PEDIDO AO VIVO (2026-09-10): "busca manual" pra todas as telas pesadas
  // de Recebimento — mas ESTA tela é diferente das outras 3 (97/99/103):
  // o objetivo dela é análise de TENDÊNCIA de longo prazo ("Média de dias
  // p/ finalizar por mês" já pede até 24 meses de histórico de propósito),
  // não uma fila operacional do que precisa de atenção agora. Um teto de
  // 3 meses quebraria a razão de existir do gráfico mensal. 2 anos ainda
  // limita a busca (não é mais "sem fim, cresce pra sempre"), mas deixa
  // margem confortável pro gráfico de 24 meses funcionar de verdade.
  const DIAS_MAX_PERIODO = 731; // ~2 anos
  let _periodoBuscado = ''; // chave "ini|fim" do último período buscado com sucesso — vazio = ainda não buscou
  // Filtro cruzado ÚNICO (clicar numa barra filtra tudo, clicar de novo na
  // mesma barra limpa) — é o padrão mínimo que atende "clico em alguma
  // informação, as outras atualizam" sem a complexidade de múltiplos
  // filtros simultâneos (que o print não exige: é sempre 1 seleção ativa
  // por vez guiando o resto).
  let _filtro = null; // { dim, valor }
  // Pedido ao vivo do usuário: "nos gráficos tem que ter a opção de
  // período, para filtrar no período" — filtra por criadoEm (data do
  // retorno) ANTES do filtro cruzado por clique, os dois se combinam.
  let _periodoInicio = '';
  let _periodoFim = '';
  // Painéis de checkbox (Ação/Status — ver comentário no topo do
  // arquivo): multi-seleção de verdade, igual ao slicer real do Power BI
  // ("Basic" = checkbox-list). Vazio = sem filtro (todo mundo passa).
  let _filtroAcaoSet = new Set();
  let _filtroStatusSet = new Set();

  function fs() {
    if (typeof global.getDTFirestore === 'function') return global.getDTFirestore();
    if (global.firebase && typeof global.firebase.firestore === 'function') return global.firebase.firestore();
    throw new Error('Firestore ainda não foi inicializado. Recarregue a página.');
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
  function fmtBRL(v) { return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function mesAnoDe(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return '';
    return String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  }
  function ordenarCronologico(itens) {
    return [...itens].sort((a, b) => {
      const [ma, ya] = String(a.label).split('/').map(Number);
      const [mb, yb] = String(b.label).split('/').map(Number);
      return (ya * 12 + ma) - (yb * 12 + mb);
    });
  }

  function _periodoPadrao() {
    const fim = new Date();
    const inicio = new Date(fim.getTime() - (DIAS_MAX_PERIODO - 1) * 86400000);
    return { ini: inicio.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) };
  }
  function _periodoValido(ini, fim) {
    if (!ini || !fim) return false;
    const dIni = new Date(ini + 'T00:00:00'), dFim = new Date(fim + 'T23:59:59');
    if (Number.isNaN(dIni.getTime()) || Number.isNaN(dFim.getTime()) || dIni > dFim) return false;
    return (dFim - dIni) / 86400000 <= DIAS_MAX_PERIODO;
  }
  // COL_NOTAS (ledger de venda inteiro, usado só pra enriquecer cada nota
  // com dado que o resumo embutido em recebimento_recusas não carrega —
  // ex.: valorTotal, vendedorNome) não depende do período escolhido — busca
  // só 1 vez por sessão, independente de quantas vezes o período mudar.
  let _notasCarregadas = false;
  async function _carregarNotasVenda(forcar) {
    if (_notasCarregadas && !forcar) return;
    const n = await fs().collection(COL_NOTAS).get();
    _notas = n.docs.map(d => ({ _id: d.id, ...d.data() }));
    _notasPorChave = new Map(_notas.map(x => [x.chave, x]));
    _notasCarregadas = true;
  }
  // PEDIDO AO VIVO (2026-09-11, Fase 2 do espelho BigQuery): "por que a
  // Bluesoft não demora com 1 ano de dados e aqui demora?" — a resposta
  // real era arquitetural: o Firestore não agrega no servidor, então quem
  // somava/filtrava era sempre o NAVEGADOR. Esta busca agora passa por uma
  // Cloud Function (buscarIndicadoresRetornosBigQuery) que consulta o
  // espelho no BigQuery (view "_raw_latest" da extensão firestore-
  // bigquery-export, que já resolve create/update/delete pro estado mais
  // recente de cada documento) em vez do Firestore direto — devolve os
  // MESMOS documentos crus, no mesmo formato {_id, ...dados}; todo o
  // agrupamento/filtro cruzado/checkboxes abaixo continua exatamente
  // igual, só a ORIGEM da busca mudou. Mantém o filtro de origem:
  // AUTOMATICO/motivoAutomaticoTexto no cliente também (a função já filtra
  // no servidor, mas é barato manter como defesa redundante, mesmo padrão
  // do resto do projeto).
  // BUG AO VIVO REAL (2026-09-11, achado no log do servidor em outra
  // tela desta mesma leva): sem trava contra chamada concorrente, uma
  // navegação disparando o render mais de uma vez (ou clique duplo)
  // enquanto a busca ainda não voltou cria uma consulta NOVA em cima da
  // anterior. `_indicadoresCarregandoPromise` garante que quem chegar
  // nesse meio tempo espera a MESMA promessa.
  let _indicadoresCarregandoPromise = null;
  async function carregarDadosIndicadores(ini, fim, forcar) {
    if (!_periodoValido(ini, fim)) throw new Error('Escolha um período válido de até 3 meses.');
    const chave = ini + '|' + fim;
    await _carregarNotasVenda(forcar);
    if (_periodoBuscado !== chave || forcar) {
      if (!_indicadoresCarregandoPromise) {
        _indicadoresCarregandoPromise = (async () => {
          const lojaId = typeof global.getDTLojaAtiva === 'function' ? global.getDTLojaAtiva() : '';
          if (!lojaId) throw new Error('Nenhuma loja selecionada.');
          const callable = global.firebase.app().functions('southamerica-east1').httpsCallable('buscarIndicadoresRetornosBigQuery');
          const resposta = await callable({ lojaId, ini, fim });
          const docs = (resposta && resposta.data && resposta.data.recusas) || [];
          // PEDIDO AO VIVO (2026-08-31): devolução auto-gravada (origem:
          // 'AUTOMATICO') tem indicador próprio e separado — ver
          // 102-devolucoes-bi-indicadores.js. Excluída daqui pra não
          // misturar motorista/transportadora/box (que ela não tem) com
          // os retornos físicos de verdade processados pelo Coletor.
          _recusas = docs.filter(x => x.origem !== 'AUTOMATICO' && x.motivoAutomaticoTexto == null);
          _periodoBuscado = chave;
        })();
      }
      try {
        await _indicadoresCarregandoPromise;
      } finally {
        _indicadoresCarregandoPromise = null;
      }
    }
    _filtro = null; // dado novo — um filtro antigo poderia apontar pra um valor que não existe mais
    _filtroAcaoSet = new Set();
    _filtroStatusSet = new Set();
  }

  function notaCompletaDe(n) { return _notasPorChave.get(n.chave) || n; }

  // Cada dimensão sabe extrair, de UMA recusa (evento), os valores que ela
  // contribui — usado tanto pra agregar (contar) quanto pra filtrar (uma
  // recusa passa no filtro se um desses valores bate).
  // PEDIDO AO VIVO (2026-09-11): "ele veio e devolveu uma única vez, mas
  // trouxe 10 notas, vai somar 10 ocorrências — ali tudo é por notas
  // retornadas" — SEM deduplicar dentro do mesmo evento: se as 10 notas são
  // do mesmo mercado/vendedor/motorista, conta as 10, não 1. Renomeada de
  // `valoresUnicosDeNotas` (nome antigo já não descrevia o comportamento).
  function valoresPorNota(r, campo) {
    const valores = [];
    (r.notas && r.notas.length ? r.notas : [{}]).forEach(n => {
      const v = String(notaCompletaDe(n)[campo] || '').trim();
      if (v) valores.push(v);
    });
    return valores;
  }
  // Dimensões do EVENTO (motivo/transportadora/mês não variam nota a nota
  // hoje — são campo do documento inteiro), repetido 1x por nota física
  // pra contar do mesmo jeito ("ocorrência por transportadora" = quantas
  // notas aquele motorista trouxe, não quantas vezes ele veio).
  function valorDoEventoPorNota(r, valor) {
    const v = String(valor || '').trim();
    if (!v) return [];
    const qtdNotas = (r.notas && r.notas.length) ? r.notas.length : 1;
    return new Array(qtdNotas).fill(v);
  }
  const DIMENSOES = {
    motivo: { titulo: 'Motivos da Volta', icone: '↩️', valoresDaRecusa: r => valorDoEventoPorNota(r, r.motivoNome) },
    // "Transportadora" (pedido ao vivo, combinado com o usuário): usa
    // Motorista — mais próximo dado real disponível hoje.
    transportadora: { titulo: 'Ocorrências por Transportadora', icone: '🚚', valoresDaRecusa: r => valorDoEventoPorNota(r, r.motoristaNome) },
    mercado: { titulo: 'Notas por Cliente/Mercado', icone: '🏪', valoresDaRecusa: r => valoresPorNota(r, 'destinatario') },
    vendedor: { titulo: 'Notas por Vendedor', icone: '🧑‍💼', valoresDaRecusa: r => valoresPorNota(r, 'vendedorNome') },
    supervisor: { titulo: 'Notas por Supervisor', icone: '👔', valoresDaRecusa: r => valoresPorNota(r, 'supervisorNome') },
    mes: { titulo: 'Retornos por Mês', icone: '📅', valoresDaRecusa: r => valorDoEventoPorNota(r, mesAnoDe(r.criadoEm)) },
    // Ação (Tratamento) e Status NÃO viram gráfico (ver comentário no topo
    // do arquivo) — ficam aqui só como fonte de dado pros PAINÉIS DE
    // CHECKBOX (painelFiltroHtml), reaproveitando a mesma extração
    // valoresDaRecusa() que os gráficos usam, sem duplicar lógica. Rótulo
    // humano vem de TRATAMENTO_LABELS (global, exportado por
    // 97-recebimento-recusas.js) / STATUS_RETORNO_LABELS (global,
    // exportado por 99-recebimento-retornos-status.js) — mesma fonte de
    // verdade usada nas outras telas, sem duplicar o mapa aqui.
    // PEDIDO AO VIVO (2026-09-08): "cada nota tem que gerar uma linha...
    // se ela tiver junta e uma for reentrega e a outra for recusa" —
    // Tratamento/Status passaram de campo do documento pra campo de cada
    // item de `notas[i]` (ver 97/99/103). Aqui NÃO se explode o evento em
    // várias linhas (os KPIs de quantidade física — total de retornos,
    // pallets, volume — continuam por evento, de propósito, senão um
    // evento de 3 notas contaria 3x); só os 2 extratores abaixo passam a
    // olhar por nota, podendo devolver MAIS DE 1 rótulo por evento quando
    // as notas divergem — mesmo formato de array que `valoresUnicosDeNotas`
    // já usa pra mercado/vendedor/supervisor (um evento com 2 notas de
    // clientes diferentes já conta nos dois lugares certos hoje).
    tratamento: {
      titulo: 'Ação', icone: '🗂️',
      valoresDaRecusa: r => {
        const vistos = new Set();
        (r.notas && r.notas.length ? r.notas : [{}]).forEach(n => {
          const v = n.tratamento != null ? n.tratamento : (r.tratamento || '');
          vistos.add((global.TRATAMENTO_LABELS && global.TRATAMENTO_LABELS[v]) || (v ? v : 'Não classificado'));
        });
        return [...vistos];
      },
    },
    // Reentrega não usa statusRetorno (fluxo próprio — Data Programada/
    // Saída), então fica de fora desta dimensão específica.
    status: {
      titulo: 'Status', icone: '🚦',
      valoresDaRecusa: r => {
        const vistos = new Set();
        (r.notas && r.notas.length ? r.notas : [{}]).forEach(n => {
          const trat = n.tratamento != null ? n.tratamento : (r.tratamento || '');
          if (trat === 'REENTREGA') return;
          const v = n.statusRetorno != null ? n.statusRetorno : (r.statusRetorno || '');
          const labels = global._recebimentoRetornosStatusInternals && global._recebimentoRetornosStatusInternals.STATUS_RETORNO_LABELS;
          vistos.add((labels && labels[v]) || (v || 'Aguard. Monitoramento'));
        });
        return [...vistos];
      },
    },
  };

  function recusaPassaPeriodo(r) {
    if (!_periodoInicio && !_periodoFim) return true;
    const d = r.criadoEm ? new Date(r.criadoEm) : null;
    if (!d || isNaN(d)) return false; // sem data não dá pra saber se cai no período — fica de fora quando um período está ativo
    if (_periodoInicio && d < new Date(_periodoInicio + 'T00:00:00')) return false;
    if (_periodoFim && d > new Date(_periodoFim + 'T23:59:59')) return false;
    return true;
  }
  // Painéis de checkbox (Ação/Status) — multi-seleção: uma recusa passa se
  // o valor dela bater com QUALQUER um dos marcados naquele painel (E entre
  // painéis, OU dentro do mesmo painel — mesmo comportamento de um slicer
  // "Basic" do Power BI).
  function recusaPassaPaineis(r) {
    // PEDIDO AO VIVO (2026-09-08): cada dimensão agora pode devolver mais
    // de 1 valor por evento (notas com Tratamento/Status diferentes no
    // mesmo evento) — passa se QUALQUER um dos valores bater com o filtro,
    // não só o primeiro.
    if (_filtroAcaoSet.size) {
      const vals = DIMENSOES.tratamento.valoresDaRecusa(r);
      if (!vals.some(v => _filtroAcaoSet.has(v))) return false;
    }
    if (_filtroStatusSet.size) {
      const vals = DIMENSOES.status.valoresDaRecusa(r);
      if (!vals.length || !vals.some(v => _filtroStatusSet.has(v))) return false;
    }
    return true;
  }
  function recusaPassaFiltro(r) {
    if (!recusaPassaPeriodo(r)) return false;
    if (!recusaPassaPaineis(r)) return false;
    if (!_filtro) return true;
    const def = DIMENSOES[_filtro.dim];
    if (!def) return true;
    return def.valoresDaRecusa(r).includes(_filtro.valor);
  }
  function recusasFiltradas() { return _recusas.filter(recusaPassaFiltro); }

  function agregarPorDimensao(dim) {
    const def = DIMENSOES[dim];
    if (!def) return [];
    const contagem = new Map();
    recusasFiltradas().forEach(r => def.valoresDaRecusa(r).forEach(v => contagem.set(v, (contagem.get(v) || 0) + 1)));
    return [...contagem.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }
  // Retrocompatível: nome antigo usado por quem já dependia dele (mercado).
  function agregarPorCampoDaNota(campo) {
    const contagem = new Map();
    recusasFiltradas().forEach(r => valoresPorNota(r, campo).forEach(v => contagem.set(v, (contagem.get(v) || 0) + 1)));
    return [...contagem.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }

  function diasEntre(inicioIso, fimIso) {
    if (!inicioIso) return null;
    const ini = new Date(inicioIso);
    const fim = fimIso ? new Date(fimIso) : new Date();
    if (isNaN(ini) || isNaN(fim)) return null;
    const dias = (fim - ini) / 86400000;
    return dias >= 0 ? dias : null;
  }
  // Data em que a NOTA entrou em FINALIZADO pela 1ª vez — mesma ideia de
  // dataFinalizacaoDe em 99-recebimento-retornos-status.js/103-recusas-
  // indicadores.js, duplicada aqui (histórico é por nota, com fallback pro
  // histórico antigo do documento pra registro anterior a esta migração).
  function dataFinalizacaoDeNota(n, r) {
    const hist = Array.isArray(n.statusRetornoHistorico) ? n.statusRetornoHistorico
      : (Array.isArray(r.statusRetornoHistorico) ? r.statusRetornoHistorico : []);
    const evento = hist.find(e => e && e.status === 'FINALIZADO');
    return evento ? evento.em : null;
  }
  // PEDIDO AO VIVO (2026-09-08): "a soma MÉDIA DE DIAS P/ FINALIZAR vai
  // ser a partir de quando colocar o STATUS em ENDEREÇANDO" — substitui o
  // proxy antigo (emissão da NF → registro da volta, usado enquanto não
  // existia fluxo de status real) pela métrica de verdade: Endereçando →
  // Finalizado (ou até agora, se a nota ainda não finalizou). Só entra na
  // média quem já passou por Endereçando — nunca inventa data.
  function diasParaFinalizarDaRecusa(r) {
    const dias = [];
    (r.notas || []).forEach(n => {
      const inicio = n.dataDoEnderecamentoEm != null ? n.dataDoEnderecamentoEm : r.dataDoEnderecamentoEm;
      if (!inicio) return;
      const d = diasEntre(inicio, dataFinalizacaoDeNota(n, r));
      if (d != null) dias.push(d);
    });
    if (!dias.length) return null;
    return dias.reduce((s, x) => s + x, 0) / dias.length;
  }
  function agregarMediaDiasPorMes() {
    const porMes = new Map();
    recusasFiltradas().forEach(r => {
      const dias = diasParaFinalizarDaRecusa(r);
      const mes = mesAnoDe(r.criadoEm);
      if (dias == null || !mes) return;
      const atual = porMes.get(mes) || { soma: 0, n: 0 };
      atual.soma += dias; atual.n += 1;
      porMes.set(mes, atual);
    });
    return ordenarCronologico([...porMes.entries()].map(([label, { soma, n }]) => ({ label, value: Math.round((soma / n) * 10) / 10 })));
  }
  function mediaDiasGeral() {
    const validos = recusasFiltradas().map(diasParaFinalizarDaRecusa).filter(d => d != null);
    if (!validos.length) return null;
    return Math.round((validos.reduce((s, x) => s + x, 0) / validos.length) * 10) / 10;
  }

  function kpis() {
    const filtradas = recusasFiltradas();
    const somaPallets = filtradas.reduce((s, r) => s + (Number(r.pallets) || 0), 0);
    const somaVolume = filtradas.reduce((s, r) => s + (Number(r.volumeInformado) || 0), 0);
    const chavesVistas = new Set();
    let somaValor = 0;
    filtradas.forEach(r => (r.notas || []).forEach(n => {
      if (chavesVistas.has(n.chave)) return;
      chavesVistas.add(n.chave);
      somaValor += Number(notaCompletaDe(n).valorTotal) || 0;
    }));
    return { totalRetornos: filtradas.length, somaPallets, somaVolume, somaValor, mediaDias: mediaDiasGeral() };
  }

  // Generalização de acompColumnChart (41-dashboard-acomp-v37.js): mesmas
  // classes CSS (dash-column-*, já definidas em analista.html), só que UMA
  // barra por grupo em vez de duas (auditados/divergências) — um ranking
  // simples de label+valor é exatamente esse caso. `opts.dim` liga o
  // clique de cada barra ao filtro cruzado; `opts.cronologico` preserva a
  // ordem de entrada (mês) em vez de reordenar por valor.
  function dashRankedBarChart(itens, opts) {
    opts = opts || {};
    const limit = opts.limit || 10;
    const dim = opts.dim || null;
    if (!itens.length) return '<div class="empty"><div class="empty-title">Sem dados para exibir</div><div class="empty-sub">Nenhum retorno com esse dado preenchido ainda.</div></div>';
    const dados = (opts.cronologico ? itens : [...itens].sort((a, b) => b.value - a.value)).slice(0, limit);
    const max = Math.max(...dados.map(x => x.value), 1);
    const teto = Math.max(1, Math.ceil(max / 4) * 4);
    const linhas = [0, 1, 2, 3, 4].map(n => Math.round(teto * n / 4));
    return `<div class="dash-column-scroll"><div class="dash-column-chart" style="--chart-count:${dados.length}">
      <div class="dash-y-axis">${linhas.map((v, i) => `<span style="bottom:${i * 25}%">${v}</span>`).join('')}</div>
      <div class="dash-grid-lines">${linhas.map((_, i) => `<i style="bottom:${i * 25}%"></i>`).join('')}</div>
      <div class="dash-column-groups">${dados.map((x, idx) => {
        const h = x.value ? Math.max(4, x.value / teto * 100) : 0;
        const ativo = dim && _filtro && _filtro.dim === dim && _filtro.valor === x.label;
        const atrs = dim ? ` data-indic-dim="${esc(dim)}" data-indic-val="${esc(x.label)}" tabindex="0" role="button"` : '';
        const estiloAtivo = ativo ? ';outline:2px solid var(--accent);border-radius:8px;background:rgba(0,229,255,.08)' : '';
        return `<div class="dash-column-group"${atrs} style="${dim ? 'cursor:pointer' : ''}${estiloAtivo}" title="${esc(x.label)}: ${x.value}${dim ? ' — clique pra filtrar tudo por isso' : ''}">
          <span class="dash-columns"><i class="dash-column auditados" style="height:${h}%"><b>${x.value}</b></i></span>
          <span class="dash-column-label"><em>${idx + 1}.</em> ${esc(x.label)}</span>
        </div>`;
      }).join('')}</div>
    </div></div>`;
  }

  // Pedido ao vivo do usuário (com print de referência estilo Power BI):
  // "os gráficos dos cards quero idênticos, e não tá nada parecidos" — o
  // dashboard de referência usa barra HORIZONTAL ranqueada pros rankings
  // (transportadora/motivo/cliente/vendedor/supervisor), não coluna
  // vertical. CSS puro (dash-hbar-*, definido em analista.html), mesmo
  // espírito de dashRankedBarChart: sem Chart.js, e mesmo esquema de
  // data-indic-dim/data-indic-val pro clique-pra-filtrar funcionar igual.
  function dashHorizontalBarChart(itens, opts) {
    opts = opts || {};
    const limit = opts.limit || 15;
    const dim = opts.dim || null;
    if (!itens.length) return '<div class="empty"><div class="empty-title">Sem dados para exibir</div><div class="empty-sub">Nenhum retorno com esse dado preenchido ainda.</div></div>';
    const dados = [...itens].sort((a, b) => b.value - a.value).slice(0, limit);
    const max = Math.max(...dados.map(x => x.value), 1);
    return `<div class="dash-hbar-chart">${dados.map((x, idx) => {
      const largura = x.value ? Math.max(2, x.value / max * 100) : 0;
      const ativo = dim && _filtro && _filtro.dim === dim && _filtro.valor === x.label;
      const atrs = dim ? ` data-indic-dim="${esc(dim)}" data-indic-val="${esc(x.label)}" tabindex="0" role="button"` : '';
      return `<div class="dash-hbar-row${ativo ? ' is-ativo' : ''}"${atrs} title="${esc(x.label)}: ${x.value}${dim ? ' — clique pra filtrar tudo por isso' : ''}">
        <span class="dash-hbar-label">${idx + 1}. ${esc(x.label)}</span>
        <span class="dash-hbar-track"><span class="dash-hbar-fill" style="width:${largura}%"></span></span>
        <span class="dash-hbar-value">${x.value}</span>
      </div>`;
    }).join('')}</div>`;
  }

  function chipFiltroHtml() {
    if (!_filtro) return '';
    const def = DIMENSOES[_filtro.dim];
    return `<div style="display:flex;align-items:center;gap:8px;background:rgba(0,229,255,.08);border:1px solid var(--accent);border-radius:20px;padding:6px 12px;font-size:.78rem;margin:10px 0">
      <span>Filtrando por <b>${esc(def ? def.titulo : _filtro.dim)}</b>: ${esc(_filtro.valor)}</span>
      <button class="btn btn-ghost btn-sm" data-indic-limpar-filtro="1" style="padding:2px 8px;font-size:.72rem">✕ limpar</button>
    </div>`;
  }

  function resumoHtml() {
    const k = kpis();
    return `<div style="display:grid;grid-template-columns:repeat(5,minmax(140px,1fr));gap:10px;margin:12px 0 4px">
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">TOTAL DE RETORNOS</div><div style="font-size:1.45rem;font-weight:850">${k.totalRetornos}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">PALLETS</div><div style="font-size:1.45rem;font-weight:850">${k.somaPallets}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">VOLUME INFORMADO</div><div style="font-size:1.45rem;font-weight:850">${k.somaVolume}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">VALOR</div><div style="font-size:1.3rem;font-weight:850">${fmtBRL(k.somaValor)}</div></div>
      <div class="tc" style="padding:14px"><div style="font-size:.72rem;color:var(--muted)">MÉDIA DE DIAS P/ FINALIZAR</div><div style="font-size:1.45rem;font-weight:850">${k.mediaDias == null ? '—' : k.mediaDias}</div></div>
    </div>`;
  }

  // Opções do painel: valores REAIS distintos que existem nos dados (nunca
  // uma lista fixa) — pedido ao vivo do usuário: "eles só aparecem caso
  // tenha alguma [nota] com ela". Ignora o próprio filtro da dimensão (só
  // o de período) — senão desmarcar tudo faria a lista de opções sumir.
  function opcoesDoPainel(dim) {
    const vistos = new Set();
    _recusas.filter(recusaPassaPeriodo).forEach(r => DIMENSOES[dim].valoresDaRecusa(r).forEach(v => vistos.add(v)));
    return [...vistos].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }
  // Painel de checkbox multi-seleção — mesmo comportamento de um slicer
  // "Basic" do Power BI (confirmado abrindo o .pbix real do usuário).
  // PEDIDO AO VIVO (usuário mandou print do painel REAL do Power BI:
  // "assim" — colunas lado a lado, texto simples, sem caixa/borda/sombra):
  // trocado de card (.tc, com fundo/borda) pra coluna nua, igual ao
  // slicer de verdade — cada uma só ocupa a largura do próprio texto
  // (width:fit-content), sem nenhum enfeite de card em volta.
  function painelFiltroHtml(dim, selecionados) {
    const opcoes = opcoesDoPainel(dim);
    if (!opcoes.length) return '';
    const def = DIMENSOES[dim];
    return `<div style="width:fit-content;flex:0 0 auto">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="font-size:.74rem;font-weight:700;color:var(--text);text-transform:uppercase;white-space:nowrap">${esc(def.titulo)}</div>
        ${selecionados.size ? `<button class="btn btn-ghost btn-sm" data-indic-painel-limpar="${esc(dim)}" style="padding:1px 6px;font-size:.64rem;white-space:nowrap">limpar</button>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:7px;max-height:180px;overflow:auto">
        ${opcoes.map(v => `<label style="display:flex;align-items:center;gap:7px;font-size:.78rem;color:var(--text);cursor:pointer;white-space:nowrap">
          <input type="checkbox" data-indic-painel="${esc(dim)}" data-indic-painel-valor="${esc(v)}" ${selecionados.has(v) ? 'checked' : ''}>
          ${esc(v)}
        </label>`).join('')}
      </div>
    </div>`;
  }

  function cardChart(dim, extra) {
    extra = extra || {};
    const def = DIMENSOES[dim];
    const itens = dim === 'mercado' ? agregarPorCampoDaNota('destinatario') : agregarPorDimensao(dim);
    // Rankings (transportadora/motivo/mercado/vendedor/supervisor) em barra
    // horizontal, mês em coluna vertical — igual ao dashboard de
    // referência, que usa as duas formas dependendo do gráfico.
    const html = extra.cronologico
      ? dashRankedBarChart(itens, Object.assign({ limit: 24 }, extra, { dim }))
      : dashHorizontalBarChart(itens, Object.assign({ limit: 15 }, extra, { dim }));
    return `<div class="tc" style="padding:16px"><div class="tc-title">${def.icone} ${esc(def.titulo)}</div>${html}</div>`;
  }

  function desenhar() {
    const pagina = document.getElementById('page-recebimento-retornos-indicadores');
    if (!pagina) return;
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h2 style="margin:0">📊 Indicadores de Retornos</h2><div style="color:var(--muted);font-size:.78rem;margin-top:4px">Mercados, motivos, vendedores e transportadoras com mais notas retornadas. Clique numa barra pra filtrar tudo por ela.</div></div>
        <div style="display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap">
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">PERÍODO — DE</div><input type="date" class="field" id="indic-periodo-ini" value="${esc(_periodoInicio)}" style="padding:7px"></div>
          <div><div style="font-size:.66rem;color:var(--muted);margin-bottom:3px">ATÉ</div><input type="date" class="field" id="indic-periodo-fim" value="${esc(_periodoFim)}" style="padding:7px"></div>
          <button class="btn btn-primary btn-sm" id="indic-buscar-periodo" style="padding:7px 14px">🔍 Buscar</button>
          <div style="font-size:.64rem;color:var(--muted);align-self:center">Máx. 2 anos</div>
          <button class="btn btn-ghost" data-indic-atualizar="1">↻ Atualizar</button>
        </div>
      </div>
      ${!_periodoBuscado ? '<div class="empty" style="margin-top:14px"><div class="empty-icon">🔍</div><div class="empty-title">Escolha o período e clique em Buscar</div><div class="empty-sub">Os indicadores não carregam sozinhos — evita buscar a coleção inteira à toa toda vez que você entra nesta tela.</div></div>' : `
      <div style="display:flex;gap:40px;flex-wrap:wrap;align-items:flex-start;margin:14px 0">
        ${painelFiltroHtml('tratamento', _filtroAcaoSet)}
        ${painelFiltroHtml('status', _filtroStatusSet)}
      </div>
      ${chipFiltroHtml()}
      ${resumoHtml()}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:14px;margin-top:10px">
        ${cardChart('transportadora')}
        ${cardChart('motivo')}
        ${cardChart('mercado')}
        ${cardChart('vendedor')}
        ${cardChart('supervisor')}
        ${cardChart('mes', { cronologico: true, limit: 24 })}
      </div>
      <div class="tc" style="padding:16px;margin-top:14px"><div class="tc-title">📈 Média de dias p/ finalizar por mês</div>${dashRankedBarChart(agregarMediaDiasPorMes(), { cronologico: true, limit: 24 })}</div>`}`;

    // Listener delegado, ligado UMA vez no container (que sobrevive à
    // troca de innerHTML entre re-renders) — clicar numa barra com
    // data-indic-dim aplica/alterna o filtro cruzado; clicar em "limpar"
    // some com ele.
    if (!pagina._indicListenerBound) {
      pagina.addEventListener('click', ev => {
        const limparFiltro = ev.target.closest('[data-indic-limpar-filtro]');
        if (limparFiltro) { _filtro = null; desenhar(); return; }
        const limparPainel = ev.target.closest('[data-indic-painel-limpar]');
        if (limparPainel) {
          const dim = limparPainel.getAttribute('data-indic-painel-limpar');
          (dim === 'tratamento' ? _filtroAcaoSet : _filtroStatusSet).clear();
          desenhar();
          return;
        }
        const alvo = ev.target.closest('[data-indic-dim]');
        if (!alvo) return;
        const dim = alvo.dataset.indicDim, valor = alvo.dataset.indicVal;
        _filtro = (_filtro && _filtro.dim === dim && _filtro.valor === valor) ? null : { dim, valor };
        desenhar();
      });
      // change (não click) pros campos de data de período e pros checkboxes
      // dos painéis de Ação/Status — delegado, ligado uma vez só, igual ao
      // listener de clique acima.
      pagina.addEventListener('change', ev => {
        if (ev.target.id === 'indic-periodo-ini' || ev.target.id === 'indic-periodo-fim') {
          _periodoInicio = document.getElementById('indic-periodo-ini')?.value || '';
          _periodoFim = document.getElementById('indic-periodo-fim')?.value || '';
          if (_periodoInicio && _periodoFim && !_periodoValido(_periodoInicio, _periodoFim)) {
            if (ev.target.id === 'indic-periodo-ini') _periodoFim = new Date(new Date(_periodoInicio + 'T00:00:00').getTime() + DIAS_MAX_PERIODO * 86400000).toISOString().slice(0, 10);
            else _periodoInicio = new Date(new Date(_periodoFim + 'T00:00:00').getTime() - DIAS_MAX_PERIODO * 86400000).toISOString().slice(0, 10);
            global.showToast?.('Período ajustado — máximo de 3 meses.', 'i');
          }
          desenhar();
          return;
        }
        const chk = ev.target.closest('[data-indic-painel]');
        if (chk) {
          const dim = chk.getAttribute('data-indic-painel'), valor = chk.getAttribute('data-indic-painel-valor');
          const conjunto = dim === 'tratamento' ? _filtroAcaoSet : _filtroStatusSet;
          if (chk.checked) conjunto.add(valor); else conjunto.delete(valor);
          desenhar();
        }
      });
      pagina._indicListenerBound = true;
    }
    const btnBuscar = document.getElementById('indic-buscar-periodo');
    if (btnBuscar) btnBuscar.addEventListener('click', async () => {
      if (!_periodoValido(_periodoInicio, _periodoFim)) { global.showToast?.('Escolha um período válido de até 3 meses.', 'error'); return; }
      const original = btnBuscar.innerHTML;
      btnBuscar.disabled = true; btnBuscar.innerHTML = '⏳ Buscando...';
      try { await carregarDadosIndicadores(_periodoInicio, _periodoFim, true); desenhar(); }
      catch (e) { global.showToast?.('Erro ao buscar: ' + (e.message || e), 'error'); }
      finally { btnBuscar.disabled = false; btnBuscar.innerHTML = original; }
    });
    document.querySelector('[data-indic-atualizar]')?.addEventListener('click', async () => {
      if (!_periodoBuscado) return;
      const [ini, fim] = _periodoBuscado.split('|');
      await carregarDadosIndicadores(ini, fim, true); desenhar();
    });
  }

  async function renderRecebimentoRetornosIndicadores() {
    const pagina = document.getElementById('page-recebimento-retornos-indicadores');
    if (!pagina) return;
    if (!_periodoInicio || !_periodoFim) {
      const p = _periodoPadrao();
      _periodoInicio = _periodoInicio || p.ini;
      _periodoFim = _periodoFim || p.fim;
    }
    // PEDIDO AO VIVO (2026-09-11): ver mesmo bloco em 99-recebimento-
    // retornos-status.js — refaz a busca sozinha, uma vez, se algo mudou
    // numa tela irmã desde a última vez que esta já tinha carregado dados.
    if (global.DT_RETORNOS_DIRTY && global.DT_RETORNOS_DIRTY.indicadores && _periodoBuscado) {
      global.DT_RETORNOS_DIRTY.indicadores = false;
      const [ini, fim] = _periodoBuscado.split('|');
      await carregarDadosIndicadores(ini, fim, true);
      desenhar();
      return;
    }
    desenhar();
  }

  global.renderRecebimentoRetornosIndicadores = renderRecebimentoRetornosIndicadores;
  global.dashRankedBarChart = dashRankedBarChart;
  global.dashHorizontalBarChart = dashHorizontalBarChart;
  global._recebimentoRetornosIndicadoresInternals = {
    agregarPorCampoDaNota, agregarPorDimensao, dashRankedBarChart, dashHorizontalBarChart, kpis, diasParaFinalizarDaRecusa,
    agregarMediaDiasPorMes, mesAnoDe, DIMENSOES, opcoesDoPainel,
    setFiltro(f) { _filtro = f; }, getFiltro() { return _filtro; },
    setPeriodo(ini, fim) { _periodoInicio = ini || ''; _periodoFim = fim || ''; }, getPeriodo() { return { ini: _periodoInicio, fim: _periodoFim }; },
    setFiltroAcao(arr) { _filtroAcaoSet = new Set(arr || []); }, getFiltroAcao() { return [..._filtroAcaoSet]; },
    setFiltroStatus(arr) { _filtroStatusSet = new Set(arr || []); }, getFiltroStatus() { return [..._filtroStatusSet]; },
  };
})(window);
