const fs=require('fs');
const js=fs.readFileSync('public/js/analista/49-quatro-telas-v254.js','utf8');
const css=fs.readFileSync('public/css/analista-quatro-telas-v254.css','utf8');
const html=fs.readFileSync('public/analista.html','utf8');
for(const expected of ['Top 10 produtos com mais divergências','Top 10 ruas com mais divergências','inventoryStreetDivergences','hiddenRanking']){
  if(!js.includes(expected)) throw new Error('Ausente: '+expected);
}
if(!css.includes('.v254-rank-item')) throw new Error('CSS do ranking ausente');
if(!html.includes('20260805-dashboard-v268')) throw new Error('Cache-bust v268 ausente');
console.log('OK dashboard rankings v268');
