# Produção — Etapa 7 — Paridade visual com o sistema original

Data: 17/08/2026

## Objetivo

Reproduzir dentro do projeto integrado a identidade visual e a navegação do projeto `Meu-Sistema-Producao`, sem substituir Firebase, autenticação, permissões, seletor de lojas ou integrações do sistema maior.

## Alterações

- shell do setor Produção convertido de sidebar vertical para cabeçalho + abas horizontais no padrão do Produção original;
- identidade DT Produção no cabeçalho;
- loja ativa visível e botão de troca de loja usando o seletor oficial do projeto integrado;
- tema escuro/âmbar inspirado no original e tema claro isolado somente no módulo Produção;
- abas principais: Dashboard, Programação, Máquinas, Prog. Visual, Realizado, Insumos/Máq., Insumos Geral, Programação Automática e Relatórios;
- menu Mais para Produtos/Ficha Técnica, Projeção, Funcionários, Setup, Mapa, Configurações e Importação/API;
- IDs `nav-producao-*` preservados para compatibilidade com permissões e navegação existentes;
- acabamento visual de cards, tabelas, formulários, botões e Gantt aproximado ao CSS original;
- estilos totalmente escopados em `#setor-producao-shell`, evitando alteração visual de Inventário, Recebimento, PCP e Compras;
- cache-busting atualizado e service worker regenerado.

## Validação

Suíte automatizada completa após a Etapa 7: 342 testes aprovados, 0 falhas.

## Observação

A Etapa 7 altera somente a camada visual/navegação do módulo Produção. As integrações funcionais feitas nas etapas 1–6 (Firebase do projeto maior, multi-loja, permissões, máquinas, produtos/ficha técnica, setup, programação, Gantt, realizado, MRP etc.) permanecem preservadas.
