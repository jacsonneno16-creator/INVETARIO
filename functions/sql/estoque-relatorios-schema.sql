-- ============================================================================
-- Logística › Estoque › Relatórios — schema do BigQuery
-- Dataset: dt_relatorios · Projeto: daterrinha-inventario
--
-- PEDIDO AO VIVO (2026-10-02). Migração MANUAL — rodar uma vez no console do
-- BigQuery (ou via `bq query`). Nenhuma Cloud Function aplica este arquivo
-- automaticamente, de propósito: mudança de schema em produção merece
-- revisão humana antes de aplicar.
--
-- Ordem de execução: de cima pra baixo (as views dependem das tabelas e da
-- tabela de classificação já existirem). Todo CREATE é idempotente
-- (IF NOT EXISTS / CREATE OR REPLACE), então rodar o arquivo inteiro de novo
-- não quebra nada — só a view de classificação pode precisar de um
-- `DELETE`+`INSERT` manual se um código novo for confirmado depois (ver
-- comentário em estoque_classificacao mais abaixo).
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS `daterrinha-inventario.dt_relatorios`
  OPTIONS (location = 'southamerica-east1');

-- ----------------------------------------------------------------------------
-- 1) estoque_movimentos — movimentos crus do analítico, TODOS os tipos (a
--    classificação por relatório vive nas views, nunca aqui — um código
--    novo/mudado se resolve trocando a view, sem recarregar nada).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daterrinha-inventario.dt_relatorios.estoque_movimentos` (
  movimento_estoque_key   STRING    NOT NULL,
  loja_key                STRING    NOT NULL,
  produto_key             STRING,
  data_movimento          DATE      NOT NULL,
  data_lancamento         DATETIME,
  quantidade              NUMERIC,            -- sempre positiva (vem assim da Bluesoft); sentido = saldo_posterior - saldo_anterior
  valor                   NUMERIC,
  custo_estoque           NUMERIC,
  custo_estoque_com_icm   NUMERIC,
  custo_contabil          NUMERIC,
  saldo_anterior          NUMERIC,
  saldo_posterior         NUMERIC,
  tipo_movimento_key      INT64     NOT NULL,
  tipo_movimento          STRING,
  tipo_origem_key         INT64,
  tipo_origem             STRING,
  origem_key              STRING,             -- inventario_key OU nf_key, dependendo de tipo_origem_key (ver estoque_classificacao.ligacao)
  fornecedor_key          STRING,
  produto_origem          STRING,             -- transformação: produto_key da saída que gerou esta entrada
  produto_origem_qtd      NUMERIC,
  movimento_estorno_key   STRING,             -- preenchido quando este movimento É um estorno de outro
  coletado_em             TIMESTAMP NOT NULL
)
PARTITION BY data_movimento
CLUSTER BY loja_key, tipo_movimento_key, produto_key
OPTIONS (
  description = 'Movimentos de estoque crus da Bluesoft (GET /api/estoques/movimentacoesdeestoque/analitico), todos os tipos, sem filtro. Carga incremental via MERGE por movimento_estoque_key.'
);

-- ----------------------------------------------------------------------------
-- 2) estoque_tipos_movimento — catálogo (526 tipos na Bluesoft)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daterrinha-inventario.dt_relatorios.estoque_tipos_movimento` (
  tipo_movimento_key INT64  NOT NULL,
  descricao          STRING,
  coletado_em        TIMESTAMP NOT NULL
)
OPTIONS (description = 'Catálogo de tipos de movimento (GET /api/estoques/movimentacoesdeestoque/tipos) — dimensão, recarregada inteira a cada sync (WRITE_TRUNCATE).');

