// PCP — Fase 7: auditoria compartilhada de alterações (antes/depois/quem/quando).
// Genérico e exposto em global.* de propósito — qualquer módulo (Parâmetros
// do PCP, e futuramente outros) pode chamar em vez de reinventar um log
// próprio. Append-only: nunca update/delete, mesmo padrão já usado no
// ledger de estoque (producao_estoque_movimentos).
(function (global) {
  'use strict';
  const COL = 'pcp_auditoria';
  function fs() { return global.getDTFirestore(); }
  function now() { return new Date().toISOString(); }

  // Só grava quando há mudança real entre antes/depois nos campos
  // rastreados — evita ruído de "salvou sem alterar nada".
  async function registrarAuditoria({ colecao, docId, produtoCod, produtoNome, antes = {}, depois = {}, camposRastreados = [], origem = '' } = {}) {
    const alteracoes = camposRastreados
      .map(campo => ({ campo, valorAnterior: antes[campo] ?? null, valorNovo: depois[campo] ?? null }))
      .filter(x => String(x.valorAnterior ?? '') !== String(x.valorNovo ?? ''));
    if (!alteracoes.length) return null;
    const payload = {
      colecao: colecao || '', docId: docId || '', produtoCod: produtoCod || '', produtoNome: produtoNome || '',
      alteracoes, criadoEm: now(), criadoPor: global._currentAnalistaUser?.email || '', origem: origem || '',
    };
    await fs().collection(COL).add(payload);
    return payload;
  }

  async function listarAuditoria({ colecao, docId, produtoCod } = {}) {
    let q = fs().collection(COL);
    if (colecao && docId) q = q.where('colecao', '==', colecao).where('docId', '==', docId);
    else if (produtoCod) q = q.where('produtoCod', '==', produtoCod);
    const snap = await q.get().catch(() => ({ docs: [] }));
    return snap.docs.map(d => ({ _id: d.id, ...d.data() })).sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
  }

  global.registrarAuditoria = registrarAuditoria;
  global.listarAuditoria = listarAuditoria;
})(window);
