const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'public/js/analista/52-cadastros-v287.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/css/analista.css'),'utf8');
const sw=fs.readFileSync(path.join(root,'public/sw.js'),'utf8');
function ok(c,m){if(!c)throw new Error(m);}
ok(js.includes('class="modal-bg open"'),'modal novo não usa classe open');
ok(js.includes('[data-pe]')&&js.includes('[data-ee]'),'ações de editar não estão ligadas');
ok(js.includes('[data-pd]')&&js.includes('[data-ed]'),'ações de excluir não estão ligadas');
ok(css.includes('.modal-bg.open, .modal-bg.on { display: flex; }'),'CSS não exibe modal');
ok(sw.includes('v294-acoes-cadastros'),'cache do SW não foi renovado');
ok(sw.includes('/js/analista/52-cadastros-v287.js'),'script de cadastros não está no precache');
console.log('OK - ações de produtos e endereços v294');
