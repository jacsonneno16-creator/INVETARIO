// PEDIDO AO VIVO (2026-09-08): "vai aparecer a opção de saída e entrada,
// entrada é para receber a nota que tá voltando, a saída é para as que vão
// sair, tipo vai pedir o número da nota e vai trazer as informações, box
// com quem voltou e as notas que vieram juntas" — Notas Retornadas ganhou
// uma tela de escolha (Entrada/Saída). Entrada é o fluxo que já existia
// (ver coletor-notas-retornadas-schema.test.js e outros). Saída é nova:
// busca pelo NÚMERO da nota (array `numerosNotas`, irmão de `chaves`),
// mostra Box/Motorista/notas do mesmo evento, e confirmar a Saída carimba
// `dataSaidaEm` SÓ NA NOTA bipada — só quando ela já foi classificada como
// Reentrega pelo Analista (confirmado com o usuário via AskUserQuestion).
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const { JSDOM } = require('jsdom');
const baseColetor=path.join(__dirname,'../js/coletor');
const htmlCode=fs.readFileSync(path.join(__dirname,'../coletor.html'),'utf8');
const navCode=fs.readFileSync(path.join(baseColetor,'10-navegacao-estorno.js'),'utf8');
const recusasCode=fs.readFileSync(path.join(baseColetor,'24-recebimento-recusas.js'),'utf8');

// Mock da coleção recebimento_recusas com `.where('numerosNotas','array-
// contains',valor)` de verdade (filtra os docs guardados), e `.doc(id)`
// com `.update()` real — os outros mocks deste módulo (ex.: schema.test.js)
// usam um `.where()` sempre-vazio, que não serve pra testar a busca de
// Saída.
function mockRecusas(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  const snapshot=(entradas)=>({ empty: entradas.length===0, size: entradas.length, docs: entradas.map(([id,data])=>({id,data:()=>data,exists:true})) });
  return {
    get: async()=>snapshot([...registro.entries()]),
    doc:(id)=>({
      id,
      get: async()=>{ const data=registro.get(id); return { exists: data!==undefined, id, data:()=>data }; },
      update: async(payload)=>{ const atual=registro.get(id); if(atual===undefined) throw new Error('NOT_FOUND'); registro.set(id,Object.assign({},atual,payload)); },
    }),
    add: async(payload)=>{ const docId='novo'+registro.size; registro.set(docId,payload); return {id:docId}; },
    where:(campo,op,valor)=>({
      get: async()=>{
        if(campo!=='numerosNotas'||op!=='array-contains') return snapshot([]);
        const achados=[...registro.entries()].filter(([,data])=>Array.isArray(data.numerosNotas)&&data.numerosNotas.includes(valor));
        return snapshot(achados);
      },
    }),
    _registro: registro,
  };
}
// PEDIDO AO VIVO (2026-09-11): "Identificar" passou a tentar achar o
// mercado pelo NÚMERO em recebimento_recusas_notas — mock com
// `.where('numeroNota','==',valor).limit(n).get()` de verdade.
function mockNotasVenda(docsIniciais){
  const registro=new Map((docsIniciais||[]).map(d=>[d.id,d.data]));
  const snapshot=(entradas)=>({ empty: entradas.length===0, size: entradas.length, docs: entradas.map(([id,data])=>({id,data:()=>data,exists:true})) });
  return {
    get: async()=>snapshot([...registro.entries()]),
    where:(campo,op,valor)=>({
      limit:(n)=>({
        get: async()=>{
          if(campo!=='numeroNota'||op!=='==') return snapshot([]);
          const achados=[...registro.entries()].filter(([,data])=>data.numeroNota===valor).slice(0,n);
          return snapshot(achados);
        },
      }),
    }),
    _registro: registro,
  };
}
function mockVazia(){
  return { get: async()=>({ empty:true, size:0, docs:[] }), where:()=>({ get: async()=>({ empty:true, size:0, docs:[] }), limit:()=>({ get: async()=>({ empty:true, size:0, docs:[] }) }) }) };
}

