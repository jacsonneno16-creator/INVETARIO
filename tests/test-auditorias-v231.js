'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const ler = p => fs.readFileSync(path.join(raiz, p), 'utf8');

const analista = ler('public/js/analista/38-auditoria-operacional-v22.js');
const coletorMeta = ler('public/js/coletor/17-auditoria-meta.js');
const coletorFluxo = ler('public/js/coletor/18-auditoria-fluxo.js');
const rules = ler('firestore.rules');
const html = ler('public/analista.html');
const coletorHtml = ler('public/coletor.html');
const sw = ler('public/sw.js');
const funcoes = ler('functions/index.js');

assert.match(analista, /sel\.onchange=async function\(\)/, 'seletor deve aguardar carregamento');
assert.match(analista, /await selecionarAuditoria\(proxima\)/, 'seletor deve chamar selecionarAuditoria');
assert.match(analista, /sel\.value=anterior/, 'seleção anterior deve ser restaurada');
assert.match(analista, /collection\('resultados'\)/, 'analista deve combinar resultados seguros');
assert.match(analista, /collection\('itens_coletor'\)/, 'importação deve criar base cega');
assert.match(analista, /versaoBase='base_'/, 'importação deve ser versionada');
assert.match(analista, /Duplicidade lógica/, 'importação deve rejeitar duplicidades lógicas');
assert.match(analista, /callable\('finalizarAuditoria'\)/, 'finalização deve ocorrer no servidor');
assert.match(analista, /callable\('excluirAuditoriaCompleta'\)/, 'exclusão deve ocorrer no servidor');
assert.match(analista, /ITENS_POR_PAGINA = 150/, 'tabela deve ser paginada');

assert.match(coletorMeta, /collection\('itens_coletor'\)/, 'coletor deve ler apenas base cega');
assert.doesNotMatch(coletorMeta, /collection\('base_chunks'\)/, 'coletor não pode ler chunks esperados');
assert.match(coletorMeta, /collection\('dt_auditorias_coletor'\)/, 'coletor deve listar metadados públicos');
assert.match(coletorFluxo, /registrarResultadoAuditoria/, 'resultado deve ser comparado no servidor');

assert.match(rules, /match \/itens_coletor\/{itemId}/, 'regras da base cega ausentes');
assert.match(rules, /match \/resultados\/{resultadoId}/, 'regras dos resultados ausentes');
assert.match(rules, /allow write: if false;/, 'coletor não pode gravar resultados calculados');
const blocoEndereco = rules.match(/match \/enderecos\/{enderecoId}[\s\S]*?\n\s*}/)?.[0] || '';
assert.doesNotMatch(blocoEndereco, /canUseColetor/, 'coletor não pode acessar documentos esperados');

for (const nome of ['registrarResultadoAuditoria','registrarOcorrenciaAuditoria','finalizarAuditoria','excluirAuditoriaCompleta']) {
  assert.match(funcoes, new RegExp(`exports\\.${nome}`), `Cloud Function ${nome} ausente`);
}

const cabecalho = html.match(/<thead><tr><th>Endereço<\/th>[\s\S]*?<\/tr><\/thead>/)?.[0] || '';
assert.strictEqual((cabecalho.match(/<th>/g) || []).length, 8, 'cabeçalho deve ter oito colunas');
const linha = analista.match(/pagina\.map\(i => `<tr>[\s\S]*?<\/tr>`\)\.join/)?.[0] || '';
assert.strictEqual((linha.match(/<td/g) || []).length, 8, 'renderer deve gerar oito células');
assert.ok(html.includes('v232.1 · 20260731.2') && coletorHtml.includes('v232.1 · 20260731.2'), 'versão visível ausente');
assert.ok(!html.match(/\?v=(?!20260731-2321)/) && !coletorHtml.match(/\?v=(?!20260731-2321)/), 'assets com versões misturadas');
assert.ok(sw.includes("dt-inventario-v2321-20260731-2"), 'cache não versionado');
assert.doesNotMatch(sw, /\.addAll\(/, 'instalação do cache não pode falhar de forma atômica');
const blocoColetores = rules.match(/match \/dt_coletores\/{deviceId}[\s\S]*?\n\s*}\n\n\s*match \/dt_produtos/)?.[0] || '';
assert.match(blocoColetores, /resource\.data\.operador_uid == request\.auth\.uid/, 'documentos legados do coletor devem reconhecer operador_uid');
assert.match(blocoColetores, /request\.resource\.data\.operador_uid == request\.auth\.uid/, 'coletor não pode assumir identidade de outro usuário');

console.log('Auditorias v231: testes de caracterização, segurança, layout e cache aprovados.');
