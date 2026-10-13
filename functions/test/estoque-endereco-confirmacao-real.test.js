'use strict';
// BUG AO VIVO REAL (2026-10-09): um lote de 42 paletes voltou HTTP 200 da
// BlueSoft pra todos, e o sistema gravou "concluido"/"Endereçado" pra todos —
// mas uma consulta de conferência (GET, só leitura, feita fora do app) provou
// que NENHUM palete tinha mudado de endereço: continuavam na própria lista de
// pendentes da BlueSoft, no enderecoLogisticoKey de origem. Duas causas raiz:
//
// 1) O código tratava QUALQUER resposta 2xx como sucesso confirmado, mesmo
//    quando o corpo da resposta não trazia nenhuma confirmação real (não
//    confirmava NEM que o endereçamento aconteceu, NEM de qual palete).
// 2) A planilha nunca envia logisticaLoteItemKey/quantidadeEnderecar/gtin (não
//    existe essa coluna no modelo) — sem o bloco `itens`, a BlueSoft parece
//    aceitar o POST sem saber qual item do palete mover, então não move nada.
//    A própria consulta de paletes pendentes (GET /api/wms/enderecamento-de-
//    paletes, já usada pra confirmar que o palete existe) já devolve esses 3
//    campos por palete — por isso agora são usados automaticamente dali.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

function corpoDaFunction(nomeExport) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const i = src.indexOf('exports.' + nomeExport);
  assert.ok(i >= 0, nomeExport + ' não encontrada');
  const fim = src.indexOf('\n});', i) + 4;
  return src.slice(i, fim);
}

test('enderecarPaletesArquivo: NÃO trata mais qualquer HTTP 2xx como sucesso — exige o palete confirmado na resposta da BlueSoft', () => {
  const corpo = corpoDaFunction('enderecarPaletesArquivo');
  assert.doesNotMatch(corpo, /Array\.isArray\(r\)&&r\[0\]&&r\[0\]\.enderecoDescritivo\?String\(r\[0\]\.enderecoDescritivo\):'Endereçado'/,
    'esse era o bug: aceitava a resposta sem checar se ELA confirma o palete que foi movido');
  assert.match(corpo, /const linhaConfirmada=Array\.isArray\(r\)\?r\.find\(x=>x&&Number\(x\.paleteKey\)===paleteKey\):null/);
  assert.match(corpo, /if\(!linhaConfirmada\) throw new Error/, 'resposta sem confirmação vira erro (conferência necessária), nunca sucesso presumido');
});

