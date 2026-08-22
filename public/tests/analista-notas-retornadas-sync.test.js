// FASE 4 (ponta Analista): o botão "Buscar" (antes "Sincronizar Bluesoft")
// cai na MESMA pré-visualização/gravação já usada pelo import de PDF —
// este teste dirige o fluxo completo (buscar → revisar → salvar) via DOM
// real e confere que os campos aditivos (FASE 3) chegam certos no
// documento gravado em recebimento_recusas_notas. Reescrito 2026-08-19: o
// vendedor agora vem de enriquecerNotasComVendedorPorComissao (targetado,
// a partir das próprias notas buscadas) em vez do antigo cache que
// varria o cadastro de clientes inteiro — pedido ao vivo do usuário.
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const base=path.join(__dirname,'../js/analista');
const recusasCode=fs.readFileSync(path.join(base,'97-recebimento-recusas.js'),'utf8');

function mockColecao(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  return {
    get: async()=>({ empty: registro.size===0, size: registro.size, docs:[...registro.entries()].map(([id,data])=>({id,data:()=>data})) }),
    doc:(id)=>({
      id,
      set: async(payload)=>{ const a=registro.get(id)||{}; registro.set(id,{...a,...payload}); },
      delete: async()=>{ registro.delete(id); },
    }),
    _registro: registro,
  };
}

function carregarPagina(colecoes,notasBluesoftMock,enriquecerVendedorMock,xmlMock){
  const dom=new JSDOM('<!doctype html><html><body><div id="page-recebimento-recusas"></div></body></html>',{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window; const document=win.document;
  win.getDTFirestore=()=>({ collection:(nome)=>colecoes?.[nome]||mockColecao([]) });
  win.firebase={ auth:()=>({ currentUser:{ uid:'u1', email:'analista@daterrinha.com' } }) };
  win.showToast=()=>{};
  win.aplicarPermissoesAnalista=()=>{};
  win.obterNotasRetornoBluesoft=notasBluesoftMock;
  if (xmlMock) win.obterDadosXmlNota=xmlMock;
  if (enriquecerVendedorMock) win.enriquecerNotasComVendedorPorComissao=enriquecerVendedorMock;
  win.eval(recusasCode);
  return { win, document };
}

test('sincronizar Bluesoft → revisar → salvar grava os campos aditivos da FASE 3/4 em recebimento_recusas_notas',async()=>{
  const notas=mockColecao([]);
  const notasBluesoftMock=async()=>[{
    chave:'35260800123456780001235500100000123412345673', numeroNota:'12345', serie:'1', cfop:'1202', tipoOperacao:'ENTRADA', naturezaLabel:'Devolução',
    dataEmissao:'2026-08-10', destinatarioNome:'Mercado Atacadão', destinatarioCnpj:'12345678000199',
    itens:[{produtoKey:1,descricao:'Refrigerante 2L',quantidade:12,gtin:'789',ncm:'2202'}],
    notaOriginalChave:null, notaOriginalNumero:null, pareceDevolucao:true, origemImportacao:'BLUESOFT',
  }];
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) }, notasBluesoftMock);

  await win.renderRecebimentoRecusas();
  assert.match(document.getElementById('page-recebimento-recusas').innerHTML,/data-recusa-sync-bluesoft="1">Buscar</);

  document.querySelector('[data-recusa-sync-bluesoft]').click();
  await new Promise(r=>setTimeout(r,0));
  assert.match(document.getElementById('recusas-preview').innerHTML,/parece devolução/);
  assert.match(document.getElementById('recusas-preview').innerHTML,/12345/);
  assert.match(document.getElementById('recusas-preview').innerHTML,/>Devolução</); // pedido ao vivo: "tem que mostrar a natureza"
  assert.doesNotMatch(document.getElementById('recusas-preview').innerHTML,/Buscar volume no XML/); // pedido ao vivo (2026-08-20): devolução nunca busca XML — nem botão, nem automático

  document.querySelector('[data-recusa-salvar-import]').click();
  await new Promise(r=>setTimeout(r,0));

  const doc=notas._registro.get('35260800123456780001235500100000123412345673');
  assert.ok(doc,'nota deveria ter sido gravada por doc(chave)');
  assert.equal(doc.numeroNota,'12345');
  assert.equal(doc.serie,'1');
  assert.equal(doc.cfop,'1202');
  assert.equal(doc.naturezaLabel,'Devolução');
  assert.equal(doc.informacoesComplementares,''); // honesto: vazio, não inventa motivo pra nota vinda da Bluesoft
  assert.equal(doc.tipoOperacao,'ENTRADA');
  assert.equal(doc.destinatario,'Mercado Atacadão');
  assert.equal(doc.destinatarioCnpj,'12345678000199');
  assert.equal(doc.itens.length,1);
  assert.equal(doc.itens[0].descricao,'Refrigerante 2L');
  assert.equal(doc.pareceDevolucao,true);
  assert.equal(doc.origemImportacao,'BLUESOFT');
  assert.equal(doc.notaOriginalChave,null);
  assert.equal(doc.ativo,true);
});

