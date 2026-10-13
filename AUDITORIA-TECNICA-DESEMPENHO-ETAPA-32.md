# Auditoria técnica de desempenho — Etapa 32

Data: 13/09/2026  
Projeto auditado: `daterrinha-inventario`  
Baseline: `daterrinha-inventario.web.1app(1).har`  
SHA-256 do HAR: `df22dd003760510bf923d9611c8211e40d9e8364fecccb36747714c643581eac`

## Veredito sem generalizações

| Item solicitado | Resultado comprovado | Limite da conclusão |
|---|---|---|
| Abrir o setor/painel Recebimento sem buscar | Comprovado: 0 Functions, 0 `get()`, 0 carga operacional | Teste local instrumentado do código desta versão |
| Abrir a aba operacional Recebimentos sem buscar | Comprovado: 0 Functions, 0 `get()`, 0 polling | Teste local instrumentado do código desta versão |
| Buscar somente após ação manual | Comprovado: botão chama a função de busca; filtros apenas redesenham | Não mede a latência da infraestrutura publicada |
| Resumo de notas no servidor | Comprovado por teste da projeção `select()` e ausência de `itens` | A Function precisa ser publicada para valer em produção |
| Produtos não carregam no login | Comprovado: 0 leituras fora da página; 1 ao abrir Produtos | Teste JSDOM com Firestore instrumentado |
| Coleções inteiras nunca são varridas | **A afirmação global seria falsa.** As varreduras pesadas automáticas auditadas foram removidas; ainda há varreduras manuais/administrativas listadas abaixo | Não declarar “zero full scans no sistema inteiro” |
| Timeout de 15 segundos | Comprovado no Pátio em Tempo Real | Não é um timeout global de todas as telas |
| BlueSoft fora do Inventário | Serviço geral de 161.445 bytes removido do boot; módulo leve de Recebimento não tem URL/fetch/proxy | `43-importar-exportar-api.js` e `bluesoftProxy` permanecem para Inventário, como solicitado |
| Bases BI/SharePoint materializadas | Comprovado para os pipelines listados abaixo | Nem todos os 15 JSONs estão materializados; alguns continuam sob busca manual com cache |
| Cache manual de 15 minutos | Comprovado nos limites de 899.999 ms e 900.001 ms e em concorrência | Cache em memória da aba; recarregar a página o esvazia |
| Comparação de carga publicada | Baseline real medido; nova abertura local concorrente medida | Comparação de rede Firebase pós-correção está pendente de publicação e novo HAR |
| Suíte completa do navegador | **Não passou:** 1.320/1.397 aprovados; 77 falhas | O pacote não pode ser declarado livre de regressões globais |

## 1. Correção obrigatória de Recebimentos

### Comportamento antigo encontrado

No painel do setor, `renderRecebimentoDashboard()` chamava as consultas durante a abertura:

```js
async function renderRecebimentoDashboard() {
  _desenhar();
  await Promise.all([
    carregarLogisticaRecebimento(),
    global._recebimentoOperacaoInternals?.carregar?.(),
    _carregarComprasBi()
  ]);
}
```

Na aba operacional, o render também iniciava a consulta e, depois, um `setInterval` repetia a leitura a cada 45 segundos:

```js
const atualizacao = carregarRecebimentoOperacao(forcar);
...
_intervalTempoReal = setInterval(() => {
  carregarRecebimentoOperacao(true).then(...);
}, 45000);
```

Esses trechos constam na versão anterior do Git (`HEAD`), respectivamente em `91-logistica-recebimento.js:174-181` e `93-recebimento-operacao.js:127-139,300-318`.

### Código atual

Painel do setor — `public/js/analista/91-logistica-recebimento.js:219-225`:

```js
function renderRecebimentoDashboard() {
  const pagina = document.getElementById('page-recebimento-dashboard');
  if (!pagina) return;
  _desenhar();
}
```

A busca fica em `_buscarManual()` (`:443-468`) e só os eventos do botão/tentativa chamam essa função (`:817-819`). Alterar período ou categoria apenas invalida o resultado e redesenha (`:825-834`).

Aba operacional — `public/js/analista/93-recebimento-operacao.js:288-307`:

```js
function renderRecebimentoOperacao() {
  const pagina = document.getElementById('page-recebimento-operacao');
  if (!pagina) return;
  _desenharRecebimentoOperacao();
}

async function _buscarRecebimentosManual() {
  if (_carregando) return;
  _desenharRecebimentoOperacao();
  try { await carregarRecebimentoOperacao(true); }
  catch (e) { ... }
  _desenharRecebimentoOperacao();
}
```

