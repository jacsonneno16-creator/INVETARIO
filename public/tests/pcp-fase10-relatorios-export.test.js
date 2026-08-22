const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const base=path.join(__dirname,'../js/analista');
const code=fs.readFileSync(path.join(base,'88-pcp-relatorios.js'),'utf8');
const htmlCode=fs.readFileSync(path.join(__dirname,'../analista.html'),'utf8');

test('Relatórios do PCP cobrem os 7 relatórios pedidos',()=>{
  for(const id of ['necessidade','demandas','ruptura','cobertura','estoque-projetado','compras','variacao-preco']){
    assert.match(code,new RegExp(`'${id}'`));
  }
});

test('Exportação reaproveita o padrão XLSX/PDF já existente, sem exportador paralelo',()=>{
  assert.match(code,/global\.XLSX\.utils\.book_new\(\)/);
  assert.match(code,/global\.XLSX\.utils\.book_append_sheet/);
  assert.match(code,/global\.XLSX\.utils\.json_to_sheet/);
  assert.match(code,/global\.XLSX\.writeFile/);
  assert.match(code,/global\.XLSX\.utils\.sheet_to_csv/);
  assert.match(code,/global\.exportarElementoProducaoPDF\?\./);
});

test('PCP · Relatórios está registrado dinamicamente e ligado ao HTML',()=>{
  assert.match(code,/pcpRegistrarPagina\?\.\('relatorios'/);
  assert.match(htmlCode,/id="page-pcp-relatorios"/);
  assert.match(htmlCode,/88-pcp-relatorios\.js/);
});