-- ----------------------------------------------------------------------------
-- 3) estoque_inventarios — cabeçalho de cada inventário (GET /api/estoques/inventarios)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daterrinha-inventario.dt_relatorios.estoque_inventarios` (
  inventario_key   STRING    NOT NULL,
  loja_key         STRING    NOT NULL,
  numero           STRING,
  descricao        STRING,
  tipo             STRING,            -- "Estoque" ou "Troca", conforme a Bluesoft devolve
  status           STRING,
  data_abertura    DATETIME,
  data_fechamento  DATETIME,
  coletado_em      TIMESTAMP NOT NULL
)
OPTIONS (description = 'Cabeçalho de inventários (GET /api/estoques/inventarios?lojaKey&status=TODOS).');

-- ----------------------------------------------------------------------------
-- 4) estoque_inventario_itens — resultado por produto (só inventários FECHADOS)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daterrinha-inventario.dt_relatorios.estoque_inventario_itens` (
  inventario_key      STRING  NOT NULL,
  produto_key         STRING  NOT NULL,
  loja_key            STRING  NOT NULL,
  quantidade_contada  NUMERIC,
  quantidade_sistema  NUMERIC,
  custo_bruto         NUMERIC,
  custo_liquido       NUMERIC,
  custo_contabil      NUMERIC,
  coletado_em         TIMESTAMP NOT NULL
)
CLUSTER BY loja_key
OPTIONS (description = 'Itens por produto de cada inventário fechado (GET /api/estoques/inventarios/{key}/produtos). Carga incremental: só inventários novos ou ainda sem itens gravados.');

-- ----------------------------------------------------------------------------
-- 5) estoque_notas_baixa — notas de saída CFOP 5927 (Descarte/Requisição) ou
--    5949 (ainda sem classificação confirmada — ver nota no fim do arquivo)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daterrinha-inventario.dt_relatorios.estoque_notas_baixa` (
  nf_key         STRING  NOT NULL,
  loja_key       STRING  NOT NULL,
  nf_numero      STRING,
  nf_serie       STRING,
  cfop           STRING  NOT NULL,     -- '5927' ou '5949'
  tipo_nota_key  INT64,
  tipo_nota      STRING,
  data_emissao   DATE,
  coletado_em    TIMESTAMP NOT NULL
)
PARTITION BY data_emissao
OPTIONS (description = 'Notas de saída com CFOP 5927/5949 (GET /api/estoques/notas-fiscais?tipoNota=SAIDA, filtradas por CFOP no cliente — tipoNotaKey dá 400 na Bluesoft).');

-- ----------------------------------------------------------------------------
-- 6) estoque_produtos — dimensão (só produtos que aparecem em algum movimento
--    e ainda não têm descrição gravada)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daterrinha-inventario.dt_relatorios.estoque_produtos` (
  produto_key        STRING  NOT NULL,
  descricao          STRING,
  fator_transformacao_cadastrado NUMERIC,  -- GET /api/comercial/produtos/transformacao?produtoKey= (opcional, só pra comparar com o fator real da view de transformação)
  coletado_em        TIMESTAMP NOT NULL
)
OPTIONS (description = 'Dimensão de produtos (GET /api/comercial/produtos/{key}) — só os que faltam, nunca recarrega os que já existem.');

-- ----------------------------------------------------------------------------
-- 7) estoque_classificacao — ÚNICO lugar com os códigos de tipo_movimento_key.
--    As views leem DAQUI; nenhum código fica espalhado/hardcoded nas views.
--    Confirmados com dados reais de homologação (ver plano) — NÃO INVENTAR
--    código novo aqui sem confirmação.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `daterrinha-inventario.dt_relatorios.estoque_classificacao` (
  tipo_movimento_key INT64   NOT NULL,
  operacao           STRING  NOT NULL,  -- 'INVENTARIO' | 'DESCARTE' | 'REQUISICAO' | 'TRANSFORMACAO'
  eh_estorno         BOOL    NOT NULL
);

-- Idempotente: apaga e regrava a carga inteira (tabela pequena, só ~50 linhas)
-- em vez de MERGE — mais simples de auditar/corrigir manualmente depois.
DELETE FROM `daterrinha-inventario.dt_relatorios.estoque_classificacao` WHERE TRUE;

