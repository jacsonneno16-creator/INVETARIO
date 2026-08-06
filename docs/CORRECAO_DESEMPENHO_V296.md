# v296

- Ações de produtos e endereços vinculadas diretamente após cada renderização.
- Salvamento fecha o modal após persistir o registro principal; republicação de chunks ocorre em segundo plano.
- Cache de auditorias por 60 segundos para evitar quatro leituras por auditoria em cada atualização.
- Descoberta de auditorias por loja executada em paralelo.
- Renderização reativa reduzida a páginas afetadas e debounce de 60 ms.
