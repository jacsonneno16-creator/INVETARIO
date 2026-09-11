// Recebimento > Cargas (Montagem/Expedição)
// Visão do Analista pras cargas montadas/expedidas pelo Coletor
// (26-recebimento-cargas.js): consolida TODAS as lojas (mesmo padrão de
// recebimento-paletes-monitoramento.js — raw().collection('lojas').get() +
// loop, .catch(()=>vazio) por loja pra uma loja com erro/sem permissão não
// derrubar as outras). Card mostra nome/status/origem→destino/motorista/
// notas/volumes/paletes; abrir um card busca a subcoleção `itens` sob
// demanda (só quando o Analista realmente quer ver o detalhe — cargas
// grandes podem ter muitos itens, não faz sentido buscar antecipado pra
// TODA carga só pra montar a lista) e mostra resumo por produto (soma por
// codigoProduto) + tabela Capa | Produto | Nome | Quantidade.
(function (global) {
  'use strict';

  const COL_CARGAS = 'recebimento_transbordo_cargas';

  let _cargas = [];
  let _lojas = [];
  let _filtroLoja = '';
  let _filtroStatus = '';
  let _filtroBusca = '';
  let _cargaExpandidaId = null; // _id da carga com o detalhe aberto
  const _itensPorCarga = {}; // cache: cargaId -> [{_id,capa,codigoProduto,nomeProduto,quantidade}]
  let _cargasCarregando = false;
  let _cargasErro = '';

  function raw() { return global.getDTRawFirestore(); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s])); }
  function fmtData(iso) {
    const d = iso ? new Date(iso) : null;
    return d && !isNaN(d) ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  }

  const STATUS_LABEL = { PENDENTE: 'Em montagem', EM_TRANSITO: 'Expedida', RECEBIDA: 'Recebida', CANCELADA: 'Cancelada' };
  const STATUS_CLASSE = { PENDENTE: 'b-yellow', EM_TRANSITO: 'b-blue', RECEBIDA: 'b-green', CANCELADA: 'b-red' };

  // PEDIDO AO VIVO (2026-09-10): "tela de carga montagem demorando" — essa
  // tela sempre buscou a coleção COL_CARGAS INTEIRA (todo o histórico, pra
  // sempre) de TODAS as lojas (hoje 8 cadastradas), mesmo consolidar
  // multi-loja sendo intencional (comentário original no topo do arquivo).
  // Cargas RECEBIDA/CANCELADA são histórico fechado que só cresce; por
  // padrão a busca passa a trazer só as ATIVAS (PENDENTE/EM_TRANSITO, o que
  // realmente importa no dia a dia operacional) — bem menor e mais rápido.
  // O histórico completo (RECEBIDA/CANCELADA/"Todos os status") só é
  // buscado quando o próprio filtro de status pede explicitamente (ver
  // listener de 'cargas-f-status' abaixo), nunca sozinho.
  // PEDIDO AO VIVO (2026-09-11): "a parte do Analista pode puxar do
  // BigQuery, 1 a 5 minutos de atraso não tem problema" — a busca de TODAS
  // as lojas trocou de N leituras (uma por loja) por 1 chamada de Cloud
  // Function (buscarCargasTodasLojasBigQuery), que já filtra por status
  // (PENDENTE/EM_TRANSITO por padrão, ou tudo quando incluirFinalizadas) e
  // pelas lojas que o login atual pode ver. `_carregarItensDaCarga`
  // continua lendo o Firestore direto — é sob demanda, só quando o
  // Analista abre um card específico, nunca foi o gargalo.
  let _cargasComFinalizadas = false;
  // BUG AO VIVO REAL (2026-09-11, achado no log do servidor): "ainda
  // demora muito" — não havia NENHUMA trava contra chamada concorrente
  // aqui. Clicar de novo (ou a própria navegação disparando o render mais
  // de uma vez) enquanto a 1ª busca ainda não tinha voltado criava uma
  // busca NOVA em cima da anterior — o log mostrou várias chamadas da
  // mesma função quase simultâneas. `_cargasCarregandoPromise` garante que
  // qualquer chamada que chegue enquanto uma já está em andamento espera
  // pela MESMA promessa, em vez de disparar outra consulta ao BigQuery.
  let _cargasCarregandoPromise = null;
  async function carregarCargasAnalista(forcar, incluirFinalizadas) {
    if (_cargas.length && !forcar && (!incluirFinalizadas || _cargasComFinalizadas)) return;
    if (_cargasCarregandoPromise) return _cargasCarregandoPromise;
    _cargasCarregandoPromise = (async () => {
      const vazio = { docs: [] };
      const lojasSnap = await raw().collection('lojas').get().catch(() => vazio);
      _lojas = lojasSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => x.ativa !== false);
      const callable = global.firebase.app().functions('southamerica-east1').httpsCallable('buscarCargasTodasLojasBigQuery');
      const resposta = await callable({ incluirFinalizadas: !!incluirFinalizadas });
      _cargas = (resposta && resposta.data && resposta.data.cargas) || [];
      _cargasComFinalizadas = !!incluirFinalizadas;
    })();
    try {
      await _cargasCarregandoPromise;
    } finally {
      _cargasCarregandoPromise = null;
    }
  }

  async function _carregarItensDaCarga(carga) {
    if (_itensPorCarga[carga._id]) return _itensPorCarga[carga._id];
    try {
      const snap = await raw().collection('lojas').doc(carga.lojaId).collection(COL_CARGAS).doc(carga._id).collection('itens').get();
      const itens = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
      _itensPorCarga[carga._id] = itens;
      return itens;
    } catch (e) {
      _itensPorCarga[carga._id] = [];
      return [];
    }
  }

  function _filtrados() {
    const busca = _filtroBusca.trim().toLowerCase();
    return _cargas.filter(c => {
      if (_filtroLoja && c.lojaId !== _filtroLoja) return false;
      if (_filtroStatus && c.status !== _filtroStatus) return false;
      if (busca && !String(c.nomeCarga || '').toLowerCase().includes(busca) && !String(c.motoristaNome || '').toLowerCase().includes(busca)) return false;
      return true;
    }).sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
  }

  // BUG AO VIVO REAL (2026-09-06): agrupar só por codigoProduto somava numa
  // linha só variantes de embalagem diferentes do mesmo código (ex.: "00001
  // TAPIOCA 1KG - CX 12" e "00001 TAPIOCA 1KG - FD 12" — mesmo código
  // interno na Base de Produtos, mas caixa e fardo são unidades diferentes)
  // — o resumo mostrava uma quantidade só, misturando as duas. Agrupa por
  // código + nome (embalagem já vem embutida no nome bipado): mesma
  // embalagem em capas diferentes continua somando junto; embalagens
  // diferentes do mesmo código viram linhas separadas.
  function _resumoPorProduto(itens) {
    const mapa = new Map();
    itens.forEach(it => {
      const chave = (it.codigoProduto || '—') + '|' + (it.nomeProduto || '—');
      const atual = mapa.get(chave) || { codigoProduto: it.codigoProduto || '', nomeProduto: it.nomeProduto || '—', quantidade: 0 };
      atual.quantidade += Number(it.quantidade) || 0;
      mapa.set(chave, atual);
    });
    return [...mapa.values()].sort((a, b) => b.quantidade - a.quantidade);
  }

  // PEDIDO AO VIVO (2026-09-06): "no analista colocar a opção de adicionar
  // as notas fiscais e o volume de cada uma" — antes só dava pra informar
  // NF+volume pelo Coletor, na hora de expedir (confirmarExpedicaoCarga).
  // O Analista ganha a mesma capacidade direto no card, pra qualquer
  // status (corrigir/completar NF mesmo depois de já expedida) — grava
  // direto em `notasFiscais` da carga, sem mexer em totalVolumes (esse
  // campo é a soma das QUANTIDADES bipadas, um conceito diferente do
  // "volumes" de cada NF, que é a contagem de caixas daquela nota).
  function _notasFiscaisHtml(carga) {
    const notas = carga.notasFiscais || [];
    const linhas = notas.map((n, i) => `<tr>
        <td class="mono">${esc(n.numero)}</td>
        <td class="mono">${esc(n.volumes)}</td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-nf-remover="${esc(carga._id)}" data-nf-indice="${i}" title="Remover nota fiscal">🗑</button></td>
      </tr>`).join('');
    return `
      <div style="font-weight:700;font-size:.8rem;margin-bottom:6px">📄 Notas Fiscais</div>
      <div style="overflow:auto;margin-bottom:8px"><table class="dt-table">
        <thead><tr><th>Número</th><th>Volumes</th><th></th></tr></thead>
        <tbody>${linhas || '<tr><td colspan="3">Nenhuma nota fiscal cadastrada.</td></tr>'}</tbody>
      </table></div>
      <div class="fg" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px">
        <div style="flex:1;min-width:120px"><div class="fl" style="font-size:.7rem;color:var(--muted)">Número da NF</div><input class="field" id="nf-novo-numero-${esc(carga._id)}" placeholder="Ex.: 55501"></div>
        <div style="width:110px"><div class="fl" style="font-size:.7rem;color:var(--muted)">Volumes</div><input class="field" id="nf-novo-volumes-${esc(carga._id)}" type="number" min="1" step="1"></div>
        <button type="button" class="btn btn-primary btn-sm" data-nf-adicionar="${esc(carga._id)}">+ Adicionar NF</button>
      </div>
      <div id="nf-status-${esc(carga._id)}" style="font-size:.72rem;color:var(--muted);min-height:16px;margin-bottom:6px"></div>`;
  }

  // PEDIDO AO VIVO (2026-09-08): "quando colocar uma nota vinculada com os
  // produtos não precisa criar mais novas linhas com os produtos, ali
  // mesmo no resumo do produto pode ter uma coluna com essa informação" —
  // a tabela "Notas × Produtos" separada duplicava a mesma linha que já
  // aparecia no Resumo por produto (nome/código/quantidade de novo). A
  // nota de cada produto agora é só mais uma coluna do resumo — mesma
  // fonte de dado (`carga.notasFiscaisProdutos`), sem tabela nova.
  function _notaPorChaveProduto(carga) {
    const mapa = new Map();
    (carga.notasFiscaisProdutos || []).forEach(n => {
      (n.produtos || []).forEach(p => {
        mapa.set((p.codigoProduto || '—') + '|' + (p.nomeProduto || '—'), n.numero);
      });
    });
    return mapa;
  }

  function _detalheHtml(carga, itens) {
    const resumo = _resumoPorProduto(itens);
    const notaPorChave = _notaPorChaveProduto(carga);
    const linhasResumo = resumo.map(r => {
      const chave = (r.codigoProduto || '—') + '|' + (r.nomeProduto || '—');
      const numeroNota = notaPorChave.get(chave);
      const celulaNota = numeroNota
        ? `<span class="mono">${esc(numeroNota)}</span> <button type="button" class="btn btn-ghost btn-sm" data-npv-desvincular="${esc(carga._id)}" data-npv-numero="${esc(numeroNota)}" data-npv-chave="${esc(chave)}" title="Desvincular desta nota">🗑</button>`
        : '<span style="color:var(--muted)">—</span>';
      return `<tr>
        <td><input type="checkbox" data-produto-check="${esc(chave)}"></td>
        <td>${esc(r.nomeProduto)}</td>
        <td class="mono">${esc(r.codigoProduto || '—')}</td>
        <td class="mono" style="font-weight:700">${esc(r.quantidade)}</td>
        <td>${celulaNota}</td>
      </tr>`;
    }).join('');
    const linhasItens = itens.slice().sort((a, b) => String(a.capa).localeCompare(String(b.capa))).map(it => {
      // PEDIDO AO VIVO (2026-09-08): "capa-palete não existe no
      // Bluesoft... a linha daquela capa-palete deve ficar vermelha...
      // depois que o operador corrigir, a linha fica amarela" — vermelho
      // (pendente) nunca coexiste com amarelo (já corrigida); sem nenhum
      // dos dois, sem destaque nenhum (nunca teve problema).
      const estiloLinha = it.bluesoftPendente ? 'background:rgba(217,32,32,.08);border-left:3px solid var(--danger)'
        : it.bluesoftCorrigido ? 'background:rgba(201,122,6,.10);border-left:3px solid var(--warn)' : '';
      const historico = (it.bluesoftHistorico || []);
      const ultimoHistorico = it.bluesoftCorrigido && historico.length ? historico[historico.length - 1] : null;
      const linhaHistorico = ultimoHistorico
        ? `<tr style="${estiloLinha}"><td colspan="5" style="font-size:.7rem;color:var(--muted);padding-top:0">Capa anterior: <span class="mono">${esc(ultimoHistorico.capaAnterior)}</span> · corrigida em ${esc(fmtData(ultimoHistorico.corrigidoEm))} por ${esc(ultimoHistorico.corrigidoPor || '—')}</td></tr>`
        : '';
      return `<tr style="${estiloLinha}">
        <td><input type="checkbox" data-item-bluesoft-pendente="${esc(carga._id)}|${esc(it._id)}" ${it.bluesoftPendente ? 'checked' : ''} title="Capa-palete não existe no Bluesoft"></td>
        <td class="mono">${esc(it.capa)}</td>
        <td class="mono">${esc(it.codigoProduto || '—')}</td>
        <td>${esc(it.nomeProduto || '—')}</td>
        <td class="mono" style="font-weight:700">${esc(it.quantidade)}</td>
      </tr>${linhaHistorico}`;
    }).join('');
    return `
      <div style="padding:10px 12px;border-top:1px dashed var(--border,#e5e7eb)">
        ${_notasFiscaisHtml(carga)}
        <div style="font-weight:700;font-size:.8rem;margin-bottom:6px">📊 Resumo por produto</div>
        <div style="overflow:auto;margin-bottom:8px"><table class="dt-table">
          <thead><tr><th></th><th>Produto</th><th>Código</th><th>Quantidade</th><th>Nota</th></tr></thead>
          <tbody>${linhasResumo || '<tr><td colspan="5">Nenhum item bipado ainda.</td></tr>'}</tbody>
        </table></div>
        <div class="fg" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:6px">
          <div style="flex:1;min-width:140px"><div class="fl" style="font-size:.7rem;color:var(--muted)">Número da nota (produtos marcados acima)</div><input class="field" id="npv-numero-${esc(carga._id)}" placeholder="Ex.: 123456"></div>
          <button type="button" class="btn btn-primary btn-sm" data-npv-vincular="${esc(carga._id)}">+ Vincular</button>
        </div>
        <div id="npv-status-${esc(carga._id)}" style="font-size:.72rem;color:var(--muted);min-height:16px;margin-bottom:10px"></div>
        <div style="font-weight:700;font-size:.8rem;margin-bottom:6px">📦 Itens (por capa) <span style="font-weight:400;color:var(--muted);font-size:.7rem">— marque "capa-palete não existe no Bluesoft" quando encontrar uma divergência</span></div>
        <div style="overflow:auto;max-height:320px"><table class="dt-table">
          <thead><tr><th></th><th>Capa</th><th>Código</th><th>Produto</th><th>Quantidade</th></tr></thead>
          <tbody>${linhasItens || '<tr><td colspan="5">Nenhum item bipado ainda.</td></tr>'}</tbody>
        </table></div>
      </div>`;
  }

  function _cardHtml(c) {
    const expandida = _cargaExpandidaId === c._id;
    // BUG AO VIVO REAL (2026-09-08): "vinculei pelo analista as notas nos
    // produtos e não apareceu as notas" — o badge só olhava `notasFiscais`
    // (a NF manual, "número+volume" solto). Vincular produto→nota grava em
    // `notasFiscaisProdutos`, um campo diferente — o badge mostrava "sem
    // NF" mesmo com notas já vinculadas. Junta as duas fontes, sem repetir
    // número que apareça nas duas.
    const numerosNf = (c.notasFiscais || []).map(n => n.numero);
    const numerosVinculo = (c.notasFiscaisProdutos || []).filter(n => (n.produtos || []).length).map(n => n.numero);
    const todosNumerosNf = [...new Set(numerosNf.concat(numerosVinculo))];
    return `<div class="tc" style="margin-bottom:10px" data-carga-card="${esc(c._id)}">
      <div style="padding:12px;cursor:pointer;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center" data-carga-toggle="${esc(c._id)}">
        <div>
          <div style="font-weight:700">${esc(c.nomeCarga || '(sem nome)')}</div>
          <div style="font-size:.78rem;color:var(--muted)">${esc(c.origemNome || '—')} → ${esc(c.destinoNome || '—')} · ${esc(c.motoristaNome || 'sem motorista ainda')}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="badge">${esc(todosNumerosNf.join(', ') || 'sem NF')}</span>
          <span class="badge">${esc(c.totalVolumes || 0)} volume(s)</span>
          <span class="badge">${esc(c.totalPaletesFisico != null ? c.totalPaletesFisico : '—')} palete(s)</span>
          <span class="badge ${STATUS_CLASSE[c.status] || ''}">${esc((c.status === 'PENDENTE' && c.totalPaletesFisico > 0) ? 'Pronta pra expedição' : (STATUS_LABEL[c.status] || c.status))}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-carga-pdf="${esc(c._id)}" title="Baixar PDF com as informações da carga">📄 PDF</button>
          <button type="button" class="btn btn-ghost btn-sm" data-carga-excluir="${esc(c._id)}" data-carga-excluir-loja="${esc(c.lojaId)}" title="Excluir carga">🗑</button>
          <span style="font-size:.9rem">${expandida ? '▲' : '▼'}</span>
        </div>
      </div>
      <div style="padding:0 12px 8px;font-size:.72rem;color:var(--muted)">Expedido em: ${c.expedidoEm ? esc(fmtData(c.expedidoEm)) : '—'} · Loja: ${esc(c.lojaId)}</div>
      <div data-carga-detalhe="${esc(c._id)}">${_detalheOuPlaceholder(c, expandida)}</div>
    </div>`;
  }

  // BUG AO VIVO REAL (2026-09-06): "carrega a lista, depois começa a
  // recarregar e não aparece mais" — _cardHtml SEMPRE mostrava "Carregando
  // itens..." pra qualquer card expandido, mesmo quando os itens JÁ tinham
  // sido buscados e cacheados antes. Qualquer redesenho completo da lista
  // (botão Atualizar, ou qualquer outro gatilho que chame _desenharCargas()
  // de novo) revertia o card pro placeholder de carregamento — e não existe
  // nenhum caminho automático que busque de novo depois disso (clicar de
  // novo no card FECHA ele, é um toggle). Ficava preso mostrando
  // "Carregando..." pra sempre. Agora, se os itens já estão em cache,
  // mostra o detalhe completo direto, sem voltar a depender de uma nova
  // busca assíncrona.
  function _detalheOuPlaceholder(c, expandida) {
    if (!expandida) return '';
    const cache = _itensPorCarga[c._id];
    if (cache) return _detalheHtml(c, cache);
    return '<div style="padding:12px;text-align:center;color:var(--muted)">Carregando itens...</div>';
  }

  // Shell-first (mesmo padrão de 99-recebimento-retornos-status.js):
  // _desenharCargas() já é seguro com _cargas vazio, então chama ela ANTES
  // do fetch (título/filtros/botão aparecem na hora) e de novo depois,
  // nunca escondendo a estrutura atrás de um "Carregando..." de página
  // inteira.
  async function renderRecebimentoCargas() {
    const pagina = document.getElementById('page-recebimento-cargas');
    if (!pagina) return;
    _cargasCarregando = true;
    _cargasErro = '';
    _desenharCargas();
    try { await carregarCargasAnalista(); } catch (e) { _cargasErro = e.message || String(e); }
    _cargasCarregando = false;
    _desenharCargas();
  }

  function _cargasCarregandoHtml() {
    return _cargasCarregando ? '<div style="font-size:.76rem;color:var(--muted);padding:6px 0">⏳ Carregando...</div>' : '';
  }
  function _cargasErroHtml() {
    if (_cargasErro) return '<div style="font-size:.76rem;color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:8px 12px;margin:8px 0;display:flex;justify-content:space-between;align-items:center;gap:10px"><span>⚠️ Falha ao carregar: ' + esc(_cargasErro) + '</span><button type="button" class="btn btn-ghost btn-sm" data-cargas-atualizar="1">Tentar de novo</button></div>';
    return '';
  }

  function _desenharCargas() {
    const pagina = document.getElementById('page-recebimento-cargas');
    if (!pagina) return;
    const itens = _filtrados();
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">📦 Cargas (Montagem/Expedição)</div><div style="font-size:.74rem;color:var(--muted)">Todas as lojas consolidadas</div></div>
        <button type="button" class="btn btn-ghost btn-sm" data-cargas-atualizar="1">↻ Atualizar</button>
      </div>
      ${_cargasCarregandoHtml()}
      ${_cargasErroHtml()}
      <div class="tc" style="padding:12px;margin-bottom:14px">
        <div class="fg" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
          <select class="field" id="cargas-f-loja">
            <option value="">Todas as lojas</option>
            ${_lojas.map(l => `<option value="${esc(l.id)}" ${_filtroLoja === l.id ? 'selected' : ''}>${esc(l.nome || l.codigo || l.id)}</option>`).join('')}
          </select>
          <select class="field" id="cargas-f-status">
            <option value="">Todos os status</option>
            <option value="PENDENTE" ${_filtroStatus === 'PENDENTE' ? 'selected' : ''}>Em montagem</option>
            <option value="EM_TRANSITO" ${_filtroStatus === 'EM_TRANSITO' ? 'selected' : ''}>Expedida</option>
            <option value="RECEBIDA" ${_filtroStatus === 'RECEBIDA' ? 'selected' : ''}>Recebida</option>
            <option value="CANCELADA" ${_filtroStatus === 'CANCELADA' ? 'selected' : ''}>Cancelada</option>
          </select>
          <input class="field" id="cargas-f-busca" placeholder="🔎 Nome da carga ou motorista" value="${esc(_filtroBusca)}">
        </div>
      </div>
      <div id="cargas-lista">${itens.map(_cardHtml).join('') || '<div class="empty"><div class="empty-icon">📦</div><div class="empty-title">Nenhuma carga encontrada</div><div class="empty-sub">Monte uma carga pelo Coletor pra começar.</div></div>'}</div>
    `;
  }

  async function _alternarDetalheCarga(cargaId) {
    _cargaExpandidaId = _cargaExpandidaId === cargaId ? null : cargaId;
    _desenharCargas();
    if (_cargaExpandidaId !== cargaId) return;
    const carga = _cargas.find(c => c._id === cargaId);
    if (!carga) return;
    const itens = await _carregarItensDaCarga(carga);
    if (_cargaExpandidaId !== cargaId) return; // fechou de novo antes de a busca terminar
    const alvo = document.querySelector('[data-carga-detalhe="' + cargaId + '"]');
    if (alvo) alvo.innerHTML = _detalheHtml(carga, itens);
  }

  function _statusNf(cargaId, msg) {
    const el = document.getElementById('nf-status-' + cargaId);
    if (el) el.textContent = msg || '';
  }

  // Só a subárvore do detalhe é redesenhada (não a lista inteira) — evita
  // fechar/reabrir outros cards e perder o texto que o Analista já tinha
  // digitado nos campos de outra carga expandida (se houver mais de uma).
  function _redesenharDetalhe(cargaId) {
    const alvo = document.querySelector('[data-carga-detalhe="' + cargaId + '"]');
    const carga = _cargas.find(c => c._id === cargaId);
    if (alvo && carga) alvo.innerHTML = _detalheHtml(carga, _itensPorCarga[cargaId] || []);
  }

  // PEDIDO AO VIVO (2026-09-08): "ter a opção de fazer download em PDF com
  // as informações da carga" — reaproveita `exportarElementoProducaoPDF`
  // (76-producao-importacao.js, já usado em PCP/Relatórios: screenshot de
  // um elemento do DOM virando PDF) — mas NUNCA screenshotando o card
  // interativo (tem checkbox/input/botão, ficaria feio no documento).
  // Monta um bloco limpo, só leitura, fora da tela (posicionado longe da
  // viewport, não `display:none` — html2canvas não captura elemento
  // escondido), exporta, e remove logo em seguida.
  function _notasParaPdf(carga, itens) {
    const resumo = _resumoPorProduto(itens);
    const qtdPorChave = new Map(resumo.map(r => [(r.codigoProduto || '—') + '|' + (r.nomeProduto || '—'), r.quantidade]));
    const manual = (carga.notasFiscais || []).map(n => ({ numero: n.numero, volumes: n.volumes }));
    const numerosManual = new Set(manual.map(n => n.numero));
    const vinculo = (carga.notasFiscaisProdutos || [])
      .filter(n => (n.produtos || []).length && !numerosManual.has(n.numero))
      .map(n => ({
        numero: n.numero,
        volumes: n.produtos.reduce((s, p) => s + (qtdPorChave.get((p.codigoProduto || '—') + '|' + (p.nomeProduto || '—')) || 0), 0),
      }));
    return manual.concat(vinculo);
  }

  // PEDIDO AO VIVO (2026-09-11): "juntar as linhas quando for os mesmo
  // produtos, colocar uma linha de referência quando trocar de um produto
  // pra outro" — agrupa os itens (por capa) na mesma ordem do Resumo por
  // produto (código crescente), com UMA linha de referência (código +
  // produto + total) antes de cada grupo, em vez de repetir código/produto
  // em toda linha de capa — a repetição é o que o pedido chamou de "juntar".
  function _itensAgrupadosPorProdutoParaPdf(itens) {
    const porChave = new Map();
    itens.forEach(it => {
      const chave = (it.codigoProduto || '—') + '|' + (it.nomeProduto || '—');
      if (!porChave.has(chave)) porChave.set(chave, { codigoProduto: it.codigoProduto || '', nomeProduto: it.nomeProduto || '—', capas: [] });
      porChave.get(chave).capas.push(it);
    });
    return [...porChave.values()]
      .sort((a, b) => String(a.codigoProduto || '').localeCompare(String(b.codigoProduto || ''), 'pt-BR', { numeric: true }))
      .map(g => ({ ...g, capas: g.capas.slice().sort((a, b) => String(a.capa).localeCompare(String(b.capa), 'pt-BR', { numeric: true })) }));
  }

  // PEDIDO AO VIVO (2026-09-11): "colocar o nome da pessoa que gerou a
  // carga e o nome do login da pessoa que tá imprimindo — você já tem essa
  // informação" — quem GEROU é `carga.criadoPor` (e-mail do operador do
  // Coletor, já gravado em 26-recebimento-cargas.js/criarCarga); quem
  // IMPRIME é o login do Analista atual (mesmo padrão de usuarioAtual() já
  // usado em 97/99/100) — nenhum dos dois pede pra digitar nada.
  function _usuarioAtualEmail() {
    const u = global.firebase?.auth?.().currentUser;
    return (u && u.email) || '';
  }

  // Layout inspirado no modelo "Paletes / Volumes" (Bluesoft) que o usuário
  // enviou como referência: título grande + caixa azul clara com os totais
  // no canto superior direito, seções com cabeçalho de tabela azul claro.
  // Portrait (folha vertical) — ver _baixarPdfCarga: a exportação escala a
  // imagem inteira pra caber em 1 página só, então "diminuir a letra se
  // ficar muito grande" já acontece sozinho nesse encolhe-pra-caber.
  function _pdfCargaHtml(carga, itens) {
    const notaPorChave = _notaPorChaveProduto(carga);
    const notas = _notasParaPdf(carga, itens);
    const grupos = _itensAgrupadosPorProdutoParaPdf(itens);
    const azul = '#dbeafe', azulTexto = '#1e2a5c', cinza = '#5a6472';
    const th = `padding:5px 7px;text-align:left;font-size:9.5px;text-transform:uppercase;color:${azulTexto};background:${azul}`;
    const td = 'padding:5px 7px;border-bottom:1px solid #e2e5ea;font-size:10.5px';
    const secaoTitulo = t => `<div style="display:flex;align-items:center;gap:6px;margin:14px 0 6px;font-size:13px;font-weight:700;color:${azulTexto}">${t}</div>`;

    const linhasNotas = notas.map(n => `<tr><td style="${td}">${esc(n.numero)}</td><td style="${td}">${esc(n.volumes)}</td></tr>`).join('')
      || `<tr><td style="${td}" colspan="2">Nenhuma nota fiscal registrada.</td></tr>`;

    const linhasResumo = grupos.map(g => {
      const chave = (g.codigoProduto || '—') + '|' + (g.nomeProduto || '—');
      const total = g.capas.reduce((s, it) => s + (Number(it.quantidade) || 0), 0);
      return `<tr><td style="${td}">${esc(g.codigoProduto || '—')}</td><td style="${td}">${esc(g.nomeProduto)}</td><td style="${td}">${esc(total)}</td><td style="${td}">${esc(notaPorChave.get(chave) || '—')}</td></tr>`;
    }).join('') || `<tr><td style="${td}" colspan="4">Nenhum item bipado ainda.</td></tr>`;

    const linhasItens = grupos.map(g => {
      const total = g.capas.reduce((s, it) => s + (Number(it.quantidade) || 0), 0);
      const linhaReferencia = `<tr style="background:#f0f5fc"><td style="${td};font-weight:700" colspan="3">${esc(g.codigoProduto || '—')} — ${esc(g.nomeProduto)} <span style="font-weight:400;color:${cinza}">(${esc(total)} un.)</span></td></tr>`;
      const linhasCapa = g.capas.map(it => {
        const statusCapa = it.bluesoftPendente ? 'Pendente' : it.bluesoftCorrigido ? 'Corrigida' : '—';
        return `<tr><td style="${td};padding-left:16px">${esc(it.capa)}</td><td style="${td}">${esc(it.quantidade)}</td><td style="${td}">${esc(statusCapa)}</td></tr>`;
      }).join('');
      return linhaReferencia + linhasCapa;
    }).join('') || `<tr><td style="${td}" colspan="3">Nenhum item bipado ainda.</td></tr>`;

    return `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;width:560px;padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div>
          <div style="font-size:17px;font-weight:800;color:${azulTexto};margin-bottom:2px">${esc(carga.nomeCarga || '(sem nome)')}</div>
          <div style="font-size:11px;color:${cinza}">${esc(carga.origemNome || '—')} → ${esc(carga.destinoNome || '—')}</div>
          <div style="font-size:10px;color:${cinza};margin-top:4px">Expedido em: ${carga.expedidoEm ? esc(fmtData(carga.expedidoEm)) : '—'}</div>
        </div>
        <div style="background:${azul};border-radius:8px;padding:8px 14px;text-align:right;white-space:nowrap">
          <div style="font-size:15px;font-weight:800;color:${azulTexto}">${esc(carga.totalPaletesFisico != null ? carga.totalPaletesFisico : '—')} palete(s)</div>
          <div style="font-size:15px;font-weight:800;color:${azulTexto}">${esc(carga.totalVolumes || 0)} volume(s)</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-top:10px"><tbody>
        <tr><td style="${td};width:120px;font-weight:700">Status</td><td style="${td}">${esc(STATUS_LABEL[carga.status] || carga.status)}</td></tr>
        <tr><td style="${td};font-weight:700">Motorista</td><td style="${td}">${esc(carga.motoristaNome || '—')}${carga.placa ? ' · ' + esc(carga.placa) : ''}</td></tr>
        <tr><td style="${td};font-weight:700">Gerado por</td><td style="${td}">${esc(carga.criadoPor || '—')}</td></tr>
        <tr><td style="${td};font-weight:700">Impresso por</td><td style="${td}">${esc(_usuarioAtualEmail() || '—')} em ${esc(fmtData(new Date().toISOString()))}</td></tr>
      </tbody></table>
      ${secaoTitulo('📄 Notas Fiscais')}
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th style="${th}">Número</th><th style="${th}">Volumes</th></tr></thead>
        <tbody>${linhasNotas}</tbody>
      </table>
      ${secaoTitulo('📊 Resumo por produto')}
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th style="${th}">Código</th><th style="${th}">Produto</th><th style="${th}">Quantidade</th><th style="${th}">Nota</th></tr></thead>
        <tbody>${linhasResumo}</tbody>
      </table>
      ${secaoTitulo('📦 Itens (por capa)')}
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th style="${th}">Capa</th><th style="${th}">Quantidade</th><th style="${th}">Bluesoft</th></tr></thead>
        <tbody>${linhasItens}</tbody>
      </table>
    </div>`;
  }

  async function _baixarPdfCarga(cargaId) {
    const carga = _cargas.find(c => c._id === cargaId);
    if (!carga) return;
    if (typeof global.exportarElementoProducaoPDF !== 'function') {
      if (global.showToast) global.showToast('Exportação de PDF indisponível nesta tela.', 'error');
      return;
    }
    const itens = await _carregarItensDaCarga(carga);
    const container = document.createElement('div');
    container.id = '_pdf_carga_' + cargaId;
    container.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff;z-index:-1';
    container.innerHTML = _pdfCargaHtml(carga, itens);
    document.body.appendChild(container);
    try {
      const nomeArquivo = 'carga_' + String(carga.nomeCarga || cargaId).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + '.pdf';
      await global.exportarElementoProducaoPDF(container.id, nomeArquivo, { orientation: 'portrait' });
    } finally {
      container.remove();
    }
  }

  async function _adicionarNotaFiscalCarga(cargaId) {
    const carga = _cargas.find(c => c._id === cargaId);
    if (!carga) return;
    const elNumero = document.getElementById('nf-novo-numero-' + cargaId);
    const elVolumes = document.getElementById('nf-novo-volumes-' + cargaId);
    const numero = String((elNumero && elNumero.value) || '').trim();
    const volumes = Number((elVolumes && elVolumes.value) || '');
    if (!numero) { _statusNf(cargaId, 'Digite o número da NF.'); return; }
    if (!Number.isFinite(volumes) || volumes <= 0) { _statusNf(cargaId, 'Informe um volume maior que zero.'); return; }
    const atuais = carga.notasFiscais || [];
    if (atuais.some(n => String(n.numero) === numero)) { _statusNf(cargaId, 'Essa NF já está cadastrada nessa carga.'); return; }
    const novasNotas = atuais.concat([{ numero, volumes: Math.round(volumes) }]);
    _statusNf(cargaId, 'Salvando...');
    try {
      await raw().collection('lojas').doc(carga.lojaId).collection(COL_CARGAS).doc(cargaId).update({ notasFiscais: novasNotas });
      carga.notasFiscais = novasNotas;
      _redesenharDetalhe(cargaId);
      if (global.showToast) global.showToast('Nota fiscal adicionada.', 'success');
    } catch (e) {
      _statusNf(cargaId, 'Erro ao salvar: ' + (e.message || e));
    }
  }

  async function _removerNotaFiscalCarga(cargaId, indice) {
    const carga = _cargas.find(c => c._id === cargaId);
    if (!carga) return;
    const atuais = carga.notasFiscais || [];
    const novasNotas = atuais.filter((_, i) => i !== indice);
    _statusNf(cargaId, 'Removendo...');
    try {
      await raw().collection('lojas').doc(carga.lojaId).collection(COL_CARGAS).doc(cargaId).update({ notasFiscais: novasNotas });
      carga.notasFiscais = novasNotas;
      _redesenharDetalhe(cargaId);
      if (global.showToast) global.showToast('Nota fiscal removida.', 'success');
    } catch (e) {
      _statusNf(cargaId, 'Erro ao remover: ' + (e.message || e));
    }
  }

  function _statusNpv(cargaId, msg) {
    const el = document.getElementById('npv-status-' + cargaId);
    if (el) el.textContent = msg || '';
  }

  // PEDIDO AO VIVO (2026-09-08): "seleciona os produtos através dos flags...
  // informa o número da nota... clica em Adicionar... os produtos
  // selecionados ficam vinculados àquela nota". Um produto só pode estar
  // em UMA nota por vez — vincular a uma nota nova remove de qualquer nota
  // anterior primeiro. Notas que ficam sem nenhum produto (todos movidos
  // pra outra nota) somem da lista sozinhas.
  async function _vincularProdutosANota(cargaId) {
    const carga = _cargas.find(c => c._id === cargaId);
    if (!carga) return;
    const elNumero = document.getElementById('npv-numero-' + cargaId);
    const numero = String((elNumero && elNumero.value) || '').trim();
    if (!numero) { _statusNpv(cargaId, 'Digite o número da nota.'); return; }
    const container = document.querySelector('[data-carga-detalhe="' + cargaId + '"]');
    const marcados = container ? Array.from(container.querySelectorAll('[data-produto-check]:checked')).map(el => el.getAttribute('data-produto-check')) : [];
    if (!marcados.length) { _statusNpv(cargaId, 'Marque pelo menos um produto no resumo acima.'); return; }
    const itens = _itensPorCarga[cargaId] || [];
    const resumo = _resumoPorProduto(itens);
    const marcadosSet = new Set(marcados);
    const produtosSelecionados = resumo
      .filter(r => marcadosSet.has((r.codigoProduto || '—') + '|' + (r.nomeProduto || '—')))
      .map(r => ({ codigoProduto: r.codigoProduto, nomeProduto: r.nomeProduto }));
    if (!produtosSelecionados.length) return;
    const chavesSelecionadas = new Set(produtosSelecionados.map(p => (p.codigoProduto || '—') + '|' + (p.nomeProduto || '—')));
    const agora = new Date().toISOString();
    const autor = (global._currentAnalistaUser && global._currentAnalistaUser.email) || '';
    let notasAtualizadas = (carga.notasFiscaisProdutos || []).map(n => ({
      numero: n.numero, criadoEm: n.criadoEm, criadoPor: n.criadoPor,
      produtos: (n.produtos || []).filter(p => !chavesSelecionadas.has((p.codigoProduto || '—') + '|' + (p.nomeProduto || '—'))),
    })).filter(n => n.produtos.length > 0);
    const existente = notasAtualizadas.find(n => n.numero === numero);
    if (existente) {
      const chavesJaNaNota = new Set(existente.produtos.map(p => (p.codigoProduto || '—') + '|' + (p.nomeProduto || '—')));
      produtosSelecionados.forEach(p => {
        const chave = (p.codigoProduto || '—') + '|' + (p.nomeProduto || '—');
        if (!chavesJaNaNota.has(chave)) existente.produtos.push(p);
      });
    } else {
      notasAtualizadas = notasAtualizadas.concat([{ numero, produtos: produtosSelecionados, criadoEm: agora, criadoPor: autor }]);
    }
    _statusNpv(cargaId, 'Salvando...');
    try {
      await raw().collection('lojas').doc(carga.lojaId).collection(COL_CARGAS).doc(cargaId).update({ notasFiscaisProdutos: notasAtualizadas });
      carga.notasFiscaisProdutos = notasAtualizadas;
      if (elNumero) elNumero.value = '';
      _redesenharDetalhe(cargaId);
      if (global.showToast) global.showToast('Produto(s) vinculado(s) à nota.', 'success');
    } catch (e) {
      _statusNpv(cargaId, 'Erro ao salvar: ' + (e.message || e));
    }
  }

  async function _desvincularProdutoDaNota(cargaId, numero, chave) {
    const carga = _cargas.find(c => c._id === cargaId);
    if (!carga) return;
    const notasAtualizadas = (carga.notasFiscaisProdutos || []).map(n => {
      if (n.numero !== numero) return n;
      return Object.assign({}, n, { produtos: (n.produtos || []).filter(p => (p.codigoProduto || '—') + '|' + (p.nomeProduto || '—') !== chave) });
    }).filter(n => (n.produtos || []).length > 0);
    try {
      await raw().collection('lojas').doc(carga.lojaId).collection(COL_CARGAS).doc(cargaId).update({ notasFiscaisProdutos: notasAtualizadas });
      carga.notasFiscaisProdutos = notasAtualizadas;
      _redesenharDetalhe(cargaId);
      if (global.showToast) global.showToast('Produto desvinculado da nota.', 'success');
    } catch (e) {
      if (global.showToast) global.showToast('Erro ao desvincular: ' + (e.message || e), 'error');
    }
  }

  // PEDIDO AO VIVO (2026-09-08): "adicionar uma opção pra indicar que
  // determinada capa-palete não existe no Bluesoft... a linha fica
  // vermelha... o sistema deve registrar aquela capa-palete como uma
  // pendência... o coletor/operador deve receber uma notificação".
  // `pendenciasCapaAbertas`/`temPendenciaCapa` na CARGA são uma duplicação
  // deliberada do que já está nos itens (`bluesoftPendente`) — sem ela, o
  // listener em tempo real do Coletor precisaria de uma leitura extra a
  // cada snapshot só pra montar o card de alerta. Sempre recomputadas por
  // inteiro a partir da lista de itens já em memória (nunca incremental) e
  // gravadas no MESMO batch que grava o item — nunca fica inconsistente
  // por escrita parcial. Desmarcar (falso alarme) nunca mexe em
  // `bluesoftCorrigido`/`bluesoftHistorico` — só a correção de verdade
  // pelo Coletor faz isso (26-recebimento-cargas.js).
  async function _marcarCapaBluesoftPendente(lojaId, cargaId, itemId, marcar) {
    const carga = _cargas.find(c => c._id === cargaId && c.lojaId === lojaId);
    if (!carga) return;
    const itens = _itensPorCarga[cargaId] || [];
    const item = itens.find(it => it._id === itemId);
    if (!item) return;
    const agora = new Date().toISOString();
    const autor = (global._currentAnalistaUser && global._currentAnalistaUser.email) || '';
    const patchItem = marcar
      ? { bluesoftPendente: true, bluesoftPendenteDesde: agora, bluesoftPendenteMarcadoPor: autor }
      : { bluesoftPendente: false, bluesoftPendenteDesde: null, bluesoftPendenteMarcadoPor: null };
    const itensAtualizados = itens.map(it => it._id === itemId ? Object.assign({}, it, patchItem) : it);
    const pendencias = itensAtualizados.filter(it => it.bluesoftPendente).map(it => ({
      itemId: it._id, capa: it.capa, codigoProduto: it.codigoProduto, nomeProduto: it.nomeProduto,
      marcadoEm: it.bluesoftPendenteDesde, marcadoPor: it.bluesoftPendenteMarcadoPor,
    }));
    const patchCarga = { pendenciasCapaAbertas: pendencias, temPendenciaCapa: pendencias.length > 0 };
    try {
      const itemRef = raw().collection('lojas').doc(lojaId).collection(COL_CARGAS).doc(cargaId).collection('itens').doc(itemId);
      const cargaRef = raw().collection('lojas').doc(lojaId).collection(COL_CARGAS).doc(cargaId);
      const batch = raw().batch();
      batch.update(itemRef, patchItem);
      batch.update(cargaRef, patchCarga);
      await batch.commit();
      Object.assign(item, patchItem);
      Object.assign(carga, patchCarga);
      _redesenharDetalhe(cargaId);
      if (global.showToast) global.showToast(marcar ? 'Capa-palete marcada como pendente — o operador vai ser avisado.' : 'Marcação removida.', 'success');
    } catch (e) {
      if (global.showToast) global.showToast('Erro ao salvar: ' + (e.message || e), 'error');
    }
  }

  // PEDIDO AO VIVO (2026-09-08): "no início a gente sempre faz testes...
  // isso serve pra novas funções" — o Analista precisa apagar cargas de
  // teste direto da tela. Apaga a subcoleção `itens` primeiro (Firestore
  // não cascateia) e só depois o doc da carga.
  // PEDIDO AO VIVO (2026-09-08): "aqui excluir as cargas... mas ainda
  // continuou em trânsito, ele tem que voltar para o estoque de origem" —
  // uma carga EM_TRANSITO já tinha gravado no ledger, na expedição
  // (26-recebimento-cargas.js do Coletor): disponível -= paletes, em
  // trânsito += paletes. Excluir a carga sem desfazer isso deixava esse
  // saldo preso em "Em Trânsito" pra sempre. RECEBIDA não entra aqui de
  // propósito: o bip de CHEGOU já zerou a parte de origem (só o lado
  // destino ficaria por conta de alguém mexer manualmente lá) — mensagem
  // avisa esse caso, não tenta desfazer sozinho.
  async function _excluirCarga(cargaId, lojaId) {
    const carga = _cargas.find(c => c._id === cargaId && c.lojaId === lojaId);
    if (!carga) return;
    const totalPaletes = Math.round(Number(carga.totalPaletesFisico) || 0);
    const vaiDevolverLedger = carga.status === 'EM_TRANSITO' && totalPaletes > 0;
    const msg = 'Excluir a carga "' + (carga.nomeCarga || '(sem nome)') + '" (' + (STATUS_LABEL[carga.status] || carga.status) + ')?'
      + (vaiDevolverLedger ? '\n\nOs ' + totalPaletes + ' palete(s) em trânsito desta carga voltam pro Disponível da loja de origem.' : '')
      + (carga.status === 'RECEBIDA' ? '\n\nEssa carga já foi RECEBIDA no destino — excluir aqui NÃO desfaz o saldo já somado lá, só remove o registro da carga.' : '')
      + '\n\nEssa ação não pode ser desfeita.';
    if (!confirm(msg)) return;
    try {
      const itens = await _carregarItensDaCarga(carga);
      await Promise.all(itens.map(it => raw().collection('lojas').doc(lojaId).collection(COL_CARGAS).doc(cargaId).collection('itens').doc(it._id).delete()));
      await raw().collection('lojas').doc(lojaId).collection(COL_CARGAS).doc(cargaId).delete();
      if (vaiDevolverLedger && typeof global._aplicarMovimentoLedger === 'function') {
        try {
          // PEDIDO AO VIVO (2026-09-08): "Em Trânsito" agora é lançado na
          // loja de DESTINO desde a expedição, não mais na origem — desfazer
          // precisa espelhar isso: o Disponível volta pra origem (quem
          // expediu), e o Em Trânsito é descontado do DESTINO (quem ia
          // receber), não mais da origem.
          const referenciaLedger = { colecao: COL_CARGAS, id: cargaId };
          await Promise.all([
            global._aplicarMovimentoLedger(lojaId, 'TRANSBORDO_EXPEDICAO_EXCLUIDA', { disponivelDelta: totalPaletes }, referenciaLedger),
            global._aplicarMovimentoLedger(carga.destinoLojaId, 'TRANSBORDO_EXPEDICAO_EXCLUIDA', { emTransitoDelta: -totalPaletes }, referenciaLedger)
          ]);
        } catch (eLedger) {
          if (global.showToast) global.showToast('Carga excluída, mas houve falha ao devolver o saldo ao ledger: ' + (eLedger.message || eLedger), 'error');
        }
      }
      _cargas = _cargas.filter(c => !(c._id === cargaId && c.lojaId === lojaId));
      delete _itensPorCarga[cargaId];
      if (_cargaExpandidaId === cargaId) _cargaExpandidaId = null;
      _desenharCargas();
      if (global.showToast) global.showToast('Carga excluída.', 'success');
    } catch (e) {
      if (global.showToast) global.showToast('Erro ao excluir: ' + (e.message || e), 'error'); else alert('Erro ao excluir: ' + (e.message || e));
    }
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-cargas-atualizar]')) {
      (async () => {
        try {
          await carregarCargasAnalista(true, _cargasComFinalizadas);
          // PEDIDO AO VIVO (2026-09-08): "esse palete depois da correção a
          // linha dele também tem que ficar em amarela" — o Coletor corrige
          // a capa em outro aparelho, mas _itensPorCarga nunca era
          // invalidado por "Atualizar" (só recarregava a lista de cargas,
          // não os itens), então a cor nunca mudava sem um F5 completo da
          // página. Limpa o cache inteiro; se algum card já estiver aberto,
          // busca os itens dele de novo ANTES de redesenhar — nunca deixa
          // um card aberto preso em "Carregando itens..." (ver
          // _detalheOuPlaceholder acima, bug de 2026-09-06: sem essa busca
          // antecipada, o redesenho da lista sozinho nunca dispara uma
          // busca nova).
          Object.keys(_itensPorCarga).forEach(k => delete _itensPorCarga[k]);
          if (_cargaExpandidaId) {
            const cargaExpandida = _cargas.find(c => c._id === _cargaExpandidaId);
            if (cargaExpandida) await _carregarItensDaCarga(cargaExpandida);
          }
          _desenharCargas();
        } catch (e) {
          if (global.showToast) global.showToast('Falha ao atualizar: ' + (e.message || e), 'error');
        }
      })();
      return;
    }
    const excluir = event.target.closest('[data-carga-excluir]');
    if (excluir) { _excluirCarga(excluir.getAttribute('data-carga-excluir'), excluir.getAttribute('data-carga-excluir-loja')); return; }
    const pdf = event.target.closest('[data-carga-pdf]');
    if (pdf) { _baixarPdfCarga(pdf.getAttribute('data-carga-pdf')); return; }
    const nfAdd = event.target.closest('[data-nf-adicionar]');
    if (nfAdd) { _adicionarNotaFiscalCarga(nfAdd.getAttribute('data-nf-adicionar')); return; }
    const nfRem = event.target.closest('[data-nf-remover]');
    if (nfRem) { _removerNotaFiscalCarga(nfRem.getAttribute('data-nf-remover'), Number(nfRem.getAttribute('data-nf-indice'))); return; }
    const npvVincular = event.target.closest('[data-npv-vincular]');
    if (npvVincular) { _vincularProdutosANota(npvVincular.getAttribute('data-npv-vincular')); return; }
    const npvDesvincular = event.target.closest('[data-npv-desvincular]');
    if (npvDesvincular) { _desvincularProdutoDaNota(npvDesvincular.getAttribute('data-npv-desvincular'), npvDesvincular.getAttribute('data-npv-numero'), npvDesvincular.getAttribute('data-npv-chave')); return; }
    const toggle = event.target.closest('[data-carga-toggle]');
    if (toggle) { _alternarDetalheCarga(toggle.getAttribute('data-carga-toggle')); }
  });
  document.addEventListener('input', function (event) {
    if (event.target.id === 'cargas-f-busca') { _filtroBusca = event.target.value || ''; _desenharCargas(); }
  });
  document.addEventListener('change', async function (event) {
    if (event.target.id === 'cargas-f-loja') { _filtroLoja = event.target.value || ''; _desenharCargas(); }
    if (event.target.id === 'cargas-f-status') {
      _filtroStatus = event.target.value || '';
      // "Recebida"/"Cancelada"/"Todos os status" precisam do histórico
      // completo, que não veio na busca padrão (só ativas) — busca sob
      // demanda, só na 1ª vez que o filtro pedir isso nesta sessão.
      const precisaHistorico = !_filtroStatus || _filtroStatus === 'RECEBIDA' || _filtroStatus === 'CANCELADA';
      if (precisaHistorico && !_cargasComFinalizadas) {
        _cargasCarregando = true; _desenharCargas();
        try { await carregarCargasAnalista(true, true); } catch (e) { _cargasErro = e.message || String(e); }
        _cargasCarregando = false;
      }
      _desenharCargas();
    }
    const marcarCapa = event.target.matches && event.target.matches('[data-item-bluesoft-pendente]');
    if (marcarCapa) {
      const partes = event.target.getAttribute('data-item-bluesoft-pendente').split('|');
      const cargaId = partes[0], itemId = partes[1];
      const carga = _cargas.find(c => c._id === cargaId);
      if (carga) _marcarCapaBluesoftPendente(carga.lojaId, cargaId, itemId, event.target.checked);
    }
  });

  global.renderRecebimentoCargas = renderRecebimentoCargas;
  global._recebimentoCargasCardsInternals = {
    carregarCargasAnalista,
    getCargas: () => _cargas,
    getCargasComFinalizadas: () => _cargasComFinalizadas,
    getLojas: () => _lojas,
    setFiltroLoja: v => { _filtroLoja = v || ''; },
    setFiltroStatus: v => { _filtroStatus = v || ''; },
    setFiltroBusca: v => { _filtroBusca = v || ''; },
    alternarDetalheCarga: _alternarDetalheCarga,
    getItensPorCarga: () => _itensPorCarga,
    resumoPorProduto: _resumoPorProduto,
    adicionarNotaFiscalCarga: _adicionarNotaFiscalCarga,
    removerNotaFiscalCarga: _removerNotaFiscalCarga,
    excluirCarga: _excluirCarga,
    vincularProdutosANota: _vincularProdutosANota,
    desvincularProdutoDaNota: _desvincularProdutoDaNota,
    marcarCapaBluesoftPendente: _marcarCapaBluesoftPendente,
    baixarPdfCarga: _baixarPdfCarga,
    pdfCargaHtml: _pdfCargaHtml,
    itensAgrupadosPorProdutoParaPdf: _itensAgrupadosPorProdutoParaPdf
  };
})(window);
