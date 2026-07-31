Da Terrinha — Inventário v228
=============================

Versão candidata à homologação gerada em 30/07/2026.

ÁRVORE OFICIAL

- Analista: public/js/analista
- Coletor: public/js/coletor
- Compartilhado: public/js/shared
- Service Worker único: public/sw.js

REGRAS OPERACIONAIS

- O estado de Contagem × Recontagem é consolidado por endereço pelos módulos
  address-state-engine.js, address-state-selectors.js e address-state-view.js.
- A fotografia física atual é a fonte usada pelas telas e exportações.
- Inventários são arquivados logicamente; histórico operacional não é apagado.
- Alterações de status do inventário usam transação e versão.
- A fila offline utiliza UUID como identidade idempotente e é sincronizada
  novamente após reconexão.

SEGURANÇA

- Senhas não são persistidas no navegador.
- O Firestore exige usuário ativo, canal, perfil, permissão e loja autorizada.
- Operações administrativas de Authentication são executadas por Cloud
  Functions com verificação de permissão e escopo.
- Renderizações HTML passam por sanitização central, além do escape de campos.

DEPLOY

O firebase.json referencia:

- public/firestore.rules
- public/firestore.indexes.json
- functions/ em Node.js 20
- public/ para Hosting

Antes de produção, execute a homologação com um projeto Firebase separado,
publique regras, índices e Functions, e valide os cenários descritos no
RELATORIO_IMPLEMENTACAO_V227.md.
