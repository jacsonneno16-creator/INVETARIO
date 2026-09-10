// Compras — Fase 1A: Fundação de Compras (fornecedor mestre). Serviço
// compartilhado único para tudo que toca `compras_fornecedores` /
// `compras_fornecedores_resumo` / `compras_fornecedor_produtos` — nenhuma
// tela (nem a nova aba Fornecedores, nem futuras) deve chamar
// getDTRawFirestore().collection('compras_fornecedores') direto.
//
// Coleções GLOBAIS (fora de lojas/{lojaId}) — fornecedor não pertence a
// uma loja, mesmo raciocínio já usado para recebimento_motoristas.
//
// `compras_fornecedores_resumo` existe porque o Firestore não tem
// segurança por campo: é a única forma de deixar PCP/Produção
// enxergarem fornecedorId/nome/homologação/lead time sem também
// exporem preço/condição comercial (que só Compras pode ver) — gravada
// sempre no MESMO batch atômico do documento completo, nunca diverge.
(function (global) {
  'use strict';
  const COL = 'compras_fornecedores';
  const COL_RESUMO = 'compras_fornecedores_resumo';
  const COL_PRODUTOS = 'compras_fornecedor_produtos';
  const raw = () => global.getDTRawFirestore();
  const now = () => new Date().toISOString();
  const usuario = () => global._currentAnalistaUser?.email || '';
  const idSeguro = v => String(v ?? '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);

  function normalizarCnpj(v) {
    return String(v ?? '').replace(/\D/g, '');
  }

  function formatarCnpj(v) {
    const c = normalizarCnpj(v);
    if (c.length !== 14) return '';
    return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }

  // Algoritmo padrão de dígito verificador de CNPJ — não valida só o
  // tamanho (pedido explícito: teste "CNPJ inválido" precisa de um CNPJ
  // com 14 dígitos mas dígito verificador errado, não só curto/longo).
  function validarCnpj(v) {
    const c = normalizarCnpj(v);
    if (c.length !== 14) return false;
    if (/^(\d)\1{13}$/.test(c)) return false;
    const calcDigito = base => {
      const pesos = base.length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
      const soma = base.split('').reduce((s, d, i) => s + Number(d) * pesos[i], 0);
      const resto = soma % 11;
      return resto < 2 ? 0 : 11 - resto;
    };
    const base12 = c.slice(0, 12);
    const d1 = calcDigito(base12);
    const d2 = calcDigito(base12 + String(d1));
    return c === base12 + String(d1) + String(d2);
  }

  // Nova função compartilhada — de propósito NÃO reaproveita as 3 cópias
  // de norm()/normalizar() já existentes (78/65/67), cada uma com
  // pequena diferença de comportamento e já em produção; consolidar
  // essas agora é fora do escopo da Fase 1A e arriscaria regressão nelas.
  function normalizarNomeFornecedor(v) {
    const semAcentos = String(v ?? '').normalize('NFD').split('').filter(ch => {
      const code = ch.charCodeAt(0);
      return code < 0x0300 || code > 0x036f; // remove marcas de acentuação combinantes
    }).join('');
    return semAcentos
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function _resumoDe(id, dados) {
    return {
      fornecedorId: id,
      nomeFantasia: dados.nomeFantasia || '',
      situacao: dados.situacao || 'ativo',
      homologacaoStatus: dados.homologacao?.status || 'nao_homologado',
      leadTimePadraoDias: Number(dados.leadTimePadraoDias) || 0,
    };
  }

  async function buscarPorId(fornecedorId) {
    if (!fornecedorId) return null;
    const doc = await raw().collection(COL).doc(fornecedorId).get();
    return doc.exists ? { fornecedorId: doc.id, ...doc.data() } : null;
  }

  async function buscarPorCnpj(cnpj) {
    const c = normalizarCnpj(cnpj);
    if (!c) return null;
    return buscarPorId(c);
  }

  async function listar({ situacao = '', limit = 50 } = {}) {
    let q = raw().collection(COL);
    if (situacao) q = q.where('situacao', '==', situacao);
    const snap = await q.get().catch(() => ({ docs: [] }));
    return snap.docs.map(d => ({ fornecedorId: d.id, ...d.data() }))
      .sort((a, b) => String(a.nomeFantasia || '').localeCompare(String(b.nomeFantasia || ''), 'pt-BR'))
      .slice(0, limit);
  }

  // Sem busca full-text no Firestore — filtra em memória sobre a lista já
  // trazida, mesmo padrão simples já usado no resto do módulo Compras
  // (productsPage(), suppliersPage()).
  async function pesquisarPorNome(termo, { limit = 50 } = {}) {
    const alvo = normalizarNomeFornecedor(termo);
    const todos = await listar({ limit: 100000 });
    const filtrados = !alvo ? todos : todos.filter(f =>
      normalizarNomeFornecedor(f.nomeFantasia).includes(alvo) ||
      normalizarNomeFornecedor(f.razaoSocial).includes(alvo) ||
      normalizarCnpj(f.cnpj).includes(normalizarCnpj(termo)) && normalizarCnpj(termo).length > 0
    );
    return filtrados.slice(0, limit);
  }

  function estaBloqueado(fornecedor) {
    if (!fornecedor) return false;
    if (fornecedor.situacao === 'bloqueado') return true;
    return (fornecedor.bloqueios || []).some(b => b.ativo === true);
  }

  function documentosVencidos(fornecedor) {
    const hoje = now().slice(0, 10);
    return (fornecedor?.documentos || []).filter(d => d.validade && String(d.validade).slice(0, 10) < hoje);
  }

  async function condicoesComerciaisPadrao(fornecedorId) {
    const f = await buscarPorId(fornecedorId);
    if (!f) return null;
    return {
      condicaoPagamentoPadrao: f.condicaoPagamentoPadrao || null,
      leadTimePadraoDias: f.leadTimePadraoDias || 0,
      pedidoMinimo: f.pedidoMinimo || null,
      fretePadrao: f.fretePadrao || '',
    };
  }

  async function detectarDuplicidade({ cnpj = '', nome = '' } = {}) {
    const c = normalizarCnpj(cnpj);
    if (c) {
      const existente = await buscarPorId(c);
      if (existente) return { duplicado: true, motivo: 'cnpj', fornecedor: existente };
    }
    const alvo = normalizarNomeFornecedor(nome);
    if (alvo) {
      const todos = await listar({ limit: 100000 });
      const igual = todos.find(f => normalizarNomeFornecedor(f.nomeFantasia) === alvo || normalizarNomeFornecedor(f.razaoSocial) === alvo);
      if (igual) return { duplicado: true, motivo: 'nome', fornecedor: igual };
    }
    return { duplicado: false, motivo: '', fornecedor: null };
  }

  function _validarDadosObrigatorios(dados) {
    if (!String(dados.razaoSocial || '').trim()) throw new Error('Informe a razão social.');
    if (!String(dados.nomeFantasia || '').trim()) throw new Error('Informe o nome fantasia.');
    if (dados.cnpj && !validarCnpj(dados.cnpj)) throw new Error('CNPJ inválido.');
  }

  async function criarFornecedor(dados = {}) {
    _validarDadosObrigatorios(dados);
    const cnpj = dados.cnpj ? normalizarCnpj(dados.cnpj) : '';
    const dup = await detectarDuplicidade({ cnpj, nome: dados.nomeFantasia });
    if (dup.duplicado) throw new Error(dup.motivo === 'cnpj' ? 'Já existe fornecedor cadastrado com este CNPJ.' : 'Já existe fornecedor cadastrado com este nome — verifique antes de duplicar.');
    const id = cnpj || raw().collection(COL).doc().id;
    const agora = now();
    const payload = {
      fornecedorId: id,
      razaoSocial: String(dados.razaoSocial).trim(),
      nomeFantasia: String(dados.nomeFantasia).trim(),
      cnpj: cnpj || null,
      cnpjFormatado: cnpj ? formatarCnpj(cnpj) : null,
      inscricaoEstadual: dados.inscricaoEstadual || '',
      situacao: dados.situacao || 'ativo',
      statusCadastro: cnpj ? 'completo' : 'incompleto_sem_cnpj',
      categorias: Array.isArray(dados.categorias) ? dados.categorias : [],
      enderecos: Array.isArray(dados.enderecos) ? dados.enderecos : [],
      contatos: Array.isArray(dados.contatos) ? dados.contatos : [],
      emailsCotacao: Array.isArray(dados.emailsCotacao) ? dados.emailsCotacao : [],
      condicaoPagamentoPadrao: dados.condicaoPagamentoPadrao || null,
      leadTimePadraoDias: Number(dados.leadTimePadraoDias) || 0,
      pedidoMinimo: dados.pedidoMinimo || { valor: null, quantidade: null },
      fretePadrao: dados.fretePadrao || 'a_combinar',
      compradorResponsavelUid: dados.compradorResponsavelUid || null,
      compradorResponsavelNome: dados.compradorResponsavelNome || '',
      documentos: Array.isArray(dados.documentos) ? dados.documentos : [],
      homologacao: dados.homologacao || { status: 'nao_homologado', categoriasHomologadas: [], validadeAte: null },
      bloqueios: [],
      observacoes: dados.observacoes || '',
      codigoExternoBluesoft: dados.codigoExternoBluesoft || null,
      origem: dados.origem || 'manual',
      criadoEm: agora, criadoPor: usuario(),
      atualizadoEm: agora, atualizadoPor: usuario(),
    };
    const batch = raw().batch();
    batch.set(raw().collection(COL).doc(id), payload);
    batch.set(raw().collection(COL_RESUMO).doc(id), _resumoDe(id, payload));
    await batch.commit();
    await global.registrarAuditoria?.({
      colecao: COL, docId: id, produtoCod: cnpj || id, produtoNome: payload.nomeFantasia,
      antes: {}, depois: { razaoSocial: payload.razaoSocial, nomeFantasia: payload.nomeFantasia, situacao: payload.situacao, cnpj: payload.cnpj || '' },
      camposRastreados: ['razaoSocial', 'nomeFantasia', 'situacao', 'cnpj'],
      origem: 'compras_fornecedores:criar', global: true,
    });
    return payload;
  }

  const CAMPOS_ATUALIZAVEIS = ['razaoSocial','nomeFantasia','inscricaoEstadual','situacao','categorias','enderecos','contatos','emailsCotacao','condicaoPagamentoPadrao','leadTimePadraoDias','pedidoMinimo','fretePadrao','compradorResponsavelUid','compradorResponsavelNome','documentos','homologacao','observacoes','codigoExternoBluesoft'];

  async function atualizarFornecedor(id, dados = {}) {
    if (!id) throw new Error('Fornecedor não informado.');
    const atual = await buscarPorId(id);
    if (!atual) throw new Error('Fornecedor não encontrado.');
    if (dados.nomeFantasia !== undefined && !String(dados.nomeFantasia).trim()) throw new Error('Informe o nome fantasia.');
    const agora = now();
    const patch = {};
    CAMPOS_ATUALIZAVEIS.forEach(campo => { if (dados[campo] !== undefined) patch[campo] = dados[campo]; });
    patch.atualizadoEm = agora; patch.atualizadoPor = usuario();
    const depois = { ...atual, ...patch };
    const batch = raw().batch();
    batch.set(raw().collection(COL).doc(id), patch, { merge: true });
    batch.set(raw().collection(COL_RESUMO).doc(id), _resumoDe(id, depois), { merge: true });
    await batch.commit();
    const camposParaAuditar = ['razaoSocial','nomeFantasia','situacao','leadTimePadraoDias','fretePadrao'].filter(c => patch[c] !== undefined);
    if (camposParaAuditar.length) {
      await global.registrarAuditoria?.({
        colecao: COL, docId: id, produtoCod: atual.cnpj || id, produtoNome: depois.nomeFantasia,
        antes: atual, depois,
        camposRastreados: camposParaAuditar,
        origem: 'compras_fornecedores:atualizar', global: true,
      });
    }
    return depois;
  }

  async function bloquearFornecedor(id, motivo) {
    if (!String(motivo || '').trim()) throw new Error('Informe a justificativa do bloqueio.');
    const atual = await buscarPorId(id);
    if (!atual) throw new Error('Fornecedor não encontrado.');
    const agora = now();
    const bloqueios = [...(atual.bloqueios || []), { motivo: String(motivo).trim(), bloqueadoEm: agora, bloqueadoPor: usuario(), ativo: true }];
    const batch = raw().batch();
    batch.set(raw().collection(COL).doc(id), { bloqueios, situacao: 'bloqueado', atualizadoEm: agora, atualizadoPor: usuario() }, { merge: true });
    batch.set(raw().collection(COL_RESUMO).doc(id), { situacao: 'bloqueado' }, { merge: true });
    await batch.commit();
    await global.registrarAuditoria?.({
      colecao: COL, docId: id, produtoCod: atual.cnpj || id, produtoNome: atual.nomeFantasia,
      antes: { situacao: atual.situacao }, depois: { situacao: 'bloqueado' },
      camposRastreados: ['situacao'], origem: 'compras_fornecedores:bloquear', global: true,
    });
    return { ...atual, bloqueios, situacao: 'bloqueado' };
  }

  async function desbloquearFornecedor(id, motivo) {
    if (!String(motivo || '').trim()) throw new Error('Informe a justificativa do desbloqueio.');
    const atual = await buscarPorId(id);
    if (!atual) throw new Error('Fornecedor não encontrado.');
    const agora = now();
    const bloqueios = (atual.bloqueios || []).map(b => b.ativo ? { ...b, ativo: false, desbloqueadoEm: agora, desbloqueadoPor: usuario() } : b);
    const batch = raw().batch();
    batch.set(raw().collection(COL).doc(id), { bloqueios, situacao: 'ativo', atualizadoEm: agora, atualizadoPor: usuario() }, { merge: true });
    batch.set(raw().collection(COL_RESUMO).doc(id), { situacao: 'ativo' }, { merge: true });
    await batch.commit();
    await global.registrarAuditoria?.({
      colecao: COL, docId: id, produtoCod: atual.cnpj || id, produtoNome: atual.nomeFantasia,
      antes: { situacao: atual.situacao }, depois: { situacao: 'ativo' },
      camposRastreados: ['situacao'], origem: 'compras_fornecedores:desbloquear', global: true,
    });
    return { ...atual, bloqueios, situacao: 'ativo' };
  }

  async function vincularProdutoFornecedor(payload = {}) {
    if (!payload.fornecedorId) throw new Error('Informe o fornecedor.');
    if (!payload.produtoId) throw new Error('Informe o produto.');
    const id = `${payload.fornecedorId}_${idSeguro(payload.produtoId)}`;
    const agora = now();
    const atual = await raw().collection(COL_PRODUTOS).doc(id).get();
    const dados = {
      fornecedorId: payload.fornecedorId, produtoId: String(payload.produtoId),
      produtoNomeSnapshot: payload.produtoNomeSnapshot || '',
      codigoNoFornecedor: payload.codigoNoFornecedor || '',
      unidade: payload.unidade || '', fatorConversao: Number(payload.fatorConversao) || 1,
      marca: payload.marca || '', precoReferencia: payload.precoReferencia != null ? Number(payload.precoReferencia) : null,
      quantidadeMinima: Number(payload.quantidadeMinima) || 0, multiplo: Number(payload.multiplo) || 1,
      leadTimeDias: Number(payload.leadTimeDias) || 0, capacidade: payload.capacidade != null ? Number(payload.capacidade) : null,
      homologado: !!payload.homologado, vigenciaInicio: payload.vigenciaInicio || null, vigenciaFim: payload.vigenciaFim || null,
      ultimaCompraEm: payload.ultimaCompraEm || null, ultimaCompraValor: payload.ultimaCompraValor ?? null,
      ultimaCotacaoEm: payload.ultimaCotacaoEm || null, ultimaCotacaoValor: payload.ultimaCotacaoValor ?? null,
      atualizadoEm: agora, atualizadoPor: usuario(),
      criadoEm: atual.exists ? atual.data().criadoEm : agora, criadoPor: atual.exists ? atual.data().criadoPor : usuario(),
    };
    await raw().collection(COL_PRODUTOS).doc(id).set(dados, { merge: true });
    return dados;
  }

  async function listarProdutosDoFornecedor(fornecedorId) {
    const snap = await raw().collection(COL_PRODUTOS).where('fornecedorId', '==', fornecedorId).get().catch(() => ({ docs: [] }));
    return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  }

  async function listarHomologadosPorProduto(produtoId) {
    const snap = await raw().collection(COL_PRODUTOS).where('produtoId', '==', String(produtoId)).where('homologado', '==', true).get().catch(() => ({ docs: [] }));
    return snap.docs.map(d => ({ _id: d.id, ...d.data() }));
  }

  // Nunca associa sozinho — só classifica candidatos. "exato": nome
  // normalizado idêntico. "provável": um nome contém o outro (substring),
  // determinístico e explicável, sem fuzzy matching sofisticado.
  function classificarCandidato(nomeLegadoNormalizado, fornecedor) {
    const nomes = [normalizarNomeFornecedor(fornecedor.nomeFantasia), normalizarNomeFornecedor(fornecedor.razaoSocial)].filter(Boolean);
    if (nomes.some(n => n === nomeLegadoNormalizado)) return 'exato';
    if (nomeLegadoNormalizado.length >= 4 && nomes.some(n => n.includes(nomeLegadoNormalizado) || nomeLegadoNormalizado.includes(n))) return 'provavel';
    return '';
  }

  async function conciliarFornecedorLegado(nomeLegado, fornecedoresCadastrados) {
    const alvo = normalizarNomeFornecedor(nomeLegado);
    if (!alvo) return { nomeLegado, classificacao: 'sem_correspondencia', candidatos: [] };
    const todos = fornecedoresCadastrados || await listar({ limit: 100000 });
    const candidatos = todos
      .map(f => ({ fornecedorId: f.fornecedorId, nomeFantasia: f.nomeFantasia, tipo: classificarCandidato(alvo, f) }))
      .filter(c => c.tipo);
    const exatos = candidatos.filter(c => c.tipo === 'exato');
    const provaveis = candidatos.filter(c => c.tipo === 'provavel');
    let classificacao = 'sem_correspondencia';
    if (exatos.length === 1) classificacao = 'exato';
    else if (exatos.length > 1) classificacao = 'ambiguo';
    else if (provaveis.length === 1) classificacao = 'provavel';
    else if (provaveis.length > 1) classificacao = 'ambiguo';
    return { nomeLegado, classificacao, candidatos: exatos.length ? exatos : provaveis };
  }

  // Simulação de migração — SÓ LEITURA, nunca grava nada (pedido
  // explícito: "Não executar migração definitiva sem minha aprovação").
  // Mesmo padrão de loop entre lojas já usado em 78-pcp-central.js.
  async function simularConciliacaoLegado() {
    const vazio = { docs: [] };
    const lojasSnap = await raw().collection('lojas').get().catch(() => vazio);
    const lojas = lojasSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const nomes = new Set();
    for (const loja of lojas) {
      const base = raw().collection('lojas').doc(loja.id);
      const [produtosSnap, requisicoesSnap, agendamentosSnap] = await Promise.all([
        base.collection('producao_produtos').get().catch(() => vazio),
        base.collection('pcp_requisicoes_compra').get().catch(() => vazio),
        base.collection('pcp_agendamentos').get().catch(() => vazio),
      ]);
      produtosSnap.docs.forEach(d => { const v = d.data().fornecedorPadrao; if (v) nomes.add(String(v)); });
      requisicoesSnap.docs.forEach(d => {
        const x = d.data();
        if (x.fornecedor) nomes.add(String(x.fornecedor));
        (x.cotacoes || []).forEach(c => { if (c.fornecedor) nomes.add(String(c.fornecedor)); });
      });
      agendamentosSnap.docs.forEach(d => { const v = d.data().fornecedor; if (v) nomes.add(String(v)); });
    }
    const recebimentoSnap = await raw().collection('recebimento_agendamentos').get().catch(() => vazio);
    recebimentoSnap.docs.forEach(d => { const v = d.data().fornecedorNome; if (v) nomes.add(String(v)); });
    const biSnap = await raw().collection('bi_fornecedores_agregado').get().catch(() => vazio);
    biSnap.docs.forEach(d => (d.data().top || []).forEach(t => { if (t.f) nomes.add(String(t.f)); }));

    const cadastrados = await listar({ limit: 100000 });
    const resultados = [];
    for (const nome of nomes) resultados.push(await conciliarFornecedorLegado(nome, cadastrados));
    return {
      exato: resultados.filter(r => r.classificacao === 'exato'),
      provavel: resultados.filter(r => r.classificacao === 'provavel'),
      ambiguo: resultados.filter(r => r.classificacao === 'ambiguo'),
      semCorrespondencia: resultados.filter(r => r.classificacao === 'sem_correspondencia'),
    };
  }

  global._fornecedoresService = {
    normalizarCnpj, formatarCnpj, validarCnpj, normalizarNomeFornecedor,
    buscarPorId, buscarPorCnpj, listar, pesquisarPorNome,
    estaBloqueado, documentosVencidos, condicoesComerciaisPadrao,
    detectarDuplicidade, criarFornecedor, atualizarFornecedor,
    bloquearFornecedor, desbloquearFornecedor,
    vincularProdutoFornecedor, listarProdutosDoFornecedor, listarHomologadosPorProduto,
    conciliarFornecedorLegado, simularConciliacaoLegado,
  };
})(window);
