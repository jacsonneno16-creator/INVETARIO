const fs=require('fs');
const negocio=fs.readFileSync('public/js/analista/10-inventarios-negocio.js','utf8');
const filtro=fs.readFileSync('public/js/analista/51-inventario-por-produto-v286.js','utf8');
const html=fs.readFileSync('public/analista.html','utf8');
function ok(cond,msg){if(!cond)throw new Error(msg);}
ok(negocio.includes('DTInventarioProdutoFiltro?.aplicar'),'criação não aplica filtro por produto');
ok(negocio.includes('base:                 baseInventario'),'inventário não persiste a base filtrada');
ok(negocio.includes('produtos_selecionados'),'inventário não persiste produtos selecionados');
ok(filtro.includes('Inventário geral')&&filtro.includes('Por produto'),'seletor de modo ausente');
ok(filtro.includes('Buscar por nome, código, GTIN ou DUN'),'busca de produto ausente');
ok(filtro.includes('Nenhum registro da base importada corresponde')===false,'mensagem pertence ao negócio, não ao filtro');
ok(html.includes('51-inventario-por-produto-v286.js'),'script não incluído no analista');
console.log('OK v286 inventário por produto');
