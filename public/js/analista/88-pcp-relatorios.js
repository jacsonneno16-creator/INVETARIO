// PCP — Fase 10: Relatórios + exportação. Cada relatório é só um recorte
// diferente sobre construirVisao()/requisições já carregadas — nenhuma
// consulta nova. Exportação reaproveita o mesmo padrão de XLSX já usado em
// 71-producao-excel.js e o exportarElementoProducaoPDF já genérico em
// 76-producao-importacao.js — sem criar um exportador paralelo.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = v => Number(v) || 0;
  const RELATORIOS = [
    ['previsao-realizado', 'Previsão × Realizado'],
    ['abc-xyz', 'ABC/XYZ'],
    ['cenarios', 'Cenários “E se?”'],
  ];
  let _relatorio = 'previsao-realizado';
  let _precisaoAgrupamento = 'produto';
  let _cenario = { demandaPct: 0, atrasoFornecedorDias: 0, coberturaDias: 0, producaoPct: 0 };

  // FASE 2.3 — precisão da Escadinha. Não consulta Firestore: usa o
  // dados-escadinha.json que o PCP já trouxe pelo mesmo buscarEstoqueBi().
  // Compara apenas meses FECHADOS do ano corrente. MAPE ignora meses com
  // realizado=0 (evita divisão por zero); WAPE usa o realizado total e é a
  // principal métrica de precisão exibida. Viés positivo = realizado acima
  // do plano; negativo = realizado abaixo do plano.
  function _categoriaProduto(cod, nome, produtos) {
    const internos = global._pcpInternals || {};
    const normalizar = internos.norm || (v => String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''));
    const p = (produtos || []).find(x => String(x.cod || x.prodKey || '') === String(cod || '')) ||
      (produtos || []).find(x => normalizar(x.nome || x.produto || '') === normalizar(nome || '')) || {};
    // Mesma cascata do Planejamento/Produto 360° quando há uma chave real.
    const key = internos.keyOf?.(p) || String(cod || '');
    const meta = key ? internos.metaProduto?.({key,cod:String(cod||''),produto:p.nome||p.produto||nome||''}) : null;
    return meta?.categoria || p.categoria || p.classificacao || p.grupo || internos._categoriaDoNome?.(p.nome || nome || '') || 'Sem categoria';
  }

  function _slope(valores) {
    const pts = (valores || []).filter(v => Number.isFinite(v));
    const len = pts.length;
    if (len < 2) return 0;
    const mx = (len - 1) / 2;
    const my = pts.reduce((a, b) => a + b, 0) / len;
    let num = 0, den = 0;
    pts.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) * (x - mx); });
    return den ? num / den : 0;
  }

  function calcularPrecisaoPrevisao(escadinhaRaw, produtos, opts) {
    opts = opts || {};
    const agora = opts.agora instanceof Date ? opts.agora : new Date();
    const mesAtual = Math.max(0, Math.min(11, Number.isFinite(opts.mesAtual) ? opts.mesAtual : agora.getMonth()));
    const mesesFechados = Array.from({ length: mesAtual }, (_, i) => i);
    const itens = [];
    (escadinhaRaw?.produtos || []).forEach(p => {
      const plano = Array.isArray(p.plano) ? p.plano : [];
      const real = Array.isArray(p.real) ? p.real : [];
      const periodos = mesesFechados.map(m => ({ mes: m, previsto: n(plano[m]), realizado: n(real[m]) }));
      const validos = periodos.filter(x => x.previsto !== 0 || x.realizado !== 0);
      if (!validos.length) return;
      const somaPrev = validos.reduce((s, x) => s + x.previsto, 0);
      const somaReal = validos.reduce((s, x) => s + x.realizado, 0);
      const erroAbs = validos.reduce((s, x) => s + Math.abs(x.realizado - x.previsto), 0);
      const ape = validos.filter(x => x.realizado > 0).map(x => Math.abs(x.realizado - x.previsto) / x.realizado * 100);
      const mape = ape.length ? ape.reduce((a, b) => a + b, 0) / ape.length : null;
      const wape = somaReal > 0 ? erroAbs / somaReal * 100 : null;
      const vies = somaPrev > 0 ? (somaReal - somaPrev) / somaPrev * 100 : null;
      const errosPct = validos.filter(x => x.previsto > 0).map(x => (x.realizado - x.previsto) / x.previsto * 100);
      const slope = _slope(errosPct);
      const tendencia = Math.abs(slope) < 2 ? 'Estável' : slope > 0 ? '↑ Realizado ganhando do plano' : '↓ Realizado ficando abaixo do plano';
      itens.push({
        cod: String(p.cod ?? ''), produto: p.produto || p.nome || String(p.cod ?? ''), categoria: _categoriaProduto(p.cod, p.produto || p.nome, produtos),
        meses: validos.length, previsto: somaPrev, realizado: somaReal, erroAbs, mape, wape, acuracia: wape == null ? null : Math.max(0, 100 - wape), vies, tendencia,
        periodos: validos
      });
    });
    return itens;
  }

  function _agruparPrecisao(itens, agrupamento) {
    if (agrupamento !== 'categoria') return (itens || []).map(x => ({
      Codigo: x.cod, Produto: x.produto, Categoria: x.categoria, MesesAvaliados: x.meses,
      Previsto: x.previsto, Realizado: x.realizado, ErroAbsoluto: x.erroAbs,
      MAPE: x.mape == null ? '' : Number(x.mape.toFixed(2)), WAPE: x.wape == null ? '' : Number(x.wape.toFixed(2)),
      Acuracia: x.acuracia == null ? '' : Number(x.acuracia.toFixed(2)), Vies: x.vies == null ? '' : Number(x.vies.toFixed(2)), Tendencia: x.tendencia
    }));
    const grupos = new Map();
    (itens || []).forEach(x => {
      const k = x.categoria || 'Sem categoria';
      const g = grupos.get(k) || { categoria: k, produtos: 0, previsto: 0, realizado: 0, erroAbs: 0, somaMape: 0, qtdMape: 0 };
      g.produtos++; g.previsto += x.previsto; g.realizado += x.realizado; g.erroAbs += x.erroAbs;
      if (x.mape != null) { g.somaMape += x.mape; g.qtdMape++; }
      grupos.set(k, g);
    });
    return [...grupos.values()].map(g => {
      const wape = g.realizado > 0 ? g.erroAbs / g.realizado * 100 : null;
      const vies = g.previsto > 0 ? (g.realizado - g.previsto) / g.previsto * 100 : null;
      return { Categoria: g.categoria, Produtos: g.produtos, Previsto: g.previsto, Realizado: g.realizado, ErroAbsoluto: g.erroAbs,
        MAPE: g.qtdMape ? Number((g.somaMape / g.qtdMape).toFixed(2)) : '', WAPE: wape == null ? '' : Number(wape.toFixed(2)),
        Acuracia: wape == null ? '' : Number(Math.max(0, 100 - wape).toFixed(2)), Vies: vies == null ? '' : Number(vies.toFixed(2)) };
    }).sort((a, b) => n(b.Realizado) - n(a.Realizado));
  }

  function _resumoPrecisao(itens) {
    const previsto = (itens || []).reduce((s, x) => s + x.previsto, 0);
    const realizado = (itens || []).reduce((s, x) => s + x.realizado, 0);
    const erroAbs = (itens || []).reduce((s, x) => s + x.erroAbs, 0);
    const wape = realizado > 0 ? erroAbs / realizado * 100 : null;
    const vies = previsto > 0 ? (realizado - previsto) / previsto * 100 : null;
    return { produtos: (itens || []).length, previsto, realizado, erroAbs, wape, acuracia: wape == null ? null : Math.max(0, 100 - wape), vies };
  }


  // FASE 3.1 — ABC/XYZ sem leitura adicional. Usa o mesmo real[] da
  // Escadinha já carregado pelo PCP. ABC prioriza participação acumulada
  // no volume realizado dos meses fechados; XYZ mede volatilidade pelo
  // coeficiente de variação (desvio-padrão / média). Limiares padrão podem
  // ser ajustados na própria tela e não são persistidos no Firebase.
  let _abcA = 80, _abcB = 95, _xyzX = 0.30, _xyzY = 0.75;

  function _media(vals) {
    const arr = (vals || []).map(n);
    return arr.length ? arr.reduce((a,b)=>a+b,0) / arr.length : 0;
  }

  function _desvioPadrao(vals, media) {
    const arr = (vals || []).map(n);
    if (!arr.length) return 0;
    const m = Number.isFinite(media) ? media : _media(arr);
    return Math.sqrt(arr.reduce((s,v)=>s+Math.pow(v-m,2),0) / arr.length);
  }

  function calcularABCXYZ(escadinhaRaw, produtos, opts) {
    opts = opts || {};
    const agora = opts.agora instanceof Date ? opts.agora : new Date();
    const mesAtual = Math.max(0, Math.min(11, Number.isFinite(opts.mesAtual) ? opts.mesAtual : agora.getMonth()));
    const mesesFechados = Array.from({ length: mesAtual }, (_, i) => i);
    const limA = Number.isFinite(opts.abcA) ? opts.abcA : _abcA;
    const limB = Number.isFinite(opts.abcB) ? opts.abcB : _abcB;
    const limX = Number.isFinite(opts.xyzX) ? opts.xyzX : _xyzX;
    const limY = Number.isFinite(opts.xyzY) ? opts.xyzY : _xyzY;
    const base = [];
    const internos = global._pcpInternals || {};
    ((escadinhaRaw && escadinhaRaw.produtos) || []).forEach(function(p) {
      const real = Array.isArray(p.real) ? p.real : [];
      const serie = mesesFechados.map(function(m){ return n(real[m]); });
      if (!serie.length || !serie.some(function(v){ return v !== 0; })) return;
      const total = serie.reduce(function(a,b){ return a+b; },0);
      const media = _media(serie);
      const desvio = _desvioPadrao(serie, media);
      const cv = media > 0 ? desvio / media : null;
      const cod = String(p.cod == null ? '' : p.cod);
      const nome = p.produto || p.nome || cod;
      base.push({
        cod: cod, produto: nome, categoria: _categoriaProduto(cod, nome, produtos),
        meses: serie.length, realizado: total, mediaMensal: media, desvioPadrao: desvio, cv: cv,
        xyz: cv == null ? 'N' : cv <= limX ? 'X' : cv <= limY ? 'Y' : 'Z'
      });
    });
    base.sort(function(a,b){ return b.realizado - a.realizado || String(a.produto).localeCompare(String(b.produto),'pt-BR'); });
    const totalGeral = base.reduce(function(s,x){ return s + x.realizado; },0);
    let acumulado = 0;
    base.forEach(function(x){
      const participacao = totalGeral > 0 ? x.realizado / totalGeral * 100 : 0;
      const antes = acumulado;
      acumulado += participacao;
      // O item que cruza o limite permanece na classe onde começou, evitando
      // que um SKU de grande peso caia de A para B só por ultrapassar 80%.
      x.participacao = participacao;
      x.acumulado = acumulado;
      x.abc = antes < limA ? 'A' : antes < limB ? 'B' : 'C';
      x.classe = x.abc + x.xyz;
    });
    return base;
  }

  function _linhasABCXYZ(itens) {
    return (itens || []).map(function(x){
      return {
        Codigo:x.cod, Produto:x.produto, Categoria:x.categoria, ABC:x.abc, XYZ:x.xyz, Classe:x.classe,
        Participacao:Number(x.participacao.toFixed(2)), Acumulado:Number(x.acumulado.toFixed(2)),
        Realizado:x.realizado, MediaMensal:Number(x.mediaMensal.toFixed(2)),
        CoefVariacao:x.cv == null ? '' : Number(x.cv.toFixed(3)), MesesAvaliados:x.meses
      };
    });
  }

  function _resumoABCXYZ(itens) {
    const r={total:(itens||[]).length,A:0,B:0,C:0,X:0,Y:0,Z:0,N:0,matriz:{}};
    (itens||[]).forEach(function(x){ r[x.abc]=(r[x.abc]||0)+1; r[x.xyz]=(r[x.xyz]||0)+1; r.matriz[x.classe]=(r.matriz[x.classe]||0)+1; });
    return r;
  }

  // FASE 3.2 — simulador "E se?". Trabalha SOMENTE sobre a visão já
  // carregada em memória pelo PCP. Não busca nem grava Firestore/BI. O cenário
  // clona os itens e desloca/ajusta consumo, produção e entregas apenas para
  // cálculo; o planejamento real permanece intacto.
  function _isoMaisDias(iso, dias) {
    if (!iso || !dias) return iso || '';
    const d = new Date(String(iso).slice(0,10) + 'T12:00:00');
    if (Number.isNaN(d.getTime())) return iso || '';
    d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0,10);
  }

  function aplicarCenarioItem(item, params) {
    params = params || {};
    // A visao consolidada do PCP foi calculada loja a loja. O cenario deve
    // manter o mesmo contrato: simula cada unidade com seus parametros e so
    // depois consolida, sem reaplicar lote/multiplo de uma loja ao total.
    if(item?._consolidadoLojas&&Array.isArray(item._lojasDetalhe)&&item._lojasDetalhe.length){
      const simulados=item._lojasDetalhe.map(x=>aplicarCenarioItem(x,params));
      const consolidar=global._pcpInternals?._consolidarItensPorLoja;
      if(typeof consolidar==='function')return consolidar(item.key,simulados)||item;
    }
    const demandaFator = Math.max(0, 1 + n(params.demandaPct) / 100);
    const producaoFator = Math.max(0, 1 + n(params.producaoPct) / 100);
    const atraso = Math.max(0, Math.floor(n(params.atrasoFornecedorDias)));
    const cobertura = n(params.coberturaDias) > 0 ? Math.max(1, n(params.coberturaDias)) : Math.max(1, n(item.diasAlvo) || 30);
    const consumoDia = Math.max(0, n(item.consumoDia) * demandaFator);
    const estoqueAlvo = Math.max(n(item.estoqueMinimo), consumoDia * cobertura);
    const estoqueSeguranca = Math.max(0, n(item.estoqueSeguranca) * demandaFator);
    const pontoPedido = Math.max(0, consumoDia * Math.max(0, n(item.leadTimeDias)) + estoqueSeguranca);
    const eventos = (item.eventos || []).map(function(ev){
      let delta = n(ev.delta), data = ev.data || '';
      if (ev.tipo === 'producao' && delta > 0) delta *= producaoFator;
      if (ev.tipo === 'entrada' && delta > 0 && atraso > 0) data = _isoMaisDias(data, atraso);
      return { ...ev, data, delta };
    }).sort((a,b)=>String(a.data||'').localeCompare(String(b.data||'')));
    const plano = Array.isArray(item.planoEscadinha) ? item.planoEscadinha.map(v => n(v) * demandaFator) : item.planoEscadinha;
    const producaoProgramada = Math.max(0, n(item.producaoProgramada) * producaoFator);
    const entradasPrevistas = Math.max(0, n(item.entradasPrevistas));
    const saldo = n(item.estoqueAtual) - n(item.estoqueComprometido) + producaoProgramada + entradasPrevistas;
    const cad=global._pcpInternals?.resolverCadastroProduto?.(item.key,{lojaId:item.lojaId||''})||{};
    const motorProduto={...cad,leadTimeDias:n(item.leadTimeDias),metaCoberturaDias:cobertura,estoqueSeguranca};
    const motor=global.PCPDemandEngine?.calculate?.({
      product:motorProduto,forecast:{},
      operational:{availableStock:n(item.estoqueAtual),committedDemand:n(item.estoqueComprometido),inbound:entradasPrevistas,production:producaoProgramada,dailyDemandOverride:consumoDia},
      parameters:global.PCP_DEMANDA_PARAMETROS||{}
    })||null;
    const necessidadeBruta=motor?.rawNeed??Math.max(0,estoqueAlvo+n(item.estoqueComprometido)-n(item.estoqueAtual)-producaoProgramada-entradasPrevistas);
    const sugerida=motor?.suggestedQuantity??Math.ceil(necessidadeBruta);
    // `construirVisao()` chama necessidade de quantidade operacional já
    // arredondada (lote mínimo/múltiplo). O cenário precisa usar o MESMO
    // conceito para que cenário zerado resulte em Δ = 0.
    const necessidade=sugerida;
    return { ...item, consumoDia, consumoMensal:n(item.consumoMensal)*demandaFator, previsaoMensal:n(item.previsaoMensal)*demandaFator,
      diasAlvo:cobertura, estoqueAlvo:motor?.targetStock??estoqueAlvo, estoqueSeguranca:motor?.safetyStock??estoqueSeguranca, pontoPedido:motor?.reorderPoint??pontoPedido, eventos, planoEscadinha:plano,
      producaoProgramada, saldo, necessidade, necessidadeBruta, quantidadeSugerida:sugerida,
      coberturaDias:motor?.coverageDays??(consumoDia>0?Math.max(0,n(item.estoqueDisponivel))/consumoDia:null),
      coberturaProjetadaDias:motor?.projectedCoverageDays??(consumoDia>0?Math.max(0,saldo)/consumoDia:null) };
  }

  function calcularCenarios(visao, params) {
    const risco = global._pcpTimelineInternals?.calcularRiscoTemporal;
    return (visao || []).map(function(base){
      const sim = aplicarCenarioItem(base, params);
      const rBase = risco ? risco(base, 365) : { rupturaEm: base.rupturaEm || null, pontoPedidoEm:null };
      const rSim = risco ? risco(sim, 365) : { rupturaEm: sim.rupturaEm || null, pontoPedidoEm:null };
      const mudouRuptura = (rBase.rupturaEm || '') !== (rSim.rupturaEm || '');
      let impacto='Sem mudança crítica';
      if (!rBase.rupturaEm && rSim.rupturaEm) impacto='Novo risco de ruptura';
      else if (rBase.rupturaEm && !rSim.rupturaEm) impacto='Ruptura evitada';
      else if (mudouRuptura) impacto=String(rSim.rupturaEm||'') < String(rBase.rupturaEm||'') ? 'Ruptura antecipada' : 'Ruptura postergada';
      else if (sim.necessidade > n(base.necessidade)) impacto='Necessidade aumentou';
      else if (sim.necessidade < n(base.necessidade)) impacto='Necessidade reduziu';
      return { base, sim, rBase, rSim, impacto };
    });
  }

  function _linhasCenarios(visao, calculados) {
    return (calculados || calcularCenarios(visao, _cenario)).map(function(x){
      return {
        Produto:x.base.produto,
        // PEDIDO AO VIVO (2026-10-01): coberturaDias de base/sim vem
        // floorado em 0 (aplicarCenarioItem espelha construirVisao de
        // propósito) — recalcula sem o piso só pro número mostrado aqui.
        CoberturaBase:x.base.consumoDia>0?Number((x.base.estoqueDisponivel/x.base.consumoDia).toFixed(1)):'',
        CoberturaCenario:x.sim.consumoDia>0?Number((x.sim.estoqueDisponivel/x.sim.consumoDia).toFixed(1)):'',
        NecessidadeBase:Math.ceil(n(x.base.necessidade)),
        NecessidadeCenario:Math.ceil(n(x.sim.necessidade)),
        DataAcaoBase:x.rBase.pontoPedidoEm||'', DataAcaoCenario:x.rSim.pontoPedidoEm||'',
        RupturaBase:x.rBase.rupturaEm||'', RupturaCenario:x.rSim.rupturaEm||'', Impacto:x.impacto
      };
    }).sort(function(a,b){
      const peso=v=>v==='Novo risco de ruptura'?0:v==='Ruptura antecipada'?1:v==='Necessidade aumentou'?2:v==='Ruptura postergada'?3:v==='Ruptura evitada'?4:5;
      return peso(a.Impacto)-peso(b.Impacto) || (b.NecessidadeCenario-b.NecessidadeBase)-(a.NecessidadeCenario-a.NecessidadeBase);
    });
  }

  function _fornecedorKey(v) {
    return String(v || '').trim().toLocaleLowerCase('pt-BR');
  }

  function _somarDiasISO(iso, dias) {
    const data = new Date(String(iso || '').slice(0, 10) + 'T12:00:00');
    if (Number.isNaN(data.getTime())) return iso || '';
    data.setDate(data.getDate() + dias);
    return data.toISOString().slice(0, 10);
  }

  // Transforma necessidades grandes em entregas fisicamente possíveis.
  // A capacidade é compartilhada pelo fornecedor: cada produto recebe um
  // caminhão por rodada; se sobrarem caminhões no dia, inicia outra rodada.
  // Isso evita que o primeiro produto consuma os 2 caminhões enquanto outro
  // produto do mesmo fornecedor, necessário na mesma data, fica sem espaço.
  function planejarLotesPorFornecedor(itens, produtos) {
    const configs = new Map();
    (produtos || []).forEach(prod => {
      const key = _fornecedorKey(prod.fornecedorPadrao || prod.fornecedor);
      if (!key) return;
      const atual = configs.get(key) || { capacidade: 0, maxCaminhoes: 1 };
      if (n(prod.capacidadePorCaminhao) > 0) atual.capacidade = n(prod.capacidadePorCaminhao);
      if (n(prod.maxCaminhoesPorEntrega) > 0) atual.maxCaminhoes = Math.max(1, Math.floor(n(prod.maxCaminhoesPorEntrega)));
      configs.set(key, atual);
    });

    const saida = new Map((itens || []).map(item => [item.key, []]));
    const grupos = new Map();
    (itens || []).forEach(item => {
      const fornecedorKey = _fornecedorKey(item.fornecedor);
      const cfg = configs.get(fornecedorKey);
      if (!fornecedorKey || !cfg || cfg.capacidade <= 0) {
        (item.compras || []).forEach((compra, ordemCompra) => saida.get(item.key).push({ ...compra, ordemCompra, limitada: false }));
        return;
      }
      const grupo = grupos.get(fornecedorKey) || { cfg, eventos: [] };
      (item.compras || []).forEach((compra, ordemCompra) => {
        const quantidade = Math.max(0, n(compra.quantidadeSugerida));
        if (!quantidade || !compra.dataNecessaria) return;
        grupo.eventos.push({ itemKey: item.key, dataNecessaria: compra.dataNecessaria, ordemCompra, restante: quantidade, multiplo: Math.max(1, n(item.multiplo) || 1) });
      });
      grupos.set(fornecedorKey, grupo);
    });

    grupos.forEach(({ cfg, eventos }) => {
      eventos.sort((a, b) => String(a.dataNecessaria).localeCompare(String(b.dataNecessaria)) || a.ordemCompra - b.ordemCompra || String(a.itemKey).localeCompare(String(b.itemKey)));
      let dia = eventos[0]?.dataNecessaria || '';
      let guard = 0;
      while (eventos.some(ev => ev.restante > 0) && guard++ < 10000) {
        const pendentes = eventos.filter(ev => ev.restante > 0 && ev.dataNecessaria <= dia);
        if (!pendentes.length) {
          dia = eventos.find(ev => ev.restante > 0)?.dataNecessaria || dia;
          continue;
        }
        let vagas = cfg.maxCaminhoes;
        while (vagas > 0) {
          // Só o ciclo mais antigo de cada produto disputa a rodada atual.
          const porProduto = new Map();
          pendentes.filter(ev => ev.restante > 0).forEach(ev => { if (!porProduto.has(ev.itemKey)) porProduto.set(ev.itemKey, ev); });
          const rodada = [...porProduto.values()];
          if (!rodada.length) break;
          for (const ev of rodada) {
            if (vagas <= 0) break;
            const capacidadeMultipla = Math.floor(cfg.capacidade / ev.multiplo) * ev.multiplo;
            const limiteLote = capacidadeMultipla > 0 ? capacidadeMultipla : cfg.capacidade;
            let quantidade = Math.min(ev.restante, limiteLote);
            if (quantidade < ev.restante || ev.restante <= limiteLote) quantidade = Math.min(limiteLote, Math.ceil(quantidade / ev.multiplo) * ev.multiplo);
            ev.restante = Math.max(0, ev.restante - quantidade);
            saida.get(ev.itemKey).push({ dataNecessaria: dia, quantidadeSugerida: quantidade, ordemCompra: ev.ordemCompra, limitada: true });
            vagas--;
          }
        }
        dia = _somarDiasISO(dia, 1);
      }
    });
    saida.forEach(entregas => entregas.sort((a, b) => String(a.dataNecessaria).localeCompare(String(b.dataNecessaria)) || a.ordemCompra - b.ordemCompra));
    return saida;
  }

  function _visaoRelatorio() {
    const internos=global._pcpInternals||{};
    const dados=internos.dadosFiltrados?.()||{};
    const bruta=internos.construirVisao({...(dados||{}),estoqueBi:internos.getEstoqueBi?.()});
    return internos.filtrarProdutosPlanejaveis?internos.filtrarProdutosPlanejaveis(bruta):bruta;
  }

  function _linhas() {
    const internos = global._pcpInternals;
    const visao = _visaoRelatorio();
    const reqs = internos.getReqs?.() || [];
    const produtos = internos.getProdutos?.() || [];
    const produzidoInternamente = internos.produzidoInternamente || (() => false);
    switch (_relatorio) {
      case 'necessidade': {
        // PEDIDO AO VIVO (2026-09-02): produzido internamente não é "de
        // compra" — mesmo filtro que comprasHtml (78-pcp-central.js) já usa.
        // PEDIDO AO VIVO (2026-09-07): "eu queria que somasse e colocasse a
        // data necessária de umas três compras futuras... toda vez que
        // consultar ele vai ajustando" — Data1ª/2ª/3ª Compra e as
        // quantidades correspondentes vêm de calcularProximasDatasCompra
        // (83-pcp-timeline.js), recalculado do zero a cada render — nunca
        // uma data fixada/salva. DataNecessaria/Prioridade da requisição
        // MANUAL (quando existe uma já criada por alguém) continuam
        // aparecendo à parte — são coisas diferentes: uma é o que o
        // sistema PROJETA que vai precisar, a outra é o que uma PESSOA já
        // decidiu pedir.
        const calc = global._pcpTimelineInternals?.calcularProximasDatasCompra;
        const itens = visao.filter(x => x.necessidade > 0 && !produzidoInternamente(x.key)).map(x => {
          const prod = produtos.find(p => internos.keyOf(p) === x.key);
          const multiplo = Math.max(1, n(prod?.multiploCompra) || 1);
          const sugerida = Math.ceil(x.necessidade / multiplo) * multiplo;
          const reqProduto = reqs.find(r => internos.keyOf(r) === x.key);
          const proximasCompras = calc ? calc(x, 3) : [];
          return { x, prod, multiplo, sugerida, reqProduto, compras: proximasCompras, key: x.key, fornecedor: prod?.fornecedorPadrao || prod?.fornecedor || '' };
        });
        const lotesPorProduto = planejarLotesPorFornecedor(itens, produtos);
        return itens.map(item => {
          const { x, prod, sugerida, reqProduto } = item;
          const prodConfigEntrega = produtos.find(p => _fornecedorKey(p.fornecedorPadrao || p.fornecedor) === _fornecedorKey(item.fornecedor) && n(p.capacidadePorCaminhao) > 0) || prod;
          const lotes = lotesPorProduto.get(item.key) || [];
          const [c1, c2, c3] = lotes;
          const lotesPrimeiraNecessidade = lotes.filter(l => l.ordemCompra === 0).length;
          return {
            // PEDIDO AO VIVO (2026-10-01): x.coberturaDias vem floorado em 0
            // (construirVisao) — mostra sem esse piso nos relatórios/CSV,
            // pra não esconder produto já com cobertura negativa de verdade.
            Produto: x.produto, Fornecedor: item.fornecedor, Estoque: x.estoqueAtual, Cobertura: x.consumoDia>0?x.estoqueDisponivel/x.consumoDia:null, Necessidade: x.necessidade, QuantidadeSugerida: sugerida,
            CapacidadePorCaminhao: n(prodConfigEntrega?.capacidadePorCaminhao) || '', MaxCaminhoesPorEntrega: n(prodConfigEntrega?.maxCaminhoesPorEntrega) || '', LotesPrimeiraNecessidade: lotesPrimeiraNecessidade || '',
            DataNecessaria: reqProduto?.dataNecessaria || '', Prioridade: reqProduto?.prioridade || '',
            Data1aCompra: c1?.dataNecessaria || '', Qtd1aCompra: c1?.quantidadeSugerida ?? '',
            Data2aCompra: c2?.dataNecessaria || '', Qtd2aCompra: c2?.quantidadeSugerida ?? '',
            Data3aCompra: c3?.dataNecessaria || '', Qtd3aCompra: c3?.quantidadeSugerida ?? '',
          };
        });
      }
      case 'demandas':
        return reqs.map(r => ({ Data: r.criadoEm, Produto: r.produto, Quantidade: n(r.quantidade), PCPResponsavel: r.pcpResponsavel || '', Status: r.status || '', Comprador: r.compradorNome || r.compradorEmail || '', QuantidadeComprada: n(r.quantidadeComprada), Saldo: Math.max(0, n(r.quantidade) - n(r.quantidadeComprada)) }));
      case 'ruptura':
        return visao.filter(x => x.rupturaEm && x.rupturaEm !== 'sem data').map(x => ({ Produto: x.produto, Estoque: x.estoqueAtual, RupturaEm: x.rupturaEm, Cobertura: x.consumoDia>0?x.estoqueDisponivel/x.consumoDia:null }));
      case 'cobertura':
        // Situacao continua comparando a cobertura floorada (decisão/
        // classificação) — negativo e 0 caem na mesma faixa "abaixo" de
        // qualquer forma. Só CoberturaAtual (o número mostrado) usa a
        // versão sem o piso.
        return visao.map(x => ({ Produto: x.produto, CoberturaAtual: x.consumoDia>0?x.estoqueDisponivel/x.consumoDia:null, CoberturaDesejada: x.diasAlvo, Situacao: x.coberturaDias == null ? 'sem dados' : x.coberturaDias < x.diasAlvo ? 'abaixo' : x.coberturaDias > x.diasAlvo * 1.5 ? 'acima' : 'dentro' }));
      case 'estoque-projetado':
        return visao.map(x => ({ Produto: x.produto, EstoqueAtual: x.estoqueAtual, SaldoProjetado: x.saldo, Necessidade: x.necessidade, Excesso: x.excesso }));
      case 'previsao-realizado': {
        const itens = calcularPrecisaoPrevisao(internos.getEscadinhaBiRaw?.(), produtos);
        return _agruparPrecisao(itens, _precisaoAgrupamento);
      }
      case 'abc-xyz':
        return _linhasABCXYZ(calcularABCXYZ(internos.getEscadinhaBiRaw?.(), produtos));
      case 'cenarios':
        return _linhasCenarios(visao);
      default: return [];
    }
  }

  async function renderPCPRelatorios() {
    const pagina = document.getElementById('page-pcp-relatorios');
    if (!pagina) return;
    pagina.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><div class="empty-title">Carregando...</div></div>';
    try {
      await global._pcpInternals.carregar();
      // Reaproveita exatamente o mesmo carregamento BI já usado pelo PCP.
      // Não cria leitura Firestore nova e só busca se a Escadinha ainda não
      // estiver em memória nesta sessão.
      if ((_relatorio === 'previsao-realizado' || _relatorio === 'abc-xyz') && !global._pcpInternals.getEscadinhaBiRaw?.() && global.DTBiPastaLocal?.suportado?.()) {
        await global._pcpInternals.buscarEstoqueBi?.().catch(() => {});
      }
      _desenhar();
    }
    catch (e) { pagina.innerHTML = '<div class="empty"><div class="empty-title">Falha ao carregar</div><div class="empty-sub">' + esc(e.message || e) + '</div></div>'; }
  }

  function _desenhar() {
    const pagina = document.getElementById('page-pcp-relatorios');
    if (!pagina) return;
    let linhas = _relatorio === 'cenarios' ? [] : _linhas();
    const precisaoItens = _relatorio === 'previsao-realizado' ? calcularPrecisaoPrevisao(global._pcpInternals.getEscadinhaBiRaw?.(), global._pcpInternals.getProdutos?.() || []) : [];
    const precisaoResumo = _resumoPrecisao(precisaoItens);
    const abcItens = _relatorio === 'abc-xyz' ? calcularABCXYZ(global._pcpInternals.getEscadinhaBiRaw?.(), global._pcpInternals.getProdutos?.() || []) : [];
    const abcResumo = _resumoABCXYZ(abcItens);
    const cenarioCalc = _relatorio === 'cenarios' ? calcularCenarios(_visaoRelatorio(), _cenario) : [];
    if(_relatorio === 'cenarios')linhas=_linhasCenarios([],cenarioCalc);
    const colunas = linhas.length ? Object.keys(linhas[0]) : [];
    const cenarioResumo = _relatorio === 'cenarios' ? { total:cenarioCalc.length, novasRupturas:cenarioCalc.filter(x=>!x.rBase.rupturaEm&&x.rSim.rupturaEm).length, evitadas:cenarioCalc.filter(x=>x.rBase.rupturaEm&&!x.rSim.rupturaEm).length, necessidadeDelta:cenarioCalc.reduce((s,x)=>s+n(x.sim.necessidade)-n(x.base.necessidade),0) } : {total:0,novasRupturas:0,evitadas:0,necessidadeDelta:0};
    pagina.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <div><div class="page-title" style="font-size:1.15rem">📊 Análises do PCP</div><div style="font-size:.74rem;color:var(--muted)">${linhas.length.toLocaleString('pt-BR')} linha(s)</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <select id="pcprel-tipo" class="field" style="min-width:220px">${RELATORIOS.map(([id, label]) => `<option value="${id}" ${id === _relatorio ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
          <button type="button" class="btn btn-ghost btn-sm" data-pcprel-excel>📊 Excel</button>
          <button type="button" class="btn btn-ghost btn-sm" data-pcprel-csv>📄 CSV</button>
          <button type="button" class="btn btn-ghost btn-sm" data-pcprel-pdf>🖨️ PDF</button>
        </div>
      </div>
      ${_relatorio === 'necessidade' ? '<div class="tc" style="padding:9px 12px;margin-bottom:10px;font-size:.72rem;color:var(--muted)"><b>Quantidade sugerida</b> é a necessidade total. As colunas Data/Qtd mostram os primeiros lotes que cabem nos caminhões; produtos do mesmo fornecedor dividem os caminhões disponíveis em cada dia.</div>' : ''}
      ${_relatorio === 'previsao-realizado' ? `<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px"><div class="tc" style="padding:9px 12px;font-size:.72rem;color:var(--muted);flex:1"><b>Escadinha × realizado</b> · só meses fechados. WAPE pondera pelo volume; viés positivo significa realizado acima do plano. Nenhuma leitura Firestore adicional.</div><select id="pcprel-precisao-agrupar" class="field" style="min-width:180px"><option value="produto" ${_precisaoAgrupamento==='produto'?'selected':''}>Agrupar por produto</option><option value="categoria" ${_precisaoAgrupamento==='categoria'?'selected':''}>Agrupar por categoria</option></select></div><div class="kpi-grid" style="margin-bottom:10px"><div class="kpi blue"><div class="kpi-val">${precisaoResumo.produtos}</div><div class="kpi-lbl">Produtos avaliados</div></div><div class="kpi teal"><div class="kpi-val">${precisaoResumo.acuracia==null?'—':precisaoResumo.acuracia.toFixed(1)+'%'}</div><div class="kpi-lbl">Acurácia ponderada</div></div><div class="kpi orange"><div class="kpi-val">${precisaoResumo.wape==null?'—':precisaoResumo.wape.toFixed(1)+'%'}</div><div class="kpi-lbl">WAPE</div></div><div class="kpi ${precisaoResumo.vies!=null&&Math.abs(precisaoResumo.vies)>10?'orange':'green'}"><div class="kpi-val">${precisaoResumo.vies==null?'—':(precisaoResumo.vies>0?'+':'')+precisaoResumo.vies.toFixed(1)+'%'}</div><div class="kpi-lbl">Viés</div></div></div>` : ''}
      ${_relatorio === 'abc-xyz' ? `<div class="tc" style="padding:10px 12px;margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:end"><div style="font-size:.72rem;color:var(--muted);flex:1;min-width:260px"><b>ABC/XYZ</b> · ABC usa participação acumulada no volume realizado dos meses fechados. XYZ usa coeficiente de variação (CV = desvio-padrão ÷ média). Os limiares abaixo só afetam esta análise e não geram leitura nem gravação no Firebase.</div><div style="display:flex;gap:6px;flex-wrap:wrap"><label style="font-size:.68rem">A até %<input id="pcprel-abca" class="field" type="number" min="1" max="99" step="1" value="${_abcA}" style="width:72px;height:32px"></label><label style="font-size:.68rem">B até %<input id="pcprel-abcb" class="field" type="number" min="2" max="100" step="1" value="${_abcB}" style="width:72px;height:32px"></label><label style="font-size:.68rem">X CV ≤<input id="pcprel-xyzx" class="field" type="number" min="0" step="0.05" value="${_xyzX}" style="width:72px;height:32px"></label><label style="font-size:.68rem">Y CV ≤<input id="pcprel-xyzy" class="field" type="number" min="0" step="0.05" value="${_xyzY}" style="width:72px;height:32px"></label></div></div></div><div class="kpi-grid" style="margin-bottom:10px"><div class="kpi blue"><div class="kpi-val">${abcResumo.total}</div><div class="kpi-lbl">Produtos classificados</div></div><div class="kpi green"><div class="kpi-val">${abcResumo.A}</div><div class="kpi-lbl">Classe A</div></div><div class="kpi teal"><div class="kpi-val">${abcResumo.X}</div><div class="kpi-lbl">Demanda X estável</div></div><div class="kpi orange"><div class="kpi-val">${abcResumo.Z}</div><div class="kpi-lbl">Demanda Z irregular</div></div></div>` : ''}
      ${_relatorio === 'cenarios' ? `<div class="tc" style="padding:10px 12px;margin-bottom:10px"><div style="font-size:.72rem;color:var(--muted);margin-bottom:9px"><b>Simulação sem gravação</b> · altera apenas esta análise em memória. Não muda estoque, pedidos, programação, parâmetros nem faz novas leituras no Firebase.</div><div style="display:grid;grid-template-columns:repeat(4,minmax(130px,1fr)) auto;gap:8px;align-items:end"><label style="font-size:.68rem">Demanda (%)<input id="pcprel-cen-demanda" class="field" type="number" min="-100" max="300" step="5" value="${_cenario.demandaPct}"></label><label style="font-size:.68rem">Atraso fornecedor (dias)<input id="pcprel-cen-atraso" class="field" type="number" min="0" max="180" step="1" value="${_cenario.atrasoFornecedorDias}"></label><label style="font-size:.68rem">Cobertura alvo (dias)<input id="pcprel-cen-cobertura" class="field" type="number" min="0" max="180" step="1" value="${_cenario.coberturaDias}" placeholder="0 = atual"></label><label style="font-size:.68rem">Produção (%)<input id="pcprel-cen-producao" class="field" type="number" min="-100" max="300" step="5" value="${_cenario.producaoPct}"></label><button type="button" class="btn btn-ghost btn-sm" data-pcprel-cen-reset>Limpar cenário</button></div></div><div class="kpi-grid" style="margin-bottom:10px"><div class="kpi blue"><div class="kpi-val">${cenarioResumo.total}</div><div class="kpi-lbl">Produtos simulados</div></div><div class="kpi red"><div class="kpi-val">${cenarioResumo.novasRupturas}</div><div class="kpi-lbl">Novas rupturas</div></div><div class="kpi green"><div class="kpi-val">${cenarioResumo.evitadas}</div><div class="kpi-lbl">Rupturas evitadas</div></div><div class="kpi ${cenarioResumo.necessidadeDelta>0?'orange':'teal'}"><div class="kpi-val">${(cenarioResumo.necessidadeDelta>0?'+':'')+Math.round(cenarioResumo.necessidadeDelta).toLocaleString('pt-BR')}</div><div class="kpi-lbl">Δ necessidade</div></div></div>` : ''}

      <div class="tc" id="pcprel-tabela-wrap"><div style="overflow:auto"><table class="dt-table">
        <thead><tr>${colunas.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${linhas.length ? linhas.map(l => `<tr>${colunas.map(c => `<td>${typeof l[c] === 'number' ? l[c].toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : esc(l[c] ?? '')}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${Math.max(1, colunas.length)}">Sem dados para este relatório.</td></tr>`}</tbody>
      </table></div></div>`;
  }

  function _baixarCSV(linhas, nomeArquivo) {
    if (!global.XLSX) { global.showToast?.('Biblioteca Excel não carregada.', 'error'); return; }
    const csv = global.XLSX.utils.sheet_to_csv(global.XLSX.utils.json_to_sheet(linhas));
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nomeArquivo; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function _exportarExcel() {
    if (!global.XLSX) { global.showToast?.('Biblioteca Excel não carregada.', 'error'); return; }
    const linhas = _linhas();
    const wb = global.XLSX.utils.book_new();
    const titulo=(RELATORIOS.find(r => r[0] === _relatorio)?.[1] || 'PCP').slice(0,31);
    global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(linhas), titulo);
    global.XLSX.writeFile(wb, 'pcp_' + _relatorio + '_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  global.pcpRegistrarPagina?.('relatorios', { elId: 'page-pcp-relatorios', render: 'renderPCPRelatorios', titulo: 'Análises' });
  global.renderPCPRelatorios = renderPCPRelatorios;
  global._pcpRelatoriosInternals = { _linhas, planejarLotesPorFornecedor, calcularPrecisaoPrevisao, _agruparPrecisao, _resumoPrecisao, calcularABCXYZ, _linhasABCXYZ, _resumoABCXYZ, aplicarCenarioItem, calcularCenarios, _linhasCenarios, getCenario:()=>({..._cenario}), setCenario:v=>{_cenario={..._cenario,...(v||{})};}, setRelatorio: v => { _relatorio = v; }, setPrecisaoAgrupamento: v => { _precisaoAgrupamento = v === 'categoria' ? 'categoria' : 'produto'; }, setABCXYZLimites:function(v){v=v||{};if(Number.isFinite(v.abcA))_abcA=v.abcA;if(Number.isFinite(v.abcB))_abcB=v.abcB;if(Number.isFinite(v.xyzX))_xyzX=v.xyzX;if(Number.isFinite(v.xyzY))_xyzY=v.xyzY;} };

  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-pcprel-excel]')) { _exportarExcel(); return; }
    if (event.target.closest('[data-pcprel-csv]')) { _baixarCSV(_linhas(), 'pcp_' + _relatorio + '_' + new Date().toISOString().slice(0, 10) + '.csv'); return; }
    if (event.target.closest('[data-pcprel-pdf]')) { global.exportarElementoProducaoPDF?.('pcprel-tabela-wrap', 'pcp_' + _relatorio + '.pdf'); return; }
    if (event.target.closest('[data-pcprel-cen-reset]')) { _cenario={demandaPct:0,atrasoFornecedorDias:0,coberturaDias:0,producaoPct:0}; _desenhar(); return; }
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'pcprel-tipo') {
      _relatorio = event.target.value;
      if ((_relatorio === 'previsao-realizado' || _relatorio === 'abc-xyz') && !global._pcpInternals.getEscadinhaBiRaw?.() && global.DTBiPastaLocal?.suportado?.()) { global.renderPCPRelatorios?.(); return; }
      _desenhar();
      return;
    }
    if (event.target && event.target.id === 'pcprel-precisao-agrupar') { _precisaoAgrupamento = event.target.value === 'categoria' ? 'categoria' : 'produto'; _desenhar(); return; }
    if (event.target && ['pcprel-cen-demanda','pcprel-cen-atraso','pcprel-cen-cobertura','pcprel-cen-producao'].includes(event.target.id)) {
      _cenario={ demandaPct:n(document.getElementById('pcprel-cen-demanda')?.value), atrasoFornecedorDias:Math.max(0,n(document.getElementById('pcprel-cen-atraso')?.value)), coberturaDias:Math.max(0,n(document.getElementById('pcprel-cen-cobertura')?.value)), producaoPct:n(document.getElementById('pcprel-cen-producao')?.value) }; _desenhar(); return;
    }
    if (event.target && ['pcprel-abca','pcprel-abcb','pcprel-xyzx','pcprel-xyzy'].includes(event.target.id)) {
      const a=Number(document.getElementById('pcprel-abca')?.value), b=Number(document.getElementById('pcprel-abcb')?.value), x=Number(document.getElementById('pcprel-xyzx')?.value), y=Number(document.getElementById('pcprel-xyzy')?.value);
      if (Number.isFinite(a) && Number.isFinite(b) && a>0 && b>a && b<=100) { _abcA=a; _abcB=b; }
      if (Number.isFinite(x) && Number.isFinite(y) && x>=0 && y>x) { _xyzX=x; _xyzY=y; }
      _desenhar(); return;
    }
  });
})(window);
