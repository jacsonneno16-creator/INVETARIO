// PEDIDO AO VIVO (2026-08-25): "Importar DANFE em PDF... quando vou
// importar um arquivo que tem tipo umas 100 notas ele só lê a primeira e
// não lê as outras" — parseDanfeText() usava match() simples (1ª
// ocorrência) em cada campo, sobre o texto INTEIRO do PDF. Com várias
// DANFEs concatenadas num único arquivo (comum em exportação em lote), só
// a 1ª nota saía da leitura; as demais eram descartadas em silêncio (nem
// erro, nem aviso — o usuário só via 1 linha na prévia onde esperava ~100).
// Corrigido dividindo o texto em um segmento por "chave de acesso"
// encontrada (dividirTextoPorDanfes) antes de rodar o parser de sempre em
// cada pedaço.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const base = path.join(__dirname, '../js/analista');
const recusasCode = fs.readFileSync(path.join(base, '97-recebimento-recusas.js'), 'utf8');

function carregarParser() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', runScripts: 'outside-only' });
  const win = dom.window;
  win.getDTFirestore = () => ({ collection: () => ({ get: async () => ({ docs: [] }) }) });
  win.eval(recusasCode);
  return win.DTRecusasParser;
}

// Duas chaves de acesso REAIS quanto ao dígito verificador (passam no
// mesmo algoritmo de chaveNfeValida — não são notas de verdade, só
// números que batem no cálculo, como qualquer chave válida precisa).
const CHAVE_1 = '35260614200166000187550010001234561234567895';
const CHAVE_2 = '35260614200166000187550010007654321234567893';

function blocoDanfe(chave, numeroNota, destinatario, dataEmissao, volumes, motivo) {
  // Layout linearizado como o pdf.js produz (itens de texto unidos por
  // espaço) — mesmo formato que os outros testes desta tela já assumem.
  const chaveFormatada = chave.replace(/(\d{4})(?=\d)/g, '$1 ');
  return `DANFE Documento Auxiliar da Nota Fiscal Eletrônica ` +
    `Chave de Acesso ${chaveFormatada} ` +
    `NF-e Nº ${numeroNota} - SÉRIE 1 ` +
    `Destinatário / Remetente CNPJ Data da Emissão Nome / Razão Social ${destinatario} 12.345.678/0001-99 Endereço Rua Teste 123 ` +
    `Data da Emissão ${dataEmissao} ` +
    `Transportador / Volumes Transportados Razão Social Frete Por Conta Transportadora XYZ CNPJ 11.222.333/0001-44 Quantidade Espécie ${volumes} VOLUMES ` +
    `Informações Complementares ${motivo} Reservado ao Fisco Uso exclusivo da fiscalização`;
}

test('dividirTextoPorDanfes: texto com 1 única "chave de acesso" devolve um segmento só (comportamento antigo preservado)', () => {
  const parser = carregarParser();
  const texto = blocoDanfe(CHAVE_1, '12345', 'Mercado Único', '10/08/2026', '5', 'Sem motivo');
  const segmentos = parser.dividirTextoPorDanfes(texto);
  assert.equal(segmentos.length, 1);
});

test('dividirTextoPorDanfes: PDF com várias DANFEs concatenadas (simulando as "~100 notas") divide um segmento por chave de acesso', () => {
  const parser = carregarParser();
  const notas = Array.from({ length: 5 }, (_, i) => blocoDanfe(
    i % 2 === 0 ? CHAVE_1 : CHAVE_2, String(1000 + i), 'Mercado ' + i, '0' + (i + 1) + '/08/2026', String(10 + i), 'Motivo da nota ' + i
  ));
  const textoCompleto = notas.join(' ');
  const segmentos = parser.dividirTextoPorDanfes(textoCompleto);
  assert.equal(segmentos.length, 5, 'precisa ter dividido em 5 segmentos, um por nota — não parar na primeira');
});

test('REGRESSÃO (bug ao vivo real): cada segmento, ao passar por parseDanfeText, extrai os dados da SUA PRÓPRIA nota — não repete os dados da 1ª nota em todas', () => {
  const parser = carregarParser();
  const notaA = blocoDanfe(CHAVE_1, '11111', 'Mercado A', '01/08/2026', '7', 'Motivo A - avaria');
  const notaB = blocoDanfe(CHAVE_2, '22222', 'Mercado B', '02/08/2026', '3', 'Motivo B - troca');
  const textoCompleto = notaA + ' ' + notaB;

  const segmentos = parser.dividirTextoPorDanfes(textoCompleto);
  assert.equal(segmentos.length, 2);

  const notas = segmentos.map(s => parser.parseDanfeText(s));
  assert.equal(notas[0].chave, CHAVE_1);
  assert.equal(notas[0].numeroNota, '11111');
  assert.equal(notas[0].destinatario, 'Mercado A');
  assert.equal(notas[0].volumes, 7);
  assert.match(notas[0].informacoesComplementares, /Motivo A/);

  assert.equal(notas[1].chave, CHAVE_2);
  assert.equal(notas[1].numeroNota, '22222');
  assert.equal(notas[1].destinatario, 'Mercado B');
  assert.equal(notas[1].volumes, 3);
  assert.match(notas[1].informacoesComplementares, /Motivo B/);

  assert.notEqual(notas[0].chave, notas[1].chave, 'as duas notas precisam ter chaves DIFERENTES — não pode ser a mesma nota duplicada');
});

test('dividirTextoPorDanfes: texto sem nenhuma "chave de acesso" (formato de relatório sem DANFE completo) devolve o texto inteiro como um único segmento', () => {
  const parser = carregarParser();
  const texto = 'Cliente: (123) Mercado Genérico Pedido: 456 sem chave de acesso nenhuma aqui';
  const segmentos = parser.dividirTextoPorDanfes(texto);
  assert.equal(segmentos.length, 1);
  assert.equal(segmentos[0], texto);
});
