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

  function fs() { return global.getDTFirestore(); }

  function _achaAba(book, pedacoNome) {
    const nome = book.SheetNames.find(n => n.toLowerCase().includes(pedacoNome));
    return nome ? global.XLSX.utils.sheet_to_json(book.Sheets[nome], { defval: '' }) : [];
  }

  async function exportarProducaoTemplate() {
    try {
      const [snapMaq, snapProd, snapFicha, snapSetup] = await Promise.all([
        fs().collection(COL_MAQUINAS).get(),
        fs().collection(COL_PRODUTOS).get(),
        fs().collection(COL_FICHAS).get(),
        fs().collection(COL_SETUP).get(),
      ]);
      const maquinas = snapMaq.docs.map(d => d.data());
      const produtos = snapProd.docs.map(d => d.data());
      const fichas = snapFicha.docs.map(d => d.data());
      const setups = snapSetup.docs.map(d => d.data());

      const abaMaquinas = maquinas.map(m => ({ nome: m.nome, categoria: m.categoria || '', status: m.status || 'ativa', eficiencia: m.eficiencia ?? 100, setupPadraoMin: m.setupPadraoMin ?? 0, produtos: (m.produtosCompativeis || []).map(p => p.produto).join(', ') }));
      const abaProdutos = produtos.map(p => ({ cod: p.cod, nome: p.nome, unid: p.unid ?? 1, pc_min: p.pc_min ?? 0, maquina: p.maquina || '' }));
      const abaInsumos = [];
      fichas.forEach(f => (f.insumos || []).forEach(i => abaInsumos.push({ cod_produto: f.cod, desc_produto: f.desc, insumo: i.insumo, qty: i.qty, categoria: i.categoria || '' })));
      const abaSetup = setups.map(s => ({ maquina: s.maquina, produtoOrigem: s.produtoOrigem, produtoDestino: s.produtoDestino, minutos: s.minutos }));

      const wb = global.XLSX.utils.book_new();
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(abaMaquinas), 'Maquinas');
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(abaProdutos), 'Produtos');
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(abaInsumos), 'Insumos');
      global.XLSX.utils.book_append_sheet(wb, global.XLSX.utils.json_to_sheet(abaSetup), 'Setup');
      global.XLSX.writeFile(wb, 'producao_template.xlsx');
    } catch (e) {
      global.showToast?.('Erro ao exportar: ' + (e.message || e), 'error');
    }
  }

  async function importarProducaoTemplate(file) {
    if (!file) return;
    if (!global.XLSX) { global.showToast?.('Biblioteca do Excel não carregada.', 'error'); return; }
    try {
      const bytes = await file.arrayBuffer();
      const book = global.XLSX.read(bytes, { type: 'array', raw: false, cellText: true });
      const linhasMaquinas = _achaAba(book, 'maquina');
      const linhasProdutos = _achaAba(book, 'produto');
      const linhasInsumos = _achaAba(book, 'insumo');
      const linhasSetup = _achaAba(book, 'setup');

      const [snapMaq, snapProd, snapFicha, snapSetup] = await Promise.all([
        fs().collection(COL_MAQUINAS).get(),
        fs().collection(COL_PRODUTOS).get(),
        fs().collection(COL_FICHAS).get(),
        fs().collection(COL_SETUP).get(),
      ]);
      const maquinasExistentes = snapMaq.docs.map(d => ({ _id: d.id, ...d.data() }));
      const produtosExistentes = snapProd.docs.map(d => ({ _id: d.id, ...d.data() }));
      const fichasExistentes = snapFicha.docs.map(d => ({ _id: d.id, ...d.data() }));
      const setupsExistentes = snapSetup.docs.map(d => ({ _id: d.id, ...d.data() }));
      const agora = new Date().toISOString();
      let criados = 0, atualizados = 0;

      for (const r of linhasMaquinas) {
        const nome = String(r.nome || '').trim();
        if (!nome) continue;
        const payload = { nome, categoria: String(r.categoria || ''), status: String(r.status || 'ativa'), eficiencia: Number(r.eficiencia) || 100, setupPadraoMin: Number(r.setupPadraoMin) || 0, atualizadoEm: agora };
        const existente = maquinasExistentes.find(m => m.nome === nome);
        if (existente) { await fs().collection(COL_MAQUINAS).doc(existente._id).set(payload, { merge: true }); atualizados++; }
        else { await fs().collection(COL_MAQUINAS).add({ ...payload, ativo: true, produtosCompativeis: [], turnos: {}, criadoEm: agora }); criados++; }
      }

      for (const r of linhasProdutos) {
        const cod = String(r.cod || '').trim();
        if (!cod) continue;
        const payload = { cod, nome: String(r.nome || ''), unid: Number(r.unid) || 1, pc_min: Number(r.pc_min) || 0, maquina: String(r.maquina || ''), atualizadoEm: agora };
        const existente = produtosExistentes.find(p => String(p.cod) === cod);
        if (existente) { await fs().collection(COL_PRODUTOS).doc(existente._id).set(payload, { merge: true }); atualizados++; }
        else { await fs().collection(COL_PRODUTOS).add({ ...payload, ativo: true, criadoEm: agora }); criados++; }
      }

      const insumosPorCod = {};
      linhasInsumos.forEach(r => {
        const cod = String(r.cod_produto || '').trim();
        if (!cod || !r.insumo) return;
        (insumosPorCod[cod] = insumosPorCod[cod] || []).push({ insumo: String(r.insumo), qty: Number(r.qty) || 0, categoria: String(r.categoria || '') });
      });
      for (const cod of Object.keys(insumosPorCod)) {
        const produto = produtosExistentes.find(p => String(p.cod) === cod) || linhasProdutos.find(p => String(p.cod) === cod);
        const existente = fichasExistentes.find(f => String(f.cod) === cod);
        const payload = { cod, desc: produto?.nome || existente?.desc || '', unid: Number(produto?.unid) || existente?.unid || 1, pc_min: Number(produto?.pc_min) || existente?.pc_min || 0, maquina: produto?.maquina || existente?.maquina || '', insumos: insumosPorCod[cod], atualizadoEm: agora };
        if (existente) { await fs().collection(COL_FICHAS).doc(existente._id).set(payload, { merge: true }); atualizados++; }
        else { await fs().collection(COL_FICHAS).add({ ...payload, criadoEm: agora }); criados++; }
      }

      for (const r of linhasSetup) {
        const maquina = String(r.maquina || '').trim(), origem = String(r.produtoOrigem || '').trim(), destino = String(r.produtoDestino || '').trim();
        if (!maquina || !origem || !destino) continue;
        const payload = { maquina, produtoOrigem: origem, produtoDestino: destino, minutos: Number(r.minutos) || 0, atualizadoEm: agora };
        const existente = setupsExistentes.find(s => s.maquina === maquina && s.produtoOrigem === origem && s.produtoDestino === destino);
        if (existente) { await fs().collection(COL_SETUP).doc(existente._id).set(payload, { merge: true }); atualizados++; }
        else { await fs().collection(COL_SETUP).add({ ...payload, criadoEm: agora }); criados++; }
      }

      global.showToast?.(criados + ' criado(s), ' + atualizados + ' atualizado(s). Nada foi apagado.', 'success');
      await global._desenharProducaoMaquinas?.();
      if (typeof global.renderProducaoMaquinas === 'function') global.renderProducaoMaquinas();
    } catch (e) {
      global.showToast?.('Erro ao importar: ' + (e.message || e), 'error');
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
