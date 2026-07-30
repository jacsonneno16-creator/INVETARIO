# Alteração da aba Contagens — v205

## Coluna GTIN(s) bipado(s)

A tabela consolidada por endereço passa a exibir os códigos realmente lidos em cada rodada:

- 1ª contagem;
- 2ª contagem;
- 3ª contagem.

A extração respeita a seguinte prioridade de campos existentes nos registros: `gtin_bipado`, `codigoLido`, `codigo_lido`, `gtinLido`, `gtin_lido`, `dunLido`, `dun_lido`, `codigo_bipado`, `barcode_lido`, `gtin`, `ean` e `dun`. Valores repetidos na mesma rodada são exibidos uma única vez.

## Exportação CSV

O botão da aba Contagens agora exporta somente as linhas atualmente visíveis após os filtros. O arquivo usa:

- UTF-8 com BOM;
- separador ponto e vírgula, compatível com Excel em pt-BR;
- colunas separadas para GTIN bipado da 1ª, 2ª e 3ª contagens;
- as mesmas quantidades, produtos, operadores e status da tabela consolidada.
