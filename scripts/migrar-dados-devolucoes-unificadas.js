'use strict';
/**
 * Devoluções unificadas (2026-10-13): backfill de `devolucoes_notas` (e, onde
 * já tinha retorno físico confirmado, `devolucoes_recebimentos`) a partir do
 * histórico de `recebimento_recusas` gravado pelo esquema ANTIGO (100-
 * consulta-notas-fiscais.js), que só criava documento pra 1 subconjunto de
 * motivos (origem:'AUTOMATICO') e nunca tinha um catálogo fiscal separado.
 *
 * Regra, por chave (dentro de cada loja):
 *   - Sem nenhum doc AUTOMATICO pra essa chave → não é uma devolução
 *     conhecida por este histórico; este script NÃO toca nela.
 *   - Com doc AUTOMATICO e NENHUM outro doc (origem != 'AUTOMATICO') na
 *     mesma chave → devolucoes_notas/{chave} = PENDENTE (nota existe, carga
 *     nunca foi confirmada fisicamente).
 *   - Com doc AUTOMATICO E outro doc (origem:'COLETOR', o retorno físico já
 *     bipado) na mesma chave → devolucoes_notas/{chave} = RECEBIDA, e cria
 *     devolucoes_recebimentos/{chave} com os dados de QUEM/QUANDO confirmou,
 *     tirados do doc físico mais antigo (o que realmente confirmou primeiro).
 *
 * COBERTURA PARCIAL, documentada de propósito (não é bug, é limite real dos
 * dados): antes desta feature, 4 categorias de motivo (Troca/Avaria/Vencido/
 * Impróprio para consumo + "sem motivo no texto") eram DESCARTADAS na
 * importação antiga — nunca viraram documento nenhum em recebimento_recusas.
 * Esses casos NÃO aparecem neste histórico e portanto NÃO são recuperados
 * por este script — só reimportando o arquivo BI atual (botão "Atualizar do
 * BI" na aba Controle de 106-devolucoes.js) eles entram no catálogo novo,
 * do zero, como PENDENTE.
 *
 * Idempotente: nunca sobrescreve devolucoes_notas/devolucoes_recebimentos
 * que já existam (reimportação do BI ou rodada anterior deste script) — só
 * cria o que ainda não existe.
 *
 * Uso:
 *   node scripts/migrar-dados-devolucoes-unificadas.js                  # diagnóstico só
 *   node scripts/migrar-dados-devolucoes-unificadas.js --apply          # grava
 *   node scripts/migrar-dados-devolucoes-unificadas.js --loja=matriz    # só 1 loja
 *   node scripts/migrar-dados-devolucoes-unificadas.js --service-account=/caminho/credencial.json
 */
const path = require('node:path');
const fs = require('node:fs');

// Mesma categorização usada hoje pelo importador do BI
// (functions/index.js, _classificarMotivoTextoBi) — duplicada aqui de
// propósito (script standalone, sem puxar o módulo inteiro de Cloud
// Functions só por uma função pura) e mantida em sincronia manual se a
// lista de categorias mudar.
const CATEGORIAS_MOTIVO = [
  ['TROCA', /\bTROCA/],
  ['IMPRÓPRIO PARA CONSUMO/VENDA', /IMPROPRI/],
  ['AVARIA', /AVARI/],
  ['FALTA NA CARGA/ENTREGA', /FALTA|FALTOU/],
  ['PRODUTO ERRADO/DIVERGENTE', /ERRAD|DIVERGEN/],
  ['VENCIDO/VENCIMENTO', /VENCID|VENC:/],
  ['DESACORDO COM PEDIDO', /DESACORDO/],
];
const SEM_MOTIVO_NO_TEXTO = '(SEM MOTIVO NO TEXTO)';
function classificarMotivoTexto(texto) {
  const t = String(texto || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [nome, regex] of CATEGORIAS_MOTIVO) if (regex.test(t)) return nome;
  return SEM_MOTIVO_NO_TEXTO;
}
function extrairRede(destinatario) {
  const s = String(destinatario || '').trim();
  const idx = s.indexOf(' - ');
  return (idx > -1 ? s.slice(0, idx) : s).trim();
}