test('FASE 5 (reescrita): "Buscar" enriquece as notas via enriquecerNotasComVendedorPorComissao (targetado, sem cache/sem consultar todos os clientes) e grava tudo na nota salva',async()=>{
  const notas=mockColecao([]);
  const notasBluesoftMock=async()=>[{ chave:'35260800123456780001235500100000123412345673', numeroNota:'1', destinatarioNome:'Cliente X', destinatarioCnpj:'12345678000199', itens:[] }];
  let notasRecebidasPeloEnriquecedor=null;
  const enriquecerMock=async(notasRecebidas)=>{
    notasRecebidasPeloEnriquecedor=notasRecebidas;
    return notasRecebidas.map(n=>({ ...n, vendedorNome:'João Vendas', vendedorEmail:'joao@x.com', supervisorNome:'Pedro Supervisor', supervisorEmail:'pedro@x.com' }));
  };
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) }, notasBluesoftMock, enriquecerMock);

  await win.renderRecebimentoRecusas();
  document.querySelector('[data-recusa-sync-bluesoft]').click();
  await new Promise(r=>setTimeout(r,0));
  assert.equal(notasRecebidasPeloEnriquecedor.length,1,'o enriquecedor recebe só as notas que vieram da Bluesoft, não uma lista de clientes');
  assert.match(document.getElementById('recusas-preview').innerHTML,/João Vendas/);
  // PEDIDO AO VIVO ("verifica se tem supervisor pq ta trazendo o gerente e
  // ele é o chefe master, tem que saber os que ficam responsáveis pelo
  // vendedor"): supervisor já era salvo, mas sumia da pré-visualização —
  // só vendedor apareciam ali. Gerente foi removido de vez depois (pedido
  // ao vivo: "o gerente pode tirar, que sempre será 1 pq de gerente só
  // tem ele").
  assert.match(document.getElementById('recusas-preview').innerHTML,/Pedro Supervisor/);
  assert.doesNotMatch(document.getElementById('page-recebimento-recusas').innerHTML,/Gerente/i,'coluna/campo Gerente foi removido de vez');

  document.querySelector('[data-recusa-salvar-import]').click();
  await new Promise(r=>setTimeout(r,0));
  const doc=notas._registro.get('35260800123456780001235500100000123412345673');
  assert.equal(doc.vendedorNome,'João Vendas');
  assert.equal(doc.vendedorEmail,'joao@x.com');
  assert.equal(doc.supervisorNome,'Pedro Supervisor');
  assert.ok(!('gerenteNome' in doc),'gerente não é mais salvo');
  assert.ok(!('comissao' in doc), 'comissão foi pedido explícito do usuário pra não vir em lugar nenhum');
});