INSERT INTO `daterrinha-inventario.dt_relatorios.estoque_classificacao` (tipo_movimento_key, operacao, eh_estorno)
VALUES
  -- INVENTARIO — lançamentos (801 Perda, 802 Ganho, 806 Sem Divergência,
  -- 930/931 Contábil, troca: 821/823/803/804/932/933/825/828)
  (801, 'INVENTARIO', FALSE), (802, 'INVENTARIO', FALSE), (806, 'INVENTARIO', FALSE),
  (930, 'INVENTARIO', FALSE), (931, 'INVENTARIO', FALSE),
  (821, 'INVENTARIO', FALSE), (823, 'INVENTARIO', FALSE), (803, 'INVENTARIO', FALSE), (804, 'INVENTARIO', FALSE),
  (932, 'INVENTARIO', FALSE), (933, 'INVENTARIO', FALSE), (825, 'INVENTARIO', FALSE), (828, 'INVENTARIO', FALSE),
  -- INVENTARIO — estornos
  (811, 'INVENTARIO', TRUE), (812, 'INVENTARIO', TRUE), (805, 'INVENTARIO', TRUE),
  (934, 'INVENTARIO', TRUE), (935, 'INVENTARIO', TRUE),
  (822, 'INVENTARIO', TRUE), (824, 'INVENTARIO', TRUE), (809, 'INVENTARIO', TRUE), (810, 'INVENTARIO', TRUE),
  (936, 'INVENTARIO', TRUE), (937, 'INVENTARIO', TRUE), (826, 'INVENTARIO', TRUE), (827, 'INVENTARIO', TRUE),

  -- DESCARTE — lançamentos (410 Troca Descarte/Perda, 942 Descarte de Troca de Produto)
  (410, 'DESCARTE', FALSE), (942, 'DESCARTE', FALSE),
  -- DESCARTE — estornos
  (430, 'DESCARTE', TRUE), (947, 'DESCARTE', TRUE),

  -- REQUISICAO — lançamento (352 Transferência Interna Saída - Consumo)
  (352, 'REQUISICAO', FALSE),
  -- REQUISICAO — estorno
  (362, 'REQUISICAO', TRUE),

  -- TRANSFORMACAO — lançamentos (354 Saída, 304 Entrada, kit 359/389, troca 356/860)
  (354, 'TRANSFORMACAO', FALSE), (304, 'TRANSFORMACAO', FALSE),
  (359, 'TRANSFORMACAO', FALSE), (389, 'TRANSFORMACAO', FALSE),
  (356, 'TRANSFORMACAO', FALSE), (860, 'TRANSFORMACAO', FALSE),
  -- TRANSFORMACAO — estornos
  (364, 'TRANSFORMACAO', TRUE), (314, 'TRANSFORMACAO', TRUE),
  (358, 'TRANSFORMACAO', TRUE), (388, 'TRANSFORMACAO', TRUE),
  (357, 'TRANSFORMACAO', TRUE), (861, 'TRANSFORMACAO', TRUE);

-- ============================================================================
-- VIEWS — o que cada tela de relatório lê. Nenhuma inventa classificação:
-- um tipo_movimento_key que não está em estoque_classificacao simplesmente
-- não aparece em NENHUMA view (fica só em estoque_movimentos, cru).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- vw_estoque_rel_inventario — movimento + cabeçalho do inventário + item
-- (contado/sistema/diferença/custo). Ligação: tipo_origem_key = 9 e
-- origem_key = inventario_key.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `daterrinha-inventario.dt_relatorios.vw_estoque_rel_inventario` AS
SELECT
  m.movimento_estoque_key,
  m.loja_key,
  m.produto_key,
  p.descricao AS produto_descricao,
  m.data_movimento,
  m.data_lancamento,
  m.tipo_movimento_key,
  m.tipo_movimento,
  c.eh_estorno,
  m.quantidade,
  m.valor,
  m.saldo_anterior,
  m.saldo_posterior,
  i.inventario_key,
  i.numero          AS inventario_numero,
  i.descricao       AS inventario_descricao,
  i.tipo            AS inventario_tipo,
  i.data_abertura   AS inventario_data_abertura,
  i.data_fechamento AS inventario_data_fechamento,
  it.quantidade_contada,
  it.quantidade_sistema,
  it.custo_bruto,
  it.custo_liquido,
  it.custo_contabil