O antigo ativador de tempo real agora somente garante que qualquer intervalo anterior seja desligado (`:110-121`). Os botões chamam `_buscarRecebimentosManual()` (`:703-704`).

### Prova executada

Comando:

```bash
node --test public/tests/performance-leituras-etapa31.test.js
```

Resultados pertinentes:

```text
✔ abrir Dashboard de Recebimento monta a interface com ZERO leituras; somente Buscar dados consulta
✔ abrir aba operacional Recebimentos faz ZERO leituras e não arma polling; botão manual consulta
```

Contadores verificados pelo teste:

| Ação | Cloud Functions | Firestore `get()` | Polling |
|---|---:|---:|---:|
| Abrir painel | 0 | 0 | 0 |
| Abrir aba operacional | 0 | 0 | 0 |
| Buscar manualmente na aba | 1 | 1 coleção pequena de rotas | 0 |

## 2. Reverificação dos itens anteriores

### 2.1 Consultas pesadas retiradas do navegador

Casos comprovados:

- Dashboard: as leituras integrais antigas de `recebimento_notas` e `recebimento_cargas` foram retiradas. A busca manual chama `buscarResumoHistoricoRecebimentoBigQuery`, `buscarRecebimentosOperacaoBigQuery` e `buscarResumoRecebimentoComprasBigQuery` (`91:443-457`, `93:223-241`).
- Indicadores/Pátio: o navegador não faz mais consulta `documentId() in ...` na coleção pesada de notas. Ele incorpora `resposta.data.notasResumo` (`98:122-130,168-182`; `105:190-201`).
- Histórico/Notas/Operação: as Functions têm testes que comprovam filtro no BigQuery, paginação de 50 e autorização por loja.

Query antiga do Pátio, na cópia original `originals/105...:129-147`:

```js
fs().collection(COL_NOTAS)
  .where(firebase.firestore.FieldPath.documentId(), 'in', lote)
  .get()
```

Query atual, movida para `functions/index.js:2900-2909`:

```js
col.where(admin.firestore.FieldPath.documentId(), 'in', grupo)
  .select('chave', 'numeroNota', 'serie', 'cfop', ...)
  .get()
```

Teste do backend:

```text
✔ resumo de notas usa projeção no servidor e nunca seleciona itens/documento completo
```

### 2.2 Resumo de notas no servidor

`_buscarResumoNotasRetorno()` seleciona apenas 17 campos pequenos e não seleciona `itens` (`functions/index.js:2878-2917`). Tanto `buscarIndicadoresRetornosBigQuery` quanto `buscarPatioTempoRealBigQuery` devolvem `{ recusas, notasResumo }` (`:2938-2948` e `:3103-3113`).

O teste injeta propositalmente um documento com `itens` de 5.000 elementos e confirma:

```js
assert.equal(selecao.campos.includes('itens'), false);
assert.equal(Object.hasOwn(resumo.CH1, 'itens'), false);
```

Conclusão: o código do navegador desta versão não baixa o documento completo nesse fluxo. Em produção, isso só passa a valer depois do deploy das Functions e do Hosting.

### 2.3 Produtos durante o login

Antes (`originals/52-cadastros-v287.js:105`):

```js
function boot(){ ligarAcoesCadastro(); activateProducts(); activateAddresses(); ... }
```

Agora (`public/js/analista/52-cadastros-v287.js:105`), `activateProducts()` só roda se `page-produtos` tiver a classe `on`.

Prova:

```text
✔ login em outra página faz ZERO leituras de produtos; abrir Produtos inicia a primeira leitura
✔ carrega os produtos com UMA busca (.get()), nunca abre conexão permanente (onSnapshot)
✔ clicar em "Atualizar" 2x rápido não dispara 2 buscas concorrentes
```

### 2.4 Varreduras de coleção: conclusão precisa

A frase “nenhuma coleção inteira é varrida” não é tecnicamente verdadeira para o repositório inteiro.

O que foi removido do caminho automático/pesado:

| Antes | Agora |
|---|---|
| Abertura do Dashboard lia `recebimento_notas.get()` e `recebimento_cargas.get()` | Render sem leitura; resumo agregado no BigQuery após botão |
| Aba Recebimentos carregava operação ao renderizar e a cada 45 s | Render sem leitura; consulta apenas no botão; sem intervalo |
| Pátio/Indicadores buscavam documentos completos de notas pelo navegador | Function faz query direcionada e `select()` sem `itens` |
| Importação manual de Agenda tinha fallback para `recebimento_agendamentos.get()` integral | `90-bi-recebimento-service.js:55-68` usa apenas `where('numeroPedido','in', lote)` e não possui fallback integral |

