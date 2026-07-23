// ═══════════════════════════════════════════════════
//  🔥  FIREBASE CONFIG  — mesma config do analista
// ═══════════════════════════════════════════════════
const FIREBASE_CFG = window.DT_FIREBASE_CFG;
getDTFirebaseApp();
const FS   = getDTFirestore();
const AUTH = getDTAuth();
const FCOL = window.DT_FCOL;

// Mantém a sessão de autenticação no aparelho. Nunca executa logout automático na abertura.
window.DT_AUTH_READY = AUTH.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .catch(e => { console.warn('[Auth] Persistência LOCAL indisponível:', e.message); });

// ── Persistência offline das contagens ──
const _LOJA_CACHE = () => (window.getDTLojaAtiva&&window.getDTLojaAtiva()) || 'sem_loja';
const LS_FILA    = 'col_fila_envio_' + _LOJA_CACHE();
const LS_INV     = 'col_inventarios_' + _LOJA_CACHE();
const LS_BASE    = 'col_base_' + _LOJA_CACHE() + '_';
const LS_ENDCAP  = 'col_endcap_' + _LOJA_CACHE() + '_';
const LS_BVER    = 'col_bver_' + _LOJA_CACHE() + '_';
const LS_LOCAIS      = 'col_locais_' + _LOJA_CACHE();        // cache de dt_locais (capacidade + set)
const LS_LOCAIS_VER  = 'col_locais_ver_' + _LOJA_CACHE();    // versão do cache (compara com config/locais_meta)
const LS_LOCAIS_SET  = 'col_locais_set_' + _LOJA_CACHE();    // set de endereços válidos

// ─── Sentinel único para "vazio" ────────────────────────────────────────────
// Todo produto/gtin ausente é salvo como __VAZIO__, nunca null/undefined/"".
// O analista usa o mesmo valor em _normProduto() para comparar as contagens.
const PROD_VAZIO = '__VAZIO__';

// ─── Normalização de produto ─────────────────────────────────────────────────
// Aplicada em TODOS os pontos de leitura e gravação do código de produto.
// Garante que "abc123", "ABC123 " e "ABC123" sejam sempre idênticos.
function normProd(v) {
  if (v === null || v === undefined) return PROD_VAZIO;
  const s = String(v)
    .replace(/[\x00-\x1F\x7F]/g, '') // remove chars de controle do scanner
    .replace(/\s+/g, ' ')              // colapsa espaços múltiplos
    .trim()
    .toUpperCase();
  if (!s || s === 'NULL' || s === 'UNDEFINED' || s === 'NAN') return PROD_VAZIO;
  return s;
}
const APP_VERSION = '3.2.0';            // versão do aplicativo

// ══════════════════════════════════════════════════
//  NORMALIZAÇÃO DA BASE  (melhoria 1 e 2)
// ══════════════════════════════════════════════════

// Remove acentos, espaços extras e converte para uppercase
function _normStr(v) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // remove diacríticos
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

