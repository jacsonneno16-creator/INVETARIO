'use strict';
// Migração única (rodar manualmente, não é automático): junta os 6
// cadastros fragmentados de produto (producao_produtos, pcp_produtos_
// bluesoft, producao_ficha_tecnica, compras_fornecedor_produtos — todos
// por loja/global espalhados — e bi_classificacao_produtos, a classificação
// real da Bluesoft) numa coleção global única, produtos_mestre/{cod}. Ver
// plano em C:\Users\Daterrinha69\.claude\plans\structured-sprouting-hoare.md
// ("Cadastro Único de Produtos"). Modelo de scripts/exportar-categorias-
// produtos.js (mesma credencial, mesmo admin.initializeApp).
//
// Uso:
//   node scripts/migrar-produtos-mestre.js              # dry-run (só relatório)
//   node scripts/migrar-produtos-mestre.js --write       # grava de verdade
//   node scripts/migrar-produtos-mestre.js --write --relatorio=caminho.csv
const path = require('node:path');
const fs = require('node:fs');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const { escolherCategoria, mesclarRegistrosPorCodigo, escolherFichaTecnica, decidirAtivo } = require('./produtos-mestre-merge');

const SERVICE_ACCOUNT = 'C:/Users/Daterrinha69/Downloads/daterrinha-inventario-firebase-adminsdk-fbsvc-f8aa5c734e.json';
const GRAVAR = process.argv.includes('--write');
const argRelatorio = process.argv.find(a => a.startsWith('--relatorio='));
const RELATORIO = argRelatorio ? argRelatorio.split('=')[1] : 'C:/Users/Daterrinha69/OneDrive - daterrinhaalimentos.com.br/Área de Trabalho/migracao-produtos-mestre-conflitos.csv';
// PEDIDO AO VIVO (2026-09-25): planilha que o usuário revisou à mão a
// partir do export de scripts/exportar-categorias-produtos.js — 1.256
// produtos com categoria "Categoria correta" preenchida (prioridade MÁXIMA,
// ver escolherCategoria em produtos-mestre-merge.js), e os que ele TIROU da
// planilha (não estão mais nela) viram inativos — decisão confirmada com
// ele: "os que eu tirei, marca como inativo".
const CSV_CATEGORIAS_REVISADAS = 'C:/Users/Daterrinha69/OneDrive - daterrinhaalimentos.com.br/Área de Trabalho/produtos-categorias.csv';

function lerCategoriasRevisadas() {
  const categoriaPorCodigo = new Map();
  if (!fs.existsSync(CSV_CATEGORIAS_REVISADAS)) return categoriaPorCodigo;
  let txt = fs.readFileSync(CSV_CATEGORIAS_REVISADAS, 'utf8');
  if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
  const linhas = txt.split(/\r\n|\n/).filter(l => l.trim());
  linhas.slice(1).forEach(linha => {
    const colunas = linha.split(';');
    const cod = String(colunas[0] || '').trim();
    const categoria = String(colunas[3] || '').trim();
    if (cod && categoria) categoriaPorCodigo.set(cod, categoria);
  });
  return categoriaPorCodigo;
}

