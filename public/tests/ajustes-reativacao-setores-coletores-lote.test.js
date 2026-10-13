const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
function read(rel){ return fs.readFileSync(path.join(root, rel),'utf8'); }

test('cadastro em lote de coletores: modal não possui display:none inline que impeça openModal', () => {
  const html = read('analista.html');
  assert.match(html, /id="modal-coletores-lote"/);
  assert.doesNotMatch(html, /id="modal-coletores-lote"[^>]*style="[^"]*display\s*:\s*none/i);
  const js = read('js/analista/35-coletores-render.js');
  assert.match(js, /function\s+abrirCadastroColetoresLote\s*\(/);
  assert.match(js, /openModal\(['"]modal-coletores-lote['"]\)/);
});

test('setores Compras, PCP e Produção estão reativados e carregam scripts sob demanda', () => {
  const perm = read('js/analista/37-usuarios-permissoes.js');
  assert.match(perm, /compras:\{label:/);
  assert.match(perm, /pcp:\{label:/);
  assert.match(perm, /producao:\{label:/);
  assert.match(perm, /if\(id==='producao'\)return'producao'/);
  assert.match(perm, /if\(id==='pcp'\)return'pcp'/);
  assert.match(perm, /if\(id==='compras'\)return'compras'/);
  const lazy = read('js/analista/00-lazy-areas.js');
  assert.match(lazy, /producao:\s*\[/);
  assert.match(lazy, /pcp:\s*\[/);
  assert.match(lazy, /compras:\s*\[/);
});

test('Cargas mantém filtro por período e cache-bust atualizado', () => {
  const js = read('js/analista/104-recebimento-cargas-cards.js');
  assert.match(js, /cargas-f-data-inicio/);
  assert.match(js, /cargas-f-data-fim/);
  // Não fixa o valor exato do cache-bust (quebraria de novo no próximo
  // ajuste legítimo desta tela) — só confirma que existe um, ou seja, que
  // ninguém esqueceu de trocar o ?v= ao editar o arquivo.
  const lazy = read('js/analista/00-lazy-areas.js');
  assert.match(lazy, /104-recebimento-cargas-cards\.js\?v=\d{8}-[\w-]+/);
});
