(function(global){
'use strict';

// Etapa 7 FIX: paridade visual SEM recriar a arvore de navegacao.
// Regra critica: os #nav-producao-* originais permanecem no DOM com seus
// onclicks, IDs e referencias, pois o shell principal e o sistema de permissoes
// dependem exatamente desses elementos.

// PEDIDO AO VIVO (auditoria RELATORIO-COMPARACAO-PRODUCAO.md, seções 4/5):
// a barra principal do original (index.html:173-184) tem EXATAMENTE nove
// abas fixas, nesta ordem e com este texto — nada de "Mais"/overflow na
// barra. O resto do menu original (index.html:144-170) é só o dropdown de
// 3-pontos no cabeçalho, com 5 itens fixos: usuário, Meu Perfil, Projeção
// de Vendas, Configurações, Sair. Ficha Técnica/Funcionários/Setup/
// Importação/Estoque não têm entrada própria nem na barra nem no dropdown
// no original — vivem dentro da tela de Configurações (index.html:996-
// 1074, nav lateral com grupos Máquinas/Produtos + itens soltos). Por isso
// TODAS essas rotas saem daqui e passam a ser seções dentro de
// 77-producao-config.js (SECOES_CFG) — únicos caminhos que restam pra
// alcançá-las, exatamente como no original.
const ROTAS_PRINCIPAIS=[
 'producao-dashboard','producao-programacao','producao-maquinas','producao-gantt',
 'producao-realizado','producao-insumos','producao-insumos-geral','producao-prog-automatica','producao-relatorios',
];
// Rótulos que o node original mostra mas que divergem do texto exato do
// original (auditoria seção 5): corrigidos aqui, sem recriar o elemento.
const ROTULOS_CORRIGIDOS={'producao-maquinas':'Máquinas','producao-gantt':'Prog. Visual'};
// Rotas que saem da navegação principal (nenhuma fica solta — ou entram no
// dropdown de 3-pontos, ou em Configurações; ver comentário acima).
const ROTAS_OCULTAR_DA_NAV=[
 'producao-ficha-tecnica','producao-projecao','producao-funcionarios','producao-setup',
 'producao-mapa-fabrica','producao-config','producao-importacao','producao-estoque',
];

const _invalidadores=global.DTProducaoInvalidadores=global.DTProducaoInvalidadores||[];
function registrarInvalidacao(fn){if(typeof fn==='function'&&!_invalidadores.includes(fn))_invalidadores.push(fn);}
function invalidarTudo(){_invalidadores.slice().forEach(fn=>{try{fn();}catch(e){console.warn('[Producao] Falha ao invalidar cache:',e);}});}

// PEDIDO AO VIVO (auditoria, seção 4): #topbar-loja-sel do original é um
// <select> real que troca de loja ao escolher uma opção — não um botão que
// abre outro menu. Popula o <select> aqui e liga o troca real
// (aplicarTrocaLojaAnalista, a mesma função que o switcher global usa).
async function atualizarContextoHeader(){
  const id=global.getDTLojaAtiva?.()||'';
  const sel=document.getElementById('prod-loja-sel');
  if(sel){
    try{
      const lojas=await global.DTLoja?.listar(false)||[];
      sel.innerHTML=lojas.length
        ?lojas.map(l=>`<option value="${esc(l.id)}" ${l.id===id?'selected':''}>${esc(l.nome||l.codigo||l.id)}</option>`).join('')
        :'<option value="">Sem lojas</option>';
    }catch(_){ sel.innerHTML='<option value="">—</option>'; }
  }
  const nomeUser=document.getElementById('prod-more-nome-val');
  const emailUser=document.getElementById('prod-more-email-val');
  const avatar=document.getElementById('prod-more-avatar-val');
  const u=global._currentAnalistaUser||global.firebase?.auth?.().currentUser;
  const display=(u?.displayName||u?.nome||u?.email||'Usuário').trim();
  if(nomeUser)nomeUser.textContent=display;
  if(emailUser)emailUser.textContent=u?.email||'';
  if(avatar)avatar.textContent=(display[0]||'U').toUpperCase();
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

global.DTProducao={...(global.DTProducao||{}),registrarInvalidacao,invalidarTudo,atualizarLojaSidebar:atualizarContextoHeader};
global.addEventListener?.('dt-loja-alterada',()=>{invalidarTudo();atualizarContextoHeader();});

function criarHeader(){
  const shell=document.getElementById('setor-producao-shell');
  const aside=shell?.querySelector(':scope > .sidebar');
  if(!aside||document.getElementById('prod-original-header'))return;

  // NAO usamos aside.innerHTML. Assim os nav originais continuam exatamente
  // os mesmos objetos DOM que permissoes/irParaSetor/goPage conhecem.
  aside.classList.add('producao-sidebar-completa','producao-original-nav');
  const sec=aside.querySelector(':scope > .sb-sec');
  if(sec)sec.classList.add('prod-sb-sec-hidden');

  // PEDIDO AO VIVO (auditoria, seção 4): cabeçalho copiado literalmente do
  // original (index.html:114-170) — logo real, "DT Produção", subtítulo
  // "Planejamento e Controle de Produção", <select> de loja de verdade,
  // botão de tema, 3 pontos verticais com dropdown de 5 itens fixos.
  const LOGO_B64='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAPbWAAEAAAAA0y0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAAAkclhZWgAAARQAAAAUZ1hZWgAAASgAAAAUYlhZWgAAATwAAAAUd3RwdAAAAVAAAAAUclRSQwAAAWQAAAAoZ1RSQwAAAWQAAAAoYlRSQwAAAWQAAAAoY3BydAAAAYwAAAA8bWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIARwBCWFlaIAAAAAAAAG+iAAA49QAAA5BYWVogAAAAAAAAYpkAALeFAAAY2lhZWiAAAAAAAAAkoAAAD4QAALbPWFlaIAAAAAAAAPbWAAEAAAAA0y1wYXJhAAAAAAAEAAAAAmZmAADypwAADVkAABPQAAAKWwAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCADhAOEDASIAAhEBAxEB/8QAHQABAAMBAQEBAQEAAAAAAAAAAAEGBwUCBAMICf/EAEQQAAEDAwMCAgUJBQUIAwAAAAEAAgMEBREGEiEHMRNBFCJRYXEIFRYygZGhsdEjQlSTwSUzYmNyJENFUoKSstKiwuH/xAAbAQEBAAIDAQAAAAAAAAAAAAAAAQMGAgQFB//EADsRAAIBAwAGBgcGBgMAAAAAAAABAgMEEQUGEiExQVFhcYGRoRMVIrHR4fAHFDI0csEjM0NigvEkQrL/2gAMAwEAAhEDEQA/ALqiIvj59rCIiAIiIAiIoyMIiKAIiIAiIgCIiEYRERkCIigCIiEYREQgREQMKCpUFRkIREUB6REWUzBERAEREAREUZGERFAEREAREQBERCMIiIyBERQBERCMIiIQIiIGFBUqCoyEIiKA9IiLKZgiIgCIiAIiKMjCIqnrW83G2Q1ElHOGFhYG5YD3xnuPerCLnJRXMmczjDnJpLvLYiyD6caj/jI/5LP0T6caj/jI/wCSz9F3vVtbpX13HreprjpXj8jX0WQfTjUf8ZH/ACWfon041H/GR/yWfonq2t0r67h6muOlePyNfRZB9ONR/wAZH/JZ+ifTjUf8ZH/JZ+iera3SvruHqa46V4/I19FkH041H/GR/wAln6J9ONR/xkf8lv6J6srdK+u4nqa46V4/I19Fn2jdS3i51cjKupa5rSzAEbR3PPkrVqW6VFAyCnoo431lSX7HSAlkTGNLnyOAILgMABoIyXNGWjLh1ZW841PR8/pnk3P/ABqkqc+McefA66Khac1jW1MzJaqN7qMyU0UniwMjkjNQcQvBjkka4OcWtLOHN3AnIxm+pXt50JYkdehcQrx2ohERYDMEREDCgqVBUZCERFAekRFlMwREQBERAERFGRhUbqU3+z6t3+KP+ivKpXUpp+aqp2ON8f8ARc6L/jQ7UcY/mKP64mYoiLaTfgiIgCIiAIiIC2dNRmuqP+j8yr/qa2VNdHBU0D4m1lMX7WSu2slY9pa+NzgCW54IcAcFo4IyDQumTS6uqsDOGsP4rVVr93UcLqUl1e40fSkFO9rRf9vuRSbLpOWGaOnFO2gtjXUs0sAnDzNNT4LHgNY0NJLYy52SXeG0bW8k3ZEXXrV51nmR0qNCFFYiERFhMoREQMKCpUFRkIREUB6REWUzBERAEREAREUZGFTupoPzDUH/ADI/zCuKqXU5p+jkzv8AMj/NWm/41P8AUjjH8xR/XEylWPR2iNSark/si3vdTh219VKdkLf+o9z7m5PuWm9Juj7ZIob3q+Bw3EPgtruDjyMv57P+7zao6odQJ5qiq03pioFtslvDqeqqqM7JJXsyHxQlv93GzBaXNw4uBDS0Ny/YbOdxpS7+56PipS5yf4YrpfT9cSaya92+jIyjQ9prdnlnoXS/LtKxftGaM0X4cOrNSVlzuTnDfa7HC188bcE7nBxJ28dy0E+XmR37Y3oNJTxuNPd5cjkz0teHNPmCGNAyOxwqFbqZlNBhsLIC8l7o2DAaSckcdznufM5KmpYyLdVh7YnMG6RxOGuaByHeXA7Hy+GQd+hqBRnSX3i4m5c3FqPlh8PE+PXf2i6Zr1G41MLqyv8Azg2K06L6OX8iG0shM7h6sQrp2TEe0RyO3fbhcjVvRvSNE3dBqz5mkd6wbcZY3MI93LCB7+VmEYmrMSPMtPBnMbASyR2Ozie7PaAMEcZPdoi83KgtFHNcrjM2GPdue8jLnvP4ucV57+zypTq7cL2Sp/3JN+LePIy2/wBomlaWMSbl+pteDTPx1BpG5WkSSxVFuu1JHkuqrZVNqI2gZ5cG+swcd3AD3qvrq2HUFddnRVUFiqaWlfh0M9ROxkjx7WsGT7wc/Aq+0WgxrTTdXcbMxkF7oZA2WEYbHWMIy13kGScOB8jgE4JJXV0zob1VbK5dTahlJvGzjPB9a6+tbsb19F1Y+0qN9XVppGChLlJPK71y93YcHpSM3Cr9zWfmVp6zbpZBNBd7jBPE+KaJobJG9pa5rg4ggg9iPYtJXz+9ebmfd7jYNIPN9Va/t9wREXXOswiIhAiIgYUFSoKjIQiIoD0iIspmCIiAIiIAiIoyMKz6O07TV2y53GnZNHFIH0zHjI3tz65HuPb3jPkFwLZSPrrhBSR5BleG59g8z9gyVqsEUcELIYm7Y42hrR7AF52kKuylFcTwdOXXo4Rpxe97+4r3U+8T2LQd2uNJKYqvwhBTSAZLJZXCJj8f4XPDvsX80zQxw0MVPCwMiY6JjW+xoe0Y+7hb910bv0JgglvpkJP2biPxwv5n1lq216fi8GVxqK0gOZTRnnvkFx/dH4+wFfXvsvo0aGiq1zLc5Tw31KKwvFs+R6w+kq3UKUVnCz4v5FkVXvmsNO0dYIKm5MkbDh72QNMpc/Pqty3IGCCSDjnb71mF51JqDVFRJA+cxw+FLL6LCS2MMjjc9+fN2GtcefZxhbnbeh+jjoHTbr5dWWG5VjI6itlqJGiaWV0eRTs3uDWNaXnc0NLnEN5GFtekNZadDCguP1wONhq7OvlyfD64lFm6p2ZryIrbcpGjzIjbn/5FU/Wur23+6Uc0VI9tHSNLmQT4IdKf3nAHBHDePiPNf0BafkzaRp5WvuN+vde0HJjaY4Wu9xw0n7iFwKn5OtjutTcarTmuYJoWOk8KjhiZIIX87InS+ISAOASRu4z3Xi1dZ1XThKW7sPYp6tyoNSjHf2la0DFpyso2VDKmnut3czfVz1A3TB3ngOGWtB4GABwF/UXQuzzUGk5LlUsLJLpKJomubgiBoxHn/V6zx/he1fxZ0905d4Orlpt7aIVZt+paa3Vj4m+JCXeM4OaeOWOZDMTkYLWuyv8ARM91qWv2sEqlpTsIRSUvak1zxwXfxfccNG6NVK4lWlJvkuopus9K0stXPqKhgayvMQZU7ePFY3s4jzcB5+Y+AVRWwfFZjqWgFuvE0DBiJ3rxf6T5fZyPsXzqwrOTcZM+iaEu3NulN5eFjsW7HdyOaiIvSNgYREQgREQMKCpUFRkIREUB6REWUzBERAEREAREUZGWbp5T+Jc56kgEQxbR7i4/oD96vSqnThmKStk45ka37gf1VrXg3ss1maTpebldy6sLyKh1mtF3vfTC+0FgJF2NN4tGGtBLpGEPDQDxl2C0Z/5l/Blz0Frulsb9S3DTF2ZQPzLLUyx+sBzl72k72jj6zgB55X+kQ7hZnT0lbW26kmZWyxV9N4cM8TpHCJj2YEzHMHD8kEZdnggtxnJ3DVLS1W3ozobtlNS72sP3I8n7jC4m5Pc8GI/JI0HQVVnrNaXSKOpNS59FSQvALWxtLTI8+3cQG49jT33caX1Ar+mFq1LHU60gs81xqYxFE+5QCbawAnazc0tjHrEku2BxcQC4ggXey2m2WWi9BtFvpqCl3ukENPGI2BzjkkNHAyqH1W6Y6U1RXR6lv9RcooaBni1cEFRthnYzkue0tJGGgglmHFox7FsKuYV7lzqt4fDHkd9206Fso00srjnzL5XyW6hsVRLUtgZbaelc6RpDRGIWsORzhobtHngY9yzjR9x0Pd7peI+ntqtVt1XbqOaARxUb6MB31A2ZrooyWCQM7tJG3sDwb/PRwXuiirg6nq9PS0krJXsj8Smnjkbgh0zT4fh4798nHIxzXtC9P9K6Fgq6nTNtno6m4+HC70iZ0j2Eu2sjBcTtG54zg88cnAWF4oUZ+kTUnw6OvPScqknVmpU5LZXHm+os/R3ptaunek4bVG8XC4PnNZW18rMvmqXN2l4zktAaS0c5wXZ5c7N6UnkkjkKF8vr3FS4qOrVeZPidCMVFYQVT6jU7TTUtWBhzXmI+8EZH3YP3q2Lg67aDp55OctlYR9+P6rlay2asTv6Om4XUGunHjuM9REXvm8MIiIQIiIGFBUqCoyEIiKA9IiLKZgiIgCIiAIiKMjLj03kGyui88sd/5D9Fb1neh6ptNfmMeQG1DDFknzOCPxGPtWiLwr6GzWb6TTNM0nC6b6cP9v2C51bZLXWVnpk1KRUkAOlilfE54HYOLCNwHkDnC+6aWKFgfNLHE0kNDnuDRk9hz5rJesXVqmtML7BpCtp6u8yt/b1kRbLFQMI7+bXzEEbW8huQ5/G1r+xojR97pC5jQs09t9G7HW3yR4tatCjFzm8JFo6l3ah0ha4bxOyWSF8rKf0aIAyOJ/ebuIBwAScn7c8GuUXUTRVdTkuvMNO0nY5lZG6Hk8Y9cBpz24JByv53qCJKmStqpHz1MpxJU1EhfLISeNz3HcTn2n2L4q2lqqhvo4kiMDiHFz872kHLQMd+QDnIIx59x90sdQ429oqdes5VOlLC7MPLeHz3dh5MdZK0ZborZ6+PianpzRnR+xa5pKuiuNJca8Vu220FO0SllQCQBlmdzmntvIDcAk5GVvFjtVbLWR3G6RCmEOTTUYeHOa4ggvkcON2CQGtJaMkkuJbs/jOWGa6vqbpXT/7VcJXVUoaxrmML5DIGgEZw0u+3GcLYui/VmisFLU2jVd1qpaAwtqLbIYpamRnIDosNDnbDlrm5GG4eMgbQNf1o1W0jGxVa2k5vC2o4zLfu9nHHjvWM9Z3I6eVxUcJpRXSt3Dhk1bXFvfUakovSpJzSVcHo9M+GVzJKSpZvkL24PBczPrcYMQBzuAHzwa7rodM0V8q7TCaBlHHPX1MtV4L/AKgL3RRbCHDOcBzmE8Y7jNc0n1It+utcVTaOnfT0cNCHWp0rv2lSwvzNIWY9TtDhpJO3k4O5o5NuguWntRzW64Sz1kb3vqLPLNQTVvokDXlgijZCcN2tLMucGHEoG5+MDVqWhGqEKN7DE4rOODw9/Lqx+6yenRUKtJTi8rfv+JukEsU8Ec8Esc0MjQ+OSNwc17SMggjggjnK4Ov5dliDM/3k7W/gT/ReunfiHRlue9rQ17XyQ7Y9m6J0jnRO25wCWFpIGACTgAcDj9RKvfW09G0giJhe74u8vuH4rTqVHZunBb9lvyO3oum6l1Dq3+BVkRF7JuzCIiECIiBhQVKgqMhCIigPSIiymYIiIAiIgOtYrXBW0lXV1dRJBBTkAubHu3E+QA5J5bwASdwAXTp9L0tbTCehuMuM4LZqdzHNIPIc12HNPuI/NfbpSkp5tHBtQdjKiSR73NfggiQhrg7yI2tII5BAx2X10NbbqBrqSN8zw6RzhL68+8k8Fz/WJPYcnyA4AwN9s9C2TtoOrDLaTby+fefOb7T18rqfop4im0lhcu44n0VmjqWsjuEYkGHD9m4Y96usDpPBZ4+0y4G8s7E+5ZDr7UesXdcNM6J05ffQ6e42+asuLGRQPMEbN+17XPhcWlzmlvO8cDDRzn6dE6x1Uzq3fOml/moLhNRULLlR3ADY90DixpZIGNa0vBeOQ1oIB49itqvo2t+KD8Wefc6XurlL0kk8dSPu6g2+61V+rJqi2VlyoJKCWClEURnjjL2xgZjGcPD2Py/b9WVvOGO28+5WKg1hV3ChqaGpilqquDwpZKV0M8cMbGOL/XaHNaSZWDIwSSOcruVvVnRlJS0lUKyrrKasuLbZS1VJRvfBU1JONkb/AKrwDkbgS3IIBJBxatVUtzrtN3Ggs1c2huFTTvhp6o5/2d7ht8UY7ludwHmQBkd13aGh6Ntsqi3HZ4Yf7mJaQn6NwcU0zErj0Lu0dkpIqKuoK25OmL6qaomfFHHG36jI2NYdzicFz3Yxtw1oySuWOi2tt3HzScefpZ/9F2LVeteXfVfUq1UnUmoo7ZpOnZHSV9ZR0LGOqjE4uM7/AEfaI2vY7dtAIGOfbo9l6iaQqKyCzx3Wp9I+aW3OGSqppWek0m7YJ2lwy7cRwPrOzkAg5Wy2+krigmtray85e/8A0upHkTtqcuWDCaLoxryhi2ix0r5XYMj4a2LDiBgZ3OBzgDyX5W7pH1Ap43Q/RprSxxa0trablgJ2f7zybgc+xbdaurHTy6y2RlJfpXPvkVRNRB0czdzIC8SF2R6nMb8A8nHHcL9LZ1c6f3UWZtLfCRemzupC+nkYNsO8Pc8kDYP2b8bsZwfes8NM1449lbu34nB2kHzZk2heimsX3uNt4qX6ft9K4TQ1dPOySraSSPDi2OIYQCRvdkbTtLX5JW6HRumqieKS50rr2+ncXRC4uEzYnEYyGH1A7H723dyeeVnNg1tp2NutNbXnVMlVpSnuEdFRUYt9RFNQyRxjxmuaWh7iXPaTkENxyW8gXu16v0h9NYNIUNbIbvUUpqo4/Cl8N0Y7+uRtJHORnIwQcHha3pSyWlKyqXEnhLCSeFjuWfFs71Co6EHCD4/X1uLeHMAADSAPLKqFw0rW1dXNVPr4XSSOLjlhHwHw8lkfSPqVabLQ6o1jq/Ud3mttzv8AJS2gTPnq2U1FG8tjf+9sYXSFpccbizzIW26j1JbrNcqC1S1JddLg5wpKKGB000waMudtb9Vg83uw0e3K8yGq+jKf4KeO9/E71tpa6tpN05cepHCOj7jniopD8XO/9Vzn2iUCp8Oqp5XU7XOc1u8bg04eWktAcGnhxBODweV2tA62pdb2epvFgcJaKnq30hkmppYi57A0kta4biPWHl3yO4Xctduo2PfUtikEjw9mHPk2sa925wY1/wBUE4JwB2HkAktW7KSaimn2noR1lvU05NNdhm6L1MwxyvjJBLXEZHnheV89aw8M+iJ53hERAwoKlQVGQhERQHpERZTMEREAREQF10LXQR6TzPMyNlHNLHI5xxt9cuGfse3711Y6u2XPYWRtq49zmtf4Je1rgdrgePVIIIOcYwQVnFJU1VE6oFOY3RVIYZI5N2A9jg5kjS0ghwIHPuC6NLqO800HgwuogC4ve98T3ve4nLiSX+0nywBgAAABb1aaftI28I1HhpJPc+R87vNXb13M3TjmLbaeVzKfpWuDvlF6t1ldLNf6W101phttmkFgrCKhmWulLA2Ikne12OOQ7jKqfUOwa3GmepXVD5puNDddQtgtlvoWsLqqmtofGx7ntbnaZGsYC3u3Lj55WuSakv7wQLgIuP8AdwR//YFV3VuudVWW3yVVLdXSPY9oxJBEQQTz2YFmWstk5KKzv3cPmYlqxfOUY7syeFv5srV7tlfV9Qekdntem7w3TVnpZKimpnUro3MkZGBFPO4jER8RoPres0Zdy5+1bzdqq2WKiluVdLWPihG8saZah7+ezYm7i45PZrVg0HXDVsZHi01BOAezm7c/9oC6tP1ynmLRPYHySu4Ho1TIwO+ADl3lpKhL/R26mpOmaf8ASyuqUfiZzV2PVdT8nK/1FRZL1Dcrxq8XPUNEbfLHUNo3EnDGuaC8B7WvyOBk5xgrW5LdZzatWdRLHRX+/Xr5lfFbqyvoXRcgF0VPS03hsIax7Yzu2ZyeHOIfjmxddoo/7jTe1w8zNuP2nOT96P691rjltgpx/rkcfyK5+srfp8mYlqbpp/0POPxOroWwfQX5PFHG6yS12o6Gzy10UTqEyzsrJI97YxhpLXNIjZxz+zHmF56bWJvTr5OVHVOs4qb/AENrmukcE1MDOyrkjLwwNI3NcMsYQBn1TkZyq7N131G4ER2a1xnyO55/Mr5z1w1WXbhR0DfcAf0XF6UodZnjqLpp8aSX+UficAabvM/yYrBoy3WS4/OmorzDHcqmWkeZYmySiWWaVuNzGNdHCwueRuEe7ttJ79wp9Q2vqn1Avdv0zcZzYdMstVhf4Ejmva+IyGRrgw+LKZiOBgkSPJ7Er03rnqncC6325w8/rZP2r9h131GP+DWw4Hm56es6HWR6jaaXCkn/AJR+JTJdE6iseh+lujXaYrLnDWXT51vDYGvLvEZh7KWYlu2FoErmnJ2gh7uOV3LRfNWN1z1hvtRpy7O1TDSupqGaKMSRW+jja8t8J7sbi/axzWtadzsO2kbldtJ9Xb7fKmWE2u2Q+GASf2h3ZP8AqVqbrC8Bxd6JbcnzDXg/+S609O2UJ7EptNdXyOhV1b0jSqOnOn7S61z7zj/Jnp5LL0dsVpls9dRyxxukkFSY2SPe9xe8mMu3NALtoyASGg9iFozLtQPjqXx1MT3UwcZWNkBLcEg5wT5tI+II7gqoP1ddJCDJQ2x+O25rz/Vcl1fVvY6NxY2PYY4mNziGMuDixmTw0lre+T6oAOBhYq2sVnCnJwll8lh8S0dXb2dSKnDEebyuHifg9znuLnElxOST5lQiL52fRgiIgYUFSoKjIQiIoD0iIspmCIiAIiIAiIoyMKldS3H5oqmHsHxkfgrqqP1Kd/Z1W3z3R/0XOis1odqOMfzFH9cSo6HoqGpvjKy7vgjtNAW1FY6cP8Nw3AMjdsa44e8tacDO3cfJaZc7dNprUfWO707ZWCCF9HBHG0gZrZN5cMeTIw4+4c+xY/SXC4UcEkFJcKumhlcx8kcM7mNe5hyxxAOCWkAgnsRkL9au83isZVMq7xcallWWGpbNVSPE+z6m8E+tt8s5x5LcIVYwjjG/5P5Gz3mj61zW2tv2cJY6lKMn3tKSfU10Gq1ej7PJddP6Wuk1zprVbNMz3ermEcLJYJJMyvDyGZcB+yG31iC7AOOT8uuOmNntFolNqmuc1zfdKG1xsmlYY4J5YWPlbLhgOAZGesPN4GOCs2ku18rqqaWW63OqqJ6f0eZ7qmR75Icg+G4k5LMgeqeOBwvqlGqrk18dTNeKhr6j0pwqJpCHTEAeL6x5fgAbu+ABlWdzRSe0vPuOirK6t5wlO5UUuK4JvO033tvP+y9Veg9Ix6xsulKSvuldcJr5Jbq0wubtMUbWh79xZsY8PLjsaXlrMbvWOF0KHp9pSPXGiKeL5xqqG5OrK2sNRIwxPpYHOdE4EMxse2NxI7lrm/VJWe3GbWsl0iudbX3ypuETfDiqjVSSysaQQQ14JIBBI4POT7V8HzrqGklppPnS708lJEYKZ3pMrDBGQcsYc+q0gn1RgKQuqEnmKT3+W4kbS6rQShdZ9lp4ectqSzu5JtNdhoWmdEWC/wBVb6y4w11s+kddcBT00UjWstUNMwukfJlgyQ8taGYaA3I7kEcGfS1qh6SR6lcyvdePFYyqidII203iODoHeE5mXxSQ5cHtd9bHcbsVSmu11pbZNa6W51sFBOSZaWKdzYpM4zuaDg52tz7drc9hhVXa61Vugt1Vc62eip8eBTy1D3RxYBA2tJwMAuxjtk+0p6SGOG/Hw+u/B3Y2N3Gon6X2dpPG/gnLd3ppPfvcVJt5adj6YuLK+qI7lrB+K1RZT00OK6p+DPzK1Zarf/mJd3uPD0h+fq/4+4IiLqHVYREQgREQMKCpUFRkIREUB6REWUzBERAEREAREUZGFWdSWiS6zzwOilMT3MOWkDOAPMqzIibTyjFUpuey08NPOUUim0RStwXUbMjPMkzj+AOF0qbSlJEciGkjOO7YQT95VlRc5VakuMm+8soTqfzKkpdsmcuOywtaA6eQ4/5cAL9mWqiaOY3O+Lj/AEX3IseDFG0or/qvefC+1UThxG5vwcf6r8XWaLjZPK344K6iJhCVpRlxiiu1Ol6eU7nR0krva+Af/q51ToqkeS70KEn/AC5HN/DICuaLmqk4/hk13nKNOVP+XOUeyTKZZ9OG01hkggnAkLQ4FwcBg58virmiLjKUpvMnlnKMZbTnOTk3zfUERFxOTCIiECIiBhQVKgqMhCIigPSIiymYIiIAiIgCIijIwiIoAiIgCIiAIiIRhERGQIiKAIiIRhERCBERAwoKlQVGQhERQHpERZTMEREAREQBERRkYREUAREQBERAEREIwiIjIERFAEREIwiIhAiIgYUFSoKjIQiIoD0iIspmCIiAIiIAiIoyMIiKAIiIAiIgCIiEYRERkCIigCIiEYREQgREQMKCiKMhCIigP//Z';
  const header=document.createElement('div');
  header.id='prod-original-header';
  header.className='prod-original-header';
  header.innerHTML=''+
    '<div class="prod-original-logo"><div class="prod-logo-mark"><img src="'+LOGO_B64+'" alt="Da Terrinha"></div><div class="prod-logo-copy"><div class="prod-logo-name">DT <span>Produção</span></div><div class="prod-logo-sub">Planejamento e Controle de Produção</div></div></div>'+
    '<div class="prod-header-actions">'+
      '<div class="prod-loja-wrap"><span class="prod-loja-icon" style="font-size:14px">🏭</span><select id="prod-loja-sel"><option>Carregando...</option></select></div>'+
      '<button type="button" id="prod-theme-toggle" title="Alternar tema claro/escuro">☀️</button>'+
      '<div class="prod-more-wrap"><button type="button" id="prod-more-btn" title="Menu">'+
        '<span></span><span></span><span></span>'+
      '</button><div class="prod-more-menu" id="prod-more-menu">'+
        '<div class="prod-more-user">'+
          '<div class="prod-more-avatar" id="prod-more-avatar-val">?</div>'+
          '<div style="min-width:0"><div class="prod-more-nome" id="prod-more-nome-val">—</div><div class="prod-more-cargo" id="prod-more-email-val"></div></div>'+
        '</div>'+
        '<button type="button" class="prod-more-item" data-prod-menu-acao="meu-perfil"><span>👤</span> Meu Perfil</button>'+
        '<div class="prod-more-sep"></div>'+
        '<button type="button" class="prod-more-item" data-prod-menu-acao="projecao"><span>📈</span> Projeção de Vendas</button>'+
        '<div class="prod-more-sep"></div>'+
        '<button type="button" class="prod-more-item" data-prod-menu-acao="config"><span>⚙️</span> Configurações</button>'+
        '<div class="prod-more-sep"></div>'+
        '<button type="button" class="prod-more-item prod-sair" data-prod-menu-acao="sair"><span>🚪</span> Sair</button>'+
      '</div></div>'+
    '</div>';
  aside.insertBefore(header,aside.firstChild);

  // PEDIDO AO VIVO (auditoria, seção 5): pílula de abas separada do
  // cabeçalho, com só as 9 rotas principais — nada de "Mais" aqui.
  const tabs=document.createElement('div');
  tabs.className='prod-original-tabs';
  header.insertAdjacentElement('afterend',tabs);
  ROTAS_PRINCIPAIS.forEach(id=>{
    const n=document.getElementById('nav-'+id);
    if(!n)return;
    n.classList.add('prod-tab-btn','prod-primary-tab');
    n.dataset.prodRoute=id;
    const rotulo=ROTULOS_CORRIGIDOS[id];
    if(rotulo){
      const icone=n.querySelector('.nav-icon');
      n.textContent='';
      if(icone)n.appendChild(icone);
      n.appendChild(document.createTextNode(rotulo));
    }
    tabs.appendChild(n);
  });

  // As rotas que não têm mais entrada própria na navegação (auditoria,
  // seção 4/7.10) só ficam alcançáveis por Configurações (77-producao-
  // config.js já embute cada uma) — os nós originais continuam existindo
  // no DOM (permissões/goPage dependem deles) mas escondidos, nunca
  // apagados.
  ROTAS_OCULTAR_DA_NAV.forEach(id=>{
    const n=document.getElementById('nav-'+id);
    if(n)n.style.display='none';
  });

  const moreWrap=header.querySelector('.prod-more-wrap');
  const menu=header.querySelector('#prod-more-menu');
  aside.addEventListener('click',e=>{
    const theme=e.target.closest('#prod-theme-toggle');
    if(theme){e.preventDefault();e.stopPropagation();toggleTheme();return;}
    const maisBtn=e.target.closest('#prod-more-btn');
    if(maisBtn){e.preventDefault();e.stopPropagation();menu.classList.toggle('on');return;}
    const acaoBtn=e.target.closest('[data-prod-menu-acao]');
    if(acaoBtn){
      e.preventDefault();e.stopPropagation();
      menu.classList.remove('on');
      const acao=acaoBtn.dataset.prodMenuAcao;
      if(acao==='meu-perfil')abrirMeuPerfilProducao();
      else if(acao==='projecao')global.goPage?.('producao-projecao');
      else if(acao==='config')global.goPage?.('producao-config');
      else if(acao==='sair')global.doLogoutAnalista?.();
      return;
    }
  });
  document.addEventListener('click',e=>{
    if(!menu.classList.contains('on'))return;
    if(!moreWrap.contains(e.target))menu.classList.remove('on');
  });
  document.addEventListener('change',e=>{
    if(e.target?.id==='prod-loja-sel'&&e.target.value)global.aplicarTrocaLojaAnalista?.(e.target.value);
  });

  aplicarTemaSalvo();
  atualizarContextoHeader();
}

// PEDIDO AO VIVO (auditoria, seção 4): "Meu Perfil" do original mostra
// nome/e-mail/cargo e permite trocar a própria senha (app.js:14208-14262).
// O projeto integrado não tem essa tela em lugar nenhum — construída aqui,
// mínima e real (sem campo "nome"/"cargo" editável: a identidade do
// usuário já é gerida em Usuários do Sistema, fora de Produção; troca de
// senha usa o mesmo Firebase Auth da sessão atual).
function abrirMeuPerfilProducao(){
  const u=global._currentAnalistaUser||global.firebase?.auth?.().currentUser;
  const nome=(u?.displayName||u?.nome||u?.email||'Usuário').trim();
  const host=document.getElementById('preal-modal-host')||(()=>{const d=document.createElement('div');d.id='prod-perfil-modal-host';document.body.appendChild(d);return d;})();
  host.innerHTML=`<div class="modal-backdrop show" data-prod-perfil-fechar><div class="modal" style="max-width:380px" onclick="event.stopPropagation()">
    <div class="modal-header"><b>👤 Meu Perfil</b><button class="modal-close" data-prod-perfil-fechar>×</button></div>
    <div class="modal-body">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="width:44px;height:44px;border-radius:50%;background:var(--orange,#e07020);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700">${(nome[0]||'U').toUpperCase()}</div>
        <div><div style="font-weight:600">${nome}</div><div style="font-size:.75rem;color:var(--muted)">${u?.email||''}</div></div>
      </div>
      <label style="display:block;margin-bottom:6px">Nova senha<input type="password" class="field" id="prod-perfil-senha" placeholder="mín. 6 caracteres" style="width:100%;margin-top:4px"></label>
      <label style="display:block">Confirmar nova senha<input type="password" class="field" id="prod-perfil-senha2" style="width:100%;margin-top:4px"></label>
      <div id="prod-perfil-msg" style="font-size:.78rem;margin-top:8px;display:none"></div>
    </div>
    <div class="modal-footer"><button class="btn btn-ghost" data-prod-perfil-fechar>Fechar</button><button class="btn btn-primary" id="prod-perfil-salvar">Alterar senha</button></div>
  </div></div>`;
  host.querySelectorAll('[data-prod-perfil-fechar]').forEach(el=>el.addEventListener('click',()=>{host.innerHTML='';}));
  host.querySelector('#prod-perfil-salvar')?.addEventListener('click',async()=>{
    const s1=host.querySelector('#prod-perfil-senha')?.value||'',s2=host.querySelector('#prod-perfil-senha2')?.value||'';
    const msg=host.querySelector('#prod-perfil-msg');
    const mostrar=(t,ok)=>{if(!msg)return;msg.style.display='block';msg.style.color=ok?'var(--success,#5ab848)':'var(--danger,#cc2800)';msg.textContent=t;};
    if(s1.length<6){mostrar('A senha deve ter ao menos 6 caracteres.',false);return;}
    if(s1!==s2){mostrar('As senhas não coincidem.',false);return;}
    try{
      const cu=global.firebase?.auth?.().currentUser;
      if(!cu)throw new Error('Sessão não encontrada.');
      await cu.updatePassword(s1);
      mostrar('Senha alterada com sucesso.',true);
    }catch(e){mostrar('Erro: '+(e.message||e),false);}
  });
}

function aplicarTemaSalvo(){
  const shell=document.getElementById('setor-producao-shell');if(!shell)return;
  const light=localStorage.getItem('dt-producao-tema')==='light';
  shell.classList.toggle('prod-light',light);atualizarBotaoTema();
}
function atualizarBotaoTema(){
  const shell=document.getElementById('setor-producao-shell');const b=document.getElementById('prod-theme-toggle');if(!shell||!b)return;
  b.textContent=shell.classList.contains('prod-light')?'🌙':'☀️';
  b.title=shell.classList.contains('prod-light')?'Usar tema escuro':'Usar tema claro';
}
function toggleTheme(){
  const shell=document.getElementById('setor-producao-shell');if(!shell)return;
  const light=shell.classList.toggle('prod-light');localStorage.setItem('dt-producao-tema',light?'light':'dark');atualizarBotaoTema();
}

function decorarPagina(page){
  if(!page||page.dataset.prodDecorada==='1')return;
  page.dataset.prodDecorada='1';page.classList.add('producao-page-completa');
}
function decorarTudo(){document.querySelectorAll('#setor-producao-shell [id^="page-producao-"]').forEach(decorarPagina);_sincronizarModoConfig();}

// PEDIDO AO VIVO (usuário: "quando entra nas configurações, não aparece
// Gantt, não aparece Dashboard, não aparece máquinas" — no original,
// Configurações SUBSTITUI a tela inteira: some a barra de 9 abas, fica só
// "‹ Voltar" + "⚙ Configurações" (index.html:986-992). Eu tinha deixado a
// barra de abas sempre visível por cima, inclusive dentro de
// Configurações — errado. #setor-producao-shell ganha a classe
// .prod-config-modo sempre que a página ativa é producao-config (CSS
// esconde .prod-original-tabs nesse estado); sai sozinha ao navegar pra
// qualquer outra página, sem precisar que cada tela saiba disso.
function _sincronizarModoConfig(){
  const shell=document.getElementById('setor-producao-shell');
  if(!shell)return;
  const pagConfig=document.getElementById('page-producao-config');
  shell.classList.toggle('prod-config-modo',!!pagConfig&&pagConfig.classList.contains('on'));
}
// Guarda a última página não-config visitada, pra "‹ Voltar" saber pra
// onde ir — captura ANTES do clique navegar (fase de captura roda antes
// do onclick="goPage(...)" inline nos próprios nav-items).
global._prodPaginaAntesConfig='producao-dashboard';
function _rastrearPaginaAntesConfig(e){
  const shell=document.getElementById('setor-producao-shell');
  if(!shell||!shell.contains(e.target))return;
  const atual=shell.querySelector(':scope > .content > .page.on');
  if(atual&&atual.id!=='page-producao-config')global._prodPaginaAntesConfig=atual.id.replace(/^page-/,'');
}

function observarConteudo(){
  const content=document.querySelector('#setor-producao-shell > .content');
  if(!content||content.dataset.prodObserver==='1')return;
  content.dataset.prodObserver='1';
  // Observamos apenas filhos adicionados. Nao observamos mudancas de classe,
  // evitando ciclos com goPage/permissoes.
  const mo=new MutationObserver(()=>decorarTudo());
  mo.observe(content,{subtree:true,childList:true});
  document.addEventListener('click',_rastrearPaginaAntesConfig,true);
}

// Pedido ao vivo do usuário: "mexer em tudo" — modais (edição de máquina,
// setup, ficha técnica, funcionário, reordenar fila do Gantt...) são
// elementos <div class="modal-bg"> que vivem FORA de #setor-producao-shell
// no DOM (irmãos, não descendentes), então não herdam as variáveis
// --prod-* mapeadas nele. Marca o <body> quando o setor ativo é Produção
// e o CSS (producao-completa.css) escurece qualquer modal aberto nesse
// contexto, sem precisar duplicar a lógica por modal.
function _shellProducaoVisivel(){
  const shell=document.getElementById('setor-producao-shell');
  return !!shell&&global.getComputedStyle(shell).display!=='none';
}
function _patchModaisParaTemaProducao(){
  const origOpen=global.openModal, origClose=global.closeModal;
  if(typeof origOpen!=='function'||origOpen._prodPatched)return;
  function open(id){
    if(_shellProducaoVisivel())document.body.classList.add('prod-modal-context');
    return origOpen.apply(this,arguments);
  }
  function close(id){
    const r=origClose.apply(this,arguments);
    if(!document.querySelector('.modal-bg.open'))document.body.classList.remove('prod-modal-context');
    return r;
  }
  open._prodPatched=true;
  global.openModal=open;global.closeModal=close;
}

function init(){criarHeader();decorarTudo();observarConteudo();atualizarContextoHeader();_patchModaisParaTemaProducao();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();

global.ProducaoUICompleta={montarSidebar:criarHeader,montarShellOriginal:criarHeader,toggleTheme};
})(window);
