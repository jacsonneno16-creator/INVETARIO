# Auditoria do coletor offline/online — v201

## Causa encontrada

O `coletor.html` executava os arquivos de `public/js-legacy/coletor`, mas as correções mais recentes de reconexão estavam apenas em `public/js/coletor`. Assim, o coletor instalado continuava usando a implementação antiga.

Na retomada da internet, essa versão antiga podia reconstruir parcialmente o estado do aplicativo. Durante essa janela, a validação do GTIN/DUN tratava a ausência temporária das linhas do endereço como prova de que o produto não pertencia ao endereço, disparando o beep de erro.

## Correções aplicadas

- Recompilação dos módulos atuais de `public/js/coletor` para `public/js-legacy/coletor`.
- Sincronização unificada e silenciosa das filas de contagem e auditoria.
- Reconexão sem recarregar a página e sem apagar o endereço em andamento.
- Proteção contra sincronizações simultâneas.
- Inclusão do runtime de diagnóstico no HTML e no cache offline.
- Nova validação de produto: quando a base específica do endereço ainda está sendo recuperada, o sistema não acusa produto fora do endereço e não toca beep falso.
- Atualização da versão do service worker e do cache para forçar a entrega dos arquivos corrigidos.

## Comportamento esperado

Ao perder e recuperar a internet, a tela atual permanece aberta. As filas são enviadas em segundo plano. O produto somente é marcado como fora do endereço quando existem registros válidos daquele endereço na base e o código realmente não pertence a eles.
