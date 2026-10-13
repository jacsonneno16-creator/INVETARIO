# DT Sistemas — Apontamento de Produção + Conferência Logística (V1)

Base utilizada: `INVETARIO-GitHub(3).zip`, enviada em 06/10/2026.

## Objetivo

Evitar apontamentos duplicados e estoque virtual sem pallet físico. A Produção cria um **pré-apontamento** e uma capa DT de 7 dígitos. A BlueSoft só recebe o apontamento depois que a Logística localizar e conferir fisicamente o pallet.

Regra central:

**1 pallet físico = 1 capa DT = 1 conferência = no máximo 1 envio para a BlueSoft.**

## Fluxo implementado

1. Produção abre `Logística > Estoque > Apontamento` no Coletor/PWA.
2. Bipa GTIN/DUN do produto.
3. O backend valida o produto na BlueSoft e consulta a ficha técnica da loja.
4. Produção informa lote, validade e quantidade do pallet.
5. O backend gera uma capa DT exclusiva de 7 dígitos e salva o registro como `AGUARDANDO_CONFERENCIA`.
6. **Nenhum POST de apontamento é feito à BlueSoft nesta etapa.**
7. A Logística bipa a capa física na tela de conferência.
8. Bipa novamente o produto e confirma lote, validade e quantidade.
9. Produto/lote/validade divergentes bloqueiam o envio.
10. Se somente a quantidade divergir, fica `DIVERGENTE`. A Logística pode aprovar explicitamente a quantidade física, com justificativa obrigatória.
11. Somente depois da conferência aprovada o backend faz o POST de apontamento na BlueSoft.
12. Todo o processo fica registrado com usuário, horário, capa, produto, quantidades, status e eventos.

## Integração BlueSoft usada

A documentação `api-docs.json` fornecida permite integração REST direta. Não é necessário gerar arquivo para importação manual neste fluxo.

Endpoints utilizados:

- `GET /api/comercial/produtos/gtin-plu` — valida o código bipado.
- `GET /api/pcp/ficha-tecnica` — identifica ficha técnica ativa do produto/loja.
- `POST /api/pcp/apontamento-producao` — apontamento por produto quando não há ficha técnica ativa.
- `POST /api/pcp/apontamento-producao/ficha-tecnica` — apontamento por ficha técnica.
- `GET /api/monitoramento/async/{requestId}` — acompanha apontamentos assíncronos por ficha técnica.

### Permissões necessárias no usuário/token da API BlueSoft

- **4360** — API Comercial produto gtin-plu (Consultar)
- **4238** — API Ficha Técnica (Consultar)
- **4223** — API PCP Apontamento de Produção (Incluir)
- **4047** — API Monitoramento Assíncrono (Consultar)
- **38** — consulta de produto, usada para enriquecer a descrição quando disponível

A configuração BlueSoft continua usando o cadastro já existente em `dt_config/integracao_api` e `bluesoft_loja_key` da loja. As credenciais não são expostas no navegador/coletor.

## Permissões do DT Sistemas

Novo módulo: `estoque-rel-apontamento`.

Ações:

- `visualizar`
- `criar`
- `conferir`
- `cancelar`
- `reprocessar`

Sugestão de configuração:

### Produção
- `criar = SIM`
- `visualizar = opcional`
- `conferir = NÃO`
- `cancelar = conforme responsabilidade`
- `reprocessar = NÃO`

### Logística
- `visualizar = SIM`
- `conferir = SIM`
- `criar = SIM` se a logística também puder apontar em exceção
- `cancelar = conforme responsabilidade`
- `reprocessar = somente usuários responsáveis pela integração`

As permissões são verificadas no frontend e novamente nas Cloud Functions. Ocultar o botão não é a única proteção.

## Proteções contra duplicidade

- Capa gerada no servidor por transação Firestore.
- Número de capa sempre com 7 dígitos dentro deste módulo.
- Criação possui `requisicaoId` idempotente para impedir capa duplicada por duplo clique/reenvio.
- Antes de enviar para a BlueSoft, uma transação trava o registro como `ENVIANDO`.
- `ENVIANDO`, `PROCESSANDO` ou `CONCLUIDO` não podem ser enviados novamente.
- Erro HTTP claramente rejeitado vira `ERRO_REJEITADO` e pode ser reprocessado com permissão.
- Timeout, erro de rede, HTTP 5xx ou 429 após tentativa de POST viram `ERRO_INCERTO`. **O sistema não reenvia automaticamente**, porque o primeiro POST pode ter sido processado pela BlueSoft. Isso evita duplicidade.
- Payload e hash SHA-256 ficam registrados para auditoria.

## Status principais

- `AGUARDANDO_CONFERENCIA`
- `DIVERGENTE`
- `CONFERIDO_AGUARDANDO_INTEGRACAO`
- `PROCESSANDO`
- `APONTADO_BLUESOFT`
- `ERRO_REJEITADO`
- `ERRO_INCERTO`
- `CANCELADO`

## Dados gravados

Coleção principal (acesso somente pelo backend/Admin SDK):

- `dt_apontamentos_producao/{capa}`
- subcoleção `eventos`

Controle auxiliar de idempotência:

- `dt_apontamento_idempotencia/{uid}_{requisicaoId}`

Contador transacional:

- `dt_config/apontamento_capa_counter`

Não foi necessário liberar essas coleções diretamente nas regras do Firestore; o coletor/analista usa Cloud Functions.

## Telas

### Coletor/PWA
`Estoque > Apontamento`

- Apontar produção
- Conferir pallets
- Histórico

### Analista
`Logística > Estoque > Apontamento`

- indicadores do dia
- filtros
- histórico/tabela
- consultar processamento BlueSoft
- cancelar pré-apontamento, conforme permissão
- reprocessar erro rejeitado, conforme permissão

## Deploy

Esta alteração modifica frontend e Cloud Functions:

```bash
firebase deploy --only functions,hosting
```

Não é necessário deploy de `firestore.rules` para esta V1 porque as novas coleções não são acessadas diretamente pelo cliente.

## Validação executada antes da entrega

- `node --check functions/index.js` — OK
- `node --check public/js/coletor/31-apontamento-producao.js` — OK
- testes direcionados de apontamento, permissões e navegação — **23/23 passando**
- suíte completa de testes públicos foi executada e chegou a **562 testes passando, sem falha observada**, mas o comando atingiu o limite de tempo antes de finalizar toda a suíte; portanto não é correto afirmar que 100% da suíte completa terminou.

## Antes de usar em produção

Fazer um teste controlado com uma loja/produto real e um pallet de teste:

1. conferir se o token BlueSoft possui as permissões listadas;
2. bipar o produto;
3. criar a capa DT;
4. confirmar que ainda não surgiu estoque/apontamento na BlueSoft;
5. conferir o pallet pela Logística;
6. confirmar o apontamento gerado na BlueSoft;
7. tentar bipar/conferir a mesma capa novamente e confirmar que o sistema bloqueia;
8. testar uma divergência de quantidade;
9. testar produto/lote/validade divergentes;
10. testar o acompanhamento do `requestId` quando a ficha técnica gerar processamento assíncrono.

Essa etapa é necessária porque os testes realizados aqui são de código e estrutura; não foi feito POST real no tenant de produção da Da Terrinha.
