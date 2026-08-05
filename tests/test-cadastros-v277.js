const fs=require('fs');
const html=fs.readFileSync('public/analista.html','utf8');
const js=fs.readFileSync('public/js/analista/51-cadastros-v277.js','utf8');
const prod=fs.readFileSync('public/js/analista/39-base-produtos.js','utf8');
function ok(c,m){if(!c)throw new Error(m)}
ok(html.includes('51-cadastros-v277.js'),'script v277 ausente');
ok(html.includes('analista-cadastros-v277.css'),'css v277 ausente');
ok(js.includes('Itens por página'),'paginacao ausente');
ok(js.includes('data-prod-page'),'paginacao de produtos ausente');
ok(js.includes('data-end-page'),'paginacao de enderecos ausente');
ok(js.includes('Contabiliza no inventário'),'classificacao de endereco ausente');
ok(js.includes('Permite múltiplos operadores'),'multioperador ausente');
ok(prod.includes('tipoProduto'),'tipo de produto ausente');
ok(prod.includes('fatorCaixa'),'fator caixa ausente');
console.log('OK v277');
