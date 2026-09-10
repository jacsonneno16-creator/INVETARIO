// PCP — Fase 7: auditoria compartilhada de alterações (antes/depois/quem/quando).
// Genérico e exposto em global.* de propósito — qualquer módulo (Parâmetros
// do PCP, e futuramente outros) pode chamar em vez de reinventar um log
// próprio. Append-only: nunca update/delete, mesmo padrão já usado no
// ledger de estoque (producao_estoque_movimentos).
(function (global) {
  'use strict';
  const win = global; // preserva a referência: o parâmetro `global` do destructuring abaixo tem o mesmo nome
  const COL = 'pcp_auditoria';
  const COL_GLOBAL = 'compras_fornecedores_auditoria';
  function fs() { return win.getDTFirestore(); }
  function now() { return new Date().toISOString(); }

  // Só grava quando há mudança real entre antes/depois nos campos
  // rastreados — evita ruído de "salvou sem alterar nada".
  //
  // `global:true` (Fase 1A — fornecedor mestre) grava em
  // compras_fornecedores_auditoria (raiz do Firestore, via raw()) em vez
  // de pcp_auditoria (por loja, via fs()) — fornecedor não pertence a uma
  // loja. Sem esse parâmetro o comportamento fica idêntico ao de sempre.
  async function registrarAuditoria({ colecao, docId, produtoCod, produtoNome, antes = {}, depois = {}, camposRastreados = [], origem = '', global: escreverGlobal = false } = {}) {
    const alteracoes = camposRastreados
      .map(campo => ({ campo, valorAnterior: antes[campo] ?? null, valorNovo: depois[campo] ?? null }))
      .filter(x => String(x.valorAnterior ?? '') !== String(x.valorNovo ?? ''));
    if (!alteracoes.length) return null;
    const payload = {
      colecao: colecao || '', docId: docId || '', produtoCod: produtoCod || '', produtoNome: produtoNome || '',
      alteracoes, criadoEm: now(), criadoPor: win._currentAnalistaUser?.email || '', origem: origem || '',
    };
    const destino = escreverGlobal ? win.getDTRawFirestore().collection(COL_GLOBAL) : fs().collection(COL);
    await destino.add(payload);
    return payload;
  }

  async function listarAuditoria({ colecao, docId, produtoCod, global: lerGlobal = false } = {}) {
    let q = lerGlobal ? win.getDTRawFirestore().collection(COL_GLOBAL) : fs().collection(COL);
    if (colecao && docId) q = q.where('colecao', '==', colecao).where('docId', '==', docId);
    else if (produtoCod) q = q.where('produtoCod', '==', produtoCod);
    const snap = await q.get().catch(() => ({ docs: [] }));
    return snap.docs.map(d => ({ _id: d.id, ...d.data() })).sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
  }

  global.registrarAuditoria = registrarAuditoria;
  global.listarAuditoria = listarAuditoria;
})(window);