function carregarColetorReal(colecoes){
  const dom=new JSDOM(htmlCode,{ url:'http://localhost/', runScripts:'outside-only' });
  const win=dom.window; const document=win.document;
  win.FS={ collection:(nome)=>(colecoes&&colecoes[nome])||mockVazia() };
  win.getDTFirestore=()=>win.FS;
  win.toast=()=>{};
  Object.defineProperty(win.navigator,'onLine',{ get:()=>true, configurable:true });
  win.eval(navCode);
  win.eval(recusasCode);
  return { win, document };
}

function baseColecoes(recusas){
  return {
    recebimento_recusas: recusas,
    recebimento_recusas_motoristas: mockVazia(),
    recebimento_recusas_motivos: mockVazia(),
    recebimento_recusas_tarefas_conferencia: mockVazia(),
  };
}

test('tela de escolha mostra Entrada e Saída; Saída leva pra tela de buscar por número', async () => {
  const { win, document } = carregarColetorReal(baseColecoes(mockRecusas([])));
  await win.abrirRecusasRecebimento();
  const html = document.getElementById('recusa-fluxo-host').innerHTML;
  assert.match(html, /📥 Entrada/);
  assert.match(html, /📤 Saída/);

  document.querySelector('[data-recusa-modo="saida"]').click();
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML, /Número da nota/);
});

