// Bug ao vivo real (2026-10-07): "Redefinir senha" no modal Meu Perfil não fazia
// nada. O arquivo roda em 'use strict', e o clique atribuía a uma variável `u`
// nunca declarada (`if(u=global._currentAnalistaUser||{}, ...)`), o que em modo
// estrito lança ReferenceError na hora — o clique nunca chegava a chamar
// sendPasswordResetEmail, sem nenhum aviso na tela (só um erro silencioso no
// console). Corrigido com `var u=...` declarado antes, e com mensagens de erro
// visíveis para os dois motivos de falha que antes ficavam mudos.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../js/analista/123-configuracoes-sistema.js'), 'utf8');

test("'use strict' continua no arquivo (o bug só existe por causa disso — não pode ser removido pra 'resolver')", () => {
  assert.match(src, /^\(function\(global\)\{\n'use strict';/);
});

test('Redefinir senha: não existe mais atribuição a variável não declarada dentro do bloco', () => {
  assert.doesNotMatch(src, /data-dt-profile-password'\)\)\{if\(u=/);
});

test('Redefinir senha: `u` é declarada com var antes de usar u.email', () => {
  const i = src.indexOf("data-dt-profile-password]')){");
  assert.ok(i >= 0, 'bloco do escutador de clique não encontrado (procurei o fechamento do closest, não o botão)');
  const trecho = src.slice(i, i + 400);
  assert.match(trecho, /var u=global\._currentAnalistaUser\|\|\{\};/);
});

test('Redefinir senha: mostra mensagem quando falta e-mail ou o login ainda não carregou (antes ficava mudo)', () => {
  const i = src.indexOf("data-dt-profile-password]')){");
  const trecho = src.slice(i, i + 600);
  assert.match(trecho, /Não foi possível identificar o e-mail/);
  assert.match(trecho, /Login ainda não está pronto/);
});
