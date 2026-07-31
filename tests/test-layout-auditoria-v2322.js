const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('public/analista.html', 'utf8');
const render = fs.readFileSync('public/js/analista/38-auditoria-operacional-v22.js', 'utf8');

const tabela = html.match(/<div class="tbl-wrap auditoria-tbl-wrap">([\s\S]*?)<div id="auditoria-paginacao"/);
assert(tabela, 'Tabela operacional da Auditoria não encontrada');
assert(tabela[1].includes('<colgroup><col><col><col><col><col><col><col><col></colgroup>'), 'As oito larguras da Auditoria não estão definidas');
assert(tabela[1].includes('class="auditoria-tabela"'), 'Classe isolada da tabela ausente');
assert(html.includes('.auditoria-tabela th,.auditoria-tabela td{display:table-cell!important'), 'Proteção de células ausente');
assert(html.includes('.auditoria-tabela tbody tr{display:table-row!important}'), 'Proteção de linhas ausente');

assert(render.includes('const COLUNAS_AUDITORIA = ['), 'Mapa explícito de colunas ausente');
const mapa=render.match(/const COLUNAS_AUDITORIA = \[([\s\S]*?)\n  \];/);
assert(mapa, 'Mapa de colunas não encontrado');
assert.strictEqual((mapa[1].match(/\{chave:/g)||[]).length,8,'O mapa deve possuir exatamente 8 colunas');
['endereco','dunEsperado','produtoEsperado','dunLido','produtoLido','status','operadorNome','lidoEm'].forEach(chave=>assert(mapa[1].includes("chave:'"+chave+"'"),'Coluna ausente: '+chave));
assert(render.includes("td.dataset.coluna=coluna.chave"),'Células não identificam sua coluna');
assert(render.includes("tr.appendChild(td)"),'Células não são anexadas individualmente à linha');
assert(render.includes("tbody.replaceChildren(fragmento)"),'Tabela ainda não usa montagem DOM segura');

assert(html.includes('v234 · 20260731.1'), 'Identificação do build incorreta');
assert(html.includes("serviceWorker.register('/sw.js?v=20260731-234-auditoria')"), 'Service Worker sem cache-busting do build');
console.log('OK layout Auditoria v234: mapa detalhado e 8 colunas DOM preservadas.');
