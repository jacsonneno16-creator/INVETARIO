'use strict';
// Funções PURAS (sem I/O) usadas pelo script de migração
// scripts/migrar-produtos-mestre.js — separadas num módulo próprio pra dar
// pra testar sem precisar de credencial/Firestore de verdade (mesmo padrão
// já usado nos arquivos de functions/, que também extraem a lógica pura
// pra fora do handler quando o teste não precisa da parte de I/O).
// Pedido ao vivo (2026-09-21): "único lugar gravando todas as informações
// dos produtos" — este módulo decide COMO 6 fontes fragmentadas viram 1
// registro por código em produtos_mestre.

// Mesma função exata de 78-pcp-central.js — não reimplementa, só copia,
// pra garantir que o fallback de categoria bate com o que a tela calcula.
function categoriaDoNome(nome) {
  return String(nome || '').replace(/^\d+\s*/, '').trim().split(/\s+/)[0]?.toUpperCase() || '';
}

// Mesmo critério já usado em metaProduto()/_juntarEstoqueBi (78-pcp-
// central.js): entre dois nomes pro mesmo código, fica com o mais completo
// (mais longo) — nomes truncados/abreviados costumam vir de integrações
// antigas, o nome mais longo tende a ser o cadastro mais recente/completo.
function nomeMaisCompleto(a, b) {
  const A = String(a || '').trim(), B = String(b || '').trim();
  if (!A) return B;
  if (!B) return A;
  return B.length > A.length ? B : A;
}

// Categoria manual "de verdade" é qualquer valor que já veio de algum
// cadastro (categoria/classificacao gravados por humano ou pela sync
// antiga do Bluesoft) que NÃO seja simplesmente o que a regra ingênua
// (primeira palavra do nome) já geraria sozinha — se bater exatamente, é
// mais provável que seja o próprio fallback antigo persistido em algum
// momento, não uma correção real.
function categoriaManualParaConfianca(categoriaExistente, nome) {
  const valor = String(categoriaExistente || '').trim();
  if (!valor) return '';
  if (valor.toUpperCase() === categoriaDoNome(nome)) return '';
  return valor;
}

// Ordem de prioridade da categoria final: categoria REVISADA À MÃO pelo
// usuário (planilha produtos-categorias.csv, 2026-09-25 — 1.256 produtos
// revisados um por um, prioridade MÁXIMA, acima até da Bluesoft, porque foi
// decisão humana de verdade, não regra automática) > classificação real da
// Bluesoft (bi_classificacao_produtos) > categoria manual "de confiança"
// (ver acima, cadastro antigo) > fallback pela primeira palavra do nome.
// Retorna também `origem`, pra gravar em categoriaOrigem e permitir
// auditoria/revisão futura.
function escolherCategoria({ categoriaRevisada, categoriaBluesoft, categoriaManualExistente, nome }) {
  const revisada = String(categoriaRevisada || '').trim();
  if (revisada) return { categoria: revisada.toUpperCase(), origem: 'revisado-2026-09-25' };
  const bluesoft = String(categoriaBluesoft || '').trim();
  if (bluesoft) return { categoria: bluesoft.toUpperCase(), origem: 'bluesoft' };
  const manual = categoriaManualParaConfianca(categoriaManualExistente, nome);
  if (manual) return { categoria: manual.toUpperCase(), origem: 'manual' };
  return { categoria: categoriaDoNome(nome), origem: 'nome-fallback' };
}

// Junta os registros por-loja (producao_produtos ∪ pcp_produtos_bluesoft)
// do MESMO código num único rascunho de produtos_mestre — nome mais
// completo vence, demais campos de identidade ficam com o primeiro valor
// não-vazio encontrado (ordem de chegada = ordem das lojas, sem
// preferência de loja específica: são todos o mesmo produto).
function mesclarRegistrosPorCodigo(registros) {
  const acc = { cod: '', nome: '', unidade: '', gtin: '', ativo: true, tipoProduto: '', categoriaExistente: '', classificacao: '' };
  registros.forEach(r => {
    if (!acc.cod && r.cod) acc.cod = String(r.cod).trim();
    acc.nome = nomeMaisCompleto(acc.nome, r.nome || r.produto || r.descricao || '');
    if (!acc.unidade && (r.unidade || r.unidadeMedidaBluesoft)) acc.unidade = r.unidade || r.unidadeMedidaBluesoft;
    if (!acc.gtin && r.gtin) acc.gtin = r.gtin;
    if (r.ativo === false) acc.ativo = false;
    if (!acc.tipoProduto && (r.bluesoftTipoProduto || r.tipoProduto)) acc.tipoProduto = r.bluesoftTipoProduto || r.tipoProduto;
    if (!acc.categoriaExistente && (r.categoria || r.classificacao)) acc.categoriaExistente = r.categoria || r.classificacao;
    if (!acc.classificacao && r.classificacao) acc.classificacao = r.classificacao;
  });
  return acc;
}

// Detecta ficha técnica DIVERGENTE pro mesmo código em lojas diferentes
// (BOM diferente é uma decisão de negócio, não um merge automático seguro)
// — retorna a mais recentemente atualizada, mas sinaliza o conflito pro
// relatório em vez de escolher e ficar quieto.
function escolherFichaTecnica(fichas) {
  if (!fichas.length) return { ficha: null, conflito: false };
  if (fichas.length === 1) return { ficha: fichas[0], conflito: false };
  const assinaturas = new Set(fichas.map(f => JSON.stringify((f.insumos || []).map(i => [i.cod || i.nome, i.quantidade]).sort())));
  const conflito = assinaturas.size > 1;
  const maisRecente = fichas.slice().sort((a, b) => String(b.atualizadoEm || '').localeCompare(String(a.atualizadoEm || '')))[0];
  return { ficha: maisRecente, conflito };
}

// Pedido ao vivo (2026-09-25): "os que eu tirei [da planilha], marca como
// inativo". BUG AO VIVO REAL encontrado ao conferir a 1ª gravação: usar
// `base.ativo` (herdado de mesclarRegistrosPorCodigo, que reflete um flag
// `ativo:false` antigo gravado em producao_produtos/pcp_produtos_bluesoft
// de outra época) deixava a MAIORIA dos produtos inativa mesmo pra quem o
// usuário manteve na planilha revisada — a revisão manual precisa valer
// mais que um flag esquecido. Quando a planilha foi carregada (algum
// código nela), ELA decide ativo/inativo pra todo mundo que passou por
// ela — presente = ativo, ausente = inativo — sem olhar pro flag antigo.
// Sem planilha carregada (arquivo não encontrado), preserva o comportamento
// de sempre (`ativoExistente`), pra não desativar tudo à toa.
function decidirAtivo({ ativoExistente, codigoRevisado, planilhaCarregada }) {
  if (!planilhaCarregada) return ativoExistente;
  return codigoRevisado === true;
}

module.exports = {
  categoriaDoNome,
  nomeMaisCompleto,
  categoriaManualParaConfianca,
  escolherCategoria,
  mesclarRegistrosPorCodigo,
  escolherFichaTecnica,
  decidirAtivo,
};
