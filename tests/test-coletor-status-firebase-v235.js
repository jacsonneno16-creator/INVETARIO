const fs = require('fs');
const assert = require('assert');

const raiz = require('path').resolve(__dirname, '..');
const inv = fs.readFileSync(raiz + '/public/js/coletor/05-inventarios-download.js', 'utf8');
const aud = fs.readFileSync(raiz + '/public/js/coletor/17-auditoria-meta.js', 'utf8');
const rules = fs.readFileSync(raiz + '/firestore.rules', 'utf8');

for (const status of ['ATIVO', 'ABERTO', 'EM_ANDAMENTO', 'PAUSADO']) {
  assert(inv.includes("'" + status + "'"), 'Inventário não aceita ' + status);
}
for (const status of ['LIBERADA', 'ABERTA', 'ATIVA', 'EM_ANDAMENTO']) {
  assert(aud.includes("'" + status + "'"), 'Auditoria não aceita ' + status);
}
assert(aud.includes("FS.collection('dt_auditorias_coletor').get()"), 'Auditoria ainda filtra um único status no servidor');
assert(inv.includes('FS.collection(FCOL.inventarios).get()'), 'Inventário ainda filtra estados incompletos no servidor');
assert(aud.includes('Sem acesso às auditorias no Firebase'), 'Erro do Firebase continua oculto');
assert(rules.includes('match /dt_auditorias_coletor/{docId}'), 'Regras sem metadados de auditoria do coletor');
assert(rules.includes('allow read: if canAccessStore(lojaId) && (canUseAnalista() || canUseColetor())'), 'Coletor sem leitura autorizada da lista de auditorias');

console.log('OK: coletor aceita todos os estados abertos e expõe falhas do Firebase.');
