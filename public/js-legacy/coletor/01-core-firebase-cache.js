var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
// ═══════════════════════════════════════════════════
//  🔥  FIREBASE CONFIG  — mesma config do analista
// ═══════════════════════════════════════════════════
var FIREBASE_CFG = window.DT_FIREBASE_CFG;
getDTFirebaseApp();
var FS = getDTFirestore();
var AUTH = getDTAuth();
var FCOL = window.DT_FCOL;
// Mantém a sessão de autenticação no aparelho. Nunca executa logout automático na abertura.
window.DT_AUTH_READY = AUTH.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .catch(function (e) { console.warn('[Auth] Persistência LOCAL indisponível:', e.message); });
// ── Persistência offline das contagens ──
var _LOJA_CACHE = function () { return (window.getDTLojaAtiva && window.getDTLojaAtiva()) || 'sem_loja'; };
var LS_FILA = 'col_fila_envio_' + _LOJA_CACHE();
var LS_INV = 'col_inventarios_' + _LOJA_CACHE();
var LS_BASE = 'col_base_' + _LOJA_CACHE() + '_';
var LS_ENDCAP = 'col_endcap_' + _LOJA_CACHE() + '_';
var LS_BVER = 'col_bver_' + _LOJA_CACHE() + '_';
var LS_LOCAIS = 'col_locais_' + _LOJA_CACHE(); // cache de dt_locais (capacidade + set)
var LS_LOCAIS_VER = 'col_locais_ver_' + _LOJA_CACHE(); // versão do cache (compara com config/locais_meta)
var LS_LOCAIS_SET = 'col_locais_set_' + _LOJA_CACHE(); // set de endereços válidos
// ─── Sentinel único para "vazio" ────────────────────────────────────────────
// Todo produto/gtin ausente é salvo como __VAZIO__, nunca null/undefined/"".
// O analista usa o mesmo valor em _normProduto() para comparar as contagens.
var PROD_VAZIO = '__VAZIO__';
// ─── Normalização de produto ─────────────────────────────────────────────────
// Aplicada em TODOS os pontos de leitura e gravação do código de produto.
// Garante que "abc123", "ABC123 " e "ABC123" sejam sempre idênticos.
function normProd(v) {
    if (v === null || v === undefined)
        return PROD_VAZIO;
    var s = String(v)
        .replace(/[\x00-\x1F\x7F]/g, '') // remove chars de controle do scanner
        .replace(/\s+/g, ' ') // colapsa espaços múltiplos
        .trim()
        .toUpperCase();
    if (!s || s === 'NULL' || s === 'UNDEFINED' || s === 'NAN')
        return PROD_VAZIO;
    return s;
}
var APP_VERSION = '3.2.0'; // versão do aplicativo
// ══════════════════════════════════════════════════
//  NORMALIZAÇÃO DA BASE  (melhoria 1 e 2)
// ══════════════════════════════════════════════════
// Remove acentos, espaços extras e converte para uppercase
function _normStr(v) {
    return String(v || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // remove diacríticos
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}
// Mapeamento de variantes de campo → nome canônico
var _FIELD_MAP = {
    // endereço
    'endereco': 'endereco', 'endereço': 'endereco',
    'ENDERECO': 'endereco', 'ENDEREÇO': 'endereco',
    'Endereco': 'endereco', 'Endereço': 'endereco',
    'end': 'endereco', 'END': 'endereco',
    'address': 'endereco', 'ADDRESS': 'endereco',
    'local': 'endereco', 'LOCAL': 'endereco',
    'codigo_endereco': 'endereco', 'CODIGO_ENDERECO': 'endereco',
    'endereco_logistico_descritivo': 'endereco', 'ENDERECO_LOGISTICO_DESCRITIVO': 'endereco',
    'endereco_logistico_key': 'endereco', 'ENDERECO_LOGISTICO_KEY': 'endereco',
    // gtin
    'gtin': 'gtin', 'GTIN': 'gtin',
    'ean': 'gtin', 'EAN': 'gtin',
    'ean13': 'gtin', 'EAN13': 'gtin',
    'barcode': 'gtin', 'BARCODE': 'gtin',
    'cod_barras': 'gtin', 'COD_BARRAS': 'gtin',
    // dun
    'dun': 'dun', 'DUN': 'dun',
    'dun14': 'dun', 'DUN14': 'dun',
    'ean14': 'dun', 'EAN14': 'dun',
    'caixa': 'dun', 'CAIXA': 'dun',
    // código produto
    'codigo_produto': 'codigo_produto',
    'CODIGO_PRODUTO': 'codigo_produto',
    'cod_produto': 'codigo_produto',
    'COD_PRODUTO': 'codigo_produto',
    'produto_codigo': 'codigo_produto',
    'PRODUTO_CODIGO': 'codigo_produto',
    'codigo': 'codigo_produto',
    'CODIGO': 'codigo_produto',
    'sku': 'codigo_produto',
    'SKU': 'codigo_produto',
    // descrição
    'descricao_produto': 'descricao_produto',
    'DESCRICAO_PRODUTO': 'descricao_produto',
    'descricao': 'descricao_produto',
    'DESCRICAO': 'descricao_produto',
    'descrição': 'descricao_produto',
    'DESCRIÇÃO': 'descricao_produto',
    'description': 'descricao_produto',
    'DESCRIPTION': 'descricao_produto',
    'produto': 'descricao_produto',
    'PRODUTO': 'descricao_produto',
    'nome_produto': 'descricao_produto',
    'NOME_PRODUTO': 'descricao_produto',
    // rua
    'rua': 'rua',
    'RUA': 'rua',
    'street': 'rua',
    'STREET': 'rua',
    'corredor': 'rua',
    'CORREDOR': 'rua',
    // data
    'data': 'data',
    'DATA': 'data',
    'validade': 'data',
    'VALIDADE': 'data',
    'data_validade': 'data',
    'DATA_VALIDADE': 'data',
    'data_de_validade': 'data',
    'DATA_DE_VALIDADE': 'data',
    // capa/palete
    'capa_palete': 'capa_palete',
    'CAPA_PALETE': 'capa_palete',
    'capa': 'capa_palete',
    'CAPA': 'capa_palete',
    'palete_key': 'capa_palete',
    'PALETE_KEY': 'capa_palete',
    // quantidade esperada
    'quantidade_esperada': 'quantidade_esperada',
    'QUANTIDADE_ESPERADA': 'quantidade_esperada',
    'qtd_esperada': 'quantidade_esperada',
    'QTD_ESPERADA': 'quantidade_esperada',
    'estoque': 'quantidade_esperada',
    'ESTOQUE': 'quantidade_esperada',
    'saldo': 'quantidade_esperada',
    'SALDO': 'quantidade_esperada',
    'quantidade_enderecada': 'quantidade_esperada',
    'QUANTIDADE_ENDERECADA': 'quantidade_esperada',
    'estoque_total_unidades': 'quantidade_esperada',
    'ESTOQUE_TOTAL_UNIDADES': 'quantidade_esperada',
    // capacidade pallets — sinônimos PT-BR e EN
    'capacidade_pallets': 'capacidade_pallets',
    'CAPACIDADE_PALLETS': 'capacidade_pallets',
    'capacidade_paletes': 'capacidade_pallets',
    'CAPACIDADE_PALETES': 'capacidade_pallets',
    'capacidade_palete': 'capacidade_pallets',
    'CAPACIDADE_PALETE': 'capacidade_pallets',
    'capacidade_pallet': 'capacidade_pallets',
    'CAPACIDADE_PALLET': 'capacidade_pallets',
    'capacidade': 'capacidade_pallets',
    'CAPACIDADE': 'capacidade_pallets',
    'cap_paletes': 'capacidade_pallets',
    'CAP_PALETES': 'capacidade_pallets',
    'max_pallets': 'capacidade_pallets',
    'MAX_PALLETS': 'capacidade_pallets',
    'max_paletes': 'capacidade_pallets',
    'MAX_PALETES': 'capacidade_pallets',
    'limite_capa': 'capacidade_pallets',
    'LIMITE_CAPA': 'capacidade_pallets',
    'cap_pallets': 'capacidade_pallets',
    'CAP_PALLETS': 'capacidade_pallets',
    'limite_pallets': 'capacidade_pallets',
    'LIMITE_PALLETS': 'capacidade_pallets',
    'limite_paletes': 'capacidade_pallets',
    'LIMITE_PALETES': 'capacidade_pallets',
};
/**
 * Normaliza um registro da base:
 *  1. Remapeia chaves variantes → chaves canônicas
 *  2. Normaliza o valor de `endereco` (sem acentos, maiúsculo)
 *  3. Garante que _end (chave de busca rápida) existe
 */
function _normRecord(raw) {
    var r = {};
    for (var _i = 0, _a = Object.entries(raw); _i < _a.length; _i++) {
        var _b = _a[_i], k = _b[0], v = _b[1];
        var canon = _FIELD_MAP[k] || k;
        // Se já existe a chave canônica e o novo valor está vazio, não sobrescrever
        if (r[canon] !== undefined && (v === null || v === undefined || v === ''))
            continue;
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
    if (!Array.isArray(base))
        return [];
    return base.map(_normRecord);
}
// ── Cache local da base (salva em chunks para evitar cota) ──
function baseSave(invId, base) {
    try {
        var CHK = 1000;
        var nChunks = Math.ceil(base.length / CHK);
        localStorage.setItem(LS_BASE + invId + '_meta', JSON.stringify({ total: base.length, chunks: nChunks, ts: Date.now() }));
        for (var i = 0; i < nChunks; i++) {
            localStorage.setItem(LS_BASE + invId + '_' + i, JSON.stringify(base.slice(i * CHK, (i + 1) * CHK)));
        }
    }
    catch (e) {
        console.warn('[base] localStorage:', e.message);
    }
}
function baseLoad(invId) {
    try {
        var meta = localStorage.getItem(LS_BASE + invId + '_meta');
        if (!meta)
            return null;
        var chunks = JSON.parse(meta).chunks;
        var result = [];
        for (var i = 0; i < chunks; i++) {
            var r = localStorage.getItem(LS_BASE + invId + '_' + i);
            if (!r)
                return null;
            result.push.apply(result, JSON.parse(r));
        }
        return result;
    }
    catch (e) {
        return null;
    }
}
function baseMetaLoad(invId) {
    try {
        var m = localStorage.getItem(LS_BASE + invId + '_meta');
        return m ? JSON.parse(m) : null;
    }
    catch (e) {
        return null;
    }
}
// ── Versão da base salva localmente ──
function bVerSave(invId, ver) {
    try {
        localStorage.setItem(LS_BVER + invId, String(ver || ''));
    }
    catch (e) { }
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
    var CAP_FIELDS = [
        'capacidade_pallets', 'capacidade_paletes', 'capacidade_palete', 'capacidade_pallet',
        'capacidade', 'cap_pallets', 'cap_paletes', 'max_pallets', 'max_paletes',
        'limite_capa', 'limite_pallets', 'limite_paletes',
        'CAPACIDADE_PALLETS', 'CAPACIDADE_PALETES', 'CAPACIDADE', 'CAP_PALLETS', 'CAP_PALETES',
    ];
    var _lerCap = function (r) {
        for (var _i = 0, CAP_FIELDS_1 = CAP_FIELDS; _i < CAP_FIELDS_1.length; _i++) {
            var f = CAP_FIELDS_1[_i];
            var v = parseInt(r[f]);
            if (v > 0)
                return v;
        }
        return 0;
    };
    var mapa = {};
    (base || []).forEach(function (r) {
        var end = r._end;
        if (!end)
            return;
        var cap = _lerCap(r);
        if (cap > 0 && (!mapa[end] || cap > mapa[end]))
            mapa[end] = cap;
        else if (!(end in mapa))
            mapa[end] = 0;
    });
    return mapa;
}
function endCapSave(invId, mapa) {
    try {
        localStorage.setItem(LS_ENDCAP + invId, JSON.stringify(mapa));
    }
    catch (e) { }
}
function endCapLoad(invId) {
    try {
        var r = localStorage.getItem(LS_ENDCAP + invId);
        return r ? JSON.parse(r) : {};
    }
    catch (e) {
        return {};
    }
}
// ════════════════════════════════════════════════════════════════
//  IDB — IndexedDB como camada primária de persistência da fila
//  localStorage permanece como espelho de emergência
// ════════════════════════════════════════════════════════════════
var IDB_NAME = 'dt_coletor_db';
var IDB_VERSION = 3; // v3: recria o banco se a store estiver ausente (corrige corrupção)
var IDB_STORE = 'contagens_pendentes';
var _idb = null; // instância aberta do IDB
/** Apaga e recria o banco IDB do zero. Usado como recovery de corrupção. */
function _idbRecriar() {
    _idb = null;
    return new Promise(function (resolve, reject) {
        var del = indexedDB.deleteDatabase(IDB_NAME);
        del.onsuccess = function () {
            dbg('[IDB] Banco apagado — recriando...');
            var req2 = indexedDB.open(IDB_NAME, IDB_VERSION);
            req2.onupgradeneeded = function (e) {
                var db = e.target.result;
                var store = db.createObjectStore(IDB_STORE, { keyPath: 'uuid' });
                store.createIndex('status_sync', 'status_sync', { unique: false });
                store.createIndex('inventario_id', 'inventario_id', { unique: false });
            };
            req2.onsuccess = function (e) { _idb = e.target.result; resolve(_idb); };
            req2.onerror = function (e) { return reject(e.target.error); };
        };
        del.onerror = function (e) { return reject(e.target.error); };
    });
}
/** Abre (ou cria) o banco IndexedDB. Retorna Promise<IDBDatabase>. */
function idbOpen() {
    if (_idb)
        return Promise.resolve(_idb);
    return new Promise(function (resolve, reject) {
        var req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = function (e) {
            var db = e.target.result;
            // Criar a store se não existir (primeira vez ou migração de versão)
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                var store = db.createObjectStore(IDB_STORE, { keyPath: 'uuid' });
                store.createIndex('status_sync', 'status_sync', { unique: false });
                store.createIndex('inventario_id', 'inventario_id', { unique: false });
            }
            else {
                // Garantir índices em migração
                var tx = e.target.transaction;
                var store = tx.objectStore(IDB_STORE);
                if (!store.indexNames.contains('status_sync')) {
                    store.createIndex('status_sync', 'status_sync', { unique: false });
                }
                if (!store.indexNames.contains('inventario_id')) {
                    store.createIndex('inventario_id', 'inventario_id', { unique: false });
                }
            }
        };
        req.onsuccess = function (e) {
            var db = e.target.result;
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
        req.onerror = function (e) {
            console.warn('[IDB] Falha ao abrir:', e.target.error);
            reject(e.target.error);
        };
        req.onblocked = function () {
            console.warn('[IDB] Banco bloqueado por outra aba. Feche outras abas e recarregue.');
        };
    });
}
/** Salva (ou sobrescreve) uma contagem no IDB. */
function idbPut(contagem) {
    return __awaiter(this, void 0, void 0, function () {
        var db_1, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, idbOpen()];
                case 1:
                    db_1 = _a.sent();
                    return [2 /*return*/, new Promise(function (resolve, reject) {
                            var tx = db_1.transaction(IDB_STORE, 'readwrite');
                            var store = tx.objectStore(IDB_STORE);
                            var req = store.put(contagem);
                            req.onsuccess = function () { return resolve(); };
                            req.onerror = function (e) { return reject(e.target.error); };
                        })];
                case 2:
                    e_1 = _a.sent();
                    console.warn('[IDB] idbPut falhou:', e_1);
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/** Remove uma contagem do IDB pelo uuid. */
function idbDelete(uuid) {
    return __awaiter(this, void 0, void 0, function () {
        var db_2, e_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, idbOpen()];
                case 1:
                    db_2 = _a.sent();
                    return [2 /*return*/, new Promise(function (resolve, reject) {
                            var tx = db_2.transaction(IDB_STORE, 'readwrite');
                            var store = tx.objectStore(IDB_STORE);
                            var req = store.delete(uuid);
                            req.onsuccess = function () { return resolve(); };
                            req.onerror = function (e) { return reject(e.target.error); };
                        })];
                case 2:
                    e_2 = _a.sent();
                    console.warn('[IDB] idbDelete falhou:', e_2);
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/** Lê todas as contagens com status_sync = 'pendente'. */
function idbGetPendentes() {
    return __awaiter(this, void 0, void 0, function () {
        var db_3, e_3;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, idbOpen()];
                case 1:
                    db_3 = _a.sent();
                    return [2 /*return*/, new Promise(function (resolve, reject) {
                            var tx = db_3.transaction(IDB_STORE, 'readonly');
                            var store = tx.objectStore(IDB_STORE);
                            var idx = store.index('status_sync');
                            var req = idx.getAll('pendente');
                            req.onsuccess = function (e) { return resolve(e.target.result || []); };
                            req.onerror = function (e) { return reject(e.target.error); };
                        })];
                case 2:
                    e_3 = _a.sent();
                    console.warn('[IDB] idbGetPendentes falhou:', e_3);
                    return [2 /*return*/, []];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/** Lê TODAS as contagens do IDB (para rebuild do array em memória). */
function idbGetAll() {
    return __awaiter(this, void 0, void 0, function () {
        var db_4, e_4;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, idbOpen()];
                case 1:
                    db_4 = _a.sent();
                    return [2 /*return*/, new Promise(function (resolve, reject) {
                            var tx = db_4.transaction(IDB_STORE, 'readonly');
                            var store = tx.objectStore(IDB_STORE);
                            var req = store.getAll();
                            req.onsuccess = function (e) { return resolve(e.target.result || []); };
                            req.onerror = function (e) { return reject(e.target.error); };
                        })];
                case 2:
                    e_4 = _a.sent();
                    console.warn('[IDB] idbGetAll falhou:', e_4);
                    return [2 /*return*/, []];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/** Verifica se um uuid já existe no IDB (anti-duplicata). */
function idbExists(uuid) {
    return __awaiter(this, void 0, void 0, function () {
        var db_5, e_5;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, idbOpen()];
                case 1:
                    db_5 = _a.sent();
                    return [2 /*return*/, new Promise(function (resolve) {
                            var tx = db_5.transaction(IDB_STORE, 'readonly');
                            var store = tx.objectStore(IDB_STORE);
                            var req = store.get(uuid);
                            req.onsuccess = function (e) { return resolve(!!e.target.result); };
                            req.onerror = function () { return resolve(false); };
                        })];
                case 2:
                    e_5 = _a.sent();
                    return [2 /*return*/, false];
                case 3: return [2 /*return*/];
            }
        });
    });
}
// ── localStorage: espelho de emergência + compatibilidade ──
function filaSave(fila) {
    try {
        localStorage.setItem(LS_FILA, JSON.stringify(fila));
    }
    catch (e) { }
}
function filaLoad() {
    try {
        var r = localStorage.getItem(LS_FILA);
        return r ? JSON.parse(r) : [];
    }
    catch (e) {
        return [];
    }
}
/** Gera UUID único para cada contagem (anti-duplicata). */
function gerarUUID() {
    // crypto.randomUUID se disponível, senão fallback manual
    if (crypto === null || crypto === void 0 ? void 0 : crypto.randomUUID)
        return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}
/**
 * Inicializa o IDB e migra contagens antigas do localStorage para o IDB.
 * Chamado uma vez na inicialização do app.
 */
function idbInit() {
    return __awaiter(this, void 0, void 0, function () {
        var filaLS, _i, filaLS_1, c, uuid, record, pendentes, e_6;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 8, , 9]);
                    return [4 /*yield*/, idbOpen()];
                case 1:
                    _a.sent();
                    filaLS = filaLoad();
                    if (!(filaLS.length > 0)) return [3 /*break*/, 6];
                    dbg("[IDB] Migrando ".concat(filaLS.length, " contagens do localStorage \u2192 IDB"));
                    _i = 0, filaLS_1 = filaLS;
                    _a.label = 2;
                case 2:
                    if (!(_i < filaLS_1.length)) return [3 /*break*/, 5];
                    c = filaLS_1[_i];
                    uuid = c.uuid || gerarUUID();
                    record = __assign(__assign({}, c), { uuid: uuid, status_sync: c.status_sync || 'pendente', tentativas: c.tentativas || 0, criado_em: c.criado_em || c.dataHora || new Date().toISOString() });
                    return [4 /*yield*/, idbPut(record)];
                case 3:
                    _a.sent();
                    _a.label = 4;
                case 4:
                    _i++;
                    return [3 /*break*/, 2];
                case 5:
                    // Limpa espelho após migração bem-sucedida
                    try {
                        localStorage.removeItem(LS_FILA);
                    }
                    catch (e) { }
                    _a.label = 6;
                case 6: return [4 /*yield*/, idbGetPendentes()];
                case 7:
                    pendentes = _a.sent();
                    FILA_ENVIO = pendentes;
                    filaSave(FILA_ENVIO); // atualiza espelho LS
                    dbg("[IDB] Pronto. ".concat(FILA_ENVIO.length, " contagens pendentes recuperadas."));
                    atualizarBarraStatus();
                    return [3 /*break*/, 9];
                case 8:
                    e_6 = _a.sent();
                    console.warn('[IDB] init falhou, continuando com localStorage:', e_6);
                    FILA_ENVIO = filaLoad();
                    return [3 /*break*/, 9];
                case 9: return [2 /*return*/];
            }
        });
    });
}
function invCacheLoad() {
    try {
        var r = localStorage.getItem(LS_INV);
        return r ? JSON.parse(r) : [];
    }
    catch (e) {
        return [];
    }
}
function invCacheSave(list) {
    try {
        localStorage.setItem(LS_INV, JSON.stringify(list));
    }
    catch (e) { }
}
/**
 * Remove do localStorage o cache de bases de inventários que
 * não existem mais no Firestore (foram excluídos pelo analista).
 * Também desconecta o operador do inventário atual se ele foi excluído.
 */
function limparInventariosObsoletos(idsAtivos) {
    if (!Array.isArray(idsAtivos))
        return;
    var idsSet = new Set(idsAtivos);
    // Verificar se o inventário atual foi removido
    if (APP.inventario && !idsSet.has(APP.inventario.id)) {
        console.warn('[cache] Inventário atual foi excluído do Firestore:', APP.inventario.id);
        toast('⚠️ O inventário atual foi encerrado pelo analista. Retornando à seleção...', 'w');
        APP.inventario = null;
        APP.base = [];
        setTimeout(function () { return voltarInventarios(); }, 2200);
    }
    // Encontrar todos os prefixos de base no localStorage que NÃO estão em idsAtivos
    var keysToDelete = [];
    for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key)
            continue;
        // Padrões: col_base_{invId}_meta, col_base_{invId}_N, col_bver_{invId}, col_endcap_{invId}
        var prefixes = [LS_BASE, LS_BVER, LS_ENDCAP];
        for (var _i = 0, prefixes_1 = prefixes; _i < prefixes_1.length; _i++) {
            var prefix = prefixes_1[_i];
            if (key.startsWith(prefix)) {
                // Extrair invId: remove o prefixo e pega o que sobra antes de _ ou no fim
                var rest = key.slice(prefix.length);
                // invId pode ter _ dentro (ex: col_base_INV2026_001_meta)
                // A heurística: o invId é tudo até o padrão _meta ou _N (dígitos)
                var invId = rest.replace(/_meta$/, '').replace(/_\d+$/, '');
                if (invId && !idsSet.has(invId)) {
                    keysToDelete.push(key);
                }
                break;
            }
        }
    }
    if (keysToDelete.length > 0) {
        keysToDelete.forEach(function (k) {
            try {
                localStorage.removeItem(k);
            }
            catch (e) { }
        });
        dbg('[cache] Limpos', keysToDelete.length, 'chaves de inventários obsoletos');
    }
}
// Fila de contagens aguardando envio
var FILA_ENVIO = filaLoad();
// ── Indicador de conectividade / fila ──
function atualizarBarraStatus() {
    var bar = document.getElementById('sync-bar');
    var barText = document.getElementById('sync-bar-text');
    var barSpin = document.getElementById('sync-bar-spinner');
    var pill = document.getElementById('conn-pill');
    var dot = document.getElementById('conn-dot');
    var label = document.getElementById('conn-label');
    var online = navigator.onLine;
    var pending = FILA_ENVIO.length;
    // ── Atualiza o PILL do header ──────────────────────────────
    if (pill && dot && label) {
        if (!online) {
            pill.style.background = 'rgba(255,71,87,.12)';
            pill.style.borderColor = 'rgba(255,71,87,.3)';
            pill.style.color = 'var(--danger)';
            dot.style.background = 'var(--danger)';
            dot.style.boxShadow = '0 0 6px var(--danger)';
            label.textContent = pending > 0 ? "\uD83D\uDCF5 ".concat(pending, " na fila") : '📵 Offline';
        }
        else if (pending > 0) {
            pill.style.background = 'rgba(255,179,0,.12)';
            pill.style.borderColor = 'rgba(255,179,0,.3)';
            pill.style.color = 'var(--warn)';
            dot.style.background = 'var(--warn)';
            dot.style.boxShadow = '0 0 6px var(--warn)';
            label.textContent = "\u2B06 ".concat(pending, " pend.");
            // animação de pulso no dot
            dot.style.animation = 'pulse-dot 1s ease-in-out infinite';
        }
        else {
            pill.style.background = 'rgba(0,214,143,.12)';
            pill.style.borderColor = 'rgba(0,214,143,.3)';
            pill.style.color = 'var(--success)';
            dot.style.background = 'var(--success)';
            dot.style.boxShadow = '0 0 6px var(--success)';
            dot.style.animation = '';
            label.textContent = '✓ Online';
        }
    }
    // ── Atualiza a BARRA de sincronização ──────────────────────
    if (!bar)
        return;
    if (!online) {
        bar.style.display = 'flex';
        bar.style.background = 'linear-gradient(90deg,#7c2d12,#92400e)';
        if (barText)
            barText.textContent = "\uD83D\uDCF5 Sem internet \u2014 ".concat(pending, " contagem(ns) salva(s) localmente");
        if (barSpin)
            barSpin.textContent = '💾';
    }
    else if (pending > 0) {
        bar.style.display = 'flex';
        bar.style.background = 'linear-gradient(90deg,#1e3a8a,#1d4ed8)';
        if (barText)
            barText.textContent = "\u2B06\uFE0F Sincronizando ".concat(pending, " contagem(ns) com Firebase\u2026");
        if (barSpin)
            barSpin.textContent = '🔄';
    }
    else {
        // Mostra "tudo certo" e some
        bar.style.background = 'linear-gradient(90deg,#14532d,#166534)';
        if (barText)
            barText.textContent = "\u2705 Firebase sincronizado \u2014 todas as contagens enviadas";
        if (barSpin)
            barSpin.textContent = '';
        setTimeout(function () { if (bar && FILA_ENVIO.length === 0)
            bar.style.display = 'none'; }, 3000);
    }
}