// Mapeamento de variantes de campo → nome canônico
const _FIELD_MAP = {
  // endereço
  'endereco': 'endereco', 'endereço': 'endereco',
  'ENDERECO': 'endereco', 'ENDEREÇO': 'endereco',
  'Endereco': 'endereco', 'Endereço': 'endereco',
  'end'     : 'endereco', 'END'      : 'endereco',
  'address' : 'endereco', 'ADDRESS'  : 'endereco',
  'local'   : 'endereco', 'LOCAL'    : 'endereco',
  'codigo_endereco':'endereco', 'CODIGO_ENDERECO':'endereco',
  'endereco_logistico_descritivo':'endereco', 'ENDERECO_LOGISTICO_DESCRITIVO':'endereco',
  'endereco_logistico_key':'endereco', 'ENDERECO_LOGISTICO_KEY':'endereco',
  // gtin
  'gtin'    : 'gtin',     'GTIN'     : 'gtin',
  'ean'     : 'gtin',     'EAN'      : 'gtin',
  'ean13'   : 'gtin',     'EAN13'    : 'gtin',
  'barcode' : 'gtin',     'BARCODE'  : 'gtin',
  'cod_barras':'gtin',    'COD_BARRAS':'gtin',
  // dun
  'dun'     : 'dun',      'DUN'      : 'dun',
  'dun14'   : 'dun',      'DUN14'    : 'dun',
  'ean14'   : 'dun',      'EAN14'    : 'dun',
  'caixa'   : 'dun',      'CAIXA'    : 'dun',
  // código produto
  'codigo_produto'  : 'codigo_produto',
  'CODIGO_PRODUTO'  : 'codigo_produto',
  'cod_produto'     : 'codigo_produto',
  'COD_PRODUTO'     : 'codigo_produto',
  'produto_codigo'  : 'codigo_produto',
  'PRODUTO_CODIGO'  : 'codigo_produto',
  'codigo'          : 'codigo_produto',
  'CODIGO'          : 'codigo_produto',
  'sku'             : 'codigo_produto',
  'SKU'             : 'codigo_produto',
  // descrição
  'descricao_produto' : 'descricao_produto',
  'DESCRICAO_PRODUTO' : 'descricao_produto',
  'descricao'         : 'descricao_produto',
  'DESCRICAO'         : 'descricao_produto',
  'descrição'         : 'descricao_produto',
  'DESCRIÇÃO'         : 'descricao_produto',
  'description'       : 'descricao_produto',
  'DESCRIPTION'       : 'descricao_produto',
  'produto'           : 'descricao_produto',
  'PRODUTO'           : 'descricao_produto',
  'nome_produto'      : 'descricao_produto',
  'NOME_PRODUTO'      : 'descricao_produto',
  // rua
  'rua'               : 'rua',
  'RUA'               : 'rua',
  'street'            : 'rua',
  'STREET'            : 'rua',
  'corredor'          : 'rua',
  'CORREDOR'          : 'rua',
  // data
  'data'              : 'data',
  'DATA'              : 'data',
  'validade'          : 'data',
  'VALIDADE'          : 'data',
  'data_validade'     : 'data',
  'DATA_VALIDADE'     : 'data',
  'data_de_validade'  : 'data',
  'DATA_DE_VALIDADE'  : 'data',
  // capa/palete
  'capa_palete'       : 'capa_palete',
  'CAPA_PALETE'       : 'capa_palete',
  'capa'              : 'capa_palete',
  'CAPA'              : 'capa_palete',
  'palete_key'        : 'capa_palete',
  'PALETE_KEY'        : 'capa_palete',
  // quantidade esperada
  'quantidade_esperada' : 'quantidade_esperada',
  'QUANTIDADE_ESPERADA' : 'quantidade_esperada',
  'qtd_esperada'        : 'quantidade_esperada',
  'QTD_ESPERADA'        : 'quantidade_esperada',
  'estoque'             : 'quantidade_esperada',
  'ESTOQUE'             : 'quantidade_esperada',
  'saldo'               : 'quantidade_esperada',
  'SALDO'               : 'quantidade_esperada',
  'quantidade_enderecada': 'quantidade_esperada',
  'QUANTIDADE_ENDERECADA': 'quantidade_esperada',
  'estoque_total_unidades': 'quantidade_esperada',
  'ESTOQUE_TOTAL_UNIDADES': 'quantidade_esperada',
  // capacidade pallets — sinônimos PT-BR e EN
  'capacidade_pallets'  : 'capacidade_pallets',
  'CAPACIDADE_PALLETS'  : 'capacidade_pallets',
  'capacidade_paletes'  : 'capacidade_pallets',
  'CAPACIDADE_PALETES'  : 'capacidade_pallets',
  'capacidade_palete'   : 'capacidade_pallets',
  'CAPACIDADE_PALETE'   : 'capacidade_pallets',
  'capacidade_pallet'   : 'capacidade_pallets',
  'CAPACIDADE_PALLET'   : 'capacidade_pallets',
  'capacidade'          : 'capacidade_pallets',
  'CAPACIDADE'          : 'capacidade_pallets',
  'cap_paletes'         : 'capacidade_pallets',
  'CAP_PALETES'         : 'capacidade_pallets',
  'max_pallets'         : 'capacidade_pallets',
  'MAX_PALLETS'         : 'capacidade_pallets',
  'max_paletes'         : 'capacidade_pallets',
  'MAX_PALETES'         : 'capacidade_pallets',
  'limite_capa'         : 'capacidade_pallets',
  'LIMITE_CAPA'         : 'capacidade_pallets',
  'cap_pallets'         : 'capacidade_pallets',
  'CAP_PALLETS'         : 'capacidade_pallets',
  'limite_pallets'      : 'capacidade_pallets',
  'LIMITE_PALLETS'      : 'capacidade_pallets',
  'limite_paletes'      : 'capacidade_pallets',
  'LIMITE_PALETES'      : 'capacidade_pallets',
};