test('PEDIDO AO VIVO: vendedor sem supervisor preenchido mostra "Sup.: —" na pré-visualização, em vez de simplesmente sumir a linha (deixa visível que a Bluesoft não devolveu supervisor pra esse vendedor)',async()=>{
  const notas=mockColecao([]);
  const notasBluesoftMock=async()=>[{ chave:'35260800123456780001235500100000123412345673', numeroNota:'1', destinatarioNome:'Cliente X', itens:[] }];
  const enriquecerMock=async(notasRecebidas)=>notasRecebidas.map(n=>({ ...n, vendedorNome:'Cleo Cavalcanti' })); // sem supervisorNome, igual ao caso real relatado
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) }, notasBluesoftMock, enriquecerMock);

  await win.renderRecebimentoRecusas();
  document.querySelector('[data-recusa-sync-bluesoft]').click();
  await new Promise(r=>setTimeout(r,0));
  const html=document.getElementById('recusas-preview').innerHTML;
  assert.match(html,/Cleo Cavalcanti/);
  assert.match(html,/Sup\.: —/,'a linha de supervisor aparece mesmo vazia, em vez de sumir e parecer que nem foi buscado');
});

test('pedido ao vivo do usuário: não existe mais botão separado de "Atualizar vendedores" — "Buscar" já faz tudo, e o diagnóstico mostra quantas notas ganharam vendedor',async()=>{
  const notas=mockColecao([]);
  const notaBluesoft=[{ chave:'35260800123456780001235500100000123412345673', numeroNota:'1', destinatarioNome:'Cliente X', itens:[] }];
  const enriquecerMock=async(notasRecebidas)=>notasRecebidas.map(n=>({ ...n, vendedorNome:'João Vendas' }));
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) }, async()=>notaBluesoft, enriquecerMock);
  await win.renderRecebimentoRecusas();
  assert.doesNotMatch(document.getElementById('page-recebimento-recusas').innerHTML,/Atualizar vendedores/,'o botão separado foi removido — "Buscar" faz tudo');
  document.querySelector('[data-recusa-sync-bluesoft]').click();
  await new Promise(r=>setTimeout(r,0));
  assert.match(document.getElementById('page-recebimento-recusas').innerHTML,/1 de 1 nota\(s\) com vendedor encontrado/);
});

test('se buscar o vendedor falhar/der timeout dentro do "Buscar", a busca de notas continua normalmente (melhor esforço)',async()=>{
  const notas=mockColecao([]);
  const notaBluesoft=[{ chave:'35260800123456780001235500100000123412345673', numeroNota:'1', destinatarioNome:'Cliente X', itens:[] }];
  const enriquecerMock=async()=>{ throw new Error('A Bluesoft demorou demais para responder (timeout) em /api/forca-de-vendas/comissoes-vendedores.'); };
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) }, async()=>notaBluesoft, enriquecerMock);
  await win.renderRecebimentoRecusas();
  document.querySelector('[data-recusa-sync-bluesoft]').click();
  await new Promise(r=>setTimeout(r,0));
  assert.match(document.getElementById('recusas-preview').innerHTML,/12345|1<\/td>|>1</,'nota ainda aparece na prévia mesmo com o vendedor falhando');
  assert.match(document.getElementById('page-recebimento-recusas').innerHTML,/Falha ao buscar vendedor.*timeout/);
});

test('PEDIDO AO VIVO ("não quero mais o motivo e nem o volume das notas de devolução"): devolução NUNCA busca XML — nem automático, nem botão manual',async()=>{
  // Histórico: motivo (infCpl) via XML foi reativado, depois o próprio
  // usuário pediu pra REMOVER de vez o XML de devolução (motivo E volume) —
  // só nota de Venda continua buscando volume no XML (ver teste abaixo).
  const notas=mockColecao([]);
  const notaBluesoft=[{ chave:'35260800123456780001235500100000123412345673', numeroNota:'12345', destinatarioNome:'Mercado X', itens:[], pareceDevolucao:true }];
  let chamouXml=false;
  const xmlMock=async(chave)=>{ chamouXml=true; return { motivo:'Cliente recusou por avaria no transporte', volumes:5 }; };
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) }, async()=>notaBluesoft, null, xmlMock);

  await win.renderRecebimentoRecusas();
  document.querySelector('[data-recusa-sync-bluesoft]').click();
  await new Promise(r=>setTimeout(r,0));

  assert.equal(chamouXml,false,'devolução nunca chama a busca de XML');
  assert.equal(document.querySelector('[data-recusa-buscar-xml="0"]'),null,'o botão manual nunca aparece pra devolução');
  const inputVol=document.querySelector('[data-recprev-vol="0"]');
  assert.equal(inputVol.value,'','volume de devolução fica vazio — Analista digita manualmente');

  document.querySelector('[data-recusa-salvar-import]').click();
  await new Promise(r=>setTimeout(r,0));
  const doc=notas._registro.get('35260800123456780001235500100000123412345673');
  assert.equal(doc.informacoesComplementares,'');
  assert.equal(doc.volumes,0); // campo ficou vazio na tela; ao salvar vira 0 (mesma conversão de sempre, intVol)
});

