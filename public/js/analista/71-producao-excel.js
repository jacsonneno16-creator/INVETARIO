// Setor Produção — Import/Export Excel (fase 3e da unificação com o
// Sistema de Produção). Reaproveita o MESMO XLSX (SheetJS) já vendorizado e
// usado no resto do Inventário (`XLSX.read`+`sheet_to_json` pra importar,
// `json_to_sheet`+`book_new`+`writeFile` pra exportar — ver
// `39-base-produtos.js`/`43-importar-exportar-api.js`), sem nenhuma
// biblioteca nova.
//
// Desvio deliberado de segurança em relação à original: a original APAGAVA
// a coleção inteira antes de reimportar a Ficha Técnica (destrutivo) — aqui
// é sempre upsert por chave natural (código/nome), nunca apaga o que já
// existe e não está na planilha.
(function (global) {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COL_MAQUINAS = 'producao_maquinas';
  const COL_PRODUTOS = 'producao_produtos';
  const COL_FICHAS = 'producao_ficha_tecnica';
  const COL_SETUP = 'producao_setup';
  const COL_REGISTROS = 'producao_registros';
  const COL_APONTAMENTOS = 'producao_apontamentos';
  const COL_FUNCIONARIOS = 'producao_funcionarios';
  const COL_ESTOQUE_INSUMOS = 'producao_insumos_estoque';
  const COL_PROJECAO = 'producao_projecao';
  const COL_PROCESSOS = 'producao_processos';
  const COL_CATEGORIAS = 'producao_categorias';
  const COL_CONFIG = 'producao_config';

  function fs() { return global.getDTFirestore(); }

  // PEDIDO AO VIVO (usuário: "o arquivo que eu subo... não salva nada que
  // nem no original"): o template REAL do original (app.js:9444-9552,
  // _baixarTemplateCompleto) grava 3 linhas antes dos dados — título,
  // aviso, e só na 3ª linha os nomes de coluna de verdade (app.js:9586-
  // 9658, importarArquivoPadrao, sempre lê com header:1 e pula 3 linhas
  // por índice numérico, nunca por nome de coluna). O código antigo aqui
  // usava sheet_to_json no modo padrão (linha 1 = cabeçalho), então lia o
  // TÍTULO como se fosse nome de coluna — toda linha subsequente virava
  // lixo e nenhuma OP era salva. Detecta os dois formatos: se as duas
  // primeiras linhas têm só 1 célula preenchida cada (título+aviso) e a
  // 3ª tem várias, pula pra 3ª como cabeçalho real (formato do original);
  // senão usa a 1ª linha como cabeçalho (formato desta integração).
  function _lerLinhasInteligente(sheet) {
    const raw = global.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!raw.length) return [];
    const preenchidas = row => (row || []).filter(c => String(c ?? '').trim() !== '').length;
    let headerIdx = 0;
    if (raw.length > 3 && preenchidas(raw[0]) === 1 && preenchidas(raw[1]) === 1 && preenchidas(raw[2]) > 1) headerIdx = 2;
    const headers = (raw[headerIdx] || []).map(h => String(h ?? '').trim());
    return raw.slice(headerIdx + 1).filter(r => preenchidas(r) > 0).map(r => {
      const obj = {}; headers.forEach((h, i) => { if (h) obj[h] = r[i] ?? ''; }); return obj;
    });
  }
  function _achaAba(book, pedacoNome) {
    const nome = book.SheetNames.find(n => n.toLowerCase().includes(pedacoNome));
    return nome ? _lerLinhasInteligente(book.Sheets[nome]) : [];
  }
  function _parseAtivoStatus(val) {
    if (val === null || val === undefined || val === '') return true;
    const s = String(val).trim().toLowerCase();
    return !['desativado', 'desativo', 'inativo', 'nao', 'não', 'n', '0', 'false', 'no'].includes(s);
  }

  function _json(v, fallback={}) { try { return v ? JSON.parse(String(v)) : fallback; } catch (e) { return fallback; } }
  function _dadosLinha(r) { const x=_json(r?.dadosJson ?? r?.dados ?? '', null); return x && typeof x==='object' && !Array.isArray(x) ? x : {}; }
  async function _emLotes(itens, tamanho, executar) {
    for (let i = 0; i < itens.length; i += tamanho) {
      await Promise.all(itens.slice(i, i + tamanho).map(executar));
    }
  }

  async function exportarProducaoTemplate() {
    try {
      const [snapMaq, snapProd, snapFicha, snapSetup, snapReg, snapApon, snapFunc, snapEst, snapProj, snapProc, snapCat, snapCfg] = await Promise.all([
        fs().collection(COL_MAQUINAS).get(), fs().collection(COL_PRODUTOS).get(), fs().collection(COL_FICHAS).get(), fs().collection(COL_SETUP).get(),
        fs().collection(COL_REGISTROS).get(), fs().collection(COL_APONTAMENTOS).get(), fs().collection(COL_FUNCIONARIOS).get(), fs().collection(COL_ESTOQUE_INSUMOS).get(), fs().collection(COL_PROJECAO).get(),
        fs().collection(COL_PROCESSOS).get().catch(()=>({docs:[]})), fs().collection(COL_CATEGORIAS).get().catch(()=>({docs:[]})), fs().collection(COL_CONFIG).get().catch(()=>({docs:[]})),
      ]);
      const maquinas = snapMaq.docs.map(d => ({ id:d.id, ...d.data() }));
      const produtos = snapProd.docs.map(d => ({ id:d.id, ...d.data() }));
      const fichas = snapFicha.docs.map(d => ({ id:d.id, ...d.data() }));
      const setups = snapSetup.docs.map(d => ({ id:d.id, ...d.data() }));
      const registros = snapReg.docs.map(d => ({ id: d.id, ...d.data() }));
      const apontamentos = snapApon.docs.map(d => ({ id: d.id, ...d.data() }));
      const funcionarios = snapFunc.docs.map(d => ({ id:d.id, ...d.data() }));
      const estoqueInsumos = snapEst.docs.map(d => ({ id:d.id, ...d.data() }));
      const projecao = snapProj.docs.map(d => ({ id: d.id, ...d.data() }));
      const processos = snapProc.docs.map(d => ({ id: d.id, ...d.data() }));
      const categorias = snapCat.docs.map(d => ({ id: d.id, ...d.data() }));
      const configuracoes = snapCfg.docs.map(d => ({ id: d.id, dados: JSON.stringify(d.data()) }));

      const abaMaquinas = maquinas.map(m => ({ id:m.id, nome: m.nome, categoria: m.categoria || '', status: m.status || 'ativa', eficiencia: m.eficiencia ?? 100, setupPadraoMin: m.setupPadraoMin ?? 0, produtos: (m.produtosCompativeis || []).map(p => p.produto).join(', '), produtosCompativeisJson:JSON.stringify(m.produtosCompativeis||[]), turnosJson:JSON.stringify(m.turnos||{}), dadosJson:JSON.stringify(Object.fromEntries(Object.entries(m).filter(([k])=>k!=='id'))) }));
      const abaProdutos = produtos.map(p => ({ id:p.id, cod: p.cod, nome: p.nome, unid: p.unid ?? 1, pc_min: p.pc_min ?? 0, maquina: p.maquina || '', categoria:p.categoria||'', classificacao:p.classificacao||'', metaCoberturaDias:p.metaCoberturaDias??p.coberturaDias??0, producaoMinima:p.producaoMinima??0, multiploProducao:p.multiploProducao??0, tipoMinimo:p.tipoMinimo||'', prioridadeProducao:p.prioridadeProducao??2, alergenico:p.alergenico===true?'SIM':'NAO', dadosJson:JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k])=>k!=='id'))) }));
      const abaInsumos = [];
      fichas.forEach(f => (f.insumos || []).forEach(i => abaInsumos.push({ cod_produto: f.cod, desc_produto: f.desc, insumo: i.insumo, qty: i.qty, categoria: i.categoria || '' })));
      const abaFicha = fichas.map(f=>({id:f.id,cod:f.cod||'',desc:f.desc||f.nome||'',dadosJson:JSON.stringify(Object.fromEntries(Object.entries(f).filter(([k])=>k!=='id')))}));
      const abaSetup = setups.map(s => ({ id:s.id, maquina: s.maquina, produtoOrigem: s.produtoOrigem, produtoDestino: s.produtoDestino, minutos: s.minutos, dadosJson:JSON.stringify(Object.fromEntries(Object.entries(s).filter(([k])=>k!=='id'))) }));

      const wb = global.XLSX.utils.book_new();
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(abaMaquinas), 'Maquinas');
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(abaProdutos), 'Produtos');
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(abaInsumos), 'Insumos');
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(abaFicha), 'Ficha_Tecnica');
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(abaSetup), 'Setup');
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(registros.map(r => ({id:r.id,data:r.data||'',maquina:r.maquina||'',produto:r.produto||'',qntCaixas:r.qntCaixas||0,qntUnid:r.qntUnid||0,status:r.status||'',sortOrder:r.sortOrder??'',realizadoCaixas:r.realizadoCaixas||0,dadosJson:JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='id')))}))), 'Programacao');
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(apontamentos.map(a => ({id:a.id,registroId:a.registroId||'',data:a.data||'',qntCaixas:a.qntCaixas||0,qntUnid:a.qntUnid||0,observacao:a.observacao||'',horas:JSON.stringify(a.horas||{}),dadosJson:JSON.stringify(Object.fromEntries(Object.entries(a).filter(([k])=>k!=='id')))}))), 'Realizado');
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(funcionarios.map(x=>({id:x.id,nome:x.nome||'',dadosJson:JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k])=>k!=='id')))}))), 'Funcionarios');
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(estoqueInsumos.map(x=>({id:x.id,insumo:x.insumo||'',quantidade:x.quantidade??0,unidade:x.unidade||'',categoria:x.categoria||'',dadosJson:JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k])=>k!=='id')))}))), 'Estoque_Insumos');
      const abaProjecao = projecao.map(x => ({ ...x, dadosJson: JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'id'))) }));
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(abaProjecao), 'Projecao');
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(processos.map(x=>({id:x.id,nome:x.nome||x.descricao||'',data:x.data||'',dadosJson:JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k])=>k!=='id')))}))), 'Processos');
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(categorias.map(x=>({id:x.id,nome:x.nome||'',ordem:x.ordem??0,ativo:x.ativo!==false,dadosJson:JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k])=>k!=='id')))}))), 'Categorias');
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(configuracoes), 'Configuracoes');
      global.XLSX.writeFile(wb, 'producao_backup_completo.xlsx');
    } catch (e) {
      global.showToast?.('Erro ao exportar: ' + (e.message || e), 'error');
    }
  }

  async function importarProducaoTemplate(file) {
    if (!file) return;
    if (!global.XLSX) { global.showToast?.('Biblioteca do Excel não carregada.', 'error'); return; }
    try {
      global.showToast?.('Lendo e validando o arquivo de Produção...', 'info');
      const bytes = await file.arrayBuffer();
      const book = global.XLSX.read(bytes, { type: 'array', raw: false, cellText: true });
      const linhasMaquinas = _achaAba(book, 'maquina');
      const linhasProdutos = _achaAba(book, 'produto');
      const linhasInsumos = _achaAba(book, 'insumo');
      const linhasFichaFull = book.SheetNames.includes('Ficha_Tecnica') ? _lerLinhasInteligente(book.Sheets['Ficha_Tecnica']) : [];
      const linhasSetup = _achaAba(book, 'setup');
      const linhasProgramacao = _achaAba(book, 'programacao');
      const linhasRealizado = _achaAba(book, 'realizado');
      const linhasFuncionarios = _achaAba(book, 'funcionario');
      const linhasEstoqueInsumos = book.SheetNames.includes('Estoque_Insumos') ? _lerLinhasInteligente(book.Sheets['Estoque_Insumos']) : [];
      const linhasProjecao = _achaAba(book, 'projecao');
      const linhasProcessos = _achaAba(book, 'processo');
      const linhasCategorias = _achaAba(book, 'categoria');
      const linhasConfiguracoes = _achaAba(book, 'configur');

      // Aceita tanto o template de três linhas do sistema original quanto o
      // backup completo gerado por esta integração. Um backup válido precisa
      // ter ao menos uma das bases principais; assim o usuário recebe um erro
      // claro em vez de uma importação aparentemente silenciosa.
      if (!linhasMaquinas.length && !linhasProdutos.length && !linhasFichaFull.length) {
        throw new Error('Nenhuma máquina, produto ou ficha técnica reconhecida. Use o Excel exportado pela Produção.');
      }
      global.showToast?.(
        `Arquivo reconhecido: ${linhasMaquinas.length} máquina(s), ${linhasProdutos.length} produto(s), ${linhasFichaFull.length || new Set(linhasInsumos.map(r => String(r.cod_produto || '').trim()).filter(Boolean)).size} ficha(s) e ${linhasSetup.length} setup(s). Importando...`,
        'info'
      );

      const [snapMaq, snapProd, snapFicha, snapSetup, snapReg, snapApon, snapFunc, snapEst, snapProj, snapProc, snapCat, snapCfg] = await Promise.all([
        fs().collection(COL_MAQUINAS).get(), fs().collection(COL_PRODUTOS).get(), fs().collection(COL_FICHAS).get(), fs().collection(COL_SETUP).get(),
        fs().collection(COL_REGISTROS).get(), fs().collection(COL_APONTAMENTOS).get(), fs().collection(COL_FUNCIONARIOS).get(), fs().collection(COL_ESTOQUE_INSUMOS).get(), fs().collection(COL_PROJECAO).get(),
        fs().collection(COL_PROCESSOS).get().catch(()=>({docs:[]})), fs().collection(COL_CATEGORIAS).get().catch(()=>({docs:[]})), fs().collection(COL_CONFIG).get().catch(()=>({docs:[]})),
      ]);
      const maquinasExistentes = snapMaq.docs.map(d => ({ _id: d.id, ...d.data() }));
      const produtosExistentes = snapProd.docs.map(d => ({ _id: d.id, ...d.data() }));
      const fichasExistentes = snapFicha.docs.map(d => ({ _id: d.id, ...d.data() }));
      const setupsExistentes = snapSetup.docs.map(d => ({ _id: d.id, ...d.data() }));
      const agora = new Date().toISOString();
      let criados = 0, atualizados = 0;

      await _emLotes(linhasMaquinas, 40, async r => {
        const nome = String(r.nome || '').trim();
        if (!nome) return;
        // PEDIDO AO VIVO: nomes de coluna EXATOS do template real do original
        // (app.js:9468 hdrMaq / app.js:9638-9658 importarArquivoPadrao) —
        // 'undMin'→pcMin, 'setup'→setupPadraoMin, 'produtos' é lista separada
        // por vírgula (sem velocidade específica, igual ao original faz).
        const full=_dadosLinha(r);
        const listaProdutos=String(r.produtos??'').split(',').map(p=>p.trim()).filter(Boolean).map(p=>({produto:p,velocidade:null}));
        const payload = { ...full, nome,
          codigo: String(r.codigo ?? full.codigo ?? ''),
          tipo: String(r.tipo ?? full.tipo ?? ''),
          setor: String(r.setor ?? full.setor ?? ''),
          categoria: String(r.categoria ?? full.categoria ?? ''),
          status: String(r.status ?? full.status ?? 'ativa').toLowerCase(),
          pcMin: Number(r.undMin ?? r.pcMin ?? full.pcMin) || 0,
          eficiencia: Number(r.eficiencia ?? full.eficiencia) || 100,
          hTurno: Number(r.hTurno ?? full.hTurno) || 8,
          nTurnos: Number(r.nTurnos ?? full.nTurnos) || 1,
          setupPadraoMin: Number(r.setup ?? r.setupPadraoMin ?? full.setupPadraoMin) || 0,
          produtosCompativeis: listaProdutos.length ? listaProdutos : _json(r.produtosCompativeisJson, full.produtosCompativeis||[]),
          turnos:_json(r.turnosJson, full.turnos||{}), atualizadoEm: agora };
        payload.tempoSetupPadrao = payload.setupPadraoMin;
        const existente = maquinasExistentes.find(m => m.nome === nome); const id=String(r.id||'').trim();
        if (existente) { await fs().collection(COL_MAQUINAS).doc(existente._id).set(payload, { merge: true }); atualizados++; }
        else if(id){ await fs().collection(COL_MAQUINAS).doc(id).set({...payload,ativo:payload.ativo!==false,criadoEm:payload.criadoEm||agora},{merge:true}); criados++; }
        else { await fs().collection(COL_MAQUINAS).add({ ...payload, ativo: payload.ativo!==false, criadoEm: payload.criadoEm||agora }); criados++; }
      });

      // PEDIDO AO VIVO (2026-09-02): "vou subir pra cada loja, eu vou subir
      // um [arquivo]... vai levar a empresa produtora por onde ele for
      // cadastrado" — mesmo comportamento já combinado pro cadastro em
      // lote pelo catálogo (pftCatalogoCadastrarSelecionados): quem sobe o
      // Excel de dentro de uma loja específica, o produto nasce com essa
      // loja como empresa produtora, sem precisar escolher em nenhum
      // seletor. Busca a lista de lojas UMA vez fora do laço (não por
      // linha) — mesmo padrão de _carregarLojasProdutoras em
      // 60-producao-ficha-tecnica.js.
      const lojaAtivaId = global.getDTLojaAtiva?.() || '';
      const lojasDisponiveis = lojaAtivaId ? await (global.DTLoja?.listar?.(false) || Promise.resolve([])) : [];
      const lojaAtivaNome = lojasDisponiveis.find(l => String(l.id) === String(lojaAtivaId))?.nome || lojaAtivaId;

      await _emLotes(linhasProdutos, 40, async r => {
        const cod = String(r.cod || '').trim();
        if (!cod) return;
        // PEDIDO AO VIVO: original usa 'descricao' (não 'nome') e
        // 'alergênico' com acento (app.js:9479 hdrProd); 'status' é
        // ATIVO/DESATIVADO, vira o campo 'ativo' (booleano).
        const full=_dadosLinha(r);
        const statusCol = r.status ?? full.status;
        // Só estampa em produto novo (full.empresaProdutoraId ausente) —
        // nunca sobrescreve uma empresa produtora já definida manualmente
        // numa reimportação/atualização do mesmo produto.
        const empresaProdutoraId = full.empresaProdutoraId ?? lojaAtivaId;
        const empresaProdutoraNome = full.empresaProdutoraNome ?? (lojaAtivaId ? lojaAtivaNome : '');
        const payload = { ...full, cod, nome: String(r.descricao ?? r.nome ?? full.nome ?? ''), unid: Number(r.unid ?? full.unid) || 1, pc_min: Number(r.pc_min ?? full.pc_min) || 0, maquina: String(r.maquina ?? full.maquina ?? ''), categoria:String(r.categoria??full.categoria??''), classificacao:String(r.classificacao??full.classificacao??''), metaCoberturaDias:Number(r.coberturaDias??r.metaCoberturaDias??full.metaCoberturaDias??full.coberturaDias)||0, producaoMinima:Number(r.producaoMinima??full.producaoMinima)||0, multiploProducao:Number(r.multiploProducao??full.multiploProducao)||0, tipoMinimo:String(r.tipoMinimo??full.tipoMinimo??'').toLowerCase(), prioridadeProducao:Math.max(1,Number(r.prioridadeProducao??full.prioridadeProducao)||2), alergenico:String(r['alergênico']??r.alergenico??'').trim().toUpperCase()==='SIM'||r.alergenico===true||full.alergenico===true, ativo: statusCol!=null&&statusCol!=='' ? _parseAtivoStatus(statusCol) : (full.ativo!==false), empresaProdutoraId, empresaProdutoraNome, atualizadoEm: agora };
        const existente = produtosExistentes.find(p => String(p.cod) === cod); const id=String(r.id||'').trim();
        if (existente) { await fs().collection(COL_PRODUTOS).doc(existente._id).set(payload, { merge: true }); atualizados++; }
        else if(id){ await fs().collection(COL_PRODUTOS).doc(id).set({...payload,criadoEm:payload.criadoEm||agora},{merge:true}); criados++; }
        else { await fs().collection(COL_PRODUTOS).add({ ...payload, criadoEm: payload.criadoEm||agora }); criados++; }
      });

      const insumosPorCod = {};
      linhasInsumos.forEach(r => {
        // PEDIDO AO VIVO: original filtra por 'status' ATIVO/DESATIVADO
        // (app.js:9518-9522) — linha DESATIVADO não entra na ficha.
        if (!_parseAtivoStatus(r.status)) return;
        const cod = String(r.cod_produto || '').trim();
        if (!cod || !r.insumo) return;
        (insumosPorCod[cod] = insumosPorCod[cod] || []).push({ insumo: String(r.insumo), qty: Number(r.qty) || 0, categoria: String(r.categoria || '') });
      });
      // No backup completo, Ficha_Tecnica/dadosJson é a fonte integral e já
      // contém os insumos. Não grava a mesma ficha duas vezes. No template do
      // original (sem essa aba), recompõe normalmente a ficha pela aba Insumos.
      const codigosFichaCompleta = new Set(linhasFichaFull.map(r => String(r.cod || _dadosLinha(r).cod || '').trim()).filter(Boolean));
      await _emLotes(Object.keys(insumosPorCod).filter(cod => !codigosFichaCompleta.has(cod)), 40, async cod => {
        const produto = produtosExistentes.find(p => String(p.cod) === cod) || linhasProdutos.find(p => String(p.cod) === cod);
        const existente = fichasExistentes.find(f => String(f.cod) === cod);
        const payload = { cod, desc: produto?.nome || produto?.descricao || existente?.desc || '', unid: Number(produto?.unid) || existente?.unid || 1, pc_min: Number(produto?.pc_min) || existente?.pc_min || 0, maquina: produto?.maquina || existente?.maquina || '', insumos: insumosPorCod[cod], atualizadoEm: agora };
        if (existente) { await fs().collection(COL_FICHAS).doc(existente._id).set(payload, { merge: true }); atualizados++; }
        else { await fs().collection(COL_FICHAS).add({ ...payload, criadoEm: agora }); criados++; }
      });

      await _emLotes(linhasFichaFull, 40, async r => {
        const id=String(r.id||'').trim(), cod=String(r.cod||'').trim(), full=_dadosLinha(r); if(!id&&!cod)return;
        const existente=fichasExistentes.find(f=>(id&&f._id===id)||(cod&&String(f.cod)===cod));
        const payload={...full,cod:cod||full.cod||'',desc:String(r.desc||full.desc||full.nome||''),atualizadoEm:agora};
        if(existente) { await fs().collection(COL_FICHAS).doc(existente._id).set(payload,{merge:true}); atualizados++; }
        else if(id) { await fs().collection(COL_FICHAS).doc(id).set({...payload,criadoEm:payload.criadoEm||agora},{merge:true}); criados++; }
        else { await fs().collection(COL_FICHAS).add({...payload,criadoEm:payload.criadoEm||agora}); criados++; }
      });

      await _emLotes(linhasSetup, 50, async r => {
        // PEDIDO AO VIVO: original usa 'de'/'para' (app.js:9526 hdrSetup),
        // não 'produtoOrigem'/'produtoDestino'.
        const maquina = String(r.maquina || '').trim(), origem = String(r.de ?? r.produtoOrigem ?? '').trim(), destino = String(r.para ?? r.produtoDestino ?? '').trim();
        if (!maquina || !origem || !destino) return;
        const full=_dadosLinha(r), payload = { ...full, maquina, produtoOrigem: origem, produtoDestino: destino, minutos: Number(r.minutos ?? full.minutos) || 0, atualizadoEm: agora };
        const existente = setupsExistentes.find(s => s.maquina === maquina && s.produtoOrigem === origem && s.produtoDestino === destino), id=String(r.id||'').trim();
        if (existente) { await fs().collection(COL_SETUP).doc(existente._id).set(payload, { merge: true }); atualizados++; }
        else if(id){ await fs().collection(COL_SETUP).doc(id).set({...payload,criadoEm:payload.criadoEm||agora},{merge:true}); criados++; }
        else { await fs().collection(COL_SETUP).add({ ...payload, criadoEm: payload.criadoEm||agora }); criados++; }
      });

      // As abas abaixo fazem parte do backup completo V341. Quando presentes,
      // preservamos os IDs para manter os vínculos Programação ↔ Realizado.
      for (const r of linhasProgramacao) {
        const id = String(r.id || '').trim(); if (!id) continue;
        const full=_dadosLinha(r), payload = {...full,data:String(r.data||full.data||''),maquina:String(r.maquina||full.maquina||''),produto:String(r.produto||full.produto||''),qntCaixas:Number(r.qntCaixas??full.qntCaixas)||0,qntUnid:Number(r.qntUnid??full.qntUnid)||0,status:String(r.status||full.status||'programado'),sortOrder:r.sortOrder===''?(full.sortOrder??null):Number(r.sortOrder),realizadoCaixas:Number(r.realizadoCaixas??full.realizadoCaixas)||0,atualizadoEm:agora};
        await fs().collection(COL_REGISTROS).doc(id).set(payload,{merge:true}); atualizados++;
      }
      for (const r of linhasRealizado) {
        const id = String(r.id || '').trim(), registroId=String(r.registroId||'').trim(), data=String(r.data||'').slice(0,10); if(!id||!registroId||!data) continue;
        const full=_dadosLinha(r); let horas=full.horas||{}; try{horas=r.horas?JSON.parse(String(r.horas)):horas;}catch(e){}
        await fs().collection(COL_APONTAMENTOS).doc(id).set({...full,registroId,data,qntCaixas:Number(r.qntCaixas??full.qntCaixas)||0,qntUnid:Number(r.qntUnid??full.qntUnid)||0,observacao:String(r.observacao??full.observacao??''),horas,atualizadoEm:agora},{merge:true}); atualizados++;
      }
      for (const r of linhasFuncionarios) { const id=String(r.id||r._firestoreId||'').trim(); const payload={..._dadosLinha(r),...r,atualizadoEm:agora}; delete payload.id; delete payload._firestoreId; delete payload.dadosJson; if(id){await fs().collection(COL_FUNCIONARIOS).doc(id).set(payload,{merge:true});}else{await fs().collection(COL_FUNCIONARIOS).add(payload);} atualizados++; }
      for (const r of linhasEstoqueInsumos) { const nome=String(r.insumo||r.Insumo||'').trim(); if(!nome)continue; const ex=snapEst.docs.find(d=>String(d.data().insumo||'').toLowerCase()===nome.toLowerCase()); const full=_dadosLinha(r),payload={...full,insumo:nome,quantidade:Number(r.quantidade??r.Quantidade??full.quantidade)||0,unidade:String(r.unidade??r.Unidade??full.unidade??''),categoria:String(r.categoria??r.Categoria??full.categoria??''),atualizadoEm:agora}; if(ex)await fs().collection(COL_ESTOQUE_INSUMOS).doc(ex.id).set(payload,{merge:true});else await fs().collection(COL_ESTOQUE_INSUMOS).add(payload); atualizados++; }
      for (const r of linhasProjecao) { const id=String(r.id||r._firestoreId||'').trim(); const payload={..._dadosLinha(r),...r,atualizadoEm:agora}; delete payload.id; delete payload._firestoreId; delete payload.dadosJson; if(id)await fs().collection(COL_PROJECAO).doc(id).set(payload,{merge:true}); else await fs().collection(COL_PROJECAO).add(payload); atualizados++; }
      for (const r of linhasProcessos) { const id=String(r.id||r._id||'').trim(); const payload={..._dadosLinha(r),...r,atualizadoEm:agora}; delete payload.id; delete payload._id; delete payload.dadosJson; if(id)await fs().collection(COL_PROCESSOS).doc(id).set(payload,{merge:true}); else await fs().collection(COL_PROCESSOS).add(payload); atualizados++; }
      for (const r of linhasCategorias) { const id=String(r.id||r._id||'').trim(); const payload={..._dadosLinha(r),...r,atualizadoEm:agora}; delete payload.id; delete payload._id; delete payload.dadosJson; if(id)await fs().collection(COL_CATEGORIAS).doc(id).set(payload,{merge:true}); else await fs().collection(COL_CATEGORIAS).add(payload); atualizados++; }
      for (const r of linhasConfiguracoes) { const id=String(r.id||'').trim(); if(!id)continue; let payload={}; try{payload=JSON.parse(String(r.dados||'{}'));}catch(e){payload={};} payload.atualizadoEm=agora; await fs().collection(COL_CONFIG).doc(id).set(payload,{merge:true}); atualizados++; }

      global.showToast?.(criados + ' criado(s), ' + atualizados + ' atualizado(s). Nada foi apagado.', 'success');
      await global._desenharProducaoMaquinas?.();
      if (typeof global.renderProducaoMaquinas === 'function') global.renderProducaoMaquinas();
      return { ok:true, criados, atualizados };
    } catch (e) {
      global.showToast?.('Erro ao importar: ' + (e.message || e), 'error');
      console.error('[importarProducaoTemplate]', e);
      return { ok:false, erro:e };
    }
  }

  global.exportarProducaoTemplate = exportarProducaoTemplate;
  global.importarProducaoTemplate = importarProducaoTemplate;

  document.addEventListener('click', function (event) {
    const baixar = event.target.closest('[data-pexcel-template-baixar]');
    if (baixar) { exportarProducaoTemplate(); return; }
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'pexcel-template-input') {
      const file = event.target.files && event.target.files[0];
      importarProducaoTemplate(file);
      event.target.value = '';
    }
  });
})(window);