test('Saída: busca por número acha o registro, mostra Box/Motorista/notas do mesmo evento', async () => {
  const recusas = mockRecusas([{ id: 'r1', data: {
    box: 'BOX 9', motoristaNome: 'Carlos', criadoEm: '2026-09-01T10:00:00.000Z',
    numerosNotas: ['601', '602'],
    notas: [
      { chave: 'CH1', numeroNota: '601', tratamento: 'REENTREGA' },
      { chave: 'CH2', numeroNota: '602', tratamento: 'RECUSA' },
    ],
  } }]);
  const { win, document } = carregarColetorReal(baseColecoes(recusas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="saida"]').click();

  document.getElementById('saida-numero-input').value = '601';
  document.getElementById('saida-buscar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  const html = document.getElementById('recusa-fluxo-host').innerHTML;
  assert.match(html, /BOX 9/);
  assert.match(html, /Carlos/);
  assert.match(html, /601/);
  assert.match(html, /602/, 'mostra a outra nota que veio junto no mesmo evento');
});

test('Saída: nota classificada como Reentrega mostra "Confirmar Saída", e confirmar grava dataSaidaEm SÓ naquela nota', async () => {
  const recusas = mockRecusas([{ id: 'r1', data: {
    box: 'BOX 9', motoristaNome: 'Carlos', criadoEm: '2026-09-01T10:00:00.000Z',
    origem: 'COLETOR', statusFisico: 'NO_PATIO',
    numerosNotas: ['601', '602'],
    notas: [
      { chave: 'CH1', numeroNota: '601', tratamento: 'REENTREGA' },
      { chave: 'CH2', numeroNota: '602', tratamento: 'RECUSA' },
    ],
  } }]);
  const { win, document } = carregarColetorReal(baseColecoes(recusas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="saida"]').click();
  document.getElementById('saida-numero-input').value = '601';
  document.getElementById('saida-buscar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  const btn = document.getElementById('saida-confirmar-btn');
  assert.ok(btn, 'nota é Reentrega — botão de confirmar saída precisa existir');
  btn.click();
  await new Promise(r => setTimeout(r, 0));

  const salvo = recusas._registro.get('r1');
  const n1 = salvo.notas.find(n => n.chave === 'CH1');
  const n2 = salvo.notas.find(n => n.chave === 'CH2');
  assert.ok(n1.dataSaidaEm, 'a nota bipada (601, Reentrega) ganhou dataSaidaEm');
  assert.equal(n2.dataSaidaEm, undefined, 'a outra nota do mesmo evento (602, Recusa) NUNCA deveria ser tocada');
  assert.equal(salvo.statusFisico, 'NO_PATIO', 'a outra nota (602, Recusa, ainda sem FINALIZADO) continua no pátio — o documento não pode fechar por causa de só uma nota ter saído');

  const html = document.getElementById('recusa-fluxo-host').innerHTML;
  assert.match(html, /já saiu em/i);
});

test('Saída: quando a nota bipada é a ÚLTIMA ainda presente no documento, statusFisico vira SAIU', async () => {
  const recusas = mockRecusas([{ id: 'r1', data: {
    box: 'BOX 9', motoristaNome: 'Carlos', criadoEm: '2026-09-01T10:00:00.000Z',
    origem: 'COLETOR', statusFisico: 'NO_PATIO',
    numerosNotas: ['601', '602'],
    notas: [
      { chave: 'CH1', numeroNota: '601', tratamento: 'REENTREGA' },
      { chave: 'CH2', numeroNota: '602', tratamento: 'RECUSA', statusRetorno: 'FINALIZADO' },
    ],
  } }]);
  const { win, document } = carregarColetorReal(baseColecoes(recusas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="saida"]').click();
  document.getElementById('saida-numero-input').value = '601';
  document.getElementById('saida-buscar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  document.getElementById('saida-confirmar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  const salvo = recusas._registro.get('r1');
  assert.equal(salvo.statusFisico, 'SAIU', '602 já estava FINALIZADO e 601 acabou de sair — as duas notas do documento já saíram');
});

test('Saída: nota NÃO classificada como Reentrega não mostra botão de confirmar — mostra aviso', async () => {
  const recusas = mockRecusas([{ id: 'r1', data: {
    box: 'BOX 9', motoristaNome: 'Carlos', criadoEm: '2026-09-01T10:00:00.000Z',
    numerosNotas: ['601'],
    notas: [{ chave: 'CH1', numeroNota: '601', tratamento: 'RECUSA' }],
  } }]);
  const { win, document } = carregarColetorReal(baseColecoes(recusas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="saida"]').click();
  document.getElementById('saida-numero-input').value = '601';
  document.getElementById('saida-buscar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  assert.equal(document.getElementById('saida-confirmar-btn'), null);
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML, /não foi classificada como Reentrega/);
});

test('Saída: nota ainda sem Tratamento nenhum (recém chegada) também não mostra botão de confirmar', async () => {
  const recusas = mockRecusas([{ id: 'r1', data: {
    box: 'BOX 9', motoristaNome: 'Carlos', criadoEm: '2026-09-01T10:00:00.000Z',
    numerosNotas: ['601'],
    notas: [{ chave: 'CH1', numeroNota: '601' }],
  } }]);
  const { win, document } = carregarColetorReal(baseColecoes(recusas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="saida"]').click();
  document.getElementById('saida-numero-input').value = '601';
  document.getElementById('saida-buscar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  assert.equal(document.getElementById('saida-confirmar-btn'), null);
});

test('Saída: número que não existe em nenhum registro mostra aviso de não encontrada, sem travar', async () => {
  const { win, document } = carregarColetorReal(baseColecoes(mockRecusas([])));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="saida"]').click();
  document.getElementById('saida-numero-input').value = '999999';
  document.getElementById('saida-buscar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  assert.match(document.getElementById('recusa-fluxo-host').innerHTML, /não encontrada/);
});

test('Saída: buscar sem digitar nada mostra erro, não chama o Firestore', async () => {
  const { win, document } = carregarColetorReal(baseColecoes(mockRecusas([])));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="saida"]').click();
  document.getElementById('saida-buscar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  assert.match(document.getElementById('recusa-fluxo-host').innerHTML, /Informe o número da nota/);
});

test('Saída: "Buscar outra nota" limpa o resultado e volta pra busca; "Concluir" volta pra tela de escolha', async () => {
  const recusas = mockRecusas([{ id: 'r1', data: {
    box: 'BOX 9', motoristaNome: 'Carlos', criadoEm: '2026-09-01T10:00:00.000Z',
    numerosNotas: ['601'],
    notas: [{ chave: 'CH1', numeroNota: '601', tratamento: 'REENTREGA' }],
  } }]);
  const { win, document } = carregarColetorReal(baseColecoes(recusas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="saida"]').click();
  document.getElementById('saida-numero-input').value = '601';
  document.getElementById('saida-buscar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  document.getElementById('saida-buscar-outra-btn').click();
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML, /Número da nota/);
  assert.equal(document.getElementById('saida-confirmar-btn'), null);

  // "Concluir" (na tela de resultado) e "Voltar" (na tela de busca) usam o
  // mesmo data-recusa-modo="voltar" — some da tela de Saída e volta pro
  // menu Entrada/Saída.
  document.querySelector('[data-recusa-modo="voltar"]').click();
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML, /📥 Entrada/);
});

test('Entrada continua funcionando normalmente depois da tela de escolha (fluxo antigo intocado)', async () => {
  const { win, document } = carregarColetorReal(baseColecoes(mockRecusas([])));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="entrada"]').click();
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML, /Bipe a chave de acesso/);
});

// PEDIDO AO VIVO (2026-09-08): "não consegue trazer notas recebidas antes
// da função existir, se tá tudo no banco de dados gravado?" — registro
// ANTIGO (de antes de numerosNotas existir) não tem esse campo no
// documento — a via rápida (`where` array-contains) não acha nada nele,
// mas a nota SEMPRE esteve em `notas[].numeroNota`. Fallback: sem
// resultado pela via rápida, escaneia a coleção inteira e acha pelo
// conteúdo real.
test('Saída: registro ANTIGO (sem o campo numerosNotas) ainda é encontrado — cai pro fallback que escaneia a coleção inteira', async () => {
  const recusas = mockRecusas([{ id: 'r-antigo', data: {
    box: 'BOX 3', motoristaNome: 'Zé', criadoEm: '2026-08-01T10:00:00.000Z',
    // SEM numerosNotas de propósito — simula um registro gravado antes
    // desta função existir.
    notas: [{ chave: 'CH1', numeroNota: '777', tratamento: 'REENTREGA' }],
  } }]);
  const { win, document } = carregarColetorReal(baseColecoes(recusas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="saida"]').click();
  document.getElementById('saida-numero-input').value = '777';
  document.getElementById('saida-buscar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  const html = document.getElementById('recusa-fluxo-host').innerHTML;
  assert.match(html, /BOX 3/, 'achou o registro antigo mesmo sem numerosNotas');
  assert.match(html, /Zé/);
  assert.ok(document.getElementById('saida-confirmar-btn'), 'é Reentrega — confirmar continua disponível num registro antigo');
});

// Quando existem os dois (um registro NOVO com numerosNotas batendo pelo
// caminho rápido, e um ANTIGO sem o campo que também bateria por
// conteúdo), a via rápida encontra primeiro e nem chega a escanear tudo —
// evita o caminho caro sempre que possível.
test('Saída: quando a via rápida (numerosNotas) já acha o registro, não precisa escanear a coleção inteira', async () => {
  let chamouGetSemFiltro = false;
  const recusas = mockRecusas([{ id: 'r-novo', data: {
    box: 'BOX 7', motoristaNome: 'Ana', criadoEm: '2026-09-05T10:00:00.000Z',
    numerosNotas: ['888'],
    notas: [{ chave: 'CHN', numeroNota: '888', tratamento: 'REENTREGA' }],
  } }]);
  const getOriginal = recusas.get;
  recusas.get = async () => { chamouGetSemFiltro = true; return getOriginal(); };
  const { win, document } = carregarColetorReal(baseColecoes(recusas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="saida"]').click();
  document.getElementById('saida-numero-input').value = '888';
  document.getElementById('saida-buscar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  assert.match(document.getElementById('recusa-fluxo-host').innerHTML, /BOX 7/);
  assert.equal(chamouGetSemFiltro, false, 'achou pela via rápida — nunca precisou baixar a coleção inteira');
});

// PEDIDO AO VIVO (2026-09-11): "colocar mais duas opções, uma Rastrear e
// outra Identificar — a rastrear vai funcionar somente para saber onde
// está e a quantidade de paletes".
test('tela de escolha mostra Rastrear e Identificar; Rastrear leva pra tela de buscar por número', async () => {
  const { win, document } = carregarColetorReal(baseColecoes(mockRecusas([])));
  await win.abrirRecusasRecebimento();
  const html = document.getElementById('recusa-fluxo-host').innerHTML;
  assert.match(html, /🔎 Rastrear/);
  assert.match(html, /🆕 Identificar/);

  document.querySelector('[data-recusa-modo="rastrear"]').click();
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML, /Número da nota/);
});

test('Rastrear: busca por número mostra Box e quantidade de Paletes, sem nenhum botão de ação (só leitura)', async () => {
  const recusas = mockRecusas([{ id: 'r1', data: {
    box: 'BOX 9', pallets: 4, criadoEm: '2026-09-01T10:00:00.000Z',
    numerosNotas: ['701'],
    notas: [{ chave: 'CHX', numeroNota: '701', tratamento: 'RECUSA', statusRetorno: 'EM_TRATATIVA' }],
    origem: 'COLETOR',
  } }]);
  const { win, document } = carregarColetorReal(baseColecoes(recusas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="rastrear"]').click();
  document.getElementById('rastrear-numero-input').value = '701';
  document.getElementById('rastrear-buscar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  const html = document.getElementById('recusa-fluxo-host').innerHTML;
  assert.match(html, /BOX 9/);
  assert.match(html, />4</, 'quantidade de paletes aparece');
  assert.match(html, /Ainda no pátio/);
  assert.doesNotMatch(html, /<input(?![^>]*rastrear-numero-input)/, 'tela de resultado não tem campo pra editar nada (só leitura)');
});

test('Rastrear: nota já finalizada (Recusa) mostra "Já saiu"', async () => {
  const recusas = mockRecusas([{ id: 'r1', data: {
    box: 'BOX 3', criadoEm: '2026-09-01T10:00:00.000Z',
    numerosNotas: ['702'],
    notas: [{ chave: 'CHY', numeroNota: '702', tratamento: 'RECUSA', statusRetorno: 'FINALIZADO' }],
    origem: 'COLETOR',
  } }]);
  const { win, document } = carregarColetorReal(baseColecoes(recusas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="rastrear"]').click();
  document.getElementById('rastrear-numero-input').value = '702';
  document.getElementById('rastrear-buscar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  assert.match(document.getElementById('recusa-fluxo-host').innerHTML, /Já saiu/);
});

test('Rastrear: número que não existe mostra aviso, não trava', async () => {
  const { win, document } = carregarColetorReal(baseColecoes(mockRecusas([])));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="rastrear"]').click();
  document.getElementById('rastrear-numero-input').value = '999999';
  document.getElementById('rastrear-buscar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  assert.match(document.getElementById('recusa-fluxo-host').innerHTML, /não encontrada/);
});

// PEDIDO AO VIVO (2026-09-11): "Identificar" — nota, box, paletes,
// motorista (opcional), motivo (opcional), salvar — já aparece em Notas
// Retornadas depois (mesmo formato que Entrada grava, origem:'COLETOR').
test('Identificar: preencher nota+box e salvar grava doc com origem COLETOR, statusFisico NO_PATIO, motorista/motivo vazios (opcionais)', async () => {
  const recusas = mockRecusas([]);
  const { win, document } = carregarColetorReal(baseColecoes(recusas));
  win.APP = { operador: { name: 'Pedro Operador' } };
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="identificar"]').click();

  document.getElementById('ident-numero-input').value = '555';
  document.getElementById('ident-box-input').value = 'box 4';
  document.getElementById('ident-salvar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  const salvo = [...recusas._registro.values()][0];
  assert.equal(salvo.numerosNotas[0], '555');
  assert.equal(salvo.box, 'BOX 4', 'box salvo em maiúsculas, igual ao resto do app');
  assert.equal(salvo.origem, 'COLETOR');
  assert.equal(salvo.statusFisico, 'NO_PATIO');
  assert.equal(salvo.motoristaNome, '');
  assert.equal(salvo.motivoNome, '');
  assert.equal(salvo.conferenteNome, 'Pedro Operador', 'PEDIDO AO VIVO 2026-09-11: usa o nome do login como conferente');
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML, /555.*BOX 4|BOX 4.*555/s);
});

test('Identificar: motorista e motivo preenchidos são salvos quando informados', async () => {
  const recusas = mockRecusas([]);
  const { win, document } = carregarColetorReal(baseColecoes(recusas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="identificar"]').click();

  document.getElementById('ident-numero-input').value = '556';
  document.getElementById('ident-box-input').value = 'BOX 5';
  document.getElementById('ident-pallets-input').value = '3';
  document.getElementById('ident-motorista-input').value = 'José';
  document.getElementById('ident-motivo-input').value = 'Avaria';
  document.getElementById('ident-salvar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  const salvo = [...recusas._registro.values()][0];
  assert.equal(salvo.pallets, 3);
  assert.equal(salvo.motoristaNome, 'José');
  assert.equal(salvo.motivoNome, 'Avaria');
});

test('Identificar: sem número da nota ou sem Box, bloqueia e não grava nada', async () => {
  const recusas = mockRecusas([]);
  const { win, document } = carregarColetorReal(baseColecoes(recusas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="identificar"]').click();

  document.getElementById('ident-salvar-btn').click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(recusas._registro.size, 0, 'sem número — não grava');

  document.getElementById('ident-numero-input').value = '557';
  document.getElementById('ident-salvar-btn').click();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(recusas._registro.size, 0, 'sem Box — não grava');
});

test('Identificar: nota salva aparece pro Coletor rastrear em seguida (mesma coleção, mesmo formato de Entrada)', async () => {
  const recusas = mockRecusas([]);
  const { win, document } = carregarColetorReal(baseColecoes(recusas));
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="identificar"]').click();
  document.getElementById('ident-numero-input').value = '558';
  document.getElementById('ident-box-input').value = 'BOX 6';
  document.getElementById('ident-salvar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  document.querySelector('[data-recusa-modo="voltar"]').click();
  document.querySelector('[data-recusa-modo="rastrear"]').click();
  document.getElementById('rastrear-numero-input').value = '558';
  document.getElementById('rastrear-buscar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  assert.match(document.getElementById('recusa-fluxo-host').innerHTML, /BOX 6/);
});

// PEDIDO AO VIVO (2026-09-11): "tem 11 falando que tá sem mercado, mas em
// notas retornadas tá mostrando o volume esperado" — Identificar só pede
// o NÚMERO (sem bipar chave), então antes o Pátio em Tempo Real (que
// enriquece por chave) nunca achava o mercado dessas notas. Agora tenta
// achar a nota pelo número no ledger de venda e já grava chave+mercado.
test('Identificar: acha a nota pelo NÚMERO no ledger de venda e já grava chave+mercado (Pátio consegue enriquecer depois)', async () => {
  const recusas = mockRecusas([]);
  const notasVenda = mockNotasVenda([{ id: 'CHAVE-REAL-44-DIGITOS', data: { numeroNota: '900', destinatario: 'Mercado Real' } }]);
  const { win, document } = carregarColetorReal({ ...baseColecoes(recusas), recebimento_recusas_notas: notasVenda });
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="identificar"]').click();

  document.getElementById('ident-numero-input').value = '900';
  document.getElementById('ident-box-input').value = 'BOX 8';
  document.getElementById('ident-salvar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  const salvo = [...recusas._registro.values()][0];
  assert.deepEqual(Array.from(salvo.chaves), ['CHAVE-REAL-44-DIGITOS'], 'achou a chave pelo número e gravou');
  assert.equal(salvo.notas[0].destinatario, 'Mercado Real');
  assert.equal(salvo.notas[0].chave, 'CHAVE-REAL-44-DIGITOS');
});

test('Identificar: número que NÃO existe no ledger de venda segue sem mercado, sem travar o lançamento', async () => {
  const recusas = mockRecusas([]);
  const notasVenda = mockNotasVenda([]);
  const { win, document } = carregarColetorReal({ ...baseColecoes(recusas), recebimento_recusas_notas: notasVenda });
  await win.abrirRecusasRecebimento();
  document.querySelector('[data-recusa-modo="identificar"]').click();

  document.getElementById('ident-numero-input').value = '901';
  document.getElementById('ident-box-input').value = 'BOX 9';
  document.getElementById('ident-salvar-btn').click();
  await new Promise(r => setTimeout(r, 0));

  const salvo = [...recusas._registro.values()][0];
  assert.deepEqual(Array.from(salvo.chaves), []);
  assert.equal(salvo.notas[0].destinatario, '');
  assert.equal(salvo.notas[0].chave, undefined, 'sem chave achada, nunca grava undefined nem chave inventada');
  assert.match(document.getElementById('recusa-fluxo-host').innerHTML, /Última identificada: 901/, 'não trava o lançamento mesmo sem achar mercado');
});