Varreduras que ainda existem e por quê:

| Arquivo/linha | Gatilho | Situação |
|---|---|---|
| `97-recebimento-recusas.js:448-452` | Migração/ingestão do ledger | Lê chunks; coleção individual inteira somente se os chunks ainda não existem |
| `97-recebimento-recusas.js:926-931` | Importação manual de correção | Varre recusas para casar arquivo enviado pelo usuário |
| `97-recebimento-recusas.js:1190` | Sincronização de BI no servidor/rotina específica | Precisa proteger todo o histórico contra exclusão |
| `105-recebimento-patio-tempo-real.js:216-221` | Botão manual “Preparar dados antigos” | Backfill único de `statusFisico` |
| `93-recebimento-operacao.js:385-408` | Botão “Novo Recebimento” | Lê cadastros pequenos de motoristas, veículos e docas |

Portanto: o gargalo automático foi retirado; rotinas administrativas integrais continuam existentes e não são executadas apenas por abrir o setor.

### 2.5 Timeout de 15 segundos

Implementação real no Pátio, `public/js/analista/105-recebimento-patio-tempo-real.js:154-160`:

```js
const LIMITE_TEMPO_REDE_MS = 15000;
return Promise.race([
  promessa,
  new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(mensagemTimeout)), LIMITE_TEMPO_REDE_MS);
  }),
]).finally(() => clearTimeout(timer));
```

Ela envolve a leitura do cache, a Function BigQuery e o enriquecimento (`:190-201`). Testes:

```text
✔ timeout do cache usa a consulta alternativa e ignora resposta atrasada do cache
✔ carregarPatio nunca fica pendurado pra sempre — desiste depois do limite e mostra "Tentar de novo"
```

Escopo: 15 segundos no Pátio. As Functions têm timeouts próprios de 30/120 segundos no servidor; não existe timeout único de 15 segundos para o site inteiro.

### 2.6 BlueSoft fora do Inventário

O arquivo `90-bluesoft-service.js` tinha 161.445 bytes e era carregado no login. A referência `<script src="...90-bluesoft-service.js">` foi removida de `analista.html`. Recebimento passou a usar `90-bi-recebimento-service.js` sob demanda (`00-lazy-areas.js:46-63`); esse arquivo não contém URL, `fetch` nem `bluesoftProxy`.

O fluxo permitido do Inventário permanece em `43-importar-exportar-api.js`, junto da Function `bluesoftProxy`. O teste comprova simultaneamente a ausência do serviço geral no boot e a presença do módulo de Inventário:

```text
✔ serviço BlueSoft geral não entra no boot; Recebimento usa serviço BI sem API externa
```

Também foi executado o carregamento dos 17 módulos lazy de Recebimento com Firestore e Functions instrumentados:

```text
✔ carregar os 17 scripts de Recebimento juntos executa ZERO acessos a dados
```

### 2.7 Bases materializadas do BI/SharePoint

Pipelines comprovados no servidor:

| Arquivo SharePoint | Destino materializado/uso | Evidência |
|---|---|---|
| `ficha_tecnica.json` | `producao_ficha_tecnica` | `functions/index.js:933-967,1589-1594` |
| `compras_a_receber.json` | `recebimento_agendamentos`, `origem:'bi'` | `:970-1052,1589-1594` |
| `dados-insumos.json` | `pcp_estoque_bluesoft`, `origem:'bi'` | `:1079-1101,1589-1594` |
| `produtos_estoque.json` | `pcp_estoque_bluesoft`, `origem:'bi'` | `:1135-1164,1589-1594` |
| `notas_fiscais_jacson.json` | notas retornadas/devoluções e espelhos de Recebimento | `:1415,1589-1594` |
| `compras_produto.json` | histórico de compras BigQuery/agregado | `:1951-1982` |
| `fornecedores_agregado.json` | `bi_fornecedores_agregado` | `:1993-2035` |
| `dados-consumo-insumos.json` | `bi_consumo_insumos_resumo` | `:2057-2095` |
| `dados_cortes.json` | `bi_cortes_mensal` | `:2124-2164` |

O sincronizador principal roda a cada 30 minutos (`:1726-1732`); os agregados maiores rodam a cada 4 horas. Exemplo de consumo real: Estoque consulta `pcp_estoque_bluesoft.where('origem','==','bi')` (`75-producao-estoque.js:134-148`) e a busca de pedido consulta `recebimento_agendamentos.where('numeroPedido','==',numero).limit(1)` (`78-pcp-central.js:626-646`).