test('PEDIDO AO VIVO: nota de Venda (não devolução) recebe o volume automaticamente, mas NUNCA o motivo — motivo só faz sentido pra devolução',async()=>{
  const notas=mockColecao([]);
  const notaBluesoft=[{ chave:'35260800123456780001235500100000123412345673', numeroNota:'12345', destinatarioNome:'Mercado X', itens:[], pareceDevolucao:false, naturezaLabel:'Venda' }];
  const xmlMock=async()=>({ motivo:'Isso não devia aparecer numa venda', volumes:7 });
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) }, async()=>notaBluesoft, null, xmlMock);

  await win.renderRecebimentoRecusas();
  document.querySelector('[data-recusa-sync-bluesoft]').click();
  await new Promise(r=>setTimeout(r,0));

  const inputVol=document.querySelector('[data-recprev-vol="0"]');
  assert.equal(inputVol.value,'7','volume é buscado pra qualquer nota, inclusive venda');
  assert.doesNotMatch(document.getElementById('recusas-preview').innerHTML,/Isso não devia aparecer numa venda/,'motivo NUNCA é buscado pra nota que não é devolução');
});

test('busca no XML NUNCA sobrescreve um volume que o Analista já digitou manualmente (nota de venda)',async()=>{
  const notas=mockColecao([]);
  const notaBluesoft=[{ chave:'35260800123456780001235500100000123412345673', numeroNota:'12345', destinatarioNome:'Mercado X', itens:[], pareceDevolucao:false, naturezaLabel:'Venda' }];
  let win;
  // Simula o Analista digitando um volume manualmente ENQUANTO a busca do
  // XML dessa nota ainda está em voo (a tela já fica interativa antes do
  // lote terminar) — o mock digita no campo antes de devolver o valor do
  // XML, imitando essa corrida real.
  const xmlMock=async()=>{
    const inputVol=win.document.querySelector('[data-recprev-vol="0"]');
    inputVol.value='3';
    inputVol.dispatchEvent(new win.Event('input',{bubbles:true}));
    return { motivo:'', volumes:9 };
  };
  const ambiente=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) }, async()=>notaBluesoft, null, xmlMock);
  win=ambiente.win; const document=ambiente.document;

  await win.renderRecebimentoRecusas();
  document.querySelector('[data-recusa-sync-bluesoft]').click();
  await new Promise(r=>setTimeout(r,0));
  assert.equal(document.querySelector('[data-recprev-vol="0"]').value,'3','contagem manual digitada durante a busca tem prioridade sobre o XML');
});

