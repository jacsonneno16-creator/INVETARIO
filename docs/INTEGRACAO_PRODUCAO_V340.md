# Integração Produção no Inventário — V340

Data: 2026-08-11

## Comparação realizada

O projeto `Meu-Sistema-Producao` foi confrontado com os módulos de Produção já existentes no Inventário (`60` a `75`). A integração atual já cobre ficha técnica, máquinas/turnos, programação, agenda, Gantt, insumos, projeção, programação automática, funcionários, relatórios, setup, Excel, mapa da fábrica, realizado, dashboard e estoque/Bluesoft.

## Ajustes implementados nesta revisão

1. **Snapshot de configuração da OP**
   - Novas OPs manuais e importadas por Excel passam a gravar `configSnapshot`.
   - O snapshot congela produto, unidade por caixa, categoria, máquina, velocidade e insumos da ficha técnica.
   - OPs legadas sem snapshot são migradas automaticamente quando um usuário com permissão de edição abre Programação.
   - OPs geradas pela Programação Automática também recebem snapshot.

2. **Realizado integrado à capacidade**
   - O apontamento passa a manter `realizadoCaixas` e `realizadoUnid` no documento da OP.
   - O motor de agenda desconta o realizado antes de reservar capacidade futura.
   - Isso impede Gantt/ocupação de continuar consumindo tempo para quantidade já produzida.

3. **Programação Automática com setup**
   - A seleção de máquina passa a carregar `producao_setup`.
   - O cálculo de escolha considera ocupação e penalidade de setup entre o último produto da máquina e o novo produto.

4. **PWA/cache**
   - URLs dos módulos alterados receberam versão `20260811-v340-integracao-producao`.
   - `sw.js` regenerado pelo build oficial do projeto.

## Validação

- `node --check` nos módulos alterados: OK.
- Testes específicos de Produção + rodada física: 21/21 aprovados.
- A suíte `npm test` completa também executou os novos testes, mas o teste antigo `sanitizacao.test.js` não inicia neste ZIP porque `jsdom` não está instalado em `public/node_modules`.

## Diferenças deliberadas que permanecem em relação ao sistema antigo

A arquitetura do Inventário não copia cegamente algumas implementações antigas baseadas em `localStorage` ou em um Firebase separado. O apontamento segue diário e sincronizado no Firestore (em vez da grade horária local por dispositivo); o estoque Bluesoft reutiliza a integração central do Inventário; e telas administrativas de usuários/lojas continuam usando os módulos nativos do Inventário. Essas diferenças preservam a arquitetura unificada e evitam duplicidade de autenticação/configuração.