Limite encontrado: `dados-estoque.json`, `dados-mrp-terceiros.json`, `dados-escadinha.json`, `valor_insumos.json`, `consumo_insumos.json` e outros relatórios ainda usam `buscarArquivoBiGraphApi` quando o usuário clica em Buscar. Isso é uma leitura manual do SharePoint com cache, não uma base materializada. Logo, não seria correto afirmar que todos os JSONs enviados já estão materializados.

### 2.8 Cache manual de 15 minutos

Implementação em `public/js/analista/bi-pasta-local.js:23-58`:

```js
const TTL_MS = 15 * 60 * 1000;
if (!forcar && salvo && Date.now() - salvo.em < TTL_MS) return salvo.dados;
if (!forcar && pendentes.has(nome)) return pendentes.get(nome);
```

Teste com relógio controlado:

| Momento | Chamadas acumuladas à Function |
|---|---:|
| Duas solicitações simultâneas | 1 |
| 15 min menos 1 ms | 1 |
| 15 min mais 1 ms | 2 |

Resultado:

```text
✔ cache manual mantém resposta por 15 minutos e deduplica chamadas simultâneas
```

## 3. Teste de carga e comparação

O script reproduzível é `scripts/auditoria-performance-etapa32.js`; o executor completo é `scripts/executar-auditoria-etapa32.sh`. Evidência estruturada: `evidencias/AUDITORIA-CARGA-ETAPA-32.json`.

### Baseline real do HAR publicado

| Métrica | Valor exato |
|---|---:|
| Requisições | 87 |
| Transferido | 422.323.980 bytes = 402,76 MiB |
| Conteúdo declarado/descompactado | 6.590.371.626 bytes = 6,14 GiB |
| Canais Firestore Listen | 71 |
| Maior canal | 90.733 ms |
| Maior canal transferido | 20.695.508 bytes = 19,74 MiB |

### Execução concorrente desta versão

Foram abertas em paralelo 20 instâncias isoladas: 10 Dashboards e 10 abas operacionais de Recebimentos.

| Métrica | Resultado |
|---|---:|
| Interfaces montadas | 20/20 |
| Tempo total local | 273,324 ms |
| Média local por tela | 13,666 ms |
| Cloud Functions ao abrir | 0 |
| Firestore `get()` ao abrir | 0 |
| Carregamentos operacionais indiretos | 0 |
| Intervalos automáticos | 0 |
| Bytes de dados de negócio ao abrir | 0 |
| Bundle lazy do Recebimento, bruto | 742.545 bytes |
| Bundle lazy, gzip estimado | 213.655 bytes |

Isto é execução real do código atual com APIs instrumentadas e concorrência real no processo local. **Não é um teste de rede do Firebase publicado.** Como a versão corrigida ainda não está no ar, comparar “91 s antes versus X s em produção agora” seria fabricar um resultado. O único resultado válido pós-deploy exigirá novo HAR, com cache desabilitado, após seguir a publicação abaixo.

## 4. Ambiente de publicação

Comandos de diagnóstico executados neste ambiente:

```text
firebase --version  -> firebase: command not found (exit 127)
gcloud --version    -> gcloud: command not found (exit 127)
npx --no-install firebase --version -> could not determine executable to run (exit 1)
FIREBASE_TOKEN=absent
GOOGLE_APPLICATION_CREDENTIALS=absent
GOOGLE_CLOUD_PROJECT=absent
```

O projeto está configurado corretamente em `.firebaserc` como `daterrinha-inventario`, e `firebase.json` aponta Hosting para `public` e Functions para `functions`. O impedimento daqui é operacional: não há Firebase CLI instalada nem uma sessão/credencial autorizada de deploy. Sem essas duas coisas não existe comando autenticado que possa alterar o projeto remoto.

### Passos manuais para publicar

Pré-requisitos: Node.js 22, acesso de deploy ao projeto e Firebase CLI.

```bash
cd INVETARIO-GitHub-COMPLETO-Etapa-32-Auditoria

npm install -g firebase-tools
firebase login
firebase use daterrinha-inventario

cd functions
npm ci
cd ..

# Functions primeiro: o navegador novo depende dos novos contratos notasResumo/BigQuery.
firebase deploy --only functions

# Depois publique os arquivos do navegador.
firebase deploy --only hosting
```

Validação imediatamente após publicar:

1. Abra o site em janela anônima ou use `Ctrl+Shift+R`.
2. DevTools > Network: marque “Disable cache” e “Preserve log”.
3. Inicie a gravação antes do login.
4. Entre, abra Recebimento e aguarde 30 segundos sem clicar em Buscar: não deve aparecer callable de Recebimento nem canal Listen iniciado por essa tela.
5. Clique em Buscar uma única vez: deve aparecer a consulta manual correspondente.
6. Exporte “Save all as HAR with content”. Esse novo HAR é a prova necessária para a comparação de produção.
7. Se uma Function falhar, execute `firebase functions:log --project daterrinha-inventario` e preserve o trecho do erro.

