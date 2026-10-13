# Diagnóstico e correção de desempenho — Etapa 31

Data da análise: 13/09/2026

## Evidência do travamento

O HAR `daterrinha-inventario.web.1app(1).har` contém 87 requisições e registra **402,76 MB transferidos**. O navegador informa **6,28 GB de conteúdo de resposta descompactado/processado** ao somar as entradas do HAR. O maior problema são consultas Firestore no canal `Listen`: 18 respostas principais transferem entre 17,76 MB e 19,74 MB cada, representam aproximadamente 278 MB a 308 MB de conteúdo cada e levam entre 28 e 91 segundos. Há ainda vários canais de cerca de 4,5 MB/71 MB.

As consultas repetem lotes de chaves de notas contra `lojas/{loja}/recebimento_recusas_notas`. Os documentos carregados contêm dados muito maiores que os poucos campos exibidos pelo Pátio e pelos Indicadores. Várias telas de Recebimento também eram executadas no login, ampliando o número de consultas concorrentes.

## Correções aplicadas

1. **Enriquecimento de notas no servidor:** `buscarPatioTempoRealBigQuery` e `buscarIndicadoresRetornosBigQuery` retornam `notasResumo`, com projeção apenas dos campos exibidos. O navegador não consulta mais lotes de documentos completos de `recebimento_recusas_notas`.
2. **Cache do Pátio compacto:** o job agendado monta o cache com os mesmos campos projetados, sem ler os documentos completos um por um.
3. **Recebimento sob demanda:** os scripts 91–105 deixaram o boot principal. Eles só são baixados e executados quando o usuário abre Recebimento. A carga é sequencial, deduplicada e feita uma única vez por sessão.
4. **Produtos sob demanda:** a coleção de produtos não é mais carregada no login; a leitura ocorre ao abrir Produtos.
5. **Sem fallback integral:** falhas nas consultas BigQuery das telas operacionais e relatórios não iniciam uma varredura completa das coleções Firestore. A tela mostra falha recuperável e preserva dados já carregados.
6. **Limite de espera no Pátio:** chamadas de rede encerram em 15 segundos com mensagem e opção de tentar novamente, em vez de permanecerem indefinidamente em “Carregando”.
7. **Ledger de notas:** Notas Retornadas não abre mais o ledger completo em segundo plano. A leitura integral ficou restrita às operações administrativas explícitas de importação/reconstrução.
8. **SharePoint:** leituras manuais ganharam cache de 15 minutos e deduplicação de chamadas simultâneas. Sincronizações automáticas concorrentes no navegador foram removidas; o servidor agendado mantém as bases materializadas.
9. **BlueSoft fora do Inventário:** chamadas automáticas foram removidas de Recebimento, Produção, Estoque, PCP e Lojas. A busca de pedido do PCP usa `recebimento_agendamentos`, já sincronizado pelo BI. O estoque usa `pcp_estoque_bluesoft` com origem `bi`. A integração BlueSoft permanece disponível apenas no fluxo de Inventário/API.

## Destino dos arquivos de BI

| Arquivo | Registros/tamanho enviado | Destino de leitura profissional |
|---|---:|---|
| `compras_a_receber.json` | 655 / 382 KB | Agenda materializada em Firestore (`recebimento_agendamentos`) |
| `compras_produto.json` | 96.654 / 85,6 MB | BigQuery (`compras_historico`) e classificação agregada |
| `consumo_insumos.json` | 52.843 / 10,0 MB | Relatório detalhado manual, sem abertura automática |
| `dados_cortes.json` | 53.916 / 13,4 MB | Resumo mensal materializado (`bi_cortes_mensal`) |
| `dados-consumo-insumos.json` | resumo / 1,5 MB | Resumo materializado (`bi_consumo_insumos_resumo`) |
| `dados-escadinha.json` | estrutura anual / 356 KB | Consulta manual em Produção/PCP, com cache local |
| `dados-escadinha-insumos.json` | estrutura anual / 1,4 MB | Sem gatilho automático no Analista atual |
| `dados-estoque.json` | 81 produtos / 74 KB | Consulta manual de relatório, com cache local |
| `dados-insumos.json` | 472 produtos / 502 KB | Estoque materializado por loja e consulta manual com cache |
| `dados-mrp-terceiros.json` | resumo / 353 KB | Consulta manual de relatório, com cache local |
| `ficha_tecnica.json` | 6.005 / 3,0 MB | Materializado em `producao_ficha_tecnica` |
| `fornecedores_agregado.json` | agregado / 8,4 MB | Materializado em `bi_fornecedores_agregado` |
| `notas_fiscais_jacson.json` | 31.700 / 18,2 MB | Materializado para retornos/projeções; telas usam BigQuery + resumo |
| `produtos_estoque.json` | 712 / 148 KB | Materializado em `pcp_estoque_bluesoft` com `origem: bi` |
| `valor_insumos.json` | 7.690 / 2,0 MB | Consulta manual de relatório, com cache local |

Os arquivos grandes de uso operacional ficam no BigQuery ou viram coleções resumidas. Arquivos pequenos usados apenas sob comando permanecem sob demanda e não participam do login nem do carregamento do Pátio.

## Ordem obrigatória de publicação

O front novo espera `notasResumo` nas funções. Portanto publique nesta ordem:

```bash
cd functions
npm ci
cd ..
npx firebase-tools deploy --only functions:buscarIndicadoresRetornosBigQuery,functions:buscarPatioTempoRealBigQuery,functions:atualizarCachePatioTempoRealAgendado,functions:atualizarCachePatioTempoRealAgora
npx firebase-tools deploy --only hosting
```

Depois da publicação, abra o site em uma nova aba e faça uma atualização forçada (`Ctrl+Shift+R`). O HAR esperado ao abrir Pátio deve mostrar uma leitura do documento `recebimento_patio_cache/atual` ou uma chamada `buscarPatioTempoRealBigQuery`, e **zero consultas em lotes ao `recebimento_recusas_notas` feitas pelo navegador**.

## Validação executada

- 100 testes das Cloud Functions: aprovados.
- 3 testes específicos da Etapa 31: aprovados.
- Verificação de sintaxe dos arquivos JavaScript alterados: aprovada.
- O conjunto antigo de testes de interface ainda contém expectativas do comportamento removido (fallback integral e BlueSoft fora do Inventário); essas falhas não representam o fluxo novo.