/**
 * Normaliza um registro da base:
 *  1. Remapeia chaves variantes → chaves canônicas
 *  2. Normaliza o valor de `endereco` (sem acentos, maiúsculo)
 *  3. Garante que _end (chave de busca rápida) existe
 */
function _normRecord(raw) {
  const r = {};
  for (const [k, v] of Object.entries(raw)) {
    const canon = _FIELD_MAP[k] || k;
    // Se já existe a chave canônica e o novo valor está vazio, não sobrescrever
    if (r[canon] !== undefined && (v === null || v === undefined || v === '')) continue;
    r[canon] = v;
  }
  // Normalizar o campo endereço para busca
  r._end = _normStr(r.endereco || '');
  return r;
}

/**
 * Normaliza a base inteira após download.
 * Retorna novo array já normalizado e adiciona _end em cada registro.
 */
function normalizarBase(base) {
  if (!Array.isArray(base)) return [];
  return base.map(_normRecord);
}

// ── Cache local da base (salva em chunks para evitar cota) ──
function baseSave(invId, base) {
  try {
    const CHK = 1000;
    const nChunks = Math.ceil(base.length / CHK);
    localStorage.setItem(LS_BASE + invId + '_meta',
      JSON.stringify({ total: base.length, chunks: nChunks, ts: Date.now() }));
    for (let i = 0; i < nChunks; i++) {
      localStorage.setItem(LS_BASE + invId + '_' + i,
        JSON.stringify(base.slice(i * CHK, (i + 1) * CHK)));
    }
  } catch(e) { console.warn('[base] localStorage:', e.message); }
}

function baseLoad(invId) {
  try {
    const meta = localStorage.getItem(LS_BASE + invId + '_meta');
    if (!meta) return null;
    const { chunks } = JSON.parse(meta);
    const result = [];
    for (let i = 0; i < chunks; i++) {
      const r = localStorage.getItem(LS_BASE + invId + '_' + i);
      if (!r) return null;
      result.push(...JSON.parse(r));
    }
    return result;
  } catch(e) { return null; }
}

function baseMetaLoad(invId) {
  try {
    const m = localStorage.getItem(LS_BASE + invId + '_meta');
    return m ? JSON.parse(m) : null;
  } catch(e) { return null; }
}

// ── Versão da base salva localmente ──
function bVerSave(invId, ver) {
  try { localStorage.setItem(LS_BVER + invId, String(ver || '')); } catch(e) {}
}
function bVerLoad(invId) {
  return localStorage.getItem(LS_BVER + invId) || '';
}


// ── Capacidade de pallets por endereço ──

/**
 * Constrói o mapa endereço → capacidade a partir de qualquer array de registros.
 * Testa todos os nomes de campo possíveis (PT-BR e EN) para máxima compatibilidade
 * com diferentes formatos de planilha.
 * Pode ser chamado tanto no download quanto ao carregar do cache.
 */
function _recalcularEndCap(base) {
  const CAP_FIELDS = [
    'capacidade_pallets','capacidade_paletes','capacidade_palete','capacidade_pallet',
    'capacidade','cap_pallets','cap_paletes','max_pallets','max_paletes',
    'limite_capa','limite_pallets','limite_paletes',
    'CAPACIDADE_PALLETS','CAPACIDADE_PALETES','CAPACIDADE','CAP_PALLETS','CAP_PALETES',
  ];
  const _lerCap = r => {
    for (const f of CAP_FIELDS) {
      const v = parseInt(r[f]);
      if (v > 0) return v;
    }
    return 0;
  };
  const mapa = {};
  (base || []).forEach(r => {
    const end = r._end;
    if (!end) return;
    const cap = _lerCap(r);
    if (cap > 0 && (!mapa[end] || cap > mapa[end])) mapa[end] = cap;
    else if (!(end in mapa)) mapa[end] = 0;
  });
  return mapa;
}

