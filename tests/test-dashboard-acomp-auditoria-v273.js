const fs=require('fs');
const dash=fs.readFileSync('public/js/analista/22-dashboard-render-sync.js','utf8');
const acomp=fs.readFileSync('public/js/analista/41-dashboard-acomp-v37.js','utf8');
function ok(cond,msg){if(!cond)throw new Error(msg);}
ok(dash.includes("ref.collection('resultados').get()"),'dashboard deve ler resultados');
ok(dash.includes("collection('dt_auditoria_resultados')"),'dashboard deve ler espelho central');
ok(dash.includes("ref.collection('enderecos').get()"),'dashboard deve ler base de enderecos');
ok(acomp.includes("candidato.ref.collection('resultados').get()"),'acompanhamento deve ler resultados');
ok(acomp.includes("collection('dt_auditoria_resultados')"),'acompanhamento deve ler espelho central');
ok(acomp.includes('return carregarAuditoriaSelecionada();'),'troca de auditoria deve carregar dados');
console.log('OK dashboard/acomp auditoria v273');