// Pura — sem Firestore. `recusasDocs` é [{id,data}] (já lido); `notasExistentes`
// e `recebimentosExistentes` são Set<chave> dos docs que já existem no
// catálogo novo (pra nunca sobrescrever). Devolve o mesmo plano que
// diagnosticarEMigrarLoja grava.
function montarPlanoDaLoja(lojaId, recusasDocs, notasExistentes, recebimentosExistentes, agora) {
  const porChave = new Map(); // chave -> { automatico: {id,data}|null, outros: [{id,data}] }
  recusasDocs.forEach(d => {
    const data = d.data || {};
    const origem = data.origem || '';
    (data.chaves || []).forEach(chave => {
      if (!chave) return;
      if (!porChave.has(chave)) porChave.set(chave, { automatico: null, outros: [] });
      const entrada = porChave.get(chave);
      if (origem === 'AUTOMATICO') { if (!entrada.automatico) entrada.automatico = { id: d.id, data }; }
      else entrada.outros.push({ id: d.id, data });
    });
  });

  const chavesDevolucao = [...porChave.entries()].filter(([, e]) => e.automatico);
  let pendentes = 0, recebidas = 0, jaExistiamNotas = 0, jaExistiamRecebimentos = 0;
  const notasParaCriar = [];
  const recebimentosParaCriar = [];

  for (const [chave, entrada] of chavesDevolucao) {
    if (notasExistentes.has(chave)) { jaExistiamNotas++; continue; }
    const fonte = entrada.automatico.data;
    const embutida = (fonte.notas && fonte.notas[0]) || {};
    const motivoTexto = fonte.motivoAutomaticoTexto || '';
    const destinatario = fonte.destinatario || embutida.destinatario || '';
    const devNota = {
      chave, lojaId,
      numeroNota: embutida.numeroNota || '', serie: '', cfop: '',
      dataEmissao: fonte.dataEmissao || embutida.dataEmissao || '',
      destinatario,
      rede: fonte.rede || extrairRede(destinatario),
      valorTotal: Number(fonte.valorTotal != null ? fonte.valorTotal : embutida.valorTotal) || 0,
      itens: Array.isArray(embutida.itens) ? embutida.itens : [],
      motivoTextoOriginal: motivoTexto,
      motivoNormalizado: classificarMotivoTexto(motivoTexto),
      versaoImportacao: 'migracao-historico-' + agora,
      atualizadoEm: agora,
    };
    if (entrada.outros.length) {
      recebidas++;
      const docFisico = [...entrada.outros].sort((a, b) => String(a.data.criadoEm || '').localeCompare(String(b.data.criadoEm || '')))[0];
      const confirmadoPor = docFisico.data.criadoPorEmail || docFisico.data.criadoPorUid || '';
      const confirmadoEm = docFisico.data.criadoEm || agora;
      const origemConfirmacao = docFisico.data.origem === 'ANALISTA' ? 'ANALISTA' : 'COLETOR';
      devNota.estado = 'RECEBIDA';
      devNota.recebidoEm = confirmadoEm;
      devNota.recebidoPor = confirmadoPor;
      devNota.origemRecebimento = 'MIGRACAO_HISTORICO';
      devNota.criadoEm = fonte.criadoEm || agora;
      if (!recebimentosExistentes.has(chave)) {
        recebimentosParaCriar.push({ chave, payload: { chave, lojaId, confirmadoEm, confirmadoPor, origem: origemConfirmacao, relatorioId: null, migradoDe: docFisico.id } });
      } else jaExistiamRecebimentos++;
    } else {
      pendentes++;
      devNota.estado = 'PENDENTE';
      devNota.criadoEm = fonte.criadoEm || agora;
    }
    notasParaCriar.push({ chave, payload: devNota });
  }

  return {
    lojaId,
    totalChavesComAutomatico: chavesDevolucao.length,
    pendentes, recebidas, jaExistiamNotas, jaExistiamRecebimentos,
    notasParaCriar, recebimentosParaCriar,
  };
}

async function diagnosticarEMigrarLoja(db, lojaId, agora) {
  const recusasSnap = await db.collection('lojas').doc(lojaId).collection('recebimento_recusas').get();
  const recusasDocs = recusasSnap.docs.map(d => ({ id: d.id, data: d.data() || {} }));
  const [notasExistentesSnap, recebimentosExistentesSnap] = await Promise.all([
    db.collection('lojas').doc(lojaId).collection('devolucoes_notas').get(),
    db.collection('lojas').doc(lojaId).collection('devolucoes_recebimentos').get(),
  ]);
  const notasExistentes = new Set(notasExistentesSnap.docs.map(d => d.id));
  const recebimentosExistentes = new Set(recebimentosExistentesSnap.docs.map(d => d.id));
  return montarPlanoDaLoja(lojaId, recusasDocs, notasExistentes, recebimentosExistentes, agora);
}