## 5. Registro dos testes executados

Comando único:

```bash
./scripts/executar-auditoria-etapa32.sh /caminho/daterrinha-inventario.web.1app\(1\).har
```

Resultado das suítes direcionadas de desempenho/leitura:

| Suíte | Passou | Falhou |
|---|---:|---:|
| `functions/test/*.test.js` | 101 | 0 |
| `performance-leituras-etapa31.test.js` | 9 | 0 |
| `analista-produtos-busca-unica.test.js` | 5 | 0 |
| Testes selecionados de timeout do Pátio | 2 | 0 |
| **Total** | **117** | **0** |

Além disso, `node --check` foi executado em `90-bi-recebimento-service.js`, `91-logistica-recebimento.js`, `93-recebimento-operacao.js`, `98-recebimento-retornos-indicadores.js`, `105-recebimento-patio-tempo-real.js` e `functions/index.js`; todos retornaram exit code 0.

### Suíte ampla do navegador

Também foi executado, sem filtro:

```bash
node --test public/tests/*.test.js
```

Resultado real:

| Testes | Passaram | Falharam | Exit code |
|---:|---:|---:|---:|
| 1.397 | 1.320 | 77 | 1 |

Log integral: `evidencias/TESTES-PUBLIC-COMPLETO-ETAPA-32.log`  
SHA-256: `6d3138053b66f90d94fa90499fadb8008f288a2c7c1b41da8bb4a1028b18e37e`

As falhas incluem três grupos observáveis no log:

1. Testes que ainda exigem contratos deliberadamente removidos nesta etapa, como carregamento automático no render, documento completo de notas no navegador e o serviço geral BlueSoft no HTML.
2. Testes cujo ambiente simulado não executa a nova busca manual antes de validar Dashboard/Operação/Transbordo; por isso os arrays ficam vazios sob a regra nova.
3. Falhas que não podem ser classificadas como “teste obsoleto” sem investigação adicional, incluindo autenticação/persistência, exportação/detalhe de recusa, navegação, filtros de performance e edição de motorista no transbordo.

Distribuição exata das 77 falhas por arquivo:

| Arquivo de teste | Falhas |
|---|---:|
| `recebimento-dashboard-bluesoft.test.js` | 8 |
| `analista-recebimento-patio-tempo-real.test.js` | 8 |
| `analista-recebimento-retornos-indicadores-fase11.test.js` | 7 |
| `recebimento-nf-controle.test.js` | 6 |
| `producao-relatorios-bi.test.js` | 6 |
| `logistica-fase15-recebimento.test.js` | 6 |
| `pcp-agenda-busca-pedido-bluesoft.test.js` | 5 |
| `recebimento-transbordo-analise.test.js` | 4 |
| `logistica-fase3-transbordo.test.js` | 4 |
| `analista-primeiro-acesso-troca-senha.test.js` | 4 |
| `recebimento-performance-filtro-periodo.test.js` | 3 |
| `recebimento-fase6-e2e.test.js` | 3 |
| `logistica-fase2b-recebimento-operacao.test.js` | 3 |
| `pcp-fase11-bluesoft-service.test.js` | 2 |
| `logistica-fase2d-relatorios.test.js` | 2 |
| `analista-router-navegacao.test.js` | 2 |
| Cinco arquivos com uma falha cada | 5 |

Consequência: os itens específicos de leitura/desempenho acima têm prova direcionada, mas esta versão **não deve ser descrita como aprovada em regressão completa**. As 77 falhas precisam ser triadas antes de afirmar que todo o comportamento funcional do ERP está preservado.

## Conclusão auditável

A abertura de Recebimento foi corrigida e está comprovada por contadores instrumentados: somente monta a interface, sem consulta e sem polling. Os principais downloads pesados foram deslocados para BigQuery/Functions e o resumo de notas tem projeção que exclui `itens`. Produtos não leem no login, o cache manual respeita 15 minutos e o serviço geral BlueSoft saiu do boot.

Três itens impedem uma declaração global de “tudo resolvido”: a latência/volume de rede da versão nova ainda não foi medida em produção, nem todos os 15 arquivos SharePoint estão materializados e a suíte ampla mantém 77 falhas. A evidência atual comprova os itens direcionados e os pipelines listados, mas não substitui o HAR pós-deploy nem a triagem das falhas globais.
