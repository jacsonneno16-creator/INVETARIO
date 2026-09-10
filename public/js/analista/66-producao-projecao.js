// Produção — Projeção V341. Médias simples/ponderada, projeção manual,
// estoque/cobertura/risco, CRUD, importação e exportação Excel em Firestore.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_PROJECAO = 'producao_projecao';
  const COL_PRODUTOS = 'producao_produtos';
  const COL_MOVIMENTOS = 'producao_estoque_movimentos';

  let _projecao = [];
  let _produtos = [];
  let _carregado = false;
  let _paginaAlvo = 'page-producao-projecao';
  // PEDIDO AO VIVO (2026-09-02): "pode usar a escadinha... pegar os 3
  // últimos meses [do real], dividir por três, colocar média" (na prática:
  // um mês em cada campo venda_m1/m2/m3, deixando a fórmula de
  // média/ponderada que a tela já tem fazer o resto) — auto-preenche o que
  // hoje só é digitado manual ou importado por Excel. NUNCA toca
  // estoqueAtual (ledger real, só aplicarEntradaEstoqueProducao mexe nele).
  const ARQUIVO_BI_ESCADINHA = 'dados-escadinha.json';
  let _ultimaBuscaProjecaoBi = '';

  function fs() { return global.getDTFirestore(); }
  function texto(v) { return String(v ?? '').trim(); }
  function variantesChave(v) {
    const s = texto(v);
    if (!s) return [];
    const out = [s];
    if (/^\d+$/.test(s)) out.push(String(Number(s)));
    return Array.from(new Set(out.filter(Boolean)));
  }
  function codigoProduto(p, docId) {
    return texto(p?.cod ?? p?.codigo ?? p?.COD ?? p?.CODIGO ?? p?.produtoKey ?? p?.produto_key ?? p?.bluesoftProdutoKey ?? docId);
  }
  function nomeProduto(p, fallback) {
    return texto(p?.nome ?? p?.descricao ?? p?.desc ?? p?.produto ?? p?.produtoNome ?? p?.produto_nome) || fallback;
  }
  function aliasesProduto(p, cod) {
    return [cod, p?.cod, p?.codigo, p?.COD, p?.CODIGO, p?.produtoKey, p?.produto_key,
      p?.bluesoftProdutoKey, p?.produtoUnitarioKeyBluesoft, p?.produtoUnitarioKey, p?.gtin, p?.ean]
      .flatMap(variantesChave);
  }

  // PCP (fase 6) — ledger de estoque compartilhado por Compras (recebimento)
  // e Produção/Realizado (entrada de produção acabada). Idempotente por
  // movimentoId: se o documento do movimento já existe, a transação não
  // soma de novo (protege contra reprocessar o mesmo recebimento/OP duas
  // vezes por retry de rede ou clique duplo).
  async function aplicarEntradaEstoqueProducao({ prodKey, produto, qtdCx, movimentoId, tipo, origemId } = {}) {
    const qtd = Number(qtdCx) || 0;
    if (!movimentoId || qtd <= 0) return { aplicado: false };
    await carregarProducaoProjecao();
    const item = _projecao.find(p => String(p.cod) === String(prodKey)) ||
      _projecao.find(p => String(p.produto || '').trim().toLowerCase() === String(produto || '').trim().toLowerCase());
    if (!item) throw new Error('Produto não encontrado na Projeção/Estoque: ' + (produto || prodKey));
    const raw = global.getDTRawFirestore();
    const movRef = fs().collection(COL_MOVIMENTOS).doc(movimentoId);
    const projRef = fs().collection(COL_PROJECAO).doc(item._firestoreId);
    const agora = new Date().toISOString();
    const autor = global._currentAnalistaUser?.email || '';
    await raw.runTransaction(async tx => {
      const mov = await tx.get(movRef);
      if(mov.exists)return;
      const snap = await tx.get(projRef);
      const estoqueAtual = Number(snap.data()?.estoqueAtual) || 0;
      const novoEstoque = estoqueAtual + qtd;
      tx.update(projRef,{estoqueAtual:novoEstoque, estoqueAtualizadoEm: agora, estoqueAtualizadoPor: autor});
      tx.set(movRef, { prodKey: prodKey || '', produto: item.produto || produto || '', qtdCx: qtd, tipo: tipo || 'entrada', origemId: origemId || '', criadoEm: agora, criadoPor: autor });
    });
    await carregarProducaoProjecao(true);
    return { aplicado: true };
  }

  async function carregarProducaoProjecao(forcar) {
    if (_carregado && !forcar) return;
    const [snap,prodSnap,estoqueSnap] = await Promise.all([
      fs().collection(COL_PROJECAO).get(),
      // Não transformar falha de permissão/caminho em "zero produtos".
      // A tela precisa mostrar o erro real em vez de induzir o usuário a
      // acreditar que o Cadastro de Produtos está vazio.
      fs().collection(COL_PRODUTOS).get(),
      fs().collection('pcp_estoque_bluesoft').get().catch(() => ({ docs: [] })),
    ]);
    const dados=snap.docs.map(d => ({ _firestoreId: d.id, ...d.data() }));
    const estoques=estoqueSnap.docs.map(d => ({ _estoqueId: d.id, ...d.data() }));
    _produtos=prodSnap.docs.map(d=>({_firestoreIdProduto:d.id,...d.data()}));
    // A API apenas complementa vendas e estoque. A relação exibida nasce
    // exclusivamente do Cadastro de Produtos da Produção desta loja.
    const unicos = new Map();
    _produtos.forEach(p => {
      const cod = codigoProduto(p, p._firestoreIdProduto);
      if (cod && !unicos.has(cod)) unicos.set(cod, p);
    });
    const porAlias = new Map();
    dados.forEach(x => aliasesProduto(x, codigoProduto(x, x._firestoreId)).forEach(k => {
      if (!porAlias.has(k)) porAlias.set(k, x);
    }));
    const estoquePorAlias = new Map();
    estoques.forEach(x => aliasesProduto(x, codigoProduto(x, x._estoqueId)).forEach(k => {
      if (!estoquePorAlias.has(k)) estoquePorAlias.set(k, x);
    }));
    _projecao = Array.from(unicos.entries()).map(([cod, p]) => {
      const d = aliasesProduto(p, cod).map(k => porAlias.get(k)).find(Boolean) || {};
      const e = aliasesProduto(p, cod).map(k => estoquePorAlias.get(k)).find(Boolean) || {};
      const estoqueApi = e.estoqueNormalizado ?? e.estoqueAtual ?? e.estoqueDisponivel;
      return { ...d, cod, produto: nomeProduto(p, nomeProduto(d, 'Produto ' + cod)),
        estoqueAtual: estoqueApi ?? d.estoqueNormalizado ?? d.estoqueAtual ?? null,
        produtoAtivo: p.produtoAtivo !== false && p.ativo !== false,
        _produtoBaseId: p._firestoreIdProduto };
    }).filter(p => p.produtoAtivo !== false);
    _carregado = true;
  }

  // Os 3 meses mais recentes JÁ FECHADOS (não o mês corrente, que ainda
  // está andando e sempre bateria com dado parcial) — M1 = mês passado,
  // M2/M3 = os dois antes dele, na mesma prioridade "M1 = mais recente"
  // que o resto do PCP já usa (motor de demanda, escadinha etc).
  //
  // PEDIDO AO VIVO (2026-09-07): "pega os três meses futuros... outubro,
  // novembro, dezembro [quando o mês corrente é setembro] — pula o mês
  // corrente, não é os 'próximos 15 dias'" — o arquivo da escadinha traz
  // `real[]` (vendas realizadas, 0 nos meses que ainda não aconteceram) E
  // `plano[]` (a meta/orçamento do ano inteiro, com valor real em TODOS os
  // 12 meses, inclusive os futuros) — é o `plano` que dá o dado de verdade
  // pros 3 meses seguintes; `real` sempre seria 0 ali. Os campos
  // previsao_m1/m2/m3 gravados aqui já são o que 120-pcp-demand-engine.js
  // (motor usado por PCP Central/Necessidade de Compras) espera ler — a
  // MESMA coleção producao_projecao alimenta as duas telas, então popular
  // aqui já vale pras duas ao mesmo tempo, sem duplicar lógica.
  function _valorMesEscadinha(arr, offset, mesReferencia) {
    if (!Array.isArray(arr)) return null;
    const idx = mesReferencia + offset;
    // Fora do ano coberto pelo arquivo (ex.: pediria janeiro do ano que
    // vem perto de dezembro) — nunca "embrulha" pra outro mês por engano.
    if (idx < 0 || idx > 11) return null;
    return Number(arr[idx]) || 0;
  }
  function _calcularVendaMesesEscadinha(dadosEscadinha, mesReferencia) {
    if (mesReferencia == null) mesReferencia = (new Date().getMonth() - 1 + 12) % 12;
    const out = new Map();
    (dadosEscadinha?.produtos || []).forEach(p => {
      const cod = String(p.cod ?? '').trim();
      if (!cod || !Array.isArray(p.real)) return;
      const item = {
        venda_m1: Number(p.real[mesReferencia]) || 0,
        venda_m2: Number(p.real[(mesReferencia - 1 + 12) % 12]) || 0,
        venda_m3: Number(p.real[(mesReferencia - 2 + 12) % 12]) || 0,
      };
      // mesReferencia+1 = mês corrente (em andamento, pulado); +2/+3/+4 =
      // os 3 meses seguintes de verdade.
      const p1 = _valorMesEscadinha(p.plano, 2, mesReferencia);
      const p2 = _valorMesEscadinha(p.plano, 3, mesReferencia);
      const p3 = _valorMesEscadinha(p.plano, 4, mesReferencia);
      if (p1 != null) item.previsao_m1 = p1;
      if (p2 != null) item.previsao_m2 = p2;
      if (p3 != null) item.previsao_m3 = p3;
      out.set(cod, item);
    });
    return out;
  }
  async function buscarProjecaoBi() {
    if (!global.DTBiPastaLocal?.suportado?.()) return;
    const status = await global.DTBiPastaLocal.status();
    if (status !== 'conectado') { const r = await global.DTBiPastaLocal.conectar(); if (!r.ok) { global.showToast?.(r.erro, 'error'); return; } }
    try {
      await carregarProducaoProjecao();
      const dadosEscadinha = await global.DTBiPastaLocal.lerJson(ARQUIVO_BI_ESCADINHA);
      const mapa = _calcularVendaMesesEscadinha(dadosEscadinha);
      let atualizados = 0;
      const agora = new Date().toISOString();
      for (const p of _projecao) {
        const vendas = mapa.get(String(p.cod));
        if (!vendas) continue;
        const payload = { cod: p.cod, produto: p.produto, ...vendas, atualizadoEm: agora };
        if (p._firestoreId) await fs().collection(COL_PROJECAO).doc(p._firestoreId).set(payload, { merge: true });
        else await fs().collection(COL_PROJECAO).add(payload);
        atualizados++;
      }
      _ultimaBuscaProjecaoBi = `Última atualização: ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — ${atualizados} produto(s) com venda_m1/m2/m3 (últimos 3 meses fechados) e previsão dos 3 próximos meses (plano da escadinha) atualizados.`;
      await carregarProducaoProjecao(true);
      _desenharProducaoProjecao();
    } catch (e) {
      _ultimaBuscaProjecaoBi = `Falha na última busca: ${e.message || e}`;
      global.showToast?.('Erro ao buscar projeção no BI: ' + (e.message || e), 'error');
      _desenharProducaoProjecao();
    }
  }

  // Reusada pela Programação Automática (fase 3d), pelo PCP e por
  // Relatórios pra decidir o que sugerir. metodo: 'simples' (média dos 3
  // meses) ou 'ponderada' (peso maior pro mês mais recente, M1) — mesmas
  // duas opções reais da original (a original também tinha um 3º modo
  // "manual" que não é necessário aqui, já que a tela já é 100% CRUD manual
  // por natureza).
  // Fase 12 — quando a Bluesoft já forneceu um consumo diário médio real
  // (`consumoDiaMedioBluesoft`, sincronizado via 90-bluesoft-service.js),
  // ele tem prioridade sobre a média M1/M2/M3 calculada — dado real
  // substitui estimativa, sem precisar trocar de tela/método. A projeção
  // manual (`projecaoManual`) continua podendo sobrepor tudo quando o
  // usuário escolhe explicitamente o método "manual".
  // PEDIDO AO VIVO (comparação com o original achou faltando): a original
  // tem um horizonte configurável ("meses" — 1/2/3 à frente, controla
  // quantos de M1/M2/M3 entram no cálculo) e um "fator de ajuste" (0.5–3.0)
  // que multiplica a projeção mensal final. Aceita string (compat com quem
  // já chamava só o método) ou objeto {metodo,meses,fator}.
  function calcularProjecaoComRisco(params) {
    const opts = typeof params === 'string' ? { metodo: params } : (params || {});
    const metodo = opts.metodo || 'simples';
    const meses = Math.max(1, Math.min(3, Number(opts.meses) || 3));
    const fator = Number(opts.fator) > 0 ? Number(opts.fator) : 1;
    return _projecao.map(p => {
      const vendas = [Number(p.venda_m1) || 0, Number(p.venda_m2) || 0, Number(p.venda_m3) || 0].slice(0, meses);
      const futuras = [Number(p.previsao_m1) || 0, Number(p.previsao_m2) || 0, Number(p.previsao_m3) || 0].slice(0, meses);
      const consumoRealBluesoft = Number(p.consumoDiaMedioBluesoft) || 0;
      let projMensal, origemConsumo;
      if (metodo === 'manual') { projMensal = Math.max(0, Number(p.projecaoManual) || 0); origemConsumo = 'manual'; }
      else if (consumoRealBluesoft > 0) { projMensal = consumoRealBluesoft * 30.44; origemConsumo = 'bluesoft'; }
      // PEDIDO AO VIVO (2026-09-07): "vai pegar esses dois resultados, vai
      // somar um com o outro e vai dividir por dois" — média simples
      // histórico/previsão (era 40% histórico + 60% previsão; agora 50/50,
      // igual ao motor de demanda do PCP Central, 120-pcp-demand-engine.js,
      // que lê os MESMOS campos previsao_m1/m2/m3 desta mesma coleção).
      else if (futuras.some(Boolean)) { const hist=vendas.reduce((s,v)=>s+v,0)/Math.max(1,vendas.length),prev=futuras.reduce((s,v)=>s+v,0)/Math.max(1,futuras.length);projMensal=vendas.some(Boolean)?(hist+prev)/2:prev;origemConsumo='previsao'; }
      else if (metodo === 'ponderada') {
        // Convenção única: M1 = mês mais recente, portanto recebe o maior peso.
        const pesos = [.5, .3, .2].slice(0, vendas.length);
        const somaPesos = pesos.reduce((s, v) => s + v, 0);
        projMensal = somaPesos > 0 ? vendas.reduce((s, v, i) => s + v * pesos[i], 0) / somaPesos : 0; origemConsumo = 'historico';
      } else { projMensal = vendas.length ? vendas.reduce((s, v) => s + v, 0) / vendas.length : 0; origemConsumo = 'historico'; }
      if (origemConsumo === 'historico') projMensal *= fator;
      const projSemanal = projMensal / 4.33;
      const estoque = Number(p.estoqueAtual) || 0;
      const coberturaDias = projSemanal > 0 ? (estoque / projSemanal) * 7 : null;
      let risco = 'nd';
      if (coberturaDias != null) {
        risco = coberturaDias <= 3 ? 'critico' : coberturaDias <= 7 ? 'alto' : coberturaDias <= 14 ? 'medio' : 'ok';
      }
      return { ...p, projMensal, projSemanal, coberturaDias, risco, origemConsumo };
    });
  }
  // Ponto de integração já esperado por 78-pcp-central.js (projLinhas())
  // desde uma fase anterior, nunca implementado — lê os parâmetros atuais
  // da UI desta tela (se estiver aberta) ou usa os padrões do original.
  function getParametrosProducaoProjecao() {
    return {
      metodo: document.getElementById('pproj-metodo')?.value || 'simples',
      meses: Number(document.getElementById('pproj-meses')?.value) || 3,
      fator: Number(document.getElementById('pproj-fator')?.value) || 1,
    };
  }

  const RISCO_INFO = {
    critico: { label: 'Crítico', cor: 'b-red' },
    alto: { label: 'Alto', cor: 'b-orange' },
    medio: { label: 'Médio', cor: 'b-yellow' },
    ok: { label: 'OK', cor: 'b-green' },
    nd: { label: 'Sem dados', cor: 'b-gray' },
  };

  async function renderProducaoProjecao() {
    _paginaAlvo = arguments[0] || 'page-producao-projecao';
    const pagina = document.getElementById(_paginaAlvo);
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    // Sempre relê ao abrir: a loja ativa pode ter mudado e a sincronização
    // da Bluesoft pode ter acabado depois da primeira renderização.
    try { await carregarProducaoProjecao(true); }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; return; }
    _desenharProducaoProjecao();
  }

  function _desenharProducaoProjecao() {
    const pagina = document.getElementById(_paginaAlvo);
    if (!pagina) return;
    const busca = String(document.getElementById('pproj-busca')?.value || '').trim().toLowerCase();
    const metodo = document.getElementById('pproj-metodo')?.value || 'simples';
    const meses = Number(document.getElementById('pproj-meses')?.value) || 3;
    const fator = Number(document.getElementById('pproj-fator')?.value) || 1;
    const todas = calcularProjecaoComRisco({ metodo, meses, fator });
    const linhas = todas
      .filter(p => !busca || String(p.produto || '').toLowerCase().includes(busca) || String(p.cod).includes(busca))
      .sort((a, b) => (a.coberturaDias ?? 9999) - (b.coberturaDias ?? 9999));

    // PEDIDO AO VIVO (comparação com o original achou faltando): 5 cartões
    // de estatística + banner de alerta pra produtos em risco crítico.
    const criticos = todas.filter(p => p.risco === 'critico');
    const comCobertura = todas.filter(p => p.coberturaDias != null);
    const coberturaMedia = comCobertura.length ? comCobertura.reduce((s, p) => s + p.coberturaDias, 0) / comCobertura.length : null;
    const demandaSemanalTotal = todas.reduce((s, p) => s + (p.projSemanal || 0), 0);

    pagina.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:10px">
        <div>
          <div class="page-title" style="font-size:1.1rem">📈 Projeção de Vendas</div>
          <div style="font-size:.72rem;color:var(--muted)">${linhas.length.toLocaleString('pt-BR')} produto(s)</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input id="pproj-busca" placeholder="Buscar código ou produto..." value="${esc(busca)}" class="field" style="min-width:220px">
          <select id="pproj-metodo" class="field" title="Método de cálculo da projeção">
            <option value="simples" ${metodo === 'simples' ? 'selected' : ''}>Média Simples</option>
            <option value="ponderada" ${metodo === 'ponderada' ? 'selected' : ''}>Média Ponderada (mais recente = +peso)</option>
            <option value="manual" ${metodo === 'manual' ? 'selected' : ''}>Projeção Manual</option>
          </select>
          <select id="pproj-meses" class="field" title="Horizonte considerado">
            <option value="1" ${meses === 1 ? 'selected' : ''}>1 mês à frente</option>
            <option value="2" ${meses === 2 ? 'selected' : ''}>2 meses à frente</option>
            <option value="3" ${meses === 3 ? 'selected' : ''}>3 meses à frente</option>
          </select>
          <input id="pproj-fator" class="field" type="number" min="0.5" max="3" step="0.1" value="${fator}" title="Fator de ajuste (0.5–3.0)" style="width:80px">
          <label class="btn btn-ghost btn-sm" style="cursor:pointer;margin:0">📥 Excel<input type="file" id="pproj-excel-input" accept=".xlsx,.xls" style="display:none"></label>
          <button type="button" class="btn btn-ghost btn-sm" data-pproj-export="1">📊 Exportar</button>
          ${global.DTBiPastaLocal?.suportado?.() ? '<button type="button" class="btn btn-ghost btn-sm" data-pproj-buscar-bi>📊 Buscar do BI</button>' : ''}
          <button type="button" class="btn btn-primary btn-sm" data-pproj-novo="1">+ Adicionar Manual</button>
        </div>
      </div>
      ${_ultimaBuscaProjecaoBi ? `<div style="font-size:.72rem;color:var(--muted);margin:-6px 0 12px">${esc(_ultimaBuscaProjecaoBi)}</div>` : ''}
      <div class="kpi-grid" style="margin-bottom:14px">
        <div class="kpi blue"><span class="kpi-icon">📈</span><div class="kpi-val">${todas.length}</div><div class="kpi-lbl">Produtos c/ Projeção</div></div>
        <div class="kpi ${criticos.length ? 'orange' : 'green'}"><span class="kpi-icon">⚠️</span><div class="kpi-val">${criticos.length}</div><div class="kpi-lbl">Ruptura Iminente</div></div>
        <div class="kpi teal"><span class="kpi-icon">📦</span><div class="kpi-val">${coberturaMedia != null ? coberturaMedia.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'd' : '—'}</div><div class="kpi-lbl">Cobertura Média</div></div>
        <div class="kpi purple"><span class="kpi-icon">📊</span><div class="kpi-val">${demandaSemanalTotal.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</div><div class="kpi-lbl">Demanda Semanal Total</div></div>
        <div class="kpi yellow"><span class="kpi-icon">🗓️</span><div class="kpi-val">${meses}</div><div class="kpi-lbl">Período Base (meses)</div></div>
      </div>
      ${criticos.length ? `<div class="tc" style="padding:10px 14px;margin-bottom:12px;border-left:4px solid var(--danger);background:rgba(217,32,32,.06)"><b style="color:var(--danger)">⚠️ ${criticos.length} produto(s) em risco crítico de ruptura</b> — cobertura ≤ 3 dias: ${criticos.slice(0, 6).map(p => esc(p.produto)).join(', ')}${criticos.length > 6 ? '…' : ''}</div>` : ''}
      <div class="tc">
        <div style="overflow-x:auto">
          <table class="dt-table" style="table-layout:fixed;min-width:1120px;width:100%">
            <colgroup><col style="width:90px"><col style="width:34%"><col style="width:88px"><col style="width:88px"><col style="width:88px"><col style="width:115px"><col style="width:105px"><col style="width:105px"><col style="width:95px"><col style="width:92px"></colgroup>
            <thead><tr><th>Cód.</th><th>Produto cadastrado na Produção</th><th style="text-align:right" title="Vendas do mês mais recente (histórico real)">Último mês</th><th style="text-align:right" title="Projeção do próximo mês (a partir do plano/meta)">Mês +1</th><th style="text-align:right" title="Projeção do mês seguinte ao próximo (a partir do plano/meta)">Mês +2</th><th style="text-align:right">Projeção/sem.</th><th style="text-align:right">Estoque (CX)</th><th style="text-align:right">Cobertura</th><th>Risco</th><th></th></tr></thead>
            <tbody>
              ${linhas.length ? linhas.map(p => {
                const risco = RISCO_INFO[p.risco];
                return `
                <tr>
                  <td class="mono">${esc(p.cod)}</td>
                  <td><b>${esc(p.produto)}</b></td>
                  <td style="text-align:right">${Math.ceil(Number(p.venda_m1)||0).toLocaleString('pt-BR')}</td>
                  <td style="text-align:right">${p.previsao_m1 != null ? Math.ceil(Number(p.previsao_m1)||0).toLocaleString('pt-BR') : '—'}</td>
                  <td style="text-align:right">${p.previsao_m2 != null ? Math.ceil(Number(p.previsao_m2)||0).toLocaleString('pt-BR') : '—'}</td>
                  <td style="text-align:right">${Math.ceil(p.projSemanal||0).toLocaleString('pt-BR')} ${p.origemConsumo === 'bluesoft' ? '<span class="badge b-blue" style="font-size:.6rem" title="Consumo real vindo da Bluesoft">🔗</span>' : ''}</td>
                  <td style="text-align:right">${p.estoqueAtual==null?'—':Math.ceil(Number(p.estoqueAtual)||0).toLocaleString('pt-BR')}</td>
                  <td style="text-align:right">${p.coberturaDias != null ? p.coberturaDias.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'd' : '—'}</td>
                  <td><span class="badge ${risco.cor}">${risco.label}</span></td>
                  <td style="text-align:right;white-space:nowrap">
                    <button type="button" class="acao-lapis" title="Editar" data-pproj-editar="${esc(p._firestoreId)}">✏️</button>
                    <button type="button" class="acao-lapis" title="Excluir" data-pproj-excluir="${esc(p._firestoreId)}">🗑️</button>
                  </td>
                </tr>`;
              }).join('') : `<tr><td colspan="10"><div class="empty"><div class="empty-icon">📈</div><div class="empty-title">Nenhum produto cadastrado</div></div></td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function _abrirModalPproj(item) {
    document.getElementById('pproj-title').textContent = item._novo ? 'Novo produto' : 'Editar projeção';
    document.getElementById('pproj-doc-id').value = item._firestoreId || '';
    document.getElementById('pproj-cod').value = item.cod ?? '';
    document.getElementById('pproj-produto').value = item.produto || '';
    document.getElementById('pproj-m1').value = item.venda_m1 ?? 0;
    document.getElementById('pproj-m2').value = item.venda_m2 ?? 0;
    document.getElementById('pproj-m3').value = item.venda_m3 ?? 0;
    const manual = document.getElementById('pproj-manual'); if (manual) manual.value = item.projecaoManual ?? '';
    document.getElementById('pproj-estoque').value = item.estoqueAtual ?? '';
    global.openModal?.('modal-pproj');
  }

  function pprojEditar(docId) {
    const item = _projecao.find(p => p._firestoreId === docId);
    if (!item) return;
    _abrirModalPproj(item);
  }
  function pprojNovoProduto() { _abrirModalPproj({ _novo: true }); }

  async function pprojSalvar() {
    const cod = String(document.getElementById('pproj-cod').value || '').trim();
    const produto = String(document.getElementById('pproj-produto').value || '').trim();
    if (!cod || !produto) { global.showToast?.('Informe código e produto.', 'error'); return; }
    const venda_m1 = Number(document.getElementById('pproj-m1').value) || 0;
    const venda_m2 = Number(document.getElementById('pproj-m2').value) || 0;
    const venda_m3 = Number(document.getElementById('pproj-m3').value) || 0;
    const estoqueVal = document.getElementById('pproj-estoque').value;
    const estoqueAtual = estoqueVal === '' ? null : (Number(estoqueVal) || 0);
    const manualVal = document.getElementById('pproj-manual')?.value ?? '';
    const projecaoManual = manualVal === '' ? null : Math.max(0, Number(manualVal) || 0);
    const agora = new Date().toISOString();
    const docId = document.getElementById('pproj-doc-id').value || '';
    const payload = { cod, produto, venda_m1, venda_m2, venda_m3, projecaoManual, estoqueAtual, atualizadoEm: agora };

    try {
      if (docId) {
        await fs().collection(COL_PROJECAO).doc(docId).set(payload, { merge: true });
      } else {
        payload.criadoEm = agora;
        await fs().collection(COL_PROJECAO).add(payload);
      }
      global.closeModal?.('modal-pproj');
      global.showToast?.('Projeção salva.', 'success');
      await carregarProducaoProjecao(true);
      _desenharProducaoProjecao();
    } catch (e) {
      global.showToast?.('Erro ao salvar: ' + (e.message || e), 'error');
    }
  }

  async function pprojExcluir(docId) {
    const item = _projecao.find(p => p._firestoreId === docId);
    if (!item) return;
    const executar = async () => {
      try {
        await fs().collection(COL_PROJECAO).doc(docId).delete();
        global.showToast?.('Projeção excluída.', 'success');
        await carregarProducaoProjecao(true);
        _desenharProducaoProjecao();
      } catch (e) {
        global.showToast?.('Erro ao excluir: ' + (e.message || e), 'error');
      }
    };
    if (global.showConfirm) global.showConfirm('Excluir a projeção do produto "' + item.produto + '"?', executar, { title: 'Excluir projeção', icon: '🗑️', okLabel: 'Excluir', okClass: 'btn-danger' });
    else if (confirm('Excluir a projeção do produto "' + item.produto + '"?')) await executar();
  }

  // Import Excel — colunas esperadas: cod, produto, venda_m1, venda_m2,
  // venda_m3. Upsert por `cod` (não apaga o que já existe e não está na
  // planilha, ao contrário do import destrutivo da original).
  async function importarProjecaoExcel(file) {
    if (!file) return;
    if (!global.XLSX) { global.showToast?.('Biblioteca do Excel não carregada.', 'error'); return; }
    try {
      const bytes = await file.arrayBuffer();
      const book = global.XLSX.read(bytes, { type: 'array', raw: false, cellText: true });
      const planilha = book.Sheets[book.SheetNames.find(n => String(n).trim().toLowerCase() === 'escadinha') || book.SheetNames[0]];
      const linhas = global.XLSX.utils.sheet_to_json(planilha, { defval: '' });
      const agora = new Date().toISOString();
      let criados = 0, atualizados = 0;
      const normalizaCab=v=>String(v).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      const meses=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
      const permitidos=new Map();
      _produtos.forEach(p=>aliasesProduto(p,codigoProduto(p,p._firestoreIdProduto)).forEach(a=>{if(!permitidos.has(a))permitidos.set(a,p);}));
      const agrupados=new Map();
      for(const r of linhas){
        const norm={};Object.entries(r).forEach(([k,v])=>norm[normalizaCab(k)]=v);
        if(String(norm.status||'').trim() && !/^ativo$/i.test(String(norm.status).trim()))continue;
        const codPlanilha=String(norm.cod??norm.codigo??norm.sku??'').trim();
        const produtoBase=variantesChave(codPlanilha).map(k=>permitidos.get(k)).find(Boolean);
        if(!produtoBase)continue;
        const cod=codigoProduto(produtoBase,produtoBase._firestoreIdProduto),produtoNome=nomeProduto(produtoBase,String(norm.produto??norm.descricao??norm.nome??'').trim()||('Produto '+cod));
        const anoTexto=String(norm.ano??'');
        if(anoTexto && !/plano|previs/i.test(anoTexto))continue;
        const ano=Number((anoTexto.match(/20\d{2}/)||[])[0])||new Date().getFullYear();
        const atual=agrupados.get(cod)||{cod,produto:produtoNome,previsao_meses:{},norm:{}};
        meses.forEach((m,i)=>{const v=norm[m]??norm[{mar:'marco',mai:'maio'}[m]||m];if(v!==undefined&&v!=='')atual.previsao_meses[ano+'-'+String(i+1).padStart(2,'0')]=Number(v)||0;});
        atual.norm={...atual.norm,...norm};agrupados.set(cod,atual);
      }
      const chaveMes=off=>{const hoje=new Date(),d=new Date(hoje.getFullYear(),hoje.getMonth()+off,1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');};
      for (const item of agrupados.values()) {
        const {cod,produto:produtoNome,previsao_meses:anual,norm}=item;
        // A projeção começa no próximo mês. Ex.: estando em agosto, usa
        // setembro, outubro e novembro da linha anual PLANO.
        const payload = { cod, produto: produtoNome, previsao_m1:Number(norm.previsao_m1??anual[chaveMes(1)])||0, previsao_m2:Number(norm.previsao_m2??anual[chaveMes(2)])||0, previsao_m3:Number(norm.previsao_m3??anual[chaveMes(3)])||0, previsaoMesesSelecionados:[chaveMes(1),chaveMes(2),chaveMes(3)], previsao_meses:anual, atualizadoEm: agora };
        // A Escadinha é previsão futura: não pode zerar o histórico real
        // sincronizado pela BlueSoft quando não traz colunas venda_m*.
        ['venda_m1','venda_m2','venda_m3'].forEach(c=>{if(norm[c]!==undefined&&norm[c]!=='')payload[c]=Number(norm[c])||0;});
        const existente = _projecao.find(p => String(p.cod) === cod);
        if (existente?._firestoreId) { await fs().collection(COL_PROJECAO).doc(existente._firestoreId).set(payload, { merge: true }); atualizados++; }
        else { await fs().collection(COL_PROJECAO).add({ ...payload, estoqueAtual: null, criadoEm: agora }); criados++; }
      }
      global.showToast?.(criados + ' criado(s), ' + atualizados + ' atualizado(s).', 'success');
      await carregarProducaoProjecao(true);
      _desenharProducaoProjecao();
    } catch (e) {
      global.showToast?.('Erro ao importar: ' + (e.message || e), 'error');
    }
  }


  function exportarProjecaoXLSX() {
    if (!global.XLSX) { global.showToast?.('Biblioteca do Excel não carregada.', 'error'); return; }
    const linhas = calcularProjecaoComRisco(getParametrosProducaoProjecao()).map(p => ({
      cod: p.cod, produto: p.produto, venda_m1: p.venda_m1, venda_m2: p.venda_m2, venda_m3: p.venda_m3,
      projecaoManual: p.projecaoManual ?? '', estoqueAtual: p.estoqueAtual ?? '', projMensal: p.projMensal,
      projSemanal: p.projSemanal, coberturaDias: p.coberturaDias ?? '', risco: p.risco,
    }));
    const wb = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(linhas), 'Projecao');
    global.XLSX.writeFile(wb, 'projecao_vendas.xlsx');
  }

  global.renderProducaoProjecao = renderProducaoProjecao;
  global.importarProjecaoExcel = importarProjecaoExcel;
  global.carregarProducaoProjecao = carregarProducaoProjecao;
  global.calcularProjecaoComRisco = calcularProjecaoComRisco;
  global.getParametrosProducaoProjecao = getParametrosProducaoProjecao;
  global.aplicarEntradaEstoqueProducao = aplicarEntradaEstoqueProducao;
  global.pprojEditar = pprojEditar;
  global.pprojNovoProduto = pprojNovoProduto;
  global.pprojSalvar = pprojSalvar;
  global.pprojExcluir = pprojExcluir;
  global.exportarProjecaoXLSX = exportarProjecaoXLSX;
  global.abrirProjecaoVendasPcp = function(el){document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('on'));el?.classList.add('on');document.getElementById('page-pcp-projecao-vendas')?.classList.add('on');renderProducaoProjecao('page-pcp-projecao-vendas');};
  global._DTProjecaoBiInternals = { _calcularVendaMesesEscadinha, buscarProjecaoBi, ARQUIVO_BI_ESCADINHA };

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-pproj-export]')) { exportarProjecaoXLSX(); return; }
    if (event.target.closest('[data-pproj-buscar-bi]')) { buscarProjecaoBi(); return; }
    const novo = event.target.closest('[data-pproj-novo]');
    if (novo) { pprojNovoProduto(); return; }
    const editar = event.target.closest('[data-pproj-editar]');
    if (editar) { pprojEditar(editar.getAttribute('data-pproj-editar')); return; }
    const excluir = event.target.closest('[data-pproj-excluir]');
    if (excluir) { pprojExcluir(excluir.getAttribute('data-pproj-excluir')); return; }
  });
  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'pproj-busca') _desenharProducaoProjecao();
  });
  document.addEventListener('change', function (event) {
    if (event.target && (event.target.id === 'pproj-metodo' || event.target.id === 'pproj-meses')) { _desenharProducaoProjecao(); return; }
    if (event.target && event.target.id === 'pproj-excel-input') {
      const file = event.target.files && event.target.files[0];
      importarProjecaoExcel(file);
      event.target.value = '';
    }
  });
  document.addEventListener('input', function (event) {
    if (event.target && event.target.id === 'pproj-fator') _desenharProducaoProjecao();
  });
  global.DTProducao?.registrarInvalidacao?.(()=>{ _carregado=false; _projecao=[]; _produtos=[]; });
})(window);
