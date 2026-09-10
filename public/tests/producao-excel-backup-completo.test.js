const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function colecao(nome, gravados) {
  return {
    get: async () => ({ docs: [] }),
    doc: id => ({ set: async payload => gravados.push({ nome, id, payload }) }),
    add: async payload => gravados.push({ nome, id: '', payload }),
  };
}

test('restaura o backup completo exportado pela própria Produção', async () => {
  const gravados = [];
  const avisos = [];
  const ctx = { console, Date, Promise, Set, ArrayBuffer, Uint8Array };
  ctx.window = ctx;
  ctx.document = { addEventListener() {} };
  ctx.showToast = (texto, tipo) => avisos.push({ texto, tipo });
  ctx.getDTFirestore = () => ({ collection: nome => colecao(nome, gravados) });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'vendor/xlsx-0.18.5/xlsx.full.min.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/analista/71-producao-excel.js'), 'utf8'), ctx);

  const wb = ctx.XLSX.utils.book_new();
  ctx.XLSX.utils.book_append_sheet(wb, ctx.XLSX.utils.json_to_sheet([{
    id: 'maq-1', nome: 'MAQ 1', categoria: '', status: 'ativa', eficiencia: 95,
    setupPadraoMin: 8, produtos: 'PRODUTO A', produtosCompativeisJson: '[]',
    turnosJson: '{}', dadosJson: JSON.stringify({ codigo: 'M1', hTurno: 9 }),
  }]), 'Maquinas');
  ctx.XLSX.utils.book_append_sheet(wb, ctx.XLSX.utils.json_to_sheet([{
    id: 'prod-1', cod: '00123', nome: 'PRODUTO A - CX 12', unid: 12, pc_min: 20,
    maquina: 'MAQ 1', categoria: 'Produto acabado', dadosJson: JSON.stringify({ ativo: true }),
  }]), 'Produtos');
  ctx.XLSX.utils.book_append_sheet(wb, ctx.XLSX.utils.json_to_sheet([{
    cod_produto: '00123', desc_produto: 'PRODUTO A - CX 12', insumo: 'MP A', qty: 2, categoria: 'MATERIA PRIMA',
  }]), 'Insumos');
  ctx.XLSX.utils.book_append_sheet(wb, ctx.XLSX.utils.json_to_sheet([{
    id: 'ficha-1', cod: '00123', desc: 'PRODUTO A - CX 12',
    dadosJson: JSON.stringify({ insumos: [{ insumo: 'MP A', qty: 2 }], maquina: 'MAQ 1' }),
  }]), 'Ficha_Tecnica');
  ctx.XLSX.utils.book_append_sheet(wb, ctx.XLSX.utils.json_to_sheet([{
    id: 'setup-1', maquina: 'MAQ 1', produtoOrigem: 'PRODUTO A', produtoDestino: 'PRODUTO B', minutos: 10,
    dadosJson: '{}',
  }]), 'Setup');
  const bytes = ctx.XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const resultado = await ctx.importarProducaoTemplate({ arrayBuffer: async () => bytes });

  assert.equal(resultado.ok, true);
  assert.equal(gravados.filter(x => x.nome === 'producao_maquinas').length, 1);
  assert.equal(gravados.filter(x => x.nome === 'producao_produtos').length, 1);
  assert.equal(gravados.filter(x => x.nome === 'producao_ficha_tecnica').length, 1, 'a ficha integral não deve ser gravada de novo pela aba Insumos');
  assert.equal(gravados.filter(x => x.nome === 'producao_setup').length, 1);
  assert.equal(gravados.find(x => x.nome === 'producao_produtos').payload.nome, 'PRODUTO A - CX 12');
  assert.deepEqual(JSON.parse(JSON.stringify(gravados.find(x => x.nome === 'producao_ficha_tecnica').payload.insumos)), [{ insumo: 'MP A', qty: 2 }]);
  assert.ok(avisos.some(x => /Arquivo reconhecido: 1 máquina\(s\), 1 produto\(s\), 1 ficha\(s\) e 1 setup\(s\)/.test(x.texto)));
});

// PEDIDO AO VIVO (2026-09-02): "vou subir pra cada loja, eu vou subir um
// [arquivo]... vai levar a empresa produtora por onde ele for cadastrado" —
// mesma regra já combinada pro cadastro em lote pelo catálogo: quem sobe o
// Excel de dentro de uma loja específica, o produto novo nasce com essa
// loja como empresa produtora, sem precisar escolher em nenhum seletor.
test('importarProducaoTemplate: produto novo ganha empresaProdutoraId/Nome da loja ativa no momento do import', async () => {
  const gravados = [];
  const ctx = { console, Date, Promise, Set, ArrayBuffer, Uint8Array };
  ctx.window = ctx;
  ctx.document = { addEventListener() {} };
  ctx.showToast = () => {};
  ctx.getDTFirestore = () => ({ collection: nome => colecao(nome, gravados) });
  ctx.getDTLojaAtiva = () => 'loja_filial';
  ctx.DTLoja = { listar: async () => [{ id: 'loja_filial', nome: 'DA TERRINHA - FILIAL SP' }] };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'vendor/xlsx-0.18.5/xlsx.full.min.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/analista/71-producao-excel.js'), 'utf8'), ctx);

  const wb = ctx.XLSX.utils.book_new();
  ctx.XLSX.utils.book_append_sheet(wb, ctx.XLSX.utils.json_to_sheet([
    { cod: '555', descricao: 'PRODUTO NOVO', unid: 12, pc_min: 20, maquina: 'MAQ 1' },
  ]), 'Produtos');
  const bytes = ctx.XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  await ctx.importarProducaoTemplate({ arrayBuffer: async () => bytes });

  const produto = gravados.find(x => x.nome === 'producao_produtos').payload;
  assert.equal(produto.empresaProdutoraId, 'loja_filial');
  assert.equal(produto.empresaProdutoraNome, 'DA TERRINHA - FILIAL SP');
});

test('importarProducaoTemplate: sem loja ativa, não inventa empresa produtora (fica vazio, não quebra)', async () => {
  const gravados = [];
  const ctx = { console, Date, Promise, Set, ArrayBuffer, Uint8Array };
  ctx.window = ctx;
  ctx.document = { addEventListener() {} };
  ctx.showToast = () => {};
  ctx.getDTFirestore = () => ({ collection: nome => colecao(nome, gravados) });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'vendor/xlsx-0.18.5/xlsx.full.min.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/analista/71-producao-excel.js'), 'utf8'), ctx);

  const wb = ctx.XLSX.utils.book_new();
  ctx.XLSX.utils.book_append_sheet(wb, ctx.XLSX.utils.json_to_sheet([
    { cod: '555', descricao: 'PRODUTO NOVO', unid: 12, pc_min: 20, maquina: 'MAQ 1' },
  ]), 'Produtos');
  const bytes = ctx.XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  await ctx.importarProducaoTemplate({ arrayBuffer: async () => bytes });

  const produto = gravados.find(x => x.nome === 'producao_produtos').payload;
  assert.equal(produto.empresaProdutoraId, '');
});
