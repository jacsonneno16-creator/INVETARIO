# Integração final do módulo Produção — 2026-08-16

## Objetivo
Usar `Meu-Sistema-Producao` como referência funcional do módulo Produção e consolidar a implementação dentro do sistema maior (Inventário + Recebimento + Compras + PCP + Produção), sem substituir Firebase, autenticação, permissões, navegação e estrutura multi-loja do projeto principal.

## Decisão técnica
Não foi feito um `Ctrl+C/Ctrl+V` cego do `app.js` monolítico do sistema isolado porque os projetos usam Firebase, autenticação, rotas e nomes de coleções diferentes. As funções de Produção foram mantidas nos módulos `59` a `77`, com compatibilidade de campos/estruturas do sistema original e integração com o shell do projeto maior.

## Diferenças relevantes encontradas e tratadas

### Máquinas
A versão integrada não persistia vários campos usados pelo sistema original e por cálculos posteriores. Foram restaurados/normalizados campos como `codigo`, `tipo`, `setor`, `classificacao`, `pcMin`, `hTurno`, `nTurnos`, `tempoSetupPadrao` e `setupPadraoMin`, além de prevenção de duplicidade e compatibilidade de produtos por máquina.

### Produtos e ficha técnica
Foram compatibilizados `descricao/nome`, `pc_min/velocidadePadrao`, `maquina/maquinaPadrao`, `produtoAtivo` e identificação por produto + máquina. A sincronização Produto ↔ Máquina mantém `produtosCompativeis` e velocidade específica coerentes.

### Setup
A versão original usa estruturas como `produto_origem`, `produto_destino`, `tempo_setup`, enquanto a integrada usa `produtoOrigem`, `produtoDestino`, `minutos`. A leitura/cálculo aceita os dois formatos.

### Programação e Gantt
Foram normalizados aliases como `data`, `dtDesejada`, `dtSolicitacao`, status antigos/novos, `updatedAt/atualizadoEm` e snapshots de configuração. O Gantt e a agenda passam a interpretar OPs originadas nos dois formatos.

### Realizado e MRP/Insumos
O Realizado aceita a coleção legada `apontamentos_producao` e aliases de OP/apontamento. MRP aceita `qty/qtd/quantidade/consumoPorCaixa`, variações de descrição e estoque legado `insumos`.

### Jornada
O padrão do projeto de Produção foi preservado: domingo 0h, segunda a quinta 9h, sexta 8h e sábado 8h. A jornada gravada no cache local agora é isolada por loja, evitando carregar a jornada da Matriz ao trocar para uma Filial (e vice-versa).

### Multi-loja — correção final
O maior risco restante era cache em memória por módulo. O proxy `getDTFirestore()` mudava para a nova loja, mas Máquinas, Produtos, Programação, Gantt, Realizado, Relatórios etc. podiam continuar exibindo arrays da loja anterior porque cada módulo tinha `_carregado=true`.

Foi criado um contexto central `DTProducao` com invalidadores registrados por cada tela. No evento `dt-loja-alterada`, os caches privados são zerados antes da nova renderização. A troca oficial de loja do Analista também chama essa invalidação explicitamente.

O sidebar de Produção passa a exibir a loja ativa e reutiliza o seletor oficial do sistema maior.

### Cache do navegador / Service Worker
As versões dos assets de Produção foram atualizadas e `sw.js` foi regenerado pelo build oficial, evitando que o navegador continue executando JS antigo após o deploy.

## O que foi preservado do projeto principal
- Firebase `daterrinha-inventario`.
- Login/autenticação do sistema principal.
- Permissões por usuário/canal/setor.
- `DTLoja` e isolamento `lojas/{lojaId}/{colecao}`.
- Inventário.
- Recebimento.
- Compras.
- PCP.
- Integrações Bluesoft existentes no projeto principal.

## Mapeamento funcional da Produção
- Dashboard → `74-producao-dashboard.js`
- Produtos/Ficha Técnica → `60-producao-ficha-tecnica.js`
- Máquinas/Turnos → `61-producao-maquinas.js`
- Programação → `62-producao-programacao.js`
- Motor de agenda → `63-producao-agenda.js`
- Gantt → `64-producao-gantt.js`
- Insumos/MRP → `65-producao-insumos.js`
- Projeção → `66-producao-projecao.js`
- Programação automática → `67-producao-prog-automatica.js`
- Funcionários → `68-producao-funcionarios.js`
- Relatórios/Gerencial → `69-producao-relatorios.js`
- Setup → `70-producao-setup.js`
- Backup/Excel → `71-producao-excel.js`
- Mapa da fábrica → `72-producao-mapa-fabrica.js`
- Realizado/Processos → `73-producao-realizado.js`
- Estoque → `75-producao-estoque.js`
- Importação/API → `76-producao-importacao.js`
- Jornada/Categorias → `77-producao-config.js`

## Validação automatizada
Suíte executada após a etapa final:

- 339 testes
- 339 aprovados
- 0 falhas

Foi adicionado `producao-etapa6-multiloja.test.js`, cobrindo invalidação dos caches de Produção, jornada isolada por loja, seletor de loja do módulo e integração da troca de loja com o shell do Analista.

## Homologação recomendada antes do deploy definitivo
Os testes automatizados não substituem uma sessão real contra Firebase/Bluesoft. Em homologação, validar pelo menos:

1. cadastrar máquina em uma loja e confirmar que não aparece em outra;
2. cadastrar produto/ficha e usar na programação;
3. criar OP e conferir Agenda/Gantt;
4. trocar de Matriz para Filial sem recarregar o navegador e confirmar troca imediata dos dados;
5. apontar produção e conferir Realizado/Dashboard/Relatórios;
6. validar setup entre dois produtos;
7. testar programação automática e consumo de insumos;
8. exportar e reimportar backup em ambiente de teste;
9. testar cada perfil de permissão de Produção;
10. confirmar integrações Bluesoft usando credenciais/endpoint reais de homologação.
