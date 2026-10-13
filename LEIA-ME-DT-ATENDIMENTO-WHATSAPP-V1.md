# DT Atendimento · WhatsApp — V1

## O que esta versão cria

Novo setor **💬 Atendimento** no sistema Analista, com:

- **Dashboard** da fila de atendimento;
- **Conversas WhatsApp** em 3 colunas (fila, conversa e cliente);
- **Assumir atendimento** para evitar duas pessoas respondendo ao mesmo cliente;
- **Transferir atendimento** para outro usuário liberado;
- status **Novo / Em atendimento / Aguardando cliente / Resolvido**;
- **notas internas** que o cliente não vê;
- identificação de **quem respondeu** cada mensagem;
- contagem de mensagens não lidas;
- busca e filtros de fila;
- permissões próprias por ação;
- **Configuração** mostrando se a integração oficial da Meta está pronta;
- webhook oficial para receber mensagens e atualizações de status;
- envio de mensagens de texto pela WhatsApp Business Platform.

A V1 usa **somente a integração oficial da Meta**. Não usa automação de WhatsApp Web, leitura de QR Code por robô ou bibliotecas não oficiais.

## Permissões novas

- `atendimento-dashboard.visualizar`
- `atendimento-dashboard.supervisionar`
- `atendimento-conversas.visualizar`
- `atendimento-conversas.responder`
- `atendimento-conversas.assumir`
- `atendimento-conversas.transferir`
- `atendimento-conversas.finalizar`
- `atendimento-conversas.notas`
- `atendimento-conversas.supervisionar`
- `atendimento-config.visualizar`
- `atendimento-config.configurar`

Administrador continua com bypass normal do sistema. Para os demais usuários, libere o setor **Atendimento** e as ações desejadas na tela de Usuários e Permissões.

## Collections criadas

- `wa_conversas`
  - subcollection `mensagens`
  - subcollection `notas`
- `wa_meta_mensagens` (índice técnico, somente backend)
- `wa_config` (reservada para configuração não secreta futura)

O cliente web tem somente leitura das conversas/mensagens/notas. Alterações sensíveis passam por Cloud Functions.

## Cloud Functions novas

- `whatsappWebhook`
- `whatsappEnviarMensagem`
- `whatsappAssumirConversa`
- `whatsappTransferirConversa`
- `whatsappAtualizarStatus`
- `whatsappAdicionarNota`
- `whatsappListarAgentes`
- `whatsappStatusIntegracao`

Região: `southamerica-east1`.

## Antes de usar com mensagens reais

No projeto da Meta, crie/abra um aplicativo Business e adicione o produto **WhatsApp**. Você vai precisar de:

1. token permanente/adequado da WhatsApp Business Platform;
2. `Phone Number ID` do número;
3. `App Secret` do aplicativo Meta;
4. um token de verificação do webhook criado por você (uma senha aleatória forte).

### Salvar os segredos no Firebase

Na pasta do projeto:

```bash
firebase functions:secrets:set WHATSAPP_ACCESS_TOKEN
firebase functions:secrets:set WHATSAPP_PHONE_NUMBER_ID
firebase functions:secrets:set WHATSAPP_APP_SECRET
firebase functions:secrets:set WHATSAPP_VERIFY_TOKEN
```

Nenhum desses valores deve ser colocado no JavaScript do navegador, Firestore ou GitHub.

## Webhook na Meta

Depois do deploy, use como Callback URL:

```text
https://southamerica-east1-SEU_PROJECT_ID.cloudfunctions.net/whatsappWebhook
```

No campo **Verify Token**, informe exatamente o mesmo valor salvo em `WHATSAPP_VERIFY_TOKEN`.

Assine pelo menos o evento de **messages**.

## Deploy desta V1

Esta versão mexe em Hosting, Functions e regras do Firestore:

```bash
firebase deploy --only hosting,functions,firestore:rules
```

## Limites da V1

- envio implementado inicialmente para **texto**;
- mensagens de mídia recebidas aparecem identificadas pelo tipo (`[image]`, `[audio]`, etc.), mas download/preview de mídia fica para a próxima fase;
- templates de mensagem da Meta ainda não têm tela de criação/seleção;
- relatórios avançados de SLA/tempo médio são uma próxima fase;
- a interface depende das credenciais oficiais da Meta para trocar mensagens reais.

## Fluxo esperado

1. Cliente manda mensagem para o número da empresa.
2. Meta chama `whatsappWebhook`.
3. A conversa entra na fila como **Novo**.
4. Atendente clica **Assumir**.
5. O nome do responsável fica visível para todos.
6. Atendente responde pelo sistema.
7. Outros usuários veem o histórico, mas sabem quem está responsável.
8. Pode transferir, colocar **Aguardando cliente** ou **Resolver**.
9. Supervisor pode acompanhar todas as conversas conforme permissão.