test('enderecarPaletesArquivo: preenche "itens" automaticamente com logisticaLoteItemKey/gtin/quantidade já trazidos pela própria consulta de paletes pendentes', () => {
  const corpo = corpoDaFunction('enderecarPaletesArquivo');
  assert.match(corpo, /const paleteConsultado=consultaPaletes\.paletes\.get\(String\(paleteKey\)\)/);
  assert.match(corpo, /_eopCheckNumero\(paleteConsultado\.logisticaLoteItemKey\)\s*&&\s*_eopCheckNumero\(paleteConsultado\.produtoGtin\)\s*&&\s*Number\(paleteConsultado\.quantidadeDisponivelEmUnidades\)>0/);
  assert.match(corpo, /payload\.itens=\[\{logisticaLoteItemKey:Number\(paleteConsultado\.logisticaLoteItemKey\),quantidadeEnderecar:Number\(paleteConsultado\.quantidadeDisponivelEmUnidades\),gtin:Number\(paleteConsultado\.produtoGtin\)\}\]/);
  // A planilha ainda pode informar os 3 campos manualmente — continua tendo prioridade.
  assert.match(corpo, /if \(l\.logisticaLoteItemKey && l\.quantidadeEnderecar && l\.gtin\) \{\s*payload\.itens=\[\{logisticaLoteItemKey:Number\(l\.logisticaLoteItemKey\)/);
});

// ═══════════════════════════════════════════════════════════════════════
// Teste comportamental: reproduz exatamente os 2 cenários reais (resposta
// "200 mas sem confirmação" vs "200 com o palete confirmado e itens
// corretamente enviados"), chamando a MESMA lógica do closure real via uma
// extração controlada — evita duplicar centenas de linhas de setup de
// onCall/acesso/loja só pra isso, mesmo padrão de extração já usado no mock
// entregue nesta mesma função antes desta correção.
// ═══════════════════════════════════════════════════════════════════════
function montarClosure() {
  const corpo = corpoDaFunction('enderecarPaletesArquivo');
  const inicio = corpo.indexOf('async()=>{');
  const fimClosure = corpo.indexOf('\n    });', inicio);
  assert.ok(inicio > 0 && fimClosure > inicio, 'closure de execução não localizada');
  const miolo = corpo.slice(inicio + 'async()=>{'.length, fimClosure);
  const vm = require('vm');
  const ctx = {
    Number, String, Array, Object,
    _eopCheckNumero: n => Number.isSafeInteger(Number(n)) && Number(n) > 0,
    _eopPost: null, // definido por teste
  };
  vm.createContext(ctx);
  return (l, loja, cfg, consultaPaletes, post) => {
    const fn = vm.runInContext('(async function(l, loja, cfg, consultaPaletes, _eopPost){' + miolo + '})', ctx);
    return fn(l, loja, cfg, consultaPaletes, post);
  };
}

test('closure de execução: resposta sem o palete confirmado joga erro (nunca marca sucesso)', async () => {
  const executar = montarClosure();
  const consultaPaletes = {paletes: new Map([['2851689', {logisticaLoteItemKey: 4641581, produtoGtin: 17898693232217, quantidadeDisponivelEmUnidades: 1008}]])};
  await assert.rejects(
    executar({paleteKey: 2851689, enderecoLogisticoKey: 16230}, {bluesoftLojaKey: 14}, {}, consultaPaletes, async () => ({enderecoDeDestino: 'Sem endereço de Picking'})),
    /não confirma o endereçamento/
  );
});

test('closure de execução: resposta com o palete confirmado retorna sucesso E o payload inclui itens preenchidos pela consulta', async () => {
  const executar = montarClosure();
  const consultaPaletes = {paletes: new Map([['2851689', {logisticaLoteItemKey: 4641581, produtoGtin: 17898693232217, quantidadeDisponivelEmUnidades: 1008}]])};
  let payloadEnviado = null;
  const r = await executar({paleteKey: 2851689, enderecoLogisticoKey: 16230}, {bluesoftLojaKey: 14}, {}, consultaPaletes, async (path, cfg, payload) => {
    payloadEnviado = payload;
    return [{paleteKey: 2851689, enderecoDescritivo: '14.1564.1.1.1.5.1', enderecoLogisticoKey: 16230}];
  });
  assert.equal(r.paleteKey, 2851689);
  assert.equal(r.detalhe, '14.1564.1.1.1.5.1');
  // Objetos criados dentro do vm pertencem a outro "realm" — compara por JSON,
  // não por deepEqual estrutural (que também checa o protótipo de Object).
  assert.equal(JSON.stringify(payloadEnviado.itens), JSON.stringify([{logisticaLoteItemKey: 4641581, quantidadeEnderecar: 1008, gtin: 17898693232217}]));
});

test('closure de execução: planilha informando os 3 campos manualmente tem prioridade sobre os da consulta', async () => {
  const executar = montarClosure();
  const consultaPaletes = {paletes: new Map([['2851689', {logisticaLoteItemKey: 999, produtoGtin: 111, quantidadeDisponivelEmUnidades: 1}]])};
  let payloadEnviado = null;
  await executar({paleteKey: 2851689, enderecoLogisticoKey: 16230, logisticaLoteItemKey: 42, quantidadeEnderecar: 5, gtin: 123}, {bluesoftLojaKey: 14}, {}, consultaPaletes, async (path, cfg, payload) => {
    payloadEnviado = payload;
    return [{paleteKey: 2851689, enderecoDescritivo: 'ok'}];
  });
  assert.equal(JSON.stringify(payloadEnviado.itens), JSON.stringify([{logisticaLoteItemKey: 42, quantidadeEnderecar: 5, gtin: 123}]));
});
