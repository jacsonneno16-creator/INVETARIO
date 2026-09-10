// REGRESSÃO (regex contra o texto de firestore.rules, mesmo padrão de
// firestore-rules-recebimento-paletes.test.js — não é execução real da
// regra).
//
// BUG AO VIVO REAL (2026-09-06): "Restaurar backup" (Produção → Importação)
// escreve numa ÚNICA ação em Maquinas/Produtos/Ficha_Tecnica/Setup/
// Registros/Apontamentos/Funcionarios/Config/Categorias/Processos/Projecao/
// Insumos_Estoque (ver importarProducaoTemplate, 71-producao-excel.js) —
// mas só 4 dessas 12 coleções aceitavam `producao-importacao` como
// permissão alternativa; as outras 8 exigiam a permissão específica de
// cada tela própria (ex.: producao_setup só aceitava 'producao-setup').
// Relato real: conta com só `producao-maquinas` importou as máquinas com
// sucesso e travou com permission-denied bem na escrita de Produtos —
// como isso acontece dentro do mesmo await sequencial, a exceção abortava
// tudo que viria depois (Ficha_Tecnica/Setup/...) sem aviso claro. Este
// teste garante que TODAS as 12 coleções tocadas pelo backup completo
// aceitam `producao-importacao` como alternativa — 1 permissão só deve
// bastar pro backup inteiro, igual a própria tela promete.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rules = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');

// Extrai o corpo do bloco `match /<colecao>/{docId} { ... }` de nível mais
// interno (primeira ocorrência), pra não pegar acidentalmente um bloco de
// outra loja/coleção com nome parecido.
function trechoDoMatch(nomeColecao) {
  const marcador = 'match /' + nomeColecao + '/{docId}';
  const inicio = rules.indexOf(marcador);
  assert.ok(inicio > -1, 'bloco "' + marcador + '" não encontrado em firestore.rules');
  // Fatia até o próximo `match /` no mesmo nível de indentação (6 espaços,
  // padrão usado dentro de `match /lojas/{lojaId}`), ou até 2000 chars.
  const fim = rules.indexOf('\n      match /', inicio + marcador.length);
  return rules.slice(inicio, fim > -1 ? fim : inicio + 2000);
}

const COLECOES_DO_BACKUP_COMPLETO = [
  'producao_maquinas',
  'producao_produtos',
  'producao_ficha_tecnica',
  'producao_setup',
  'producao_registros',
  'producao_apontamentos',
  'producao_funcionarios',
  'producao_insumos_estoque',
  'producao_projecao',
  'producao_processos',
  'producao_categorias',
  'producao_config',
];

COLECOES_DO_BACKUP_COMPLETO.forEach(colecao => {
  test('match /' + colecao + '/: aceita hasPermission(\'producao-importacao\',\'importar\') como alternativa de escrita', () => {
    const trecho = trechoDoMatch(colecao);
    assert.match(trecho, /hasPermission\('producao-importacao',\s*'importar'\)/,
      colecao + ' precisa aceitar producao-importacao pra "Restaurar backup" (Importação) funcionar de ponta a ponta com 1 permissão só');
  });
});