function endCapSave(invId, mapa) {
  try { localStorage.setItem(LS_ENDCAP + invId, JSON.stringify(mapa)); } catch(e) {}
}
function endCapLoad(invId) {
  try {
    const r = localStorage.getItem(LS_ENDCAP + invId);
    return r ? JSON.parse(r) : {};
  } catch(e) { return {}; }
}

// ════════════════════════════════════════════════════════════════
//  IDB — IndexedDB como camada primária de persistência da fila
//  localStorage permanece como espelho de emergência
// ════════════════════════════════════════════════════════════════
const IDB_NAME    = 'dt_coletor_db';
const IDB_VERSION = 3;   // v3: recria o banco se a store estiver ausente (corrige corrupção)
const IDB_STORE   = 'contagens_pendentes';

let _idb = null;   // instância aberta do IDB

/** Apaga e recria o banco IDB do zero. Usado como recovery de corrupção. */
function _idbRecriar() {
  _idb = null;
  return new Promise((resolve, reject) => {
    const del = indexedDB.deleteDatabase(IDB_NAME);
    del.onsuccess = () => {
      dbg('[IDB] Banco apagado — recriando...');
      const req2 = indexedDB.open(IDB_NAME, IDB_VERSION);
      req2.onupgradeneeded = e => {
        const db = e.target.result;
        const store = db.createObjectStore(IDB_STORE, { keyPath: 'uuid' });
        store.createIndex('status_sync',   'status_sync',   { unique: false });
        store.createIndex('inventario_id', 'inventario_id', { unique: false });
      };
      req2.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
      req2.onerror   = e => reject(e.target.error);
    };
    del.onerror = e => reject(e.target.error);
  });
}

/** Abre (ou cria) o banco IndexedDB. Retorna Promise<IDBDatabase>. */
function idbOpen() {
  if (_idb) return Promise.resolve(_idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      // Criar a store se não existir (primeira vez ou migração de versão)
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const store = db.createObjectStore(IDB_STORE, { keyPath: 'uuid' });
        store.createIndex('status_sync',   'status_sync',   { unique: false });
        store.createIndex('inventario_id', 'inventario_id', { unique: false });
      } else {
        // Garantir índices em migração
        const tx    = e.target.transaction;
        const store = tx.objectStore(IDB_STORE);
        if (!store.indexNames.contains('status_sync')) {
          store.createIndex('status_sync',   'status_sync',   { unique: false });
        }
        if (!store.indexNames.contains('inventario_id')) {
          store.createIndex('inventario_id', 'inventario_id', { unique: false });
        }
      }
    };
    req.onsuccess = e => {
      const db = e.target.result;
      // Verificar se a store existe de fato após abertura (proteção contra corrupção)
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.close();
        _idb = null;
        console.warn('[IDB] Store ausente após abertura — recriando banco...');
        _idbRecriar().then(resolve).catch(reject);
        return;
      }
      _idb = db;
      resolve(_idb);
    };
    req.onerror   = e => {
      console.warn('[IDB] Falha ao abrir:', e.target.error);
      reject(e.target.error);
    };
    req.onblocked = () => {
      console.warn('[IDB] Banco bloqueado por outra aba. Feche outras abas e recarregue.');
    };
  });
}

/** Salva (ou sobrescreve) uma contagem no IDB. */
async function idbPut(contagem) {
  try {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req   = store.put(contagem);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  } catch(e) {
    console.warn('[IDB] idbPut falhou:', e);
  }
}

/** Remove uma contagem do IDB pelo uuid. */
async function idbDelete(uuid) {
  try {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req   = store.delete(uuid);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  } catch(e) {
    console.warn('[IDB] idbDelete falhou:', e);
  }
}

