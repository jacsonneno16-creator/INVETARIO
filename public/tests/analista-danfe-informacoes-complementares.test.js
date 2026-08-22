// Pedido ao vivo do usuário: "tem uma parte de baixo da nota que vem
// informações complementares, colocando o motivo da devolução — tem como
// vocês colocar uma coluna com esse motivo". Confirmado contra o schema
// oficial da Bluesoft (NotasFiscaisConsultarResponse e
// NotaFiscalImportadaTerm, nenhuma variação de "informação complementar"
// existe em nenhum dos dois) — só o import de PDF de DANFE consegue puxar
// esse texto, porque só ali temos o rodapé completo da nota.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const base=path.join(__dirname,'../js/analista');
const recusasCode=fs.readFileSync(path.join(base,'97-recebimento-recusas.js'),'utf8');

function carregarParser(){
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window;
  win.getDTFirestore=()=>({ collection:()=>({ get: async()=>({docs:[]}) }) });
  win.eval(recusasCode);
  return win.DTRecusasParser;
}

test('parseDanfeText extrai o texto de "Informações Complementares" (motivo da devolução no rodapé do DANFE)',()=>{
  const parser=carregarParser();
  // Simula o texto linearizado que o pdf.js produz (itens de texto unidos
  // por espaço, sem quebras de layout) — mesmo formato já usado pelos
  // outros campos extraídos desta função.
  const texto='... Transportador / Volumes Transportados Razão Social Frete Por Conta Transportadora XYZ CNPJ ... ' +
    'Informações Complementares Devolução ref. NF 12345 - mercadoria avariada, cliente recusou o recebimento. ' +
    'Reservado ao Fisco Uso exclusivo da fiscalização';
  const r=parser.parseDanfeText(texto);
  assert.equal(r.informacoesComplementares,'Devolução ref. NF 12345 - mercadoria avariada, cliente recusou o recebimento.');
});

test('parseDanfeText corta o texto antes de "Reservado ao Fisco" (coluna vizinha no layout do DANFE)',()=>{
  const parser=carregarParser();
  const texto='Informações Complementares Cliente não quis receber, produto amassado na entrega Reservado ao Fisco Campo do fisco não deve aparecer aqui';
  const r=parser.parseDanfeText(texto);
  assert.equal(r.informacoesComplementares,'Cliente não quis receber, produto amassado na entrega');
  assert.doesNotMatch(r.informacoesComplementares,/Reservado|fisco/i);
});

test('parseDanfeText não quebra e devolve string vazia quando a nota não tem essa seção',()=>{
  const parser=carregarParser();
  const r=parser.parseDanfeText('NF-e Nº 12345 - SÉRIE 1 Destinatário / Remetente Nome / Razão Social Mercado X');
  assert.equal(r.informacoesComplementares,'');
});
