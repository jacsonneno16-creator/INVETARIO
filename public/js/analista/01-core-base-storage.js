(function(global){
  // ── Constante de negócio ────────────────────────────────────────────────────
  // MAX_CONTAGENS também está em AnalistaDivergenciaService — mantida aqui para
  // compatibilidade com chamadas legadas em arquivos não migrados.
  const MAX_CONTAGENS = 3;

  // ── Chaves do localStorage ──────────────────────────────────────────────────
  const KEYS = {
    inventarios:       'invcount_inventarios',
    contagens:         'invcount_contagens',
    divergencias:      'invcount_divergencias',
    recontagens:       'invcount_recontagens',
    enderecos:         'invcount_enderecos',
    logs:              'invcount_logs',
    auditorias:        'invcount_auditorias',
    auditoria_imports: 'invcount_auditoria_imports',
    config:            'invcount_config',
    coletores:         'dt_db_coletores',
  };

  // ── Storage ─────────────────────────────────────────────────────────────────
  function scopedKey(key){ const loja=(window.getDTLojaAtiva&&window.getDTLojaAtiva())||'sem_loja'; return `${key}__${loja}`; }

  /** Salva dado com timestamp (para detectar mudanças externas) */
  function storageSave(key, data){
    try {
      if (key === KEYS.auditorias && Array.isArray(data)){
        const slim = data.slice(-2000).map(a => ({
          id: a.id,
          auditoria_id: a.auditoria_id || '',
          auditoria_nome: a.auditoria_nome || '',
          endereco: a.endereco || '',
          endereco_norm: a.endereco_norm || '',
          rua: a.rua || '',
          itens_count: Array.isArray(a.itens) ? a.itens.length : 0,
          itens_confirmados_count: Array.isArray(a.itens_confirmados) ? a.itens_confirmados.length : 0,
          status: a.status || 'PENDENTE',
          importado_em: a.importado_em || '',
          importado_por: a.importado_por || '',
          confirmado_em: a.confirmado_em || '',
          confirmado_por: a.confirmado_por || '',
          com_ajuste: !!a.com_ajuste,
          reaberto_por_alteracao_base: !!a.reaberto_por_alteracao_base,
          liberada_coletor: !!a.liberada_coletor,
          disponivel_coletor: !!a.disponivel_coletor,
          origem: a.origem || '',
          local_estoque_auditoria: a.local_estoque_auditoria || '',
          assinatura_base: a.assinatura_base || ''
        }));
        localStorage.setItem(scopedKey(key), JSON.stringify({ v: slim, ts: Date.now() }));
        return;
      }
      if (key === KEYS.inventarios && Array.isArray(data)){
        // A base completa pode ter milhares de registros e exceder facilmente a
        // quota do localStorage. Persistimos apenas os metadados; a base é
        // recarregada dos base_chunks do Firestore pelo FirebaseService.
        const loja=(window.getDTLojaAtiva&&window.getDTLojaAtiva())||'sem_loja';
        const semBase = data.map(inv => { const { base, ...rest } = inv; return rest; });
        localStorage.setItem(scopedKey(key), JSON.stringify({ v: semBase, ts: Date.now() }));
        // Limpar caches antigos de base que causavam QuotaExceededError.
        try {
          const prefix=`invcount_base_${loja}_`;
          const apagar=[];
          for(let i=0;i<localStorage.length;i++){
            const k=localStorage.key(i); if(k&&k.indexOf(prefix)===0) apagar.push(k);
          }
          apagar.forEach(k=>localStorage.removeItem(k));
        } catch(_e){}
        return;
      }
      localStorage.setItem(scopedKey(key), JSON.stringify({ v: data, ts: Date.now() }));
    } catch(e){
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)){
        console.warn('[Storage] Limite local atingido; mantendo dados no Firebase e limpando caches grandes.');
        try{
          const apagar=[];
          for(let i=0;i<localStorage.length;i++){
            const k=localStorage.key(i); if(k&&k.indexOf('invcount_base_')===0) apagar.push(k);
          }
          apagar.forEach(k=>localStorage.removeItem(k));
        }catch(_e){}
      } else console.error('[Storage] Erro ao salvar', key, e);
    }
  }

  /** Carrega dado; retorna null se não existir */
  function storageLoad(key){
    try {
      const raw = localStorage.getItem(scopedKey(key));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const data = parsed && 'v' in parsed ? parsed.v : parsed;
      return data;
    } catch(e){ return null; }
  }

  /** Retorna o timestamp da última gravação de uma chave */
  function storageTs(key){
    try {
      const raw = localStorage.getItem(scopedKey(key));
      if (!raw) return 0;
      const parsed = JSON.parse(raw);
      return parsed?.ts || 0;
    } catch(e){ return 0; }
  }

  // ── Exportação do módulo ────────────────────────────────────────────────────
  const AnalistaStorage = { KEYS, storageSave, storageLoad, storageTs, MAX_CONTAGENS };
  global.AnalistaStorage = AnalistaStorage;

  // Aliases globais mantidos para compatibilidade com módulos ainda não migrados
  // (09-fs-publicar, 10-inventarios-negocio, 21-divergencias-recontagens, etc.)
  global.KEYS         = KEYS;
  global.storageSave  = storageSave;
  global.storageLoad  = storageLoad;
  global.storageTs    = storageTs;
  global.MAX_CONTAGENS = MAX_CONTAGENS;

  // _isFluxoEncerrado e obterRecontagemAtivaPorDivergencia foram movidos para
  // AnalistaDivergenciaService — aliases para compatibilidade com chamadas legadas
  global._isFluxoEncerrado = function(divOuRec){
    return global.AnalistaDivergenciaService?.isFluxoEncerrado(divOuRec) ?? false;
  };
  global._isPersistenteBloqueado = global._isFluxoEncerrado;
  global.obterRecontagemAtivaPorDivergencia = function(divergenciaId){
    return global.AnalistaDivergenciaService?.obterRecontagemAtivaPorDivergencia(divergenciaId) ?? null;
  };

  // atribuirRecontagemSegura foi movido para AnalistaRecontagemService (módulo próprio).
  // O alias abaixo garante que chamadas legadas continuem funcionando.
  global.atribuirRecontagemSegura = function(d, operador, atribPor, obs, agora){
    return global.AnalistaRecontagemService?.atribuirRecontagemSegura(d, operador, atribPor, obs, agora) ?? null;
  };
})(window);