/** Lê todas as contagens com status_sync = 'pendente'. */
async function idbGetPendentes() {
  try {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const idx   = store.index('status_sync');
      const req   = idx.getAll('pendente');
      req.onsuccess = e => resolve(e.target.result || []);
      req.onerror   = e => reject(e.target.error);
    });
  } catch(e) {
    console.warn('[IDB] idbGetPendentes falhou:', e);
    return [];
  }
}

/** Lê TODAS as contagens do IDB (para rebuild do array em memória). */
async function idbGetAll() {
  try {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req   = store.getAll();
      req.onsuccess = e => resolve(e.target.result || []);
      req.onerror   = e => reject(e.target.error);
    });
  } catch(e) {
    console.warn('[IDB] idbGetAll falhou:', e);
    return [];
  }
}

/** Verifica se um uuid já existe no IDB (anti-duplicata). */
async function idbExists(uuid) {
  try {
    const db = await idbOpen();
    return new Promise((resolve) => {
      const tx    = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req   = store.get(uuid);
      req.onsuccess = e => resolve(!!e.target.result);
      req.onerror   = () => resolve(false);
    });
  } catch(e) { return false; }
}

// ── localStorage: espelho de emergência + compatibilidade ──
function filaSave(fila) {
  try { localStorage.setItem(LS_FILA, JSON.stringify(fila)); } catch(e) {}
}
function filaLoad() {
  try {
    const r = localStorage.getItem(LS_FILA);
    return r ? JSON.parse(r) : [];
  } catch(e) { return []; }
}

/** Gera UUID único para cada contagem (anti-duplicata). */
function gerarUUID() {
  // crypto.randomUUID se disponível, senão fallback manual
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * Inicializa o IDB e migra contagens antigas do localStorage para o IDB.
 * Chamado uma vez na inicialização do app.
 */
async function idbInit() {
  try {
    await idbOpen();

    // Migrar fila antiga do localStorage (se existir) para o IDB
    const filaLS = filaLoad();
    if (filaLS.length > 0) {
      dbg(`[IDB] Migrando ${filaLS.length} contagens do localStorage → IDB`);
      for (const c of filaLS) {
        const uuid = c.uuid || gerarUUID();
        const record = {
          ...c,
          uuid,
          status_sync: c.status_sync || 'pendente',
          tentativas:  c.tentativas  || 0,
          criado_em:   c.criado_em   || c.dataHora || new Date().toISOString(),
        };
        await idbPut(record);
      }
      // Limpa espelho após migração bem-sucedida
      try { localStorage.removeItem(LS_FILA); } catch(e) {}
    }

    // Rebuild FILA_ENVIO a partir do IDB
    const pendentes = await idbGetPendentes();
    FILA_ENVIO = pendentes;
    filaSave(FILA_ENVIO);   // atualiza espelho LS
    dbg(`[IDB] Pronto. ${FILA_ENVIO.length} contagens pendentes recuperadas.`);
    atualizarBarraStatus();
  } catch(e) {
    console.warn('[IDB] init falhou, continuando com localStorage:', e);
    FILA_ENVIO = filaLoad();
  }
}
function invCacheLoad() {
  try {
    const r = localStorage.getItem(LS_INV);
    return r ? JSON.parse(r) : [];
  } catch(e) { return []; }
}
function invCacheSave(list) {
  try { localStorage.setItem(LS_INV, JSON.stringify(list)); } catch(e) {}
}

/**
 * Remove do localStorage o cache de bases de inventários que
 * não existem mais no Firestore (foram excluídos pelo analista).
 * Também desconecta o operador do inventário atual se ele foi excluído.
 */
function limparInventariosObsoletos(idsAtivos) {
  if (!Array.isArray(idsAtivos)) return;
  const idsSet = new Set(idsAtivos);

  // Verificar se o inventário atual foi removido
  if (APP.inventario && !idsSet.has(APP.inventario.id)) {
    console.warn('[cache] Inventário atual foi excluído do Firestore:', APP.inventario.id);
    toast('⚠️ O inventário atual foi encerrado pelo analista. Retornando à seleção...', 'w');
    APP.inventario = null;
    APP.base       = [];
    setTimeout(() => voltarInventarios(), 2200);
  }

  // Encontrar todos os prefixos de base no localStorage que NÃO estão em idsAtivos
  const keysToDelete = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    // Padrões: col_base_{invId}_meta, col_base_{invId}_N, col_bver_{invId}, col_endcap_{invId}
    const prefixes = [LS_BASE, LS_BVER, LS_ENDCAP];
    for (const prefix of prefixes) {
      if (key.startsWith(prefix)) {
        // Extrair invId: remove o prefixo e pega o que sobra antes de _ ou no fim
        const rest = key.slice(prefix.length);
        // invId pode ter _ dentro (ex: col_base_INV2026_001_meta)
        // A heurística: o invId é tudo até o padrão _meta ou _N (dígitos)
        const invId = rest.replace(/_meta$/, '').replace(/_\d+$/, '');
        if (invId && !idsSet.has(invId)) {
          keysToDelete.push(key);
        }
        break;
      }
    }
  }

  if (keysToDelete.length > 0) {
    keysToDelete.forEach(k => {
      try { localStorage.removeItem(k); } catch(e) {}
    });
    dbg('[cache] Limpos', keysToDelete.length, 'chaves de inventários obsoletos');
  }
}