test('PEDIDO AO VIVO ("a tela fica recarregando, se eu clicar em buscar se a página recarregar ele para"): a busca automática em lote NUNCA redesenha a tabela inteira entre um lote e outro — só a linha de cada nota processada',async()=>{
  // 8 notas de venda com TAMANHO_LOTE=6 força 2 lotes — cenário real de
  // "56 notas" relatado pelo usuário, reduzido a um tamanho testável.
  // xmlMock com promise controlada manualmente pra conseguir inspecionar o
  // DOM exatamente ENTRE o fim do lote 1 e o início do lote 2.
  const notaBluesoft=Array.from({length:8},(_,i)=>({ chave:'352608001234567800012355001000001234123456'+(70+i), numeroNota:String(1000+i), destinatarioNome:'Mercado '+i, itens:[], pareceDevolucao:false, naturezaLabel:'Venda' }));
  const resolvers=[];
  const xmlMock=()=>new Promise(resolve=>{ resolvers.push(resolve); });
  const { win, document }=carregarPagina({ recebimento_recusas_notas:mockColecao([]), recebimento_recusas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) }, async()=>notaBluesoft, null, xmlMock);

  await win.renderRecebimentoRecusas();
  document.querySelector('[data-recusa-sync-bluesoft]').click();
  await new Promise(r=>setTimeout(r,0));
  assert.equal(resolvers.length,6,'só o 1º lote (6 notas) dispara chamada de XML de imediato — o resto espera esse lote terminar');

  const tabelaAntes=document.querySelector('#recusas-preview table');
  const inputLinha7Antes=document.querySelector('[data-recprev-vol="7"]'); // nota do 2º lote, ainda intocada
  assert.ok(tabelaAntes && inputLinha7Antes);

  resolvers.slice(0,6).forEach(r=>r({motivo:'',volumes:5})); // termina o lote 1
  await new Promise(r=>setTimeout(r,0));
  assert.equal(resolvers.length,8,'lote 2 só começou depois do lote 1 terminar');

  const tabelaDepois=document.querySelector('#recusas-preview table');
  const inputLinha7Depois=document.querySelector('[data-recprev-vol="7"]');
  assert.strictEqual(tabelaAntes,tabelaDepois,'o elemento <table> nunca é trocado entre lotes');
  assert.strictEqual(inputLinha7Antes,inputLinha7Depois,'o <input> de uma linha de OUTRO lote não é recriado quando um lote termina — prova que não houve redraw da tabela inteira');
  assert.equal(document.querySelector('[data-recprev-vol="0"]').value,'5','a linha do 1º lote já processada foi atualizada normalmente');

  resolvers.slice(6).forEach(r=>r({motivo:'',volumes:9}));
  await new Promise(r=>setTimeout(r,0));
});

test('PEDIDO AO VIVO ("se eu fizer outra busca... ela já tem as notas salvas, e já com o XML gravado... não precisaria buscar de novo"): nota já salva com volume > 0 reaproveita o valor, sem chamar o XML de novo',async()=>{
  const notas=mockColecao([{id:'35260800123456780001235500100000123412345673',data:{chave:'35260800123456780001235500100000123412345673',numeroNota:'12345',volumes:12000,naturezaLabel:'Venda'}}]);
  const notaBluesoft=[{ chave:'35260800123456780001235500100000123412345673', numeroNota:'12345', destinatarioNome:'Mercado X', itens:[], pareceDevolucao:false, naturezaLabel:'Venda' }];
  let chamouXml=false;
  const xmlMock=async()=>{ chamouXml=true; return { motivo:'', volumes:9 }; };
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) }, async()=>notaBluesoft, null, xmlMock);

  await win.renderRecebimentoRecusas();
  document.querySelector('[data-recusa-sync-bluesoft]').click();
  await new Promise(r=>setTimeout(r,0));

  assert.equal(chamouXml,false,'nota já resolvida numa busca anterior não chama o XML de novo');
  assert.equal(document.querySelector('[data-recprev-vol="0"]').value,'12000','volume já salvo aparece pré-preenchido direto da base');
  assert.equal(document.querySelector('[data-recusa-buscar-xml="0"]'),null,'sem precisar buscar, o botão manual nem aparece');
});

test('nota já salva mas com volume 0 (nunca chegou a carregar) NÃO é tratada como resolvida — continua buscando o XML normalmente',async()=>{
  const notas=mockColecao([{id:'35260800123456780001235500100000123412345673',data:{chave:'35260800123456780001235500100000123412345673',numeroNota:'12345',volumes:0,naturezaLabel:'Venda'}}]);
  const notaBluesoft=[{ chave:'35260800123456780001235500100000123412345673', numeroNota:'12345', destinatarioNome:'Mercado X', itens:[], pareceDevolucao:false, naturezaLabel:'Venda' }];
  const xmlMock=async()=>({ motivo:'', volumes:7 });
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) }, async()=>notaBluesoft, null, xmlMock);

  await win.renderRecebimentoRecusas();
  document.querySelector('[data-recusa-sync-bluesoft]').click();
  await new Promise(r=>setTimeout(r,0));

  assert.equal(document.querySelector('[data-recprev-vol="0"]').value,'7','volume 0 salvo não conta como resolvido — busca o XML normalmente e preenche');
});

