# Refatoração Estado Único v202

## Causa confirmada
A aba Contagens exibia o motor consolidado, mas filtros e indicadores ainda utilizavam `contagem.status` e `contagem.divergente`. A aba Recontagem aplicava o consolidado somente em alguns estados e mantinha campos legados nos demais.

## Correção
- `InventoryAddressState.consolidate()` é a única regra de status por inventário/endereço.
- Contagem, Divergências e Recontagens sobrescrevem campos legados com o snapshot consolidado antes de filtrar/renderizar.
- Indicadores contam endereços consolidados, não documentos técnicos.
- Duas contagens iguais não resolvem o fluxo se o total continuar diferente do esperado.
- Somente o total do endereço igual ao esperado gera `RESOLVIDA`.