// Fila de contagens aguardando envio
let FILA_ENVIO = filaLoad();

// ── Indicador de conectividade / fila ──
function atualizarBarraStatus() {
  const bar     = document.getElementById('sync-bar');
  const barText = document.getElementById('sync-bar-text');
  const barSpin = document.getElementById('sync-bar-spinner');
  const pill    = document.getElementById('conn-pill');
  const dot     = document.getElementById('conn-dot');
  const label   = document.getElementById('conn-label');

  const online  = navigator.onLine;
  const pending = FILA_ENVIO.length;

  // ── Atualiza o PILL do header ──────────────────────────────
  if (pill && dot && label) {
    if (!online) {
      pill.style.background    = 'rgba(255,71,87,.12)';
      pill.style.borderColor   = 'rgba(255,71,87,.3)';
      pill.style.color         = 'var(--danger)';
      dot.style.background     = 'var(--danger)';
      dot.style.boxShadow      = '0 0 6px var(--danger)';
      label.textContent        = pending > 0 ? `📵 ${pending} na fila` : '📵 Offline';
    } else if (pending > 0) {
      pill.style.background    = 'rgba(255,179,0,.12)';
      pill.style.borderColor   = 'rgba(255,179,0,.3)';
      pill.style.color         = 'var(--warn)';
      dot.style.background     = 'var(--warn)';
      dot.style.boxShadow      = '0 0 6px var(--warn)';
      label.textContent        = `⬆ ${pending} pend.`;
      // animação de pulso no dot
      dot.style.animation      = 'pulse-dot 1s ease-in-out infinite';
    } else {
      pill.style.background    = 'rgba(0,214,143,.12)';
      pill.style.borderColor   = 'rgba(0,214,143,.3)';
      pill.style.color         = 'var(--success)';
      dot.style.background     = 'var(--success)';
      dot.style.boxShadow      = '0 0 6px var(--success)';
      dot.style.animation      = '';
      label.textContent        = '✓ Online';
    }
  }

  // ── Atualiza a BARRA de sincronização ──────────────────────
  if (!bar) return;
  if (!online) {
    bar.style.display    = 'flex';
    bar.style.background = 'linear-gradient(90deg,#7c2d12,#92400e)';
    if (barText) barText.textContent = `📵 Sem internet — ${pending} contagem(ns) salva(s) localmente`;
    if (barSpin) barSpin.textContent = '💾';
  } else if (pending > 0) {
    bar.style.display    = 'flex';
    bar.style.background = 'linear-gradient(90deg,#1e3a8a,#1d4ed8)';
    if (barText) barText.textContent = `⬆️ Sincronizando ${pending} contagem(ns) com Firebase…`;
    if (barSpin) barSpin.textContent = '🔄';
  } else {
    // Mostra "tudo certo" e some
    bar.style.background = 'linear-gradient(90deg,#14532d,#166534)';
    if (barText) barText.textContent = `✅ Firebase sincronizado — todas as contagens enviadas`;
    if (barSpin) barSpin.textContent = '';
    setTimeout(() => { if (bar && FILA_ENVIO.length === 0) bar.style.display = 'none'; }, 3000);
  }
}

