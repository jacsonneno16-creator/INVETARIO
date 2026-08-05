const fs=require('fs');
function ok(v,m){if(!v)throw new Error(m);}
const flow=fs.readFileSync('public/js/coletor/18-auditoria-fluxo.js','utf8');
const fn=fs.readFileSync('functions/index.js','utf8');
const an=fs.readFileSync('public/js/analista/38-auditoria-operacional-v22.js','utf8');
const rules=fs.readFileSync('firestore.rules','utf8');
ok(flow.includes('SINCRONIZADOR DE AUDITORIA V2'),'sincronizador V2 ausente');
ok(flow.includes('Um registro antigo ou inconsistente nao bloqueia os demais'),'fila ainda pode bloquear');
ok(flow.includes("window.addEventListener('online'"),'retorno online ausente');
ok(!flow.includes("window.confirm('Voltar"),'reconexao nao pode pedir retorno');
ok(fn.includes('localizarItemAuditoriaV2'),'resolver V2 ausente');
ok(fn.includes("collection('base_chunks')"),'compatibilidade base_chunks ausente');
ok(fn.includes("collection('dt_auditoria_resultados')"),'espelho central ausente');
ok(an.includes("collection('dt_auditoria_resultados').where('auditoriaId','==',auditoriaAtual)"),'analista nao le espelho');
ok(rules.includes('match /dt_auditoria_resultados/{docId}'),'regra do espelho ausente');
console.log('OK auditoria envio v269');
