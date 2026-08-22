# Produção — FASE 1 V344 Final

Data: 11/08/2026

## Escopo

Finalização da Produção antes de qualquer implementação de PCP ou Compras, seguindo o comportamento operacional do Sistema de Produção original e preservando a arquitetura modular/Firebase do Inventário.

## Fonte única de dados

- `producao_produtos`: cadastro produtivo.
- `producao_ficha_tecnica`: BOM/insumos.
- `producao_maquinas`: máquinas, compatibilidade, turnos e velocidades.
- `producao_registros`: OPs/programação.
- `producao_apontamentos`: realizado.
- `producao_setup`: setup produto-produto/máquina.
- `producao_projecao`: estoque/vendas/projeção.
- `producao_insumos_estoque`: estoque de insumos/MRP.
- `producao_processos`: processos produtivos.
- `producao_config`: jornada, parâmetros compartilhados, API e operadores do Produção Dia.
- `producao_auditoria`: auditoria operacional imutável.
- `producao_import_historico`: histórico de importações/API.

## Paridade funcional consolidada

### Ficha Técnica / Produtos

CRUD, status ativo/inativo, BOM, categorias, alergênicos, meta de cobertura, mínimo, múltiplo, tipo de mínimo, prioridade e edição de múltiplas máquinas/velocidades sincronizada diretamente em `producao_maquinas.produtosCompativeis`.

### Máquinas / Turnos

CRUD, código, tipo, setor, classificação, eficiência, velocidade padrão, velocidade específica por produto, turnos, capacidade e atalhos. A resolução de velocidade é única: produto x máquina -> velocidade padrão da máquina -> velocidade do produto.

### Programação

OP manual, filtros, observação, hora inicial, compatibilidade produto x máquina, snapshot histórico, importação Excel, criação/edição/exclusão com permissões separadas.

### Agenda / Gantt

Semana operacional segunda-domingo, turnos reais, hora de início, setup, absorção de setup em ociosidade, desconto do realizado, drag/reordenação, quantidade por dia e Excel baseado na distribuição calculada pelo próprio motor.

### Projeção / Programação Automática

1-3 meses, média simples/ponderada, fator, override manual semanal, estoque normalizado unidades->caixas e parâmetros compartilhados no Firestore. O automático usa look-ahead, OPs já programadas/realizadas, eficiência da máquina, capacidade, setup, mínimo, múltiplo, cobertura, prioridade, insumos, concentração em uma máquina e split em até duas quando necessário.

### Insumos / MRP

Consumo com o mesmo calendário/setup da Agenda/Gantt, estoque de insumos, saldo/faltas, visão por máquina/geral, importação/exportação e uso prioritário do `configSnapshot.insumos` para preservar histórico.

### Realizado / Produção Dia

Grade semanal e Produção Dia, apontamento por hora, observações, sequência por máquina/semana, liberação temporária com motivo/expiração/auditoria, validações de data/quantidade, conclusão automática, concluir/reabrir, reset por dia, operadores por máquina/dia, drag entre dias atualizando a própria OP, alertas de atraso/parada/excesso e processos produtivos.

### Relatórios / Gerencial

Programado x Realizado, capacidade real, setup, ociosidade, eficiência, produtos, máquinas, categorias, cobertura, funcionários/processos, insumos, alertas, busca/ordenação, gráficos, tabela, Pivot e exportações.

### Importação / API / Backup

Backup/restauração profunda, IDs, turnos, velocidades, snapshots, apontamentos, processos, categorias/configurações; estoque PA, projeção, insumos, programação, API, histórico e limpeza controlada. A permissão `producao-importacao:importar` pode executar restauração/importação sem conceder edição manual das telas correspondentes.

## Permissões e Firestore Rules

- OP: criação, importação/automático, edição/Gantt, finalizar, liberar, resetar e excluir separados.
- Alterações do Realizado na OP são limitadas por `affectedKeys()` aos campos operacionais autorizados.
- Auditoria da Produção é append-only.
- Importação/API possui regras para histórico, Projeção, Insumos e configuração.
- Realizado separa editar/finalizar/liberar/resetar/importar/exportar também no frontend.
- Programação separa criar/editar/excluir/importar também no frontend.

## Validação

- Testes específicos de Produção: **44/44 aprovados**.
- Fluxo executável Projeção -> Automático -> OP: aprovado.
- Fluxo executável Realizado -> OP -> liberação -> reset -> status: aprovado.
- Sintaxe dos módulos `60` a `77`: aprovada via `node --check`.
- `npm test` em `public`: **61 testes aprovados** e 1 teste não inicia por `MODULE_NOT_FOUND: jsdom` (`sanitizacao.test.js`). `jsdom` está declarado em `public/package.json`, mas não está instalado no pacote recebido.
- Suíte legada `tests/*.js`: resultado atual 9 pass / 15 fail; o Inventário base recebido apresenta exatamente os mesmos 9 pass / 15 fail, portanto não é regressão da Produção.
- Service Worker regenerado: `dt-inventario-20260811-c973212548da`.
- Nenhum módulo PCP ou Compras foi criado nesta fase.

## Status

**FASE 1 — PRODUÇÃO: concluída para validação funcional.**

PCP e Compras continuam não iniciados. A próxima fase só deve começar após aceite desta base de Produção.
