'use strict';
/**
 * Devoluções unificadas (2026-10-13): backfill explícito do módulo novo
 * `recebimento-devolucoes` a partir dos 2 módulos antigos que ele substitui
 * (`recebimento-consulta-notas` e `recebimento-devolucoes-indicadores`).
 * Script único, não um fallback de runtime — depois de rodado, 106-
 * devolucoes.js e firestore.rules (hasPermissionDevolucoes) nunca olham pra
 * trás pros módulos antigos.
 *
 * Regra de mapeamento (ver plano aprovado):
 *   visualizar = OR dos dois antigos (quem via qualquer uma das 2 telas
 *     continua vendo a nova, que reúne as duas).
 *   importar/exportar = copiados de recebimento-consulta-notas (só ele
 *     tinha essas 2 ações no catálogo antigo).
 *   confirmar / relatorio_criar / relatorio_finalizar / estornar / excluir
 *     = SEMPRE false pra todo mundo — ninguém tinha essa capacidade antes
 *     (bipagem/relatório é funcionalidade NOVA), nunca inferir de importar.
 *
 * Nunca sobrescreve `permissoes.recebimento-devolucoes` se já existir (nem
 * sequer parcialmente) — rodar de novo depois de aplicado é no-op.
 *
 * Uso:
 *   node scripts/migrar-permissoes-devolucoes-unificadas.js            # dry-run
 *   node scripts/migrar-permissoes-devolucoes-unificadas.js --apply    # grava
 *   node scripts/migrar-permissoes-devolucoes-unificadas.js --service-account=/caminho/credencial.json
 */
const path = require('node:path');
const fs = require('node:fs');

const MODULO_NOVO = 'recebimento-devolucoes';
const MODULO_ANTIGO_1 = 'recebimento-consulta-notas';
const MODULO_ANTIGO_2 = 'recebimento-devolucoes-indicadores';
const ACOES_SEMPRE_FALSE = ['confirmar', 'relatorio_criar', 'relatorio_finalizar', 'estornar', 'excluir'];

function get(obj, pathStr) { return pathStr.split('.').reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), obj); }
function has(obj, pathStr) {
  const ks = pathStr.split('.'); let v = obj;
  for (const k of ks) { if (!v || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, k)) return false; v = v[k]; }
  return true;
}

// Pura — sem Firestore. Devolve null quando não há nada a fazer (já migrado
// ou sem nenhum módulo antigo), ou o plano de updates (dotted-path, prontos
// pra um .update() do Firestore — NUNCA .set(...,{merge:true}), que trata
// chave com ponto como campo literal em vez de aninhar) e os contadores de
// sanity check.
function calcularPlanoUsuario(a) {
  a = a || {};
  if (has(a, 'permissoes.' + MODULO_NOVO)) return { pulado: 'ja-tinha-modulo-novo' };
  const tinhaAntigo1 = has(a, 'permissoes.' + MODULO_ANTIGO_1);
  const tinhaAntigo2 = has(a, 'permissoes.' + MODULO_ANTIGO_2);
  if (!tinhaAntigo1 && !tinhaAntigo2) return { pulado: 'sem-modulo-antigo' };

  const visOld1 = get(a, 'permissoes.' + MODULO_ANTIGO_1 + '.visualizar') === true;
  const visOld2 = get(a, 'permissoes.' + MODULO_ANTIGO_2 + '.visualizar') === true;
  const importarOld = get(a, 'permissoes.' + MODULO_ANTIGO_1 + '.importar') === true;
  const exportarOld = get(a, 'permissoes.' + MODULO_ANTIGO_1 + '.exportar') === true;

  const updates = {};
  updates['permissoes.' + MODULO_NOVO + '.visualizar'] = visOld1 || visOld2;
  updates['permissoes.' + MODULO_NOVO + '.importar'] = importarOld;
  updates['permissoes.' + MODULO_NOVO + '.exportar'] = exportarOld;
  ACOES_SEMPRE_FALSE.forEach(acao => { updates['permissoes.' + MODULO_NOVO + '.' + acao] = false; });

  return { pulado: null, updates, visOld1, visOld2, importarOld, exportarOld };
}

async function main(db, APPLY) {
  console.log(APPLY ? '=== APPLY: gravação habilitada ===' : '=== DRY-RUN: nada será gravado ===');
  const snap = await db.collection('usuarios_acessos').get();
  let jaTinhaModuloNovo = 0, semModuloAntigo = 0, migrados = 0;
  let contVisualizarOld1 = 0, contVisualizarOld2 = 0, contVisualizarNovo = 0, contImportarNovo = 0, contExportarNovo = 0;
  const planos = [];
  for (const doc of snap.docs) {
    const a = doc.data() || {};
    const plano = calcularPlanoUsuario(a);
    if (plano.pulado === 'ja-tinha-modulo-novo') { jaTinhaModuloNovo++; continue; }
    if (plano.pulado === 'sem-modulo-antigo') { semModuloAntigo++; continue; }
    if (plano.visOld1) contVisualizarOld1++;
    if (plano.visOld2) contVisualizarOld2++;
    if (plano.visOld1 || plano.visOld2) contVisualizarNovo++;
    if (plano.importarOld) contImportarNovo++;
    if (plano.exportarOld) contExportarNovo++;
    migrados++;
    planos.push({ id: doc.id, email: a.email || '', updates: plano.updates });
  }

  console.log(`usuarios_acessos: ${snap.size}; já tinha módulo novo (pulado): ${jaTinhaModuloNovo}; sem nenhum módulo antigo (pulado): ${semModuloAntigo}; a migrar: ${migrados}`);
  console.log(`Sanity check (nunca pode alargar acesso): visualizar antigo-1=${contVisualizarOld1}, antigo-2=${contVisualizarOld2} → visualizar novo (união)=${contVisualizarNovo}; importar novo=${contImportarNovo}; exportar novo=${contExportarNovo}`);
  console.log(`Ações sempre false pra todo mundo migrado: ${ACOES_SEMPRE_FALSE.join(', ')}`);
  planos.slice(0, 20).forEach(x => console.log('-', x.id, x.email));
  if (planos.length > 20) console.log(`... +${planos.length - 20} usuário(s)`);

  if (!APPLY) { console.log('DRY-RUN concluído. Rode novamente com --apply somente após revisar o resumo.'); return; }
  for (let i = 0; i < planos.length; i += 400) {
    const batch = db.batch();
    for (const x of planos.slice(i, i + 400)) batch.update(db.collection('usuarios_acessos').doc(x.id), x.updates);
    await batch.commit();
    console.log(`Lote ${Math.floor(i / 400) + 1}: ${Math.min(400, planos.length - i)} usuário(s) gravados.`);
  }
  console.log('Migração de permissões concluída.');
}

module.exports = { get, has, calcularPlanoUsuario, MODULO_NOVO, MODULO_ANTIGO_1, MODULO_ANTIGO_2, ACOES_SEMPRE_FALSE, main };

if (require.main === module) {
  const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
  const APPLY = process.argv.includes('--apply');
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
  main(admin.firestore(), APPLY).catch(e => { console.error(e); process.exitCode = 1; });
}
