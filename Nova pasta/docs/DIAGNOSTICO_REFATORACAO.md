# Diagnóstico e Refatoração — Contagem e Recontagem

## Diagnóstico

### Problemas encontrados

1. A decisão do estado do endereço estava distribuída entre `21-divergencias-recontagens.js`, `31-render-contagens-pendencias.js`, `32-render-divergencias-recontagens.js` e `43-importar-exportar-api.js`.
2. A tela de Contagem possuía fallback próprio para recalcular a primeira rodada quando não encontrava uma divergência.
3. A tela de Recontagem montava outro resumo do endereço e reinterpretava os estados para apresentação.
4. A Exportação reconstruía novamente o histórico, selecionava recontagens e decidia o resultado final por um caminho próprio.
5. Status persistidos (`status`, `status_recontagem`, `divergente`, `precisa_recontagem`) eram usados junto com cálculos derivados, permitindo conflito entre dado legado e resultado atual.
6. A lógica operacional principal estava dentro de um arquivo com aproximadamente 1.900 linhas, misturada com persistência, atribuição, recuperação de legado, modais e renderização.
7. Existiam duas granularidades concorrentes: produto/palete e endereço. O fechamento do fluxo precisava ocorrer por endereço, mas partes antigas ainda tentavam decidir por produto.
8. Havia arquivos versionados/duplicados no projeto (`10-inventarios-negocio.js` e `10-inventarios-negocio-v6.js`, múltiplas versões de coletores e service workers), elevando o risco de manutenção e carregamento acidental de implementação obsoleta.

### Riscos anteriores

- Contagem exibir “OK 1ª” enquanto Recontagem mantinha divergência aberta.
- Uma recontagem consolidada por vários pallets ser comparada contra apenas uma linha da base.
- Exportação produzir um resultado diferente do exibido nas telas.
- Registros legados influenciarem a decisão atual mesmo quando os totais físicos já confirmavam o endereço.
- Alterações futuras corrigirem uma tela e quebrarem outra por duplicação de regras.

## Arquitetura aplicada

Foi criado `js/shared/address-state-engine.js`, responsável por:

- identificar unicamente o fluxo por `inventário + endereço`;
- deduplicar linhas técnicas da base e leituras;
- consolidar todos os pallets esperados do endereço;
- consolidar todas as leituras da primeira, segunda e terceira rodadas;
- comparar somente o total consolidado do endereço;
- produzir um único objeto imutável de estado;
- fornecer a mesma avaliação para Contagem, Recontagem, Dashboard, Relatórios, Indicadores e Exportações.

### Objeto consolidado

O motor retorna, entre outros:

- `chave`
- `inventario_id`
- `endereco`
- `esperado`
- `primeira`
- `segunda`
- `terceira`
- `status`
- `status_recontagem`
- `divergente`
- `precisa_recontagem`
- `avaliacao`
- `itens_esperados`
- `contagens`
- `divergencias`
- `recontagens`

## Regras consolidadas

1. Primeira rodada igual ao esperado: `RESOLVIDA`.
2. Segunda rodada igual ao esperado: `RESOLVIDA`.
3. Segunda rodada igual à primeira: `RESOLVIDA` por consenso.
4. Terceira rodada igual ao esperado ou a qualquer rodada anterior: `RESOLVIDA`.
5. Três resultados diferentes: `PERSISTENTE`.
6. Enquanto não houver confirmação: estado derivado único de divergência/recontagem.
7. Pallets e produtos distintos encontrados no endereço são somados antes da comparação.

## Alterações realizadas

- Inclusão do motor central antes dos módulos do Analista.
- `21-divergencias-recontagens.js` passou a delegar avaliação, snapshot esperado e histórico consolidado ao motor central.
- `31-render-contagens-pendencias.js` teve removida a regra própria de decisão e agora consome diretamente o estado consolidado.
- Recontagem e Exportação continuam usando a fachada pública existente, mas essa fachada agora delega ao mesmo motor, preservando os pontos de integração sem preservar a regra duplicada.
- O resultado não depende mais de uma interpretação diferente por tela.

## Validação executada

Foram automatizados e aprovados os cenários:

- primeira contagem totalizando exatamente o esperado;
- primeira divergente e segunda rodada composta por dois pallets (150 + 1000 = 1150);
- segunda rodada confirmando a primeira por consenso;
- terceira rodada sem qualquer consenso, resultando em persistência;
- verificação de sintaxe dos arquivos JavaScript alterados.

## Recomendações para a próxima etapa

1. Migrar gradualmente os campos persistidos de status para uma projeção derivada do estado consolidado.
2. Separar `21-divergencias-recontagens.js` em comandos de domínio, persistência e compatibilidade de dados legados.
3. Remover versões antigas não carregadas após confirmar que não existem links externos ou service workers apontando para elas.
4. Criar testes de integração com snapshots reais do Firestore antes de excluir definitivamente os caminhos de recuperação legada.
