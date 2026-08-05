(function(){
  'use strict';
  function qs(id){ return document.getElementById(id); }
  function prepararFluxoPallet(){
    var bloco = qs('bloco-endereco-travado');
    if(!bloco || bloco.dataset.v284Ready) return;
    bloco.dataset.v284Ready = '1';
    var titulo = bloco.querySelector('div:nth-child(2) > div:first-child');
    if(titulo) titulo.textContent = 'Confirme o mesmo endereço para abrir o próximo pallet';
    var input = qs('f-rebipar-endereco');
    if(input) input.placeholder = 'Bipe novamente o endereço';
    var btn = bloco.querySelector('button.btn-primary');
    if(btn) btn.textContent = 'SIM, PRÓXIMO PALLET';
  }
  function prepararStatus(){
    var labels = [
      ['st-total','TOTAL'],['st-enviadas','ENVIADAS'],['st-pendentes','PENDENTES'],['st-div','DIVERGÊNCIAS']
    ];
    labels.forEach(function(pair){
      var el=qs(pair[0]);
      if(el && el.parentElement){
        el.parentElement.setAttribute('aria-label', pair[1]);
      }
    });
  }
  function init(){ prepararFluxoPallet(); prepararStatus(); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  new MutationObserver(function(){ prepararFluxoPallet(); }).observe(document.documentElement,{childList:true,subtree:true});
})();
