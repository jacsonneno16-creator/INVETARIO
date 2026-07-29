Projeto refatorado v6
=====================

CORREÇÕES CRÍTICAS nesta versão (v5 → v6):

1. [CRÍTICO] Criado js/analista/09-fs-publicar.js
   Funções fsPublicarInventario(), fsPublicarEnderecos() e fsPublicarProdutos()
   estavam sendo chamadas em 10-inventarios-negocio.js mas NUNCA definidas.
   Resultado: analista criava inventários apenas no localStorage local — o
   coletor NUNCA os via no Firestore. Esta era a causa raiz da "falta de
   ligação entre coletor e analista".

2. [CRÍTICO] firestore.rules: regras faltando para coleções principais
   dt_inventarios, dt_contagens, dt_vazios, dt_divergencias, dt_analistas,
   dt_auditoria_meta e dt_locais_meta não tinham regras de acesso.
   Resultado: coletor recebia "permission-denied" ao tentar ler inventários
   e ao salvar contagens.

3. [ALTO] Analista não iniciava listeners Firebase no boot (02-core-state-bootstrap.js)
   initApp() chamava apenas loadAll() do localStorage. Os onSnapshot de
   dt_contagens/dt_vazios/dt_recontagens só eram ativados ao navegar para
   a aba "Contagens" e somente se o DB estivesse vazio. Contagens novas
   do coletor não chegavam em tempo real se o analista já tinha dados em cache.
   Correção: initApp() agora chama os três listeners após 800ms do boot.

4. [ALTO] sincronizarContagens() só lia localStorage (20-sync-contagens.js)
   O botão de sync manual do analista recarregava apenas o cache local, sem
   buscar dados novos do Firestore. Agora reinicia os onSnapshot quando online.

5. [MÉDIO] Scripts duplicados no coletor.html
   common-utils.js e firebase-shared.js eram carregados duas vezes seguidas,
   causando redefinições de funções globais (window.esc, window.dbg, etc.).

6. [MÉDIO] inventario_id com fallback 'local' no coletor (08-etapas-produto-quantidade-salvamento.js)
   Se APP.inventario não estivesse definido, a contagem era salva com
   inventario_id: 'local'. O analista filtra por inventários ativos, então
   essas contagens nunca apareciam. Agora o salvamento é bloqueado com toast
   de erro antes de criar o objeto de contagem.

7. [MÉDIO] Aba Contagens sempre garante listener ativo (03-core-navigation.js)
   Antes só ativava listener se DB.contagens estivesse vazio. Agora ativa
   sempre que houver inventários ativos ao abrir a aba.

Estrutura:
- js/shared/............. utilitários e serviços compartilhados
- js/analista/.......... módulos do painel analista
  - 09-fs-publicar.js .. NOVO: publicação Firestore (inventários, endereços, produtos)
- js/coletor/........... módulos do aplicativo coletor
- js/ajuda/............. scripts da central de ajuda
