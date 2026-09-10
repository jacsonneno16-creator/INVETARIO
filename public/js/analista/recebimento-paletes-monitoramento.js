// Recebimento > Paletes > Monitoramento
// Comparação do que saiu vs. o que voltou de paletes emprestados a mercados
// externos na entrega (motorista + viagem + quantidade). Coleção PRÓPRIA
// `recebimento_paletes` (por loja) — de propósito NÃO reaproveita
// `recebimentos`/tipo:'TRANSBORDO' (aquela regra do Firestore já documenta
// estouros reais do limite de 1000 sub-expressões em produção depois de
// várias otimizações delicadas). Sem cross-loja NO SENTIDO DE ORIGEM (uma
// viagem não "pertence" a duas lojas, só à que despachou) — mas a TELA
// precisa juntar TODAS as lojas mesmo assim.
// BUG AO VIVO REAL (2026-09-04): "dei saída em um palete, na parte do
// analista não pareceu" — investigado ao vivo: o registro FOI salvo (a
// loja do Coletor batia com a "loja ativa" do Analista na hora), mas o
// usuário disse "lá não vai funcionar por loja, vai mostrar tudo em uma
// loja só" — ou seja, o pedido real é que esta tela NUNCA dependa de qual
// loja está ativa no navegador do Analista (a tela não tinha indicação
// nenhuma de loja, igual "Pedidos x Estoque" já faz consolidado).
// PEDIDO AO VIVO (2026-09-04, mesma conversa): "controle de paletes" no
// Coletor virou 2 sub-telas — "Saída de Paletes" (a de sempre) e "Paletes
// em Estoque" (NOVA: contagem diária manual por loja, recebimento_
// paletes_estoque, 1 doc por dia). Esta tela ganha uma 2ª seção mostrando
// o último registro de cada loja — mesmo padrão multi-loja acima.
// Antes, `fs().collection(COL_PALETES)` (proxy loja-scoped, ver
// firebase-shared.js) só lia a subcoleção da loja ativa — qualquer viagem
// de outra loja ficava invisível sem aviso nenhum. Agora lê a subcoleção
// de TODAS as lojas ativas (mesmo padrão de carregar() em
// 78-pcp-central.js: raw().collection('lojas').get() + loop, com
// .catch(()=>vazio) por loja pra uma loja sem permissão/erro não derrubar
// as outras).
(function (global) {
  'use strict';

  const COL_PALETES = 'recebimento_paletes';
  const COL_PALETES_ESTOQUE = 'recebimento_paletes_estoque';
  const COL_PALETES_LEDGER = 'recebimento_paletes_ledger';
  const COL_PALETES_MOVIMENTOS = 'recebimento_paletes_movimentos';
  // PEDIDO AO VIVO (2026-09-08): "Em Trânsito" do ledger hoje mistura TUDO
  // (Montagem/Expedição de Carga de transbordo + Saída Externa/Retorno de
  // entrega + Transferência entre lojas + Ajuste manual — ver
  // 28-recebimento-paletes-ledger.js). Pedido: separar visualmente quanto
  // desse total é CARGA DE TRANSBORDO do quanto é entrega de motorista (+
  // o resto). Em vez de mexer no ledger (campo único, já usado por
  // increment() em vários lugares — mexer lá arrisca inconsistência), lê o
  // LOG de movimentos (recebimento_paletes_movimentos, já grava `tipo` por
  // movimento) e soma só os de transbordo — "Em Trânsito" (a coluna que já
  // existia) vira o RESTANTE (ledger.emTransito - transbordo), garantindo
  // que as duas colunas sempre somem o mesmo total de antes, sem duplicar
  // nem divergir da fonte de verdade.
  const TIPOS_TRANSBORDO = new Set(['TRANSBORDO_EXPEDICAO', 'TRANSBORDO_RECEBIMENTO']);

  let _itens = [];
  let _estoquePorLoja = []; // [{lojaId, lojaNome, quantidade, data, registradoEm}] — último registro de cada loja
  let _estoqueHistorico = []; // [{lojaId, lojaNome, quantidade, data, registradoEm}] — TODOS os registros diários, mais recente primeiro
  let _ledgerPorLoja = []; // [{lojaId, lojaNome, disponivel, emTransito, total}] — saldo calculado (fonte de verdade), Montagem/Expedição de Carga + Transferência de Paletes + Saída Externa
  let _filtroMotorista = '';
  let _filtroMercado = '';
  let _filtroStatus = ''; // '' | 'EM_TRANSITO' | 'FINALIZADO' | 'PENDENTE'
  let _filtroLoja = ''; // '' = todas as lojas
  let _periodoInicio = '';
  let _periodoFim = '';
  let _lojas = []; // [{id,nome}] — pra montar o filtro de loja
  let _abaAtiva = 'transito'; // 'transito' | 'estoque' — PEDIDO AO VIVO (2026-09-04): "colocar uma opção do lado tipo uma em trânsito e outra 'estoque'"

  function raw() { return global.getDTRawFirestore(); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s])); }
  function fmtData(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  }
  function dataLocalChave(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleDateString('en-CA') : '';
  }
  function saldoDe(p) { return Number(p.paletesSaida || 0) - (p.paletesRetorno != null ? Number(p.paletesRetorno) : 0); }
  function rotuloStatus(p) {
    if (p.status === 'EM_TRANSITO') return 'Em trânsito';
    if (saldoDe(p) > 0) return 'Retornado (parcial)';
    return 'Finalizado';
  }
  function classeStatus(p) {
    if (p.status === 'EM_TRANSITO') return 'b-yellow';
    if (saldoDe(p) > 0) return 'b-red';
    return 'b-green';
  }

  async function carregarPaletesMonitoramento(forcar) {
    if (_itens.length && !forcar) return;
    const vazio = { docs: [] };
    const vazioDoc = { exists: false };
    const lojasSnap = await raw().collection('lojas').get().catch(() => vazio);
    _lojas = lojasSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.ativa !== false);
    const [porLoja, porLojaEstoque, porLojaLedger, porLojaMovimentos] = await Promise.all([
      Promise.all(_lojas.map(loja => raw().collection('lojas').doc(loja.id).collection(COL_PALETES).get().catch(() => vazio))),
      Promise.all(_lojas.map(loja => raw().collection('lojas').doc(loja.id).collection(COL_PALETES_ESTOQUE).get().catch(() => vazio))),
      Promise.all(_lojas.map(loja => raw().collection('lojas').doc(loja.id).collection(COL_PALETES_LEDGER).doc('atual').get().catch(() => vazioDoc))),
      Promise.all(_lojas.map(loja => raw().collection('lojas').doc(loja.id).collection(COL_PALETES_MOVIMENTOS).where('tipo', 'in', [...TIPOS_TRANSBORDO]).get().catch(() => vazio))),
    ]);
    // Soma só os movimentos de TRANSBORDO (ver TIPOS_TRANSBORDO acima) —
    // o resto (entrega externa/transferência/ajuste) fica implícito como
    // "ledger.emTransito - transbordo" na hora de desenhar a tabela.
    const emTransitoTransbordoPorLoja = porLojaMovimentos.map(snap =>
      snap.docs.reduce((soma, d) => {
        const m = d.data() || {};
        return TIPOS_TRANSBORDO.has(m.tipo) ? soma + (Number.isFinite(m.emTransitoDelta) ? m.emTransitoDelta : 0) : soma;
      }, 0)
    );
    // Ledger (Disponível/Em Trânsito/Total) — fonte de verdade calculada a
    // partir de TODA movimentação (Montagem/Expedição de Carga,
    // Transferência de Paletes, Saída Externa), ver
    // 28-recebimento-paletes-ledger.js. Só leitura aqui — a contagem manual
    // (COL_PALETES_ESTOQUE) continua existindo só como CONFERÊNCIA, nunca
    // ajusta o ledger sozinha.
    _ledgerPorLoja = _lojas.map((loja, i) => {
      const doc = porLojaLedger[i];
      const dados = doc && doc.exists ? doc.data() || {} : {};
      return {
        lojaId: loja.id,
        lojaNome: loja.nome || loja.codigo || loja.id,
        disponivel: Number.isFinite(dados.disponivel) ? dados.disponivel : 0,
        emTransito: Number.isFinite(dados.emTransito) ? dados.emTransito : 0,
        emTransitoTransbordo: emTransitoTransbordoPorLoja[i] || 0,
        total: Number.isFinite(dados.total) ? dados.total : 0,
      };
    });
    _itens = [];
    porLoja.forEach((snap, i) => {
      const loja = _lojas[i];
      snap.docs.forEach(d => _itens.push({ _id: d.id, lojaId: loja.id, ...d.data() }));
    });
    // "Paletes em Estoque" é 1 doc por DIA (id = AAAA-MM-DD). O resumo por
    // loja mostra só o registro mais recente; PEDIDO AO VIVO (2026-09-04)
    // "tem que ter um histórico de paletes por dia" — guarda TODOS os
    // registros também, pra tela mostrar a série completa dia a dia (a
    // ordenação por id de string já funciona porque AAAA-MM-DD é
    // lexicograficamente crescente).
    _estoqueHistorico = [];
    _estoquePorLoja = _lojas.map((loja, i) => {
      const lojaNome = loja.nome || loja.codigo || loja.id;
      const docs = porLojaEstoque[i].docs.slice().sort((a, b) => String(b.id).localeCompare(String(a.id)));
      docs.forEach(d => _estoqueHistorico.push({ lojaId: loja.id, lojaNome, ...d.data() }));
      const ultimo = docs[0] ? docs[0].data() : null;
      return { lojaId: loja.id, lojaNome, quantidade: ultimo ? ultimo.quantidade : null, data: ultimo ? ultimo.data : null, registradoEm: ultimo ? ultimo.registradoEm : null };
    });
    _estoqueHistorico.sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  }

  function _passaPeriodo(p) {
    if (!_periodoInicio && !_periodoFim) return true;
    const dia = dataLocalChave(p.horaSaida);
    if (!dia) return false;
    if (_periodoInicio && dia < _periodoInicio) return false;
    if (_periodoFim && dia > _periodoFim) return false;
    return true;
  }
  function _passaStatus(p) {
    if (!_filtroStatus) return true;
    if (_filtroStatus === 'PENDENTE') return saldoDe(p) > 0;
    return p.status === _filtroStatus;
  }
  function _filtrados() {
    const motorista = _filtroMotorista.trim().toLowerCase();
    const mercado = _filtroMercado.trim().toLowerCase();
    return _itens.filter(p => {
      if (_filtroLoja && p.lojaId !== _filtroLoja) return false;
      if (motorista && !String(p.motoristaNome || '').toLowerCase().includes(motorista)) return false;
      if (mercado && !String(p.mercado || '').toLowerCase().includes(mercado)) return false;
      if (!_passaStatus(p)) return false;
      if (!_passaPeriodo(p)) return false;
      return true;
    }).sort((a, b) => String(b.horaSaida || '').localeCompare(String(a.horaSaida || '')));
  }

  function _kpis(itens) {
    const emTransito = itens.filter(p => p.status === 'EM_TRANSITO');
    const comSaldoPendente = itens.filter(p => saldoDe(p) > 0);
    const paletesRetornados = itens.reduce((s, p) => s + (p.paletesRetorno != null ? Number(p.paletesRetorno) : 0), 0);
    const paletesEmAberto = comSaldoPendente.reduce((s, p) => s + saldoDe(p), 0);
    return {
      total: itens.length,
      emTransito: emTransito.length,
      comSaldoPendente: comSaldoPendente.length,
      paletesRetornados,
      paletesEmAberto
    };
  }

  // PEDIDO AO VIVO (2026-09-06): "às vezes o motorista sai com o pallet mas
  // o pallet fica no mercado e o mercado não devolve... como colocar isso
  // no nome do mercado e não do motorista?" — o saldo pendente já existe
  // por VIAGEM (motorista+mercado juntos na mesma linha), mas se o MESMO
  // mercado recebeu entregas de motoristas diferentes, o quanto ele deve
  // no total ficava espalhado em várias linhas, cada uma "no nome" de um
  // motorista diferente. Agrupa por mercado (ignorando quem foi o
  // motorista de cada entrega) — dívida é do mercado, não de quem dirigiu.
  function _saldoPorMercado(itens) {
    const mapa = new Map();
    itens.filter(p => saldoDe(p) > 0).forEach(p => {
      const mercado = p.mercado || 'Sem mercado informado';
      const atual = mapa.get(mercado) || { mercado, saldoPendente: 0, viagens: 0 };
      atual.saldoPendente += saldoDe(p);
      atual.viagens += 1;
      mapa.set(mercado, atual);
    });
    return [...mapa.values()].sort((a, b) => b.saldoPendente - a.saldoPendente);
  }

  // PEDIDO AO VIVO (2026-09-06): "no palete monitoramento, quero que tenha
  // a opção de excluir" — viagem errada/duplicada. Esta tabela ALIMENTA o
  // ledger (Disponível/Em Trânsito) — excluir sem desfazer o efeito dela
  // deixaria o saldo errado pra sempre. saldoDe(p) já é exatamente o que
  // esta viagem ainda tem "em trânsito" (paletesSaida - paletesRetorno);
  // desfazer é devolver isso pro disponível e tirar do em trânsito — o
  // oposto do que _aplicarMovimentoLedger fez quando a viagem foi criada.
  function _tabelaHtml(itens) {
    const linhas = itens.map(p => `<tr>
      <td>${esc(p.motoristaNome || '—')}</td>
      <td>${esc(p.mercado || '—')}</td>
      <td class="mono">${esc(p.numeroViagem || '—')}</td>
      <td class="mono">${esc(p.paletesSaida || 0)} <span style="color:var(--muted);font-size:.68rem">· ${fmtData(p.horaSaida)}</span></td>
      <td class="mono">${p.paletesRetorno != null ? esc(p.paletesRetorno) + ' <span style="color:var(--muted);font-size:.68rem">· ' + fmtData(p.horaRetorno) + '</span>' : '<span style="color:var(--muted)">—</span>'}</td>
      <td class="mono" style="font-weight:700;color:${saldoDe(p) > 0 ? 'var(--danger,#ef4444)' : 'var(--muted)'}">${saldoDe(p)}</td>
      <td><span class="badge ${classeStatus(p)}">${esc(rotuloStatus(p))}</span></td>
      <td>${esc(p.origem || '—')}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-paletes-excluir="${esc(p._id)}" data-paletes-excluir-loja="${esc(p.lojaId)}" title="Excluir esta viagem">🗑</button></td>
    </tr>`).join('');
    return `<div class="tc"><div style="overflow:auto"><table class="dt-table">
      <thead><tr><th>Motorista</th><th>Mercado</th><th>Viagem</th><th>Saída</th><th>Retorno</th><th>Saldo pendente</th><th>Status</th><th>Loja</th><th></th></tr></thead>
      <tbody>${linhas || '<tr><td colspan="9"><div class="empty"><div class="empty-icon">🎯</div><div class="empty-title">Nenhuma viagem de paletes encontrada</div><div class="empty-sub">Registre uma saída pelo Coletor pra começar.</div></div></td></tr>'}</tbody>
    </table></div></div>`;
  }

  async function _excluirViagemPaletes(id, lojaId) {
    const viagem = _itens.find(p => p._id === id && p.lojaId === lojaId);
    if (!viagem) return;
    const msg = 'Excluir esta viagem de paletes (' + (viagem.motoristaNome || 'sem motorista') + ' · ' + (viagem.mercado || 'sem mercado') + ')?'
      + (saldoDe(viagem) > 0 ? '\n\nEla ainda tem ' + saldoDe(viagem) + ' palete(s) marcado(s) como "em trânsito" — excluir vai devolver essa quantidade pro saldo Disponível.' : '');
    if (!confirm(msg)) return;
    try {
      await raw().collection('lojas').doc(lojaId).collection(COL_PALETES).doc(id).delete();
      const saldoPendente = saldoDe(viagem);
      if (saldoPendente !== 0 && typeof global._aplicarMovimentoLedger === 'function') {
        await global._aplicarMovimentoLedger(lojaId, 'SAIDA_EXTERNA_EXCLUIDA', { disponivelDelta: saldoPendente, emTransitoDelta: -saldoPendente }, { colecao: COL_PALETES, id: id });
      }
      _itens = _itens.filter(p => !(p._id === id && p.lojaId === lojaId));
      await carregarPaletesMonitoramento(true);
      _desenharPaletes();
      if (global.showToast) global.showToast('Viagem excluída.', 'success');
    } catch (e) {
      if (global.showToast) global.showToast('Erro ao excluir: ' + (e.message || e), 'error'); else alert('Erro ao excluir: ' + (e.message || e));
    }
  }

  // PEDIDO AO VIVO (2026-09-04): "paletes em estoque é onde a pessoa vai
  // colocar todo dia a quantidade... na parte do analista vai especifica
  // de qual loja é esse saldo" — 1 linha por loja, com o nome bem visível.
  function _estoqueFiltrado() {
    return _filtroLoja ? _estoquePorLoja.filter(e => e.lojaId === _filtroLoja) : _estoquePorLoja;
  }
  // Ledger é a fonte de verdade (calculada); a contagem manual é só
  // conferência — a "Diferença" NUNCA ajusta nada sozinha, só mostra pro
  // Analista decidir se precisa investigar/recontar.
  function _ledgerDe(lojaId) {
    return _ledgerPorLoja.find(l => l.lojaId === lojaId) || null;
  }
  // PEDIDO AO VIVO (2026-09-06): "como é que eu faço um primeiro
  // inventário de palete... vou colocar a quantidade total, como é que eu
  // faço?" — não existia NENHUM jeito de fazer o "Disponível (sistema)"
  // virar um número digitado; ele só mudava sozinho por movimentação
  // (saída/retorno/carga/transferência). Este botão pega a Contagem manual
  // já registrada e ajusta o ledger pra bater com ela — serve tanto pro
  // inventário inicial (loja que nunca teve nenhuma movimentação, ledger
  // "zerado" por padrão) quanto pra corrigir depois. Grava como movimento
  // 'AJUSTE_MANUAL' (auditável em recebimento_paletes_movimentos, igual
  // qualquer outro tipo de movimento do ledger) — nunca sobrescreve
  // silenciosamente, e só mexe em Disponível (uma contagem física não sabe
  // quanto está em trânsito, então Em Trânsito não é tocado aqui).
  // PEDIDO AO VIVO (2026-09-08): "excluir as cargas e as saídas de paletes
  // mas ainda continuou em trânsito" — a exclusão de carga/saída AGORA já
  // devolve o saldo certo pro ledger (ver 104-recebimento-cargas-cards.js e
  // 25-recebimento-paletes.js), mas isso só vale pra exclusões NOVAS —
  // sobras de ANTES dessa correção (ou qualquer outra divergência) ficam
  // presas em "Em Trânsito" pra sempre, sem nenhum jeito de corrigir na
  // tela. "Aplicar contagem como saldo" só mexe no Disponível — nunca
  // toca Em Trânsito. Este botão zera especificamente essa coluna, pra
  // quando o Analista sabe que não tem nenhum palete de verdade em
  // trânsito daquela loja no momento.
  async function _zerarEmTransito(lojaId) {
    const ledger = _ledgerDe(lojaId);
    if (!ledger || !ledger.emTransito) { if (global.showToast) global.showToast('Já está zerado — nada pra ajustar.', 'info'); return; }
    const loja = _lojas.find(l => l.id === lojaId);
    const emTransitoAtual = ledger.emTransito;
    const msg = 'Zerar o "Em Trânsito" de ' + (loja ? (loja.nome || loja.id) : lojaId) + ' (hoje em ' + emTransitoAtual + ')?\n\nUse só quando tiver certeza de que não tem nenhum palete de verdade em trânsito dessa loja — por exemplo, depois de excluir cargas/saídas de teste.';
    if (!confirm(msg)) return;
    try {
      await global._aplicarMovimentoLedger(lojaId, 'AJUSTE_MANUAL', { emTransitoDelta: -emTransitoAtual }, { colecao: COL_PALETES_LEDGER, id: 'atual' });
      ledger.emTransito = 0;
      ledger.total = ledger.disponivel + ledger.emTransito;
      _desenharPaletes();
      if (global.showToast) global.showToast('Em Trânsito zerado.', 'success');
    } catch (e) {
      if (global.showToast) global.showToast('Erro ao ajustar: ' + (e.message || e), 'error'); else alert('Erro ao ajustar: ' + (e.message || e));
    }
  }

  async function _ajustarSaldoComoContagem(lojaId) {
    const estoque = _estoquePorLoja.find(e => e.lojaId === lojaId);
    if (!estoque || estoque.quantidade == null) return;
    const ledger = _ledgerDe(lojaId) || { disponivel: 0, emTransito: 0, total: 0 };
    const alvo = Number(estoque.quantidade);
    const delta = alvo - ledger.disponivel;
    if (delta === 0) { if (global.showToast) global.showToast('Já está batendo — nada pra ajustar.', 'info'); return; }
    const msg = 'Ajustar o Disponível (sistema) de ' + estoque.lojaNome + ' de ' + ledger.disponivel + ' para ' + alvo + ' (a contagem manual registrada)?';
    if (!confirm(msg)) return;
    try {
      await global._aplicarMovimentoLedger(lojaId, 'AJUSTE_MANUAL', { disponivelDelta: delta }, { colecao: COL_PALETES_ESTOQUE, id: estoque.data || '' });
      ledger.disponivel = alvo;
      ledger.total = ledger.disponivel + ledger.emTransito;
      if (!_ledgerPorLoja.some(l => l.lojaId === lojaId)) _ledgerPorLoja.push(Object.assign({ lojaId, lojaNome: estoque.lojaNome }, ledger));
      _desenharPaletes();
      if (global.showToast) global.showToast('Saldo ajustado.', 'success');
    } catch (e) {
      if (global.showToast) global.showToast('Erro ao ajustar: ' + (e.message || e), 'error'); else alert('Erro ao ajustar: ' + (e.message || e));
    }
  }

  function _estoqueTabelaHtml() {
    const linhas = _estoqueFiltrado().map(e => {
      const ledger = _ledgerDe(e.lojaId);
      const disponivel = ledger ? ledger.disponivel : null;
      const emTransitoTotal = ledger ? ledger.emTransito : null;
      const emTransitoTransbordo = ledger ? (ledger.emTransitoTransbordo || 0) : null;
      // PEDIDO AO VIVO (2026-09-08): "Em Trânsito" (a coluna que já existia)
      // passa a mostrar só entrega de motorista/transferência/ajuste — o
      // que sobra do total depois de tirar o que é carga de transbordo.
      // Math.max(0,...) protege contra "Zerar Em Trânsito" (zera só o
      // TOTAL do ledger, não o log de movimentos de transbordo) deixar
      // esse resto artificialmente negativo — nunca mostra número
      // negativo, mesmo que as duas colunas deixem de somar exatamente o
      // total nesse cenário específico (uso do botão de correção manual).
      const emTransitoEntrega = emTransitoTotal != null ? Math.max(0, emTransitoTotal - (emTransitoTransbordo || 0)) : null;
      const diferenca = (ledger && e.quantidade != null) ? (disponivel - Number(e.quantidade)) : null;
      const corDiferenca = diferenca == null ? 'var(--muted)' : (diferenca === 0 ? 'var(--muted)' : 'var(--danger,#ef4444)');
      const botaoAjustar = e.quantidade != null ? `<button type="button" class="btn btn-ghost btn-sm" data-paletes-ajustar-saldo="${esc(e.lojaId)}" title="Faz o Disponível (sistema) virar este número">✓ Aplicar contagem como saldo</button>` : '';
      const botaoZerarTransito = emTransitoTotal ? `<button type="button" class="btn btn-ghost btn-sm" data-paletes-zerar-transito="${esc(e.lojaId)}" title="Zera o Em Trânsito — use quando souber que não tem palete de verdade em trânsito">↺ Zerar Em Trânsito</button>` : '';
      return `<tr>
      <td><b>${esc(e.lojaNome)}</b></td>
      <td class="mono" style="font-weight:700">${e.quantidade != null ? esc(e.quantidade) : '<span style="color:var(--muted)">—</span>'}</td>
      <td style="color:var(--muted);font-size:.78rem">${e.data ? esc(String(e.data).split('-').reverse().join('/')) : 'Nunca registrado'}</td>
      <td class="mono" style="font-weight:700">${disponivel != null ? esc(disponivel) : '<span style="color:var(--muted)">—</span>'}</td>
      <td class="mono">${emTransitoTransbordo != null ? esc(emTransitoTransbordo) : '<span style="color:var(--muted)">—</span>'}</td>
      <td class="mono">${emTransitoEntrega != null ? esc(emTransitoEntrega) : '<span style="color:var(--muted)">—</span>'}</td>
      <td class="mono" style="font-weight:700;color:${corDiferenca}">${diferenca != null ? esc(diferenca > 0 ? '+' + diferenca : diferenca) : '<span style="color:var(--muted)">—</span>'}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">${botaoAjustar}${botaoZerarTransito}</td>
    </tr>`;
    }).join('');
    return `<div class="tc"><div style="padding:10px 12px;border-bottom:1px solid var(--border,#e5e7eb);font-weight:700;font-size:.85rem">📦 Paletes em Estoque — último registro de cada loja</div><div style="overflow:auto"><table class="dt-table">
      <thead><tr><th>Loja</th><th>Contagem manual</th><th>Registrado em</th><th>Disponível (sistema)</th><th>Em Trânsito/Transbordo</th><th>Em Trânsito</th><th>Diferença</th><th></th></tr></thead>
      <tbody>${linhas || '<tr><td colspan="8">Nenhuma loja com estoque registrado ainda.</td></tr>'}</tbody>
    </table></div></div>`;
  }
  // PEDIDO AO VIVO (2026-09-04): "tem que ter um histórico de paletes por
  // dia" — série completa (não só o último registro), filtrável por loja
  // igual o resto da tela.
  function _estoqueHistoricoFiltrado() {
    return _filtroLoja ? _estoqueHistorico.filter(e => e.lojaId === _filtroLoja) : _estoqueHistorico;
  }
  function _estoqueHistoricoHtml() {
    const linhas = _estoqueHistoricoFiltrado().map(e => `<tr>
      <td>${e.data ? esc(String(e.data).split('-').reverse().join('/')) : '—'}</td>
      <td><b>${esc(e.lojaNome)}</b></td>
      <td class="mono" style="font-weight:700">${e.quantidade != null ? esc(e.quantidade) : '—'}</td>
      <td style="color:var(--muted);font-size:.72rem">${esc(e.registradoPor || '—')}</td>
    </tr>`).join('');
    return `<div class="tc" style="margin-top:14px"><div style="padding:10px 12px;border-bottom:1px solid var(--border,#e5e7eb);font-weight:700;font-size:.85rem">📅 Histórico diário</div><div style="overflow:auto;max-height:420px"><table class="dt-table">
      <thead><tr><th>Data</th><th>Loja</th><th>Quantidade</th><th>Registrado por</th></tr></thead>
      <tbody>${linhas || '<tr><td colspan="4">Nenhum registro de estoque ainda.</td></tr>'}</tbody>
    </table></div></div>`;
  }

  function _saldoPorMercadoHtml(itens) {
    const linhas = _saldoPorMercado(itens).map(m => `<tr>
      <td><b>${esc(m.mercado)}</b></td>
      <td class="mono" style="font-weight:700;color:var(--danger,#ef4444)">${esc(m.saldoPendente)}</td>
      <td style="color:var(--muted);font-size:.78rem">${esc(m.viagens)} viagem(ns)</td>
    </tr>`).join('');
    if (!linhas) return '';
    return `<div class="tc" style="margin-bottom:14px"><div style="padding:10px 12px;border-bottom:1px solid var(--border,#e5e7eb);font-weight:700;font-size:.85rem">🏪 Saldo pendente por mercado (não devolvido, somando todos os motoristas)</div><div style="overflow:auto"><table class="dt-table">
      <thead><tr><th>Mercado</th><th>Paletes pendentes</th><th>Viagens em aberto</th></tr></thead>
      <tbody>${linhas}</tbody>
    </table></div></div>`;
  }

  async function renderRecebimentoPaletes() {
    const pagina = document.getElementById('page-recebimento-paletes');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try { await carregarPaletesMonitoramento(); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharPaletes();
  }

  // PEDIDO AO VIVO (2026-09-04): "na tela do analista colocar uma opção do
  // lado tipo uma em trânsito e outra 'estoque'" — antes era tudo numa
  // página só, empilhado; virou 2 abas de verdade, cada uma com seus
  // próprios filtros (o de loja é compartilhado, o resto (motorista/
  // mercado/status/período) só faz sentido em "Em Trânsito").
  function _desenharPaletes() {
    const pagina = document.getElementById('page-recebimento-paletes');
    if (!pagina) return;
    const abaTransito = _abaAtiva !== 'estoque';
    const itens = _filtrados();
    const k = _kpis(itens);
    const seletorLoja = `<select class="field" id="paletes-f-loja">
        <option value="">Todas as lojas</option>
        ${_lojas.map(l => `<option value="${esc(l.id)}" ${_filtroLoja === l.id ? 'selected' : ''}>${esc(l.nome || l.codigo || l.id)}</option>`).join('')}
      </select>`;
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">🎯 Controle de Paletes</div><div style="font-size:.74rem;color:var(--muted)">Todas as lojas consolidadas</div></div>
        <button type="button" class="btn btn-ghost btn-sm" data-paletes-atualizar="1">↻ Atualizar</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <button type="button" class="btn ${abaTransito ? 'btn-primary' : 'btn-ghost'} btn-sm" data-paletes-aba="transito">🚚 Em Trânsito</button>
        <button type="button" class="btn ${!abaTransito ? 'btn-primary' : 'btn-ghost'} btn-sm" data-paletes-aba="estoque">📦 Estoque</button>
      </div>
      ${abaTransito ? `
      <div class="kpi-grid" style="margin-bottom:14px">
        <div class="kpi blue"><div class="kpi-val">${k.total.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Viagens (no filtro)</div></div>
        <div class="kpi yellow"><div class="kpi-val">${k.emTransito.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Em trânsito</div></div>
        <div class="kpi red"><div class="kpi-val">${k.comSaldoPendente.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Com saldo pendente</div></div>
        <div class="kpi orange"><div class="kpi-val">${k.paletesEmAberto.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Paletes ainda não devolvidos</div></div>
        <div class="kpi green"><div class="kpi-val">${k.paletesRetornados.toLocaleString('pt-BR')}</div><div class="kpi-lbl">Paletes retornados (no filtro)</div></div>
      </div>
      ${_saldoPorMercadoHtml(itens)}
      <div class="tc" style="padding:12px;margin-bottom:14px">
        <div class="fg" style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px">
          ${seletorLoja}
          <input class="field" id="paletes-f-motorista" placeholder="🔎 Motorista" value="${esc(_filtroMotorista)}">
          <input class="field" id="paletes-f-mercado" placeholder="🔎 Mercado" value="${esc(_filtroMercado)}">
          <select class="field" id="paletes-f-status">
            <option value="">Todos os status</option>
            <option value="EM_TRANSITO" ${_filtroStatus === 'EM_TRANSITO' ? 'selected' : ''}>Em trânsito</option>
            <option value="PENDENTE" ${_filtroStatus === 'PENDENTE' ? 'selected' : ''}>Com saldo pendente</option>
            <option value="FINALIZADO" ${_filtroStatus === 'FINALIZADO' ? 'selected' : ''}>Finalizado</option>
          </select>
          <input type="date" class="field" id="paletes-f-inicio" value="${esc(_periodoInicio)}" title="Período — de">
          <input type="date" class="field" id="paletes-f-fim" value="${esc(_periodoFim)}" title="Período — até">
        </div>
      </div>
      ${_tabelaHtml(itens)}
      ` : `
      <div class="tc" style="padding:12px;margin-bottom:14px">
        <div class="fg" style="display:grid;grid-template-columns:minmax(220px,320px);gap:8px">${seletorLoja}</div>
      </div>
      ${_estoqueTabelaHtml()}
      ${_estoqueHistoricoHtml()}
      `}
    `;
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-paletes-atualizar]')) {
      Promise.resolve(carregarPaletesMonitoramento(true)).then(_desenharPaletes).catch(e => global.showToast && global.showToast('Falha ao atualizar: ' + (e.message || e), 'error'));
      return;
    }
    const excluir = event.target.closest('[data-paletes-excluir]');
    if (excluir) { _excluirViagemPaletes(excluir.getAttribute('data-paletes-excluir'), excluir.getAttribute('data-paletes-excluir-loja')); return; }
    const ajustar = event.target.closest('[data-paletes-ajustar-saldo]');
    if (ajustar) { _ajustarSaldoComoContagem(ajustar.getAttribute('data-paletes-ajustar-saldo')); return; }
    const zerarTransito = event.target.closest('[data-paletes-zerar-transito]');
    if (zerarTransito) { _zerarEmTransito(zerarTransito.getAttribute('data-paletes-zerar-transito')); return; }
    const aba = event.target.closest('[data-paletes-aba]');
    if (aba) { _abaAtiva = aba.getAttribute('data-paletes-aba') || 'transito'; _desenharPaletes(); }
  });
  document.addEventListener('input', function (event) {
    if (event.target.id === 'paletes-f-motorista') { _filtroMotorista = event.target.value || ''; _desenharPaletes(); }
    if (event.target.id === 'paletes-f-mercado') { _filtroMercado = event.target.value || ''; _desenharPaletes(); }
  });
  document.addEventListener('change', function (event) {
    if (event.target.id === 'paletes-f-loja') { _filtroLoja = event.target.value || ''; _desenharPaletes(); }
    if (event.target.id === 'paletes-f-status') { _filtroStatus = event.target.value || ''; _desenharPaletes(); }
    if (event.target.id === 'paletes-f-inicio') { _periodoInicio = event.target.value || ''; _desenharPaletes(); }
    if (event.target.id === 'paletes-f-fim') { _periodoFim = event.target.value || ''; _desenharPaletes(); }
  });

  global.renderRecebimentoPaletes = renderRecebimentoPaletes;
  global._recebimentoPaletesMonitoramentoInternals = {
    carregarPaletesMonitoramento,
    getItens: () => _itens,
    getLojas: () => _lojas,
    getEstoquePorLoja: () => _estoquePorLoja,
    getEstoqueHistorico: () => _estoqueHistorico,
    getLedgerPorLoja: () => _ledgerPorLoja,
    setFiltroLoja: v => { _filtroLoja = v || ''; },
    setAba: v => { _abaAtiva = v || 'transito'; },
    kpis: _kpis,
    saldoDe,
    excluirViagemPaletes: _excluirViagemPaletes,
    ajustarSaldoComoContagem: _ajustarSaldoComoContagem,
    zerarEmTransito: _zerarEmTransito,
    saldoPorMercado: _saldoPorMercado
  };
})(window);
