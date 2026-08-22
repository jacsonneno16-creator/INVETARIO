# Integração V350 — Produção + PCP + Compras

Data: 11/08/2026

## Ordem executada

A implementação respeitou a ordem definida:

1. FASE 1 — Produção completa e validada.
2. FASE 2 — Estrutura base do PCP.
3. FASE 3 — Integração PCP → Compras.
4. FASE 4 — Integração PCP → Produção.
5. FASE 5 — Retorno Compras/Produção → PCP.
6. FASE 6 — Fluxos integrados e atualização de estoque.

## Produção

A Produção permanece baseada nas coleções `producao_*` por loja e usa `producao_registros` como fonte oficial de OPs. Foram preservados os módulos de ficha técnica, máquinas/turnos, programação, Agenda, Gantt, MRP/insumos, projeção, programação automática, funcionários, relatórios/gerencial, setup, backup/Excel, mapa, realizado/Produção Dia, dashboard, estoque/Bluesoft, importação/API e configurações.

## PCP

Módulo: `public/js/analista/78-pcp-central.js`.

Abas:
- Pedidos
- Estoque
- Pedidos x Estoque
- Compras / Necessidades
- Agendamentos
- Programação de Produção

Fontes reutilizadas, sem duplicação:
- estoque/demanda: `producao_projecao`
- produção programada/realizada: `producao_registros`
- dados produtivos: `producao_produtos`, `producao_maquinas` e demais coleções da Produção

Coleções próprias do fluxo PCP:
- `pcp_pedidos`
- `pcp_requisicoes_compra`
- `pcp_agendamentos`
- `pcp_solicitacoes_producao_global`

O cálculo de PCP cruza pedidos, saldo atual, estoque comprometido, produção programada, compras/agendamentos, consumo médio e eventos futuros, retornando saldo, necessidade, excesso, cobertura e previsão de ruptura.

## PCP → Compras

Módulo: `public/js/analista/79-compras-central.js`.

O comprador responsável é resolvido na ordem:
1. produto
2. categoria/classificação
3. fornecedor

As regras ficam em `compras_regras_comprador`. Requisições sem regra ficam com status `sem_comprador` e podem ser reprocessadas quando uma nova regra é cadastrada.

O comprador visualiza somente suas próprias requisições operacionais. O configurador pode administrar roteamento sem receber permissão operacional irrestrita.

## Compras → PCP

Ao efetivar uma compra, a própria requisição gera um agendamento determinístico ligado por `requisicaoId`. O PCP registra recebimentos parciais ou totais e o status retorna à requisição.

Estados principais:
- solicitada
- em análise
- comprada
- parcialmente recebida
- finalizada

## PCP → Produção

Cada produto pode armazenar `empresaProdutoraId` e `empresaProdutoraNome`, ligados às lojas reais do sistema.

A solicitação de produção é global em `pcp_solicitacoes_producao_global`, contendo loja de origem e empresa produtora de destino. A unidade produtora lê apenas solicitações direcionadas a ela e transforma a solicitação em uma OP oficial local em `producao_registros`.

A OP guarda vínculo com `pcpSolicitacaoId` e mantém o fluxo oficial da Produção.

## Produção → PCP

O Realizado devolve automaticamente o andamento da OP vinculada:
- programada
- em produção
- produzida
- finalizada

A finalização da solicitação de PCP é feita pela Produção após o apontamento concluído.

## Atualização física de estoque

A FASE 6 usa `producao_projecao` como saldo-base; não foi criado um segundo estoque paralelo.

Foi acrescentado o ledger imutável `producao_estoque_movimentos` para deduplicação e auditoria.

Regras:
- recebimento parcial de compra aplica somente o delta novo;
- repetição do mesmo evento não soma estoque novamente;
- produção finalizada por solicitação PCP cria uma única entrada;
- cada movimento tem `movimentoId` determinístico;
- ledger não pode ser alterado nem excluído pelo cliente.

## Fluxos validados

### Compra

Pedido → Estoque → PCP → Requisição → Comprador → Compra → Agendamento → Recebimento → Estoque atualizado → PCP recalculado.

### Produção

Pedido → Estoque → PCP → Solicitação de Produção → Empresa produtora → OP oficial → Realizado → Produzida/Finalizada → Estoque atualizado → PCP recalculado.

## Permissões e isolamento

As Firestore Rules foram ajustadas para:
- separar operações de Programação/Realizado;
- permitir roteamento PCP↔Compras sem edição operacional ampla;
- permitir apenas o comprador dono da requisição trabalhar sua operação;
- isolar OPs na loja produtora;
- permitir a solicitação global somente à loja de origem e à unidade produtora de destino;
- limitar retornos de status a campos específicos;
- tornar `producao_estoque_movimentos` imutável.

## Validação

- Produção específica: 44/44 testes aprovados.
- Fases PCP/Compras 2–6: 26/26 testes aprovados.
- Validação integrada Produção + PCP + Compras: 70/70 testes aprovados.
- `node --check` aprovado nos módulos `60–79`.
- `npm test`: 87 testes aprovados; somente `sanitizacao.test.js` não inicia por ausência da dependência `jsdom` no pacote recebido (`MODULE_NOT_FOUND`).
- Service Worker regenerado: `dt-inventario-20260811-6cd0f3f7ce0e`.

## Observação

Os dados de estoque, OP, realizado e projeção continuam com fonte única. PCP e Compras referenciam essas estruturas em vez de criar cópias concorrentes.
