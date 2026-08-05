# v275 - Classificações e acompanhamento por produto

- Importação aceita: `tipo_endereco`, `contabiliza_inventario`, `permite_multiplos_operadores`, `tipo_produto` e `total_unidades_sistema`.
- Endereços virtuais permanecem na base para validação, mas ficam fora do total/progresso quando `contabiliza_inventario = NÃO`.
- Endereços virtuais ou com `permite_multiplos_operadores = SIM` aceitam contagens simultâneas sem bloqueio por outro operador.
- Novo inventário permite selecionar múltiplos tipos de produto.
- Acompanhamento ganhou as abas Por Endereço e Por Produto.
- A visão por produto consolida sistema, contado e diferença em unidades, incluindo produtos não previstos.
- Contagens do coletor gravam `quantidade_unidades` e `unidade_contagem`.
