'use strict';
const catalogo = require('./permissoes-catalogo.json');
const modulos = Object.fromEntries(catalogo.map(m => [m.id, m]));
const areas = ['inventario','recebimento','estoque','compras','pcp','producao','atendimento'];
function protegido(a) { return !!a && (a.admin_mestre === true || a.administrador_mestre === true || a.perfil === 'administrador'); }
function mestre(a) { return !!a && a.ativo !== false && protegido(a); }
function delegacao(a) { return a && a.ativo !== false && a.gestao_areas || {}; }
function pode(a, op) { return mestre(a) || delegacao(a).operacoes && delegacao(a).operacoes[op] === true; }
function area(m) { return modulos[m] && modulos[m].area; }
function pares(p) { return Object.keys(p || {}).flatMap(m => Object.keys(p[m] || {}).filter(x => p[m][x] === true).map(x => [m,x])); }
function normalizar(p) {
  const out = {};
  for (const [m,v] of Object.entries(p || {})) {
    if (!modulos[m] || !v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Módulo desconhecido: '+m);
    out[m] = {};
    for (const [ac,b] of Object.entries(v)) {
      if (!modulos[m].acoes.includes(ac) || typeof b !== 'boolean') throw new Error('Ação inválida: '+m+'.'+ac);
      out[m][ac] = b;
    }
  }
  // Mapa completo evita os fallbacks de permissões legadas.
  return Object.fromEntries(catalogo.map(m => [m.id,Object.fromEntries(m.acoes.map(ac => [ac,!!(out[m.id] && out[m.id][ac])]))]));
}
function concedivel(a,m,ac) {
  const d=delegacao(a);
  return mestre(a) || !!(area(m) !== 'sistema' && (d.areas || []).includes(area(m)) && a.permissoes && a.permissoes[m] && a.permissoes[m][ac] === true && d.permissoes && d.permissoes[m] && d.permissoes[m][ac] === true);
}
function lojasOk(a,b) {
  if(mestre(a)) return true;
  const d=delegacao(a), lojas=d.lojas || [];
  return b.acesso_todas_lojas !== true && Array.isArray(b.lojas_permitidas) && b.lojas_permitidas.length>0 && b.lojas_permitidas.every(l => lojas.includes(l) && (a.acesso_todas_lojas === true || (a.lojas_permitidas || []).includes(l)));
}
function completo(a,b) { return lojasOk(a,b) && !protegido(b) && !Object.keys(b.gestao_areas||{}).length && pares(b.permissoes).every(([m]) => (delegacao(a).areas || []).includes(area(m))); }
function validarDelegacao(d) {
  if(!d || !Object.keys(d).length)return {};
  if(!Array.isArray(d.areas)||!d.areas.length||d.areas.some(x=>!areas.includes(x)))throw new Error('Áreas de gestão inválidas.');
  if(!Array.isArray(d.lojas)||!d.lojas.length||d.lojas.length>50||d.lojas.some(x=>typeof x!=='string'||!x||x.includes('/')))throw new Error('Lojas de gestão inválidas.');
  const operacoes={};
  for(const op of ['visualizar','criar','editar','atribuir','bloquear','senha','excluir'])operacoes[op]=!!(d.operacoes&&d.operacoes[op]===true);
  const permissoes=normalizar(d.permissoes);
  if(pares(permissoes).some(([m])=>!d.areas.includes(area(m))))throw new Error('Permissão fora das áreas de gestão.');
  return {areas:[...new Set(d.areas)],lojas:[...new Set(d.lojas)],canais:{analista:!!(d.canais&&d.canais.analista),coletor:!!(d.canais&&d.canais.coletor)},operacoes,permissoes};
}
function validarAlteracao(a, antigo, proposto, uid, actorUid) {
  const novo={...proposto,permissoes:normalizar(proposto.permissoes)};
  if(uid===actorUid)throw new Error('A própria conta deve ser administrada por outro responsável.');
  if(protegido(antigo))throw new Error('Conta de administrador protegida.');
  if(mestre(a))return novo;
  if(!pode(a,antigo?'editar':'criar')||!pode(a,'atribuir'))throw new Error('Sem autorização para cadastrar ou atribuir acessos.');
  if(antigo && (Object.keys(antigo.gestao_areas||{}).length || !lojasOk(a,antigo)))throw new Error('Conta fora do escopo de gestão.');
  if(!lojasOk(a,novo))throw new Error('Lojas fora do escopo de gestão.');
  if(novo.perfil==='administrador'||novo.admin_mestre||novo.administrador_mestre)throw new Error('Não é permitido promover administrador.');
  const d=delegacao(a);
  if(Object.keys(novo.gestao_areas||{}).length)throw new Error('Somente administrador define responsáveis por área.');
  for(const c of ['analista','coletor'])if(novo.canais_acesso&&novo.canais_acesso[c]===true && !(d.canais&&d.canais[c]===true) && !(antigo&&antigo.canais_acesso&&antigo.canais_acesso[c]===true))throw new Error('Canal fora do escopo.');
  for(const [m,ac] of pares(novo.permissoes))if(!concedivel(a,m,ac) && !(antigo&&antigo.permissoes&&antigo.permissoes[m]&&antigo.permissoes[m][ac]===true))throw new Error('Acesso não concedível: '+m+'.'+ac);
  if(antigo){
    if(proposto.email_recuperacao!==undefined&&proposto.email_recuperacao!==(antigo.email_recuperacao||'')&&(!pode(a,'senha')||!completo(a,antigo)))throw new Error('Sem autorização para alterar o e-mail de recuperação desta conta.');
    // Edição parcial conserva todas as permissões que o responsável não pode administrar.
    for(const m of catalogo)for(const ac of m.acoes)if(!concedivel(a,m.id,ac))novo.permissoes[m.id][ac]=!!(antigo.permissoes&&antigo.permissoes[m.id]&&antigo.permissoes[m.id][ac]===true);
    if(!completo(a,antigo)){
      for(const k of ['ativo','canais_acesso','setores_permitidos','acesso_todas_lojas','lojas_permitidas','papelCompras','compradoresGerenciados']) {
        if(JSON.stringify(novo[k])!==JSON.stringify(antigo[k]))throw new Error('Usuário com acesso a outras áreas: não altere '+k+'.');
      }
    }
    if(novo.ativo!==antigo.ativo&&(!pode(a,'bloquear')||!completo(a,antigo)))throw new Error('Sem autorização para bloquear esta conta.');
    if((novo.papelCompras||'')!==(antigo.papelCompras||'') && !d.areas.includes('compras'))throw new Error('Papel de Compras fora do escopo.');
  }else if(novo.papelCompras && !d.areas.includes('compras'))throw new Error('Papel de Compras fora do escopo.');
  return novo;
}
module.exports={catalogo,areas,protegido,mestre,delegacao,pode,area,pares,normalizar,concedivel,lojasOk,completo,validarDelegacao,validarAlteracao};