test('se buscar no XML falhar (link expirado, por exemplo), mostra o erro e o botão volta a ficar clicável',async()=>{
  const notas=mockColecao([]);
  const notaBluesoft=[{ chave:'35260800123456780001235500100000123412345673', numeroNota:'12345', destinatarioNome:'Mercado X', itens:[] }];
  const toasts=[];
  const xmlMock=async()=>{ throw new Error('Não foi possível baixar o XML (HTTP 403).'); };
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) }, async()=>notaBluesoft, null, xmlMock);
  win.showToast=(m,t)=>toasts.push({m,t});

  await win.renderRecebimentoRecusas();
  document.querySelector('[data-recusa-sync-bluesoft]').click();
  await new Promise(r=>setTimeout(r,0));
  document.querySelector('[data-recusa-buscar-xml="0"]').click();
  await new Promise(r=>setTimeout(r,0));

  assert.ok(toasts.some(t=>/HTTP 403/.test(t.m)));
  const btn=document.querySelector('[data-recusa-buscar-xml="0"]');
  assert.ok(btn,'o botão continua lá pra tentar de novo');
  assert.equal(btn.disabled,false);
});

test('erro na sincronização Bluesoft mostra o motivo e não grava nada',async()=>{
  const notas=mockColecao([]);
  const { win, document }=carregarPagina({ recebimento_recusas_notas:notas, recebimento_recusas:mockColecao([]), recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) }, async()=>{ throw new Error('Esta loja não está vinculada à Bluesoft (bluesoft_loja_key).'); });

  await win.renderRecebimentoRecusas();
  document.querySelector('[data-recusa-sync-bluesoft]').click();
  await new Promise(r=>setTimeout(r,0));
  assert.equal(notas._registro.size,0);
  // botão "Salvar importação" some/desabilita quando não há nada pra salvar
  assert.match(document.getElementById('page-recebimento-recusas').innerHTML,/disabled/);
});

test('PEDIDO AO VIVO ("ter a opção de excluir notas retornadas registradas"): botão excluir apaga o registro depois de confirmar, e cancelar não apaga nada',async()=>{
  const recusas=mockColecao([
    {id:'r1',data:{notas:[{chave:'A',numeroNota:'189146'}],motoristaNome:'geraldo',motivoNome:'recusa',box:'1',volumeEsperado:104,volumeInformado:50,diferencaVolumes:-54,criadoEm:'2026-08-18T11:12:00.000Z'}},
  ]);
  const { win, document }=carregarPagina({ recebimento_recusas_notas:mockColecao([]), recebimento_recusas:recusas, recebimento_recusas_motoristas:mockColecao([]), recebimento_recusas_motivos:mockColecao([]) }, async()=>[]);

  await win.renderRecebimentoRecusas();
  assert.match(document.getElementById('page-recebimento-recusas').innerHTML,/189146/);
  const btnExcluir=document.querySelector('[data-recusa-excluir]');
  assert.ok(btnExcluir,'o botão de excluir precisa existir na linha da tabela');

  // Cancela a confirmação — nada deve ser apagado.
  win.confirm=()=>false;
  btnExcluir.click();
  await new Promise(r=>setTimeout(r,0));
  assert.ok(recusas._registro.has('r1'),'cancelar a confirmação não apaga o registro');
  assert.match(document.getElementById('page-recebimento-recusas').innerHTML,/189146/);

  // Confirma — apaga de verdade e some da lista.
  win.confirm=()=>true;
  document.querySelector('[data-recusa-excluir]').click();
  await new Promise(r=>setTimeout(r,0));
  assert.ok(!recusas._registro.has('r1'),'confirmar a exclusão apaga o registro de recebimento_recusas');
  assert.doesNotMatch(document.getElementById('page-recebimento-recusas').innerHTML,/189146/);
});
