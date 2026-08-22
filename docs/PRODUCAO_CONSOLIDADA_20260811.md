# Produção consolidada — 2026-08-11

Base funcional: Inventário + Gantt Completo V1.
Referência de migração: Meu-Sistema-Producao original.

## Áreas expostas na Produção
Dashboard; Programação; Prog. Visual/Gantt; Produção Dia/Realizado; Programação Automática; Insumos/Máquina; Insumos Geral; Projeção de Vendas; Estoque/Bluesoft; Relatórios/Gerencial; Mapa da Fábrica; Cadastro de Máquinas; Turnos por Máquina; Tempos de Setup; Cadastro de Produtos; Ficha Técnica; Categorias; Funcionários; Processos; Jornada; Importação/API.

## Fonte única
Os submenus reutilizam os módulos e coleções `producao_*` do Inventário. Não foram criadas coleções paralelas apenas para reproduzir a navegação do sistema antigo.

## Correções desta consolidação
- navegação completa e hierárquica da Produção;
- acabamento visual isolado no shell de Produção;
- semana operacional do Realizado alinhada para segunda→domingo;
- conclusão automática da OP quando o realizado alcança a quantidade programada;
- atualização da Jornada usa o roteador atual do Inventário;
- catálogo de permissões do Realizado inclui finalizar, liberar e resetar;
- Gantt Completo V1 preservado;
- service worker regenerado.

## Validação
- `node --check` em todos os módulos `*producao*.js`;
- suíte `public/tests/producao-integracao.test.js`: 21/21 aprovada.
