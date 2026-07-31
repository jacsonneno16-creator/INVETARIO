# Auditoria completa do código e das regras — v230

Base revisada: último pacote v228 com as correções de Auditoria, UID de log e sessão.

## Diagnóstico do erro da imagem

O aviso `Missing or insufficient permissions` em `adicionarColecao()` era causado por duas consultas auxiliares da aba Auditoria:

1. leitura da coleção inteira `lojas` para procurar auditorias em outras lojas;
2. leitura de `dt_auditorias` na raiz, usada apenas por dados antigos.

A auditoria da loja selecionada era carregada, mas as duas buscas adicionais eram recusadas e registradas no Console. A chamada para `gc.kes...kaspersky-labs.com` é externa ao sistema e não é erro do Firebase.

## Resultado por aba

| Aba | Dados principais | Resultado da revisão |
|---|---|---|
| Dashboard | inventários, contagens, divergências e auditorias | Corrigida a procura global de auditorias para ocorrer somente com acesso global. |
| Inventários | `dt_inventarios/base_chunks` | Regras explícitas preservam leitura por loja e escrita por permissão. Controle de versão mantido. |
| Acompanhamento | inventário ou auditoria | Corrigida a tentativa de ler auditorias antigas na raiz por perfil restrito. |
| Auditoria Operacional | `dt_auditorias`, `base_chunks`, `enderecos`, `ocorrencias` | Corrigidas consultas multiloja e criadas regras próprias para todas as subcoleções. |
| Contagens | `dt_contagens` | Mantido o motor único de status; testes de 1ª, 2ª e 3ª rodada passaram. Identidade antiga por `operador_id` passou a ser validada contra o usuário autenticado. |
| Pendências | `dt_atribuicoes_contagem` | Coletor responsável pode concluir somente campos operacionais; criação, cancelamento e atribuição continuam administrativos. |
| Recontagem | `dt_recontagens`, `dt_divergencias`, bloqueios | Incluídos `numero_recontagem` e `contagem_uuid` na sincronização limitada do coletor. Divergências continuam exclusivas do Analista autorizado. |
| Relatório de conflitos | contagens e divergências | Sem erro sintático encontrado; leituras permanecem limitadas à loja autorizada. |
| Capas duplicadas | inventários e endereços | Sem incompatibilidade adicional encontrada. |
| Produtividade | contagens e operadores | Sem incompatibilidade adicional encontrada. |
| Endereços | `dt_locais`, chunks e meta | Leitura por loja e edição com permissão `enderecos.editar`. Migração raiz limitada a administrador. |
| Produtos | coleções globais de produtos | Leitura para usuário ativo; importação/edição exige permissão de produtos. |
| Coletores | `dt_coletores` global e dados por loja | Aprovação continua administrativa; coletor só atualiza seu próprio dispositivo sem alterar `aprovado`. |
| Operadores | `usuarios_acessos` e `dt_operadores` | Mapas opcionais agora são verificados antes do acesso; usuário não pode promover a si mesmo. |
| Lojas | `lojas` e migração legada | Perfil restrito busca individualmente apenas os IDs permitidos; administrador mantém listagem global. |
| Rastreabilidade | logs e dados operacionais | Log mantém `usuario_uid == request.auth.uid`; atualização e exclusão de log continuam bloqueadas. |
| Importar/Exportar | inventários e chunks | Escrita continua condicionada às permissões específicas. |
| Coletor | contagem, recontagem e auditoria | Regras de identidade e inventário aberto preservadas; subcoleções da Auditoria agora têm regras explícitas. |

## Regras reescritas

- Nenhum `allow ... if true` foi criado.
- Usuário precisa estar autenticado, cadastrado e ativo.
- Administrador legado é reconhecido sem depender de campos novos de loja.
- Campos opcionais de perfil não causam mais negação por mapa inexistente.
- Acesso operacional continua separado por loja.
- Logs continuam imutáveis e vinculados ao UID autenticado.
- Coletor não pode alterar divergências nem administrar auditorias.
- Atualizações do Coletor usam lista fechada de campos.
- Coleções desconhecidas continuam bloqueadas.
- Dados antigos na raiz ficam disponíveis somente ao administrador para compatibilidade/migração.

## Arquivos funcionalmente alterados

- `public/firestore.rules`: regras completas e explícitas.
- `public/js/shared/firebase-shared.js`: listagem segura de lojas para perfil restrito.
- `public/js/analista/38-auditoria-operacional-v22.js`: busca de outras lojas/raiz somente com acesso global.
- `public/js/analista/22-dashboard-render-sync.js`: mesma correção no Dashboard.
- `public/js/analista/41-dashboard-acomp-v37.js`: mesma correção no Acompanhamento.
- `public/analista.html`, `public/coletor.html` e `public/sw.js`: somente atualização de versão do cache.

## Validações executadas

- Verificação sintática de todos os arquivos JavaScript: aprovada.
- Testes de colunas e estado único Contagem/Recontagem: aprovados.
- Testes de 1ª, 2ª e 3ª contagem: aprovados.
- Busca por permissões abertas e escrita genérica: nenhuma liberação encontrada.

## Publicação

Esta versão altera Hosting e regras. Publique os dois juntos:

```bash
firebase deploy --only hosting,firestore:rules
```

Depois feche todas as abas do sistema e abra novamente para o Service Worker carregar a versão nova.
