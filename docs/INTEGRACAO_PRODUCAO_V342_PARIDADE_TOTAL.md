# Integração Produção V342 — Auditoria de paridade funcional

Data: 11/08/2026

## Objetivo

Auditar o projeto **Meu-Sistema-Producao** por completo e garantir que as funcionalidades operacionais do sistema de Produção tenham equivalente no novo Inventário, preservando a arquitetura Firebase, permissões e navegação do sistema novo.

A auditoria não considerou apenas a existência das abas. Foram confrontados fluxos, cálculos, ações, importações/exportações, persistência, filtros, navegação e integrações entre módulos.

## Matriz de paridade

| Área | Situação V342 | Principais funções preservadas/restauradas |
|---|---|---|
| Dashboard | Equivalente / ampliado | KPIs e visão consolidada da Produção integrada ao Inventário |
| Ficha Técnica / Produtos | Completo | CRUD, insumos, categoria/classificação, alergênico, cobertura meta, produção mínima, múltiplo, tipo mínimo, prioridade |
| Máquinas / Turnos | Completo | CRUD, produtos compatíveis, velocidades por produto, turnos, setup e capacidade |
| Programação | Completo | OP manual, importação, status, ordenação, hora de início, configuração congelada por snapshot |
| Agenda | Completo | Capacidade por turno, horaInicio, setup, absorção de setup em ociosidade e desconto do realizado |
| Gantt | Completo | Planejamento temporal, fila, reordenação, navegação por data e exportação |
| Insumos / MRP | Completo | Necessidade por máquina e geral, estoque, saldo, faltas, categorias, importação/exportação e navegação por data |
| Projeção | Completo | Média simples, ponderada e manual, estoque, vendas, CRUD, importação/exportação |
| Programação Automática | Completo | Multi-semana, máquinas compatíveis, capacidade, setup, velocidade, limite por máquina/produto, insumos, mínimo, múltiplo, cobertura, prioridade, simulação e auditoria |
| Funcionários | Completo | CRUD, máquinas/setor, ativo/inativo, ausência temporária/indefinida e retorno automático após a data |
| Realizado / Apontamento | Completo | Grade horária, observação, realizado agregado, bloqueio de sequência, liberação, limite de quantidade, concluir/reabrir, importação/exportação e navegação por data |
| Processos Produtivos | Completo | Tipo, data, produtos, máquina, início/fim, dia inteiro, duração por Jornada, equipe/função/tempo, observação, filtros, editar/finalizar/excluir |
| Relatórios | Completo / ampliado | Programado x Realizado, máquinas, produtos, OPs, alertas, gráficos, categorias, cobertura, funcionários/processos, insumos e visão gerencial |
| Setup | Completo | Matriz produto-produto, fallback de produtos compatíveis/cadastrados, CRUD, importação e exportação |
| Excel / Backup | Completo / ampliado | Backup e restauração de IDs e objetos profundos, máquinas/turnos/velocidades, fichas, OP snapshots, realizado, processos, categorias e configurações |
| Mapa da Fábrica | Equivalente / ampliado | Visualização de máquinas e situação produtiva |
| Estoque / Bluesoft | Equivalente | Consulta/integração de estoque utilizada pela Produção |
| Importação / API | Completo | Estoque PA, projeção, insumos, programação, API, mapeamento, teste/sincronização, histórico e limpeza controlada |
| Jornada da Fábrica | Completo | Horas por dia, persistência, aplicação em capacidade/processos e restauração padrão com confirmação |
| Categorias | Completo | CRUD, ordem, status e busca |
| Permissões | Preservado / adaptado | Visualização, edição, importação, exportação, execução e configuração conforme módulo |
| PWA / Cache | Atualizado | Todos os módulos 60–77 versionados em V342 e service worker regenerado |

## Correções de paridade relevantes

1. O realizado agora reduz a carga restante da OP no motor de Agenda/Gantt.
2. OPs guardam `configSnapshot`, evitando que alterações posteriores de máquina/ficha mudem o histórico.
3. Programação Automática recuperou planejamento multi-semana, capacidade, setup, insumos e regras avançadas de produto.
4. Realizado recuperou apontamento por hora e controles de sequência/liberação.
5. Processos com "dia inteiro" usam a Jornada configurada, não 24 horas.
6. Relatórios voltaram a cruzar Programado x Realizado e recuperaram dimensões gerenciais do sistema original.
7. Ficha Técnica voltou a fornecer os parâmetros usados pela Programação Automática: mínimo, múltiplo, cobertura e prioridade.
8. Setup voltou a oferecer produtos mesmo quando a máquina ainda não tem lista explícita de compatibilidade.
9. Funcionários respeitam status ativo/inativo e expiração de ausência temporária.
10. Importação/API recuperou histórico e rotinas de limpeza controlada.
11. Backup passou a preservar estruturas aninhadas, IDs e snapshots, evitando restauração parcial.
12. Gantt, Insumos e Realizado voltaram a permitir navegação direta por data.
13. Categorias recuperaram pesquisa e Jornada ganhou confirmação antes de resetar.

## Validação

- Testes específicos de integração de Produção: **21/21 aprovados**.
- Suíte executável sem a dependência ausente: **38 testes aprovados**.
- O único teste que não inicia é `sanitizacao.test.js`, pois `jsdom` está declarado no projeto, mas não está instalado no pacote recebido (`MODULE_NOT_FOUND`). Isso não é uma falha encontrada nos módulos de Produção.
- `node --check` executado nos módulos de Produção `60` a `77`, navegação e permissões, sem erro de sintaxe.
- `npm run build:sw` executado após o versionamento final dos scripts.

## Observação de arquitetura

A implementação não copia literalmente o código monolítico do projeto antigo. A funcionalidade foi portada para a arquitetura modular do Inventário e para seu contexto Firebase. Assim, alguns fluxos mudaram de posição ou foram consolidados, mas a auditoria V342 não identificou função operacional do escopo de Produção auditado que permaneça deliberadamente removida.