FROM `daterrinha-inventario.dt_relatorios.estoque_movimentos` m
JOIN `daterrinha-inventario.dt_relatorios.estoque_classificacao` c
  ON c.tipo_movimento_key = m.tipo_movimento_key AND c.operacao = 'INVENTARIO'
LEFT JOIN `daterrinha-inventario.dt_relatorios.estoque_produtos` p
  ON p.produto_key = m.produto_key
LEFT JOIN `daterrinha-inventario.dt_relatorios.estoque_inventarios` i
  ON i.inventario_key = m.origem_key AND i.loja_key = m.loja_key
LEFT JOIN `daterrinha-inventario.dt_relatorios.estoque_inventario_itens` it
  ON it.inventario_key = m.origem_key AND it.produto_key = m.produto_key AND it.loja_key = m.loja_key
WHERE m.tipo_origem_key = 9;

-- ----------------------------------------------------------------------------
-- vw_estoque_rel_descarte — movimento + nota (número/série/CFOP) + fornecedor
-- + produto. Ligação: tipo_origem_key = 1 e origem_key = nf_key (CFOP 5927).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `daterrinha-inventario.dt_relatorios.vw_estoque_rel_descarte` AS
SELECT
  m.movimento_estoque_key,
  m.loja_key,
  m.produto_key,
  p.descricao AS produto_descricao,
  m.data_movimento,
  m.data_lancamento,
  m.tipo_movimento_key,
  m.tipo_movimento,
  c.eh_estorno,
  m.quantidade,
  m.valor,
  m.saldo_anterior,
  m.saldo_posterior,
  -- PEDIDO AO VIVO: 942 pode vir com saldo igual — nunca inferir sentido
  -- quando não há variação de saldo real.
  CASE WHEN m.saldo_anterior = m.saldo_posterior THEN 'sem variação de saldo' ELSE NULL END AS observacao_saldo,
  m.fornecedor_key,
  n.nf_key, n.nf_numero, n.nf_serie, n.cfop, n.tipo_nota_key, n.tipo_nota, n.data_emissao
FROM `daterrinha-inventario.dt_relatorios.estoque_movimentos` m
JOIN `daterrinha-inventario.dt_relatorios.estoque_classificacao` c
  ON c.tipo_movimento_key = m.tipo_movimento_key AND c.operacao = 'DESCARTE'
LEFT JOIN `daterrinha-inventario.dt_relatorios.estoque_produtos` p
  ON p.produto_key = m.produto_key
LEFT JOIN `daterrinha-inventario.dt_relatorios.estoque_notas_baixa` n
  ON n.nf_key = m.origem_key AND n.loja_key = m.loja_key
WHERE m.tipo_origem_key = 1;

-- ----------------------------------------------------------------------------
-- vw_estoque_rel_requisicao — movimento 352 (+ estorno 362) + nota (CFOP 5927,
-- tipo 168 "consumo interno") + produto.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `daterrinha-inventario.dt_relatorios.vw_estoque_rel_requisicao` AS
SELECT
  m.movimento_estoque_key,
  m.loja_key,
  m.produto_key,
  p.descricao AS produto_descricao,
  m.data_movimento,
  m.data_lancamento,
  m.tipo_movimento_key,
  m.tipo_movimento,
  c.eh_estorno,
  m.quantidade,
  m.valor,
  m.saldo_anterior,
  m.saldo_posterior,
  n.nf_key, n.nf_numero, n.nf_serie, n.cfop, n.tipo_nota_key, n.tipo_nota, n.data_emissao
FROM `daterrinha-inventario.dt_relatorios.estoque_movimentos` m
JOIN `daterrinha-inventario.dt_relatorios.estoque_classificacao` c
  ON c.tipo_movimento_key = m.tipo_movimento_key AND c.operacao = 'REQUISICAO'
LEFT JOIN `daterrinha-inventario.dt_relatorios.estoque_produtos` p
  ON p.produto_key = m.produto_key
LEFT JOIN `daterrinha-inventario.dt_relatorios.estoque_notas_baixa` n
  ON n.nf_key = m.origem_key AND n.loja_key = m.loja_key