async function main() {
  admin.initializeApp({ credential: admin.credential.cert(require(SERVICE_ACCOUNT)) });
  const db = admin.firestore();

  console.log(GRAVAR ? '=== MODO GRAVAÇÃO (--write) ===' : '=== MODO DRY-RUN (sem --write, nada será gravado) ===');

  // 0) Categorias revisadas à mão (planilha do usuário) — quem SUMIU da
  // planilha em relação ao universo completo de códigos vira inativo.
  const categoriaRevisadaPorCodigo = lerCategoriasRevisadas();
  console.log('Categorias revisadas à mão carregadas da planilha:', categoriaRevisadaPorCodigo.size, categoriaRevisadaPorCodigo.size ? '(' + CSV_CATEGORIAS_REVISADAS + ')' : '(planilha não encontrada — seguindo sem essa etapa)');

  // 1) Classificação real da Bluesoft, por produtoKey.
  const biClassSnap = await db.collection('bi_classificacao_produtos').get();
  const bluesoftPorCodigo = new Map();
  biClassSnap.docs.forEach(d => { const x = d.data(); if (x && x.produtoKey) bluesoftPorCodigo.set(String(x.produtoKey), x); });
  console.log('bi_classificacao_produtos:', bluesoftPorCodigo.size, 'produtos classificados pela Bluesoft.');

  // 2) producao_produtos + pcp_produtos_bluesoft, todas as lojas.
  const lojasSnap = await db.collection('lojas').get();
  const registrosPorCodigo = new Map();
  for (const lojaDoc of lojasSnap.docs) {
    for (const colecao of ['producao_produtos', 'pcp_produtos_bluesoft']) {
      const snap = await lojaDoc.ref.collection(colecao).get();
      snap.docs.forEach(doc => {
        const x = doc.data();
        const cod = String(x.cod || '').trim();
        if (!cod) return;
        if (!registrosPorCodigo.has(cod)) registrosPorCodigo.set(cod, []);
        registrosPorCodigo.get(cod).push(x);
      });
    }
  }
  console.log('Códigos únicos encontrados em producao_produtos/pcp_produtos_bluesoft:', registrosPorCodigo.size);

  // 3) producao_ficha_tecnica, todas as lojas — insumos/pc_min.
  const fichasPorCodigo = new Map();
  for (const lojaDoc of lojasSnap.docs) {
    const snap = await lojaDoc.ref.collection('producao_ficha_tecnica').get();
    snap.docs.forEach(doc => {
      const x = doc.data();
      const cod = String(x.cod || x.codigo || x.produtoCod || '').trim();
      if (!cod) return;
      if (!fichasPorCodigo.has(cod)) fichasPorCodigo.set(cod, []);
      fichasPorCodigo.get(cod).push(x);
    });
  }

  // 4) compras_fornecedor_produtos — fornecedor homologado/padrão por produto.
  const fornecedorPadraoPorProduto = new Map();
  const vinculosSnap = await db.collection('compras_fornecedor_produtos').get();
  vinculosSnap.docs.forEach(d => {
    const x = d.data();
    const produtoId = String(x.produtoId || '').trim();
    if (!produtoId || !x.homologado) return;
    const atual = fornecedorPadraoPorProduto.get(produtoId);
    if (!atual || (x.ultimaCompraEm || '') > (atual.ultimaCompraEm || '')) fornecedorPadraoPorProduto.set(produtoId, x);
  });

  // Merge final por código.
  const conflitosFicha = [];
  const semMatchBluesoft = [];
  const desativadosPorRevisao = [];
  const documentos = [];
  registrosPorCodigo.forEach((registros, cod) => {
    const base = mesclarRegistrosPorCodigo(registros);
    const { categoria, origem } = escolherCategoria({
      categoriaRevisada: categoriaRevisadaPorCodigo.get(cod) || '',
      categoriaBluesoft: bluesoftPorCodigo.get(cod)?.grupo || bluesoftPorCodigo.get(cod)?.secao || bluesoftPorCodigo.get(cod)?.departamento || '',
      categoriaManualExistente: base.categoriaExistente,
      nome: base.nome,
    });
    if (origem !== 'bluesoft' && origem !== 'revisado-2026-09-25') semMatchBluesoft.push(cod);

    const { ficha, conflito } = escolherFichaTecnica(fichasPorCodigo.get(cod) || []);
    if (conflito) conflitosFicha.push(cod);

    const fornecedor = fornecedorPadraoPorProduto.get(cod);
    const bluesoftCls = bluesoftPorCodigo.get(cod);

    const ativo = decidirAtivo({
      ativoExistente: base.ativo,
      codigoRevisado: categoriaRevisadaPorCodigo.has(cod),
      planilhaCarregada: categoriaRevisadaPorCodigo.size > 0,
    });
    if (categoriaRevisadaPorCodigo.size && !ativo) desativadosPorRevisao.push(cod);

    documentos.push({
      cod,
      nome: base.nome,
      unidade: base.unidade,
      gtin: base.gtin,
      ativo,
      tipoProduto: base.tipoProduto,
      categoria,
      categoriaOrigem: origem,
      classificacao: base.classificacao,
      departamentoBluesoft: bluesoftCls?.departamento || '',
      secaoBluesoft: bluesoftCls?.secao || '',
      grupoBluesoft: bluesoftCls?.grupo || '',
      pc_min: ficha?.pc_min ?? null,
      insumosCount: (ficha?.insumos || []).length,
      fornecedorPadraoId: fornecedor?.fornecedorId || '',
      atualizadoEm: new Date().toISOString(),
      origemMigracao: 'migrar-produtos-mestre.js',
    });
  });

  console.log('Produtos com categoria revisada à mão aplicada:', documentos.filter(d => d.categoriaOrigem === 'revisado-2026-09-25').length);
  console.log('Produtos sem match na classificação Bluesoft (caem no fallback manual/nome):', semMatchBluesoft.length, 'de', documentos.length);
  console.log('Fichas técnicas com BOM divergente entre lojas pro mesmo código:', conflitosFicha.length);
  console.log('Produtos marcados INATIVO por terem sido removidos da planilha revisada:', desativadosPorRevisao.length);

  // Relatório CSV de conflitos (mesma convenção do script anterior).
  const linhasCsv = ['Código;Nome;Categoria;Origem da categoria;Ficha técnica com conflito entre lojas?'];
  documentos.forEach(d => {
    linhasCsv.push(`${d.cod};${String(d.nome).replace(/;/g, ',')};${d.categoria};${d.categoriaOrigem};${conflitosFicha.includes(d.cod) ? 'SIM' : ''}`);
  });
  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, '\uFEFF' + linhasCsv.join('\r\n'), 'utf8');
  console.log('Relatório gravado em:', RELATORIO);

  if (!GRAVAR) {
    console.log('\nDry-run concluído — nada foi gravado. Rode de novo com --write pra gravar em produtos_mestre.');
    process.exit(0);
  }

  const col = db.collection('produtos_mestre');
  let gravados = 0;
  for (let i = 0; i < documentos.length; i += 350) {
    const lote = documentos.slice(i, i + 350);
    const batch = db.batch();
    lote.forEach(doc => batch.set(col.doc(doc.cod), doc, { merge: true }));
    await batch.commit();
    gravados += lote.length;
    console.log('Gravados', gravados, '/', documentos.length);
  }
  console.log('Migração concluída:', gravados, 'produtos gravados em produtos_mestre.');
  process.exit(0);
}

main().catch(e => { console.error('ERRO:', e); process.exit(1); });