async function gravar(db, lojaId, resultado) {
  const colNotas = db.collection('lojas').doc(lojaId).collection('devolucoes_notas');
  const colRec = db.collection('lojas').doc(lojaId).collection('devolucoes_recebimentos');
  for (let i = 0; i < resultado.notasParaCriar.length; i += 400) {
    const lote = resultado.notasParaCriar.slice(i, i + 400);
    const batch = db.batch();
    lote.forEach(n => batch.set(colNotas.doc(n.chave), n.payload));
    await batch.commit();
  }
  for (let i = 0; i < resultado.recebimentosParaCriar.length; i += 400) {
    const lote = resultado.recebimentosParaCriar.slice(i, i + 400);
    const batch = db.batch();
    lote.forEach(r => batch.set(colRec.doc(r.chave), r.payload));
    await batch.commit();
  }
}

async function listarLojas(db, lojaFiltro) {
  if (lojaFiltro) return [lojaFiltro];
  const snap = await db.collection('lojas').get();
  return snap.docs.map(d => d.id);
}

async function main(db, APPLY, lojaFiltro) {
  console.log(APPLY ? '=== APPLY: gravação habilitada ===' : '=== DIAGNÓSTICO: nada será gravado ===');
  console.log('COBERTURA PARCIAL — motivos historicamente descartados (Troca/Avaria/Vencido/Impróprio/sem motivo) não aparecem no histórico e não são recuperados aqui; só reimportando o BI atual.');
  const agora = new Date().toISOString();
  const lojas = await listarLojas(db, lojaFiltro);
  console.log(`Loja(s) a processar: ${lojas.join(', ') || '(nenhuma)'}`);

  let totalPendentes = 0, totalRecebidas = 0, totalJaExistiamNotas = 0, totalJaExistiamRecebimentos = 0;
  for (const lojaId of lojas) {
    const r = await diagnosticarEMigrarLoja(db, lojaId, agora);
    totalPendentes += r.pendentes; totalRecebidas += r.recebidas;
    totalJaExistiamNotas += r.jaExistiamNotas; totalJaExistiamRecebimentos += r.jaExistiamRecebimentos;
    console.log(`[${lojaId}] chaves com devolução conhecida: ${r.totalChavesComAutomatico}; a criar PENDENTE: ${r.pendentes}; a criar RECEBIDA: ${r.recebidas}; já existiam (puladas): notas=${r.jaExistiamNotas}, recebimentos=${r.jaExistiamRecebimentos}`);
    if (APPLY && (r.notasParaCriar.length || r.recebimentosParaCriar.length)) {
      await gravar(db, lojaId, r);
      console.log(`[${lojaId}] gravado: ${r.notasParaCriar.length} nota(s), ${r.recebimentosParaCriar.length} recebimento(s).`);
    }
  }
  console.log(`TOTAL — a criar PENDENTE: ${totalPendentes}; a criar RECEBIDA: ${totalRecebidas}; já existiam (puladas): notas=${totalJaExistiamNotas}, recebimentos=${totalJaExistiamRecebimentos}`);
  if (!APPLY) console.log('Diagnóstico concluído. Rode novamente com --apply somente após revisar os números acima.');
  else console.log('Migração de dados concluída.');
}

module.exports = { classificarMotivoTexto, extrairRede, montarPlanoDaLoja, main };

if (require.main === module) {
  const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
  const APPLY = process.argv.includes('--apply');
  const argLoja = process.argv.find(x => x.startsWith('--loja='));
  const LOJA_FILTRO = argLoja ? argLoja.slice('--loja='.length) : '';
  const argSa = process.argv.find(x => x.startsWith('--service-account='));
  const SA = argSa ? argSa.slice('--service-account='.length) : (process.env.GOOGLE_APPLICATION_CREDENTIALS || '');
  if (admin.apps.length === 0) {
    if (SA) {
      if (!fs.existsSync(SA)) throw new Error('Service account não encontrado: ' + SA);
      admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(SA))) });
    } else {
      admin.initializeApp();
    }
  }
  main(admin.firestore(), APPLY, LOJA_FILTRO).catch(e => { console.error(e); process.exitCode = 1; });
}
