# Auditoria completa — Contagem e Recontagem v203

## Princípio aplicado
As duas abas passaram a consumir o mesmo objeto consolidado produzido por `InventoryAddressState.list(state())`. Nenhuma coluna operacional calcula status ou total por conta própria.

## Correções de integridade
1. Linhas iguais da base sem ID explícito não são mais deduplicadas. Elas podem representar pallets distintos.
2. Duplicatas com o mesmo ID explícito continuam sendo removidas.
3. Endereço sem quantidade esperada agora recebe `SEM_BASE`; quantidade zero não é presumida.
4. A primeira, segunda e terceira rodadas são somadas por inventário + endereço, com detalhamento por produto.
5. Totais de recontagem vindos de leituras reais têm prioridade sobre documentos auxiliares.
6. A aba Contagem deixou de repetir o último total consolidado em cada linha de pallet.
7. Contagem, Recontagem e exportações usam a mesma lista consolidada.

## Aba Contagem — origem das colunas
| Coluna | Origem única |
|---|---|
| Última atualização | maior timestamp entre contagens, divergências e recontagens do endereço |
| Operador(es) | operadores da última rodada consolidada |
| Inventário | inventário canônico resolvido por ID/código/nome |
| Endereço | endereço normalizado do estado consolidado |
| Produtos esperados | base oficial agrupada por produto, preservando linhas/pallets legítimos |
| Totais das rodadas | total esperado e totais consolidados da 1ª, 2ª e 3ª contagens |
| Última etapa | número da última rodada existente |
| Status consolidado | resultado único do motor central |
| Ações | registro operacional de origem do mesmo endereço |

## Aba Recontagem — origem das colunas
| Coluna | Origem única |
|---|---|
| Inventário/Rua/Endereço | mesmo estado consolidado usado na aba Contagem |
| Produtos esperados | mesma composição da base oficial |
| Qtd Sistema | soma da composição esperada do endereço |
| Contagens 1/2/3 | totais e itens de cada rodada do mesmo snapshot |
| Atribuído para | divergência/recontagem vinculada ao endereço |
| Executado por | operadores efetivos das rodadas 2 e 3 |
| Status consolidado | exatamente o mesmo status exibido na aba Contagem |
| Ações | apenas tarefas pendentes do endereço; resolvidos não permitem novo registro |

## Regras de status
- `RESOLVIDA`: alguma rodada totalizou exatamente o esperado do endereço.
- `DIVERGENTE`: 1ª rodada diferente do esperado e ainda sem 2ª rodada.
- `EM_RECONTAGEM`: 2ª rodada registrada, ainda diferente do esperado.
- `PERSISTENTE`: 3ª rodada registrada e ainda diferente do esperado.
- `SEM_BASE`: não há total esperado confiável; resolução automática bloqueada.
- `PENDENTE`: base existente, mas nenhuma contagem válida.

## Testes executados
- múltiplos produtos no mesmo endereço;
- múltiplos pallets totalizando 1.150;
- segunda rodada resolvendo o endereço;
- pallets idênticos sem ID preservados;
- duplicatas com mesmo ID removidas;
- endereço sem base não tratado como zero;
- igualdade entre `list()` e `decorate()`;
- sintaxe de todos os JavaScripts;
- referências locais do HTML verificadas.