WHERE m.tipo_origem_key = 1;

-- ----------------------------------------------------------------------------
-- vw_estoque_rel_transformacao — junta SAÍDA (354/359/356/860) com ENTRADA
-- (304/389) da MESMA loja, MESMO dia, onde entrada.produto_origem =
-- saida.produto_key e data_lancamento fica a poucos segundos de diferença.
-- Saída sem entrada correspondente aparece com entrada_* tudo NULL ("sem par").
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `daterrinha-inventario.dt_relatorios.vw_estoque_rel_transformacao` AS
WITH saidas AS (
  SELECT m.*, c.eh_estorno
  FROM `daterrinha-inventario.dt_relatorios.estoque_movimentos` m
  JOIN `daterrinha-inventario.dt_relatorios.estoque_classificacao` c
    ON c.tipo_movimento_key = m.tipo_movimento_key AND c.operacao = 'TRANSFORMACAO'
  WHERE m.tipo_movimento_key IN (354, 359, 356, 860, 364, 358, 357, 861)
),
entradas AS (
  SELECT m.*, c.eh_estorno
  FROM `daterrinha-inventario.dt_relatorios.estoque_movimentos` m
  JOIN `daterrinha-inventario.dt_relatorios.estoque_classificacao` c
    ON c.tipo_movimento_key = m.tipo_movimento_key AND c.operacao = 'TRANSFORMACAO'
  WHERE m.tipo_movimento_key IN (304, 389, 314, 388)
)
SELECT
  s.movimento_estoque_key AS saida_movimento_key,
  s.loja_key,
  s.data_movimento,
  s.produto_key        AS produto_origem_key,
  po.descricao         AS produto_origem_descricao,
  s.quantidade         AS saida_quantidade,
  s.valor              AS saida_valor,
  s.eh_estorno          AS saida_eh_estorno,
  e.movimento_estoque_key AS entrada_movimento_key,
  e.produto_key        AS produto_destino_key,
  pd.descricao         AS produto_destino_descricao,
  e.quantidade         AS entrada_quantidade,
  e.valor              AS entrada_valor,
  -- Fator real = quanto de produto destino sai pra cada unidade de origem.
  SAFE_DIVIDE(e.quantidade, s.quantidade) AS fator_real,
  po.fator_transformacao_cadastrado,
  CASE WHEN e.movimento_estoque_key IS NULL THEN TRUE ELSE FALSE END AS sem_par
FROM saidas s
LEFT JOIN entradas e
  ON e.loja_key = s.loja_key
  AND e.produto_origem = s.produto_key
  AND e.data_movimento = s.data_movimento
  AND ABS(TIMESTAMP_DIFF(TIMESTAMP(e.data_lancamento), TIMESTAMP(s.data_lancamento), SECOND)) <= 30
LEFT JOIN `daterrinha-inventario.dt_relatorios.estoque_produtos` po ON po.produto_key = s.produto_key
LEFT JOIN `daterrinha-inventario.dt_relatorios.estoque_produtos` pd ON pd.produto_key = e.produto_key;

-- ============================================================================
-- Pendências que NÃO foram resolvidas por suposição (ver plano):
--
-- 1) CFOP 5.949 ("Baixa de estoque de mercadoria com destinação a uso,
--    consumo") existe em produção mas não em homologação — não se sabe que
--    tipo_movimento_key ele gera. As notas 5949 são gravadas normalmente em
--    estoque_notas_baixa; NENHUMA linha foi adicionada em
--    estoque_classificacao pra elas. Quando o código real for confirmado,
--    adicionar aqui com um novo INSERT (ou editar a lista acima e rodar o
--    DELETE+INSERT de novo) — as views pegam automaticamente, sem mexer em
--    nenhuma delas.
--
-- 2) Tipo 942 pode vir com saldo_anterior = saldo_posterior (sem variação
--    real) — vw_estoque_rel_descarte expõe isso como observacao_saldo =
--    'sem variação de saldo', nunca inventa sentido (positivo/negativo) pra
--    esse caso.
-- ============================================================================
