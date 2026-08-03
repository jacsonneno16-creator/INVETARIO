#!/usr/bin/env node
/**
 * build-sw.js
 * ---------------------------------------------------------------------
 * Gera public/sw.js a partir de public/sw.template.js, substituindo
 * o placeholder __CACHE_VERSION__ por um nome de cache derivado do
 * hash SHA-256 do conteúdo de todos os arquivos listados em PRECACHE.
 *
 * Por quê: antes o nome do cache era escrito à mão (ex.:
 * "dt-inventario-v239-expand-enderecos-20260802-1"). Se alguém
 * esquecer de bumpar essa string em um deploy, o Service Worker
 * nunca invalida o cache antigo e o usuário fica preso numa versão
 * desatualizada do app — mesmo com arquivos novos no servidor.
 *
 * Este script elimina esse passo manual: a versão do cache muda
 * automaticamente sempre (e somente) que o conteúdo de algum arquivo
 * pré-cacheado muda.
 *
 * Uso:
 *   node scripts/build-sw.js
 *
 * Rodar como parte do processo de build/deploy (ex.: "npm run build"
 * antes de "firebase deploy"), nunca editar public/sw.js manualmente.
 * ---------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(ROOT, 'sw.template.js');
const OUTPUT_PATH = path.join(ROOT, 'sw.js');
const PLACEHOLDER = '__CACHE_VERSION__';
const PREFIX = 'dt-inventario';

function extrairListaPrecache(templateSource) {
  const match = templateSource.match(/var PRECACHE=\[([\s\S]*?)\];/);
  if (!match) {
    throw new Error('Não encontrei o array PRECACHE em sw.template.js');
  }
  return match[1]
    .split(',')
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha) => linha.replace(/^['"]|['"]$/g, ''));
}

function calcularHashConteudo(urls) {
  const hash = crypto.createHash('sha256');
  const faltando = [];

  for (const url of urls) {
    // '/' representa o index; os demais mapeiam direto para public/<url>
    const relativo = url === '/' ? 'index.html' : url.replace(/^\//, '');
    const arquivo = path.join(ROOT, relativo);
    if (!fs.existsSync(arquivo)) {
      faltando.push(relativo);
      continue;
    }
    hash.update(relativo);
    hash.update(fs.readFileSync(arquivo));
  }

  if (faltando.length) {
    console.warn(
      '[build-sw] Aviso: arquivos do PRECACHE não encontrados no disco (ignorados no hash):\n  - ' +
        faltando.join('\n  - ')
    );
  }

  return hash.digest('hex').slice(0, 12);
}

function main() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error('[build-sw] sw.template.js não encontrado em ' + TEMPLATE_PATH);
    process.exit(1);
  }

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const urls = extrairListaPrecache(template);
  const hash = calcularHashConteudo(urls);
  const dataISO = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const versao = `${PREFIX}-${dataISO}-${hash}`;

  const saida = template.replace(PLACEHOLDER, versao);
  fs.writeFileSync(OUTPUT_PATH, saida, 'utf8');

  console.log(`[build-sw] sw.js gerado com CACHE='${versao}'`);
  console.log(`[build-sw] ${urls.length} arquivos incluídos no hash de versão.`);
}

main();
