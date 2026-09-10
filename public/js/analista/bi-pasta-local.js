// PEDIDO AO VIVO (2026-08-26 → 2026-08-27): começou como "conecte a pasta
// do BI uma vez, clique em Buscar" via File System Access API (pasta
// sincronizada localmente pelo SharePoint). Depois de configurar e
// confirmar ao vivo a integração com a API do SharePoint (Microsoft
// Graph, App Registration "App PCP e Compras", Cloud Function
// buscarArquivoBiGraphApi em southamerica-east1 — client_credentials,
// sem usuário do SharePoint envolvido), o usuário decidiu: "deixa tudo
// via API lá, como as pastas está tudo na API, deixa tudo lá" — abandona
// de vez a pasta local como fonte de dados. Não existe mais "conectar"
// nada: funciona em qualquer navegador, sem pedir nenhuma permissão de
// arquivo, sem IndexedDB — só precisa o Analista estar logado (a function
// checa a mesma permissão de sempre, recebimento-recusas.importar).
//
// suportado()/status()/conectar()/desconectar() foram MANTIDOS como
// funções (sempre resolvendo "tudo certo") só pra não precisar reescrever
// as 5 telas que já chamavam esse fluxo (elas fazem "se não tiver
// conectado, conecta, depois lê") — aqui isso vira um no-op inofensivo,
// sem efeito prático. lerJson() é a única coisa que realmente faz alguma
// coisa agora.
(function (global) {
  'use strict';

  function suportado() {
    return typeof global.firebase?.app === 'function';
  }

  async function conectar() {
    return { ok: true };
  }

  async function status() {
    return suportado() ? 'conectado' : 'sem-suporte';
  }

  async function desconectar() {}

  async function lerJson(nomeArquivo) {
    if (typeof global.firebase?.app !== 'function') throw new Error('Firebase ainda não carregou nesta página. Recarregue e tente de novo.');
    const app = global.firebase.app();
    if (typeof app.functions !== 'function') throw new Error('Serviço de functions do Firebase indisponível.');
    const callable = app.functions('southamerica-east1').httpsCallable('buscarArquivoBiGraphApi');
    const resposta = await callable({ arquivo: nomeArquivo });
    if (!resposta || !resposta.data || resposta.data.ok !== true) throw new Error('Resposta inesperada da API do BI.');
    return resposta.data.dados;
  }

  global.DTBiPastaLocal = { suportado, conectar, status, desconectar, lerJson };
})(window);
