'use strict';
// BUG AO VIVO REAL (2026-10-03): login do Coletor não entrava — 04-auth-login.js
// tinha `a.canais_acesso?.coletor`. A WebView antiga do coletor (Chromium 66)
// não entende `?.`/`??`: o arquivo INTEIRO falha ao carregar, doLogin() nunca
// existe e o botão ENTRAR não faz nada, sem erro visível. Este teste trava a
// regressão em todos os arquivos do coletor.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const DIR = path.join(__dirname, '..', 'js', 'coletor');

function semComentariosENemStrings(codigo) {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

test('coletor: nenhum arquivo usa ?. nem ?? em código (WebView antiga quebra o arquivo inteiro)', () => {
  const arquivos = fs.readdirSync(DIR).filter(f => f.endsWith('.js'));
  assert.ok(arquivos.length > 0, 'precisa encontrar os arquivos do coletor');
  const problemas = [];
  for (const nome of arquivos) {
    const codigo = semComentariosENemStrings(fs.readFileSync(path.join(DIR, nome), 'utf8'));
    const linhas = codigo.split('\n');
    linhas.forEach((linha, i) => {
      if (/\?\.(?![0-9])/.test(linha) || /\?\?/.test(linha)) problemas.push(nome + ':' + (i + 1) + ' → ' + linha.trim());
    });
  }
  assert.deepEqual(problemas, [], 'achou ?. ou ?? em código do coletor:\n' + problemas.join('\n'));
});
