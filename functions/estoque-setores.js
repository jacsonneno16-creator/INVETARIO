'use strict';
const crypto=require('crypto');
function idVinculo(loja,endereco){return crypto.createHash('sha256').update(String(loja)+':'+String(endereco).trim()).digest('hex');}
function resolver(linha,setores,vinculo){
  const endereco=String(linha.enderecoSetor||'').trim();
  let key=Number(linha.setorOperacionalKey||0);
  if(endereco){
    if(!/^\d+(?:\.\d+)+$/.test(endereco))throw new Error('Endereço do setor inválido.');
    if(!vinculo||vinculo.endereco!==endereco||vinculo.ativo===false)throw new Error('Endereço '+endereco+' sem associação de setor. Cadastre a associação na tela.');
    if(key>0&&key!==Number(vinculo.setorOperacionalKey))throw new Error('O setor informado difere do setor associado ao endereço '+endereco+'.');
    key=Number(vinculo.setorOperacionalKey);
  }
  if(!Number.isSafeInteger(key)||key<=0||!setores.some(x=>Number(x.setorOperacionalKey)===key))throw new Error('Setor operacional não encontrado na BlueSoft.');
  return key;
}
module.exports={idVinculo,resolver};
