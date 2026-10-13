// Bug ao vivo real (2026-10-07): a BlueSoft recusava o arquivo de endereçamento
// ("Erro recebendo arquivo de dados - Linha 2: A coluna endereço logístico é
// obrigatória no CSV") porque o arquivo era gravado com marca BOM (\uFEFF) no
// início. O parser da BlueSoft não reconhece BOM: o nome da 1ª coluna chegava
// como "\uFEFFendereco_logistico", diferente do esperado por ela. Os dados
// desse arquivo (endereço, GTIN, quantidade, lote, validade, palete) não têm
// acento, então o BOM nunca fez falta aqui — só atrapalhava a BlueSoft.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../js/analista/43-importar-exportar-api.js'), 'utf8');

test('exportação para a BlueSoft (bluesoft_enderecamento): o conteúdo do arquivo não começa com BOM', () => {
  const i = src.indexOf("var conteudo = ");
  assert.ok(i >= 0, 'linha de montagem do conteúdo não encontrada');
  const trecho = src.slice(i, i + 200);
  assert.doesNotMatch(trecho, /var conteudo = '\\uFEFF'/);
  assert.match(trecho, /var conteudo = headers\.join\(';'\)/);
});

test('o exportador genérico de relatórios (Excel) continua com BOM — não é o mesmo arquivo da BlueSoft', () => {
  assert.match(src, /return '\\uFEFF' \+ headers\.map\(csvEscape\)/);
});
