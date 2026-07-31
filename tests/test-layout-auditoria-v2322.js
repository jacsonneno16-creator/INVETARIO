const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('public/analista.html', 'utf8');
const render = fs.readFileSync('public/js/analista/38-auditoria-operacional-v22.js', 'utf8');

const tabela = html.match(/<div class="tbl-wrap auditoria-tbl-wrap">([\s\S]*?)<div id="auditoria-paginacao"/);
assert(tabela, 'Tabela operacional da Auditoria não encontrada');
assert(!tabela[1].includes('<colgroup>'), 'Layout rígido com colgroup voltou à tabela');
assert(tabela[1].includes('class="auditoria-tabela"'), 'Classe isolada da tabela ausente');
assert(html.includes('.auditoria-tabela th,.auditoria-tabela td{display:table-cell!important'), 'Proteção de células ausente');
assert(html.includes('.auditoria-tabela tbody tr{display:table-row!important}'), 'Proteção de linhas ausente');

const linha = render.match(/pagina\.map\(i => `<tr>([\s\S]*?)<\/tr>`\)/);
assert(linha, 'Renderização de linha da Auditoria não encontrada');
assert.strictEqual((linha[1].match(/<td/g) || []).length, 8, 'Cada linha deve possuir exatamente 8 células');

assert(html.includes('v232.2 · 20260731.3'), 'Identificação do build incorreta');
assert(html.includes("serviceWorker.register('/sw.js?v=20260731-2322')"), 'Service Worker sem cache-busting do build');
console.log('OK layout Auditoria v232.2: estrutura automática e 8 colunas preservadas.');
