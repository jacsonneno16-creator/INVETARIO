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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
(function () {
    var manifest = {
        name: "DT Inventário — Coletor",
        short_name: "DT Coletor",
        description: "Coletor de inventário Da Terrinha Alimentos",
        start_url: "./",
        display: "standalone",
        orientation: "portrait",
        background_color: "#060d1a",
        theme_color: "#1E6F4E",
        icons: [
            { src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'%3E%3Crect width='192' height='192' rx='36' fill='%231E6F4E'/%3E%3Ctext x='96' y='80' font-family='monospace' font-weight='700' font-size='52' fill='white' text-anchor='middle' dominant-baseline='middle'%3EDT%3C/text%3E%3Crect x='62' y='105' width='68' height='9' rx='4' fill='%23F59E0B'/%3E%3C/svg%3E", sizes: "192x192", type: "image/svg+xml" },
            { src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' rx='96' fill='%231E6F4E'/%3E%3Ctext x='256' y='210' font-family='monospace' font-weight='700' font-size='140' fill='white' text-anchor='middle' dominant-baseline='middle'%3EDT%3C/text%3E%3Crect x='166' y='280' width='180' height='24' rx='10' fill='%23F59E0B'/%3E%3C/svg%3E", sizes: "512x512", type: "image/svg+xml" }
        ]
    };
    var blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('link');
    link.rel = 'manifest';
    link.href = url;
    document.head.appendChild(link);
})();
// ===== PATCH AUDITORIA COLETOR v2 =====
(function () {
    window._audNorm = function (v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toUpperCase(); };
    window._audEndNorm = function (v) { return _audNorm(v).replace(/[^A-Z0-9]/g, ''); };
    window._audItemKey = function (it) { var _a, _b; return [_audNorm(it.codigo_produto || ''), _audNorm(it.produto_nome || ''), _audNorm(it.dun || ''), _audNorm(it.capa_palete || ''), _audNorm(it.data || ''), String((_b = ((_a = it.quantidade) !== null && _a !== void 0 ? _a : it.quantidade_dun)) !== null && _b !== void 0 ? _b : '').trim()].join('|'); };
    window._audSignature = function (itens) { return (itens || []).map(_audItemKey).sort().join('||'); };
    window._audFormatDateColetor = function (v) {
        var s = String(v == null ? '' : v).trim();
        if (!s)
            return '';
        var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m)
            return "".concat(m[3], "/").concat(m[2], "/").concat(m[1]);
        return s;
    };
    window._audResolverRua = function (r) {
        return String(r.rua ||
            r.street ||
            r.corredor ||
            r.local_estoque_auditoria ||
            r.descricao_local_estoque ||
            r.local_de_estoque ||
            r.local_estoque ||
            r.descricao_setor_armazenagem ||
            r.setor_armazenagem ||
            r.setor_estoque ||
            'SEM RUA').trim().toUpperCase();
    };
    window._auditoriaDaBaseInventario = function (base, invRef) {
        var inv = (invRef && typeof invRef === 'object') ? invRef : (APP.inventario || { id: invRef || '' });
        var invId = inv.id || '';
        if (Array.isArray(inv.auditoria_base_inicial) && inv.auditoria_base_inicial.length) {
            return __spreadArray([], inv.auditoria_base_inicial, true).sort(function (a, b) {
                return String(a.rua || '').localeCompare(String(b.rua || '')) ||
                    String(a.endereco || '').localeCompare(String(b.endereco || ''));
            });
        }
        var rows = Array.isArray(base) ? base : [];
        var mapa = new Map();
        rows.forEach(function (r) {
            var _a, _b, _c, _d, _e, _f;
            var endereco = String(r.endereco || r.codigo_endereco || r.endereco_logistico_descritivo || r.local || '').trim().toUpperCase();
            var endereco_norm = _audNorm(endereco);
            if (!endereco_norm)
                return;
            // DUN deve ser identificado separadamente do código interno do produto.
            // Se a base antiga trouxe um DUN de 13/14 dígitos dentro de codigo_produto,
            // movemos esse valor para dun e não usamos como código do produto.
            var codigoBruto = String(r.codigo_produto || r.codigo || r.sku || r.cod_produto || '').trim();
            var dunBruto = String(r.dun || r.dun14 || r.ean14 || r.gtin14 || '').trim();
            var codigoPareceDun = /^\d{13,14}$/.test(codigoBruto.replace(/\s/g, ''));
            var dunFinal = (dunBruto || (codigoPareceDun ? codigoBruto : '')).trim();
            var capaFinal = String(r.capa_palete || r.capa || r.palete_key || r.pallete_ou_capa || '').trim();
            if (dunFinal && capaFinal.replace(/\s/g, '') === dunFinal.replace(/\s/g, ''))
                capaFinal = '';
            var qtdFinal = String((_f = (_e = (_d = (_c = (_b = (_a = r.quantidade_esperada) !== null && _a !== void 0 ? _a : r.quantidade) !== null && _b !== void 0 ? _b : r.quantidade_dun) !== null && _c !== void 0 ? _c : r.qtd) !== null && _d !== void 0 ? _d : r.quantidade_enderecada) !== null && _e !== void 0 ? _e : r.estoque_total_unidades) !== null && _f !== void 0 ? _f : '').trim();
            var item = {
                codigo_produto: codigoPareceDun ? '' : codigoBruto,
                produto_nome: String(r.descricao_produto || r.produto_nome || r.produto || '').trim(),
                capa_palete: capaFinal,
                data: _audFormatDateColetor(r.data || r.validade || r.data_validade || r.data_de_validade || r.bb || r.vencimento || ''),
                dun: dunFinal,
                quantidade: qtdFinal,
                quantidade_dun: qtdFinal
            };
            var rua = _audResolverRua(r);
            if (!mapa.has(endereco_norm)) {
                mapa.set(endereco_norm, {
                    id: "".concat(invId, "__BASE__").concat(endereco_norm),
                    inventario_id: invId,
                    auditoria_id: "".concat(invId, "__BASE_INICIAL"),
                    endereco: endereco,
                    endereco_norm: endereco_norm,
                    rua: rua,
                    itens: [],
                    itens_confirmados: [],
                    status: 'PENDENTE',
                    origem: 'BASE_INICIAL_INVENTARIO',
                    disponivel_coletor: true,
                    liberada_coletor: true
                });
            }
            mapa.get(endereco_norm).itens.push(item);
        });
        return __spreadArray([], mapa.values(), true).sort(function (a, b) {
            return String(a.rua || '').localeCompare(String(b.rua || '')) ||
                String(a.endereco || '').localeCompare(String(b.endereco || ''));
        });
    };
    window._auditoriaListaAtiva = function () {
        if ((APP.modoAcesso || 'inventario') === 'auditoria')
            return __spreadArray([], (APP.auditorias || []), true);
        return __spreadArray([], (APP.auditoriaBase || []), true);
    };
    window.iniciarListenerAuditoria = function (invId) {
        if (_auditoriaListener) {
            try {
                _auditoriaListener();
            }
            catch (e) { }
            _auditoriaListener = null;
        }
        if (!invId)
            return;
        var atualizarBadge = function () {
            var _a;
            var lista = _auditoriaListaAtiva();
            var tab = document.getElementById('tab-auditoria');
            if (!tab)
                return;
            var old = tab.querySelector('.rec-badge');
            if (old)
                old.remove();
            if (lista.length) {
                var b = document.createElement('span');
                b.className = 'rec-badge';
                b.textContent = lista.length;
                b.style.background = 'var(--accent)';
                b.style.color = '#fff';
                tab.appendChild(b);
                tab.style.display = '';
            }
            else {
                tab.style.display = (APP.modoAcesso === 'auditoria') ? '' : 'none';
            }
            if ((_a = document.getElementById('view-auditoria')) === null || _a === void 0 ? void 0 : _a.classList.contains('on'))
                renderAuditoriaColetor();
        };
        if ((APP.modoAcesso || 'inventario') !== 'auditoria') {
            // No modo inventário, não gerar auditoriaBase (aba auditoria fica oculta)
            APP.auditoriaBase = [];
            atualizarBadge();
            return;
        }
        _auditoriaListener = FS.collection(FCOL.auditorias)
            .where('inventario_id', '==', invId)
            .onSnapshot(function (snap) {
            APP.auditorias = snap.docs
                .map(function (d) { return (__assign({ id: d.id }, d.data())); })
                .filter(function (a) { return a.disponivel_coletor !== false && !['CONFIRMADO_SEM_AJUSTE', 'CONFIRMADO_COM_AJUSTE'].includes(String(a.status || '').toUpperCase()); });
            atualizarBadge();
        }, function (err) { return console.warn('[AUD] listener auditoria:', err.message); });
    };
    window.renderAuditoriaColetor = function () {
        var wrap = document.getElementById('auditoria-lista-wrap');
        if (!wrap)
            return;
        var lista = _auditoriaListaAtiva().sort(function (a, b) { return String(a.rua || '').localeCompare(String(b.rua || '')) || String(a.endereco || '').localeCompare(String(b.endereco || '')); });
        if (!lista.length) {
            wrap.innerHTML = "<div class=\"empty\"><div class=\"ei\">\uD83D\uDCDD</div><p>Nenhuma auditoria pendente para este invent\u00E1rio.</p></div>";
            return;
        }
        var ruas = {};
        lista.forEach(function (a) { var rua = a.rua || 'SEM RUA'; (ruas[rua] || (ruas[rua] = [])).push(a); });
        wrap.innerHTML = Object.entries(ruas).map(function (_a, idx) {
            var rua = _a[0], itens = _a[1];
            return "\n      <div class=\"card\" style=\"padding:0;overflow:hidden;border-color:rgba(232,117,26,.24)\">\n        <div onclick=\"toggleAuditoriaRua('".concat(esc(rua), "')\" style=\"padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;background:rgba(232,117,26,.06)\">\n          <div><div style=\"font-size:.95rem;font-weight:800;color:var(--text)\">").concat(esc(rua), "</div><div style=\"font-size:.72rem;color:var(--muted)\">").concat(itens.length, " endere\u00E7o(s) pendente(s)</div></div>\n          <div id=\"aud-rua-icon-").concat(idx, "\" style=\"font-size:1rem;color:var(--accent)\">\u25B8</div>\n        </div>\n        <div id=\"aud-rua-body-").concat(idx, "\" data-rua=\"").concat(esc(rua), "\" style=\"display:none;padding:10px 12px\">\n          ").concat(itens.map(function (item) {
                var _a;
                var linhas = (((_a = item.itens_confirmados) === null || _a === void 0 ? void 0 : _a.length) ? item.itens_confirmados : item.itens || []);
                return "<div style=\"border:1px solid var(--border);border-radius:12px;margin-bottom:8px;overflow:hidden;background:var(--card)\">\n              <div onclick=\"toggleAuditoriaEndereco('".concat(item.id, "')\" style=\"padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer\">\n                <div><div style=\"font-family:var(--mono);font-weight:800;color:var(--text)\">").concat(esc(item.endereco || ''), "</div><div style=\"font-size:.7rem;color:var(--muted)\">").concat(linhas.length, " item(ns) \u00B7 ").concat(item.status === 'REABERTO_ALTERACAO_BASE' ? 'Reaberto por alteração de base' : 'Pendente de confirmação', "</div></div>\n                <div id=\"aud-item-icon-").concat(item.id, "\" style=\"font-size:1rem;color:var(--accent)\">\u25BE</div>\n              </div>\n              <div id=\"aud-item-body-").concat(item.id, "\" style=\"display:none;padding:0 14px 14px\">\n                <div style=\"overflow:auto;border:1px solid var(--border);border-radius:10px\">\n                  <table style=\"width:100%;border-collapse:collapse;font-size:.78rem\">\n                    <thead><tr style=\"background:rgba(255,255,255,.03)\"><th style=\"padding:8px;text-align:left\">Produto</th><th style=\"padding:8px;text-align:left\">Data</th><th style=\"padding:8px;text-align:left\">Capa</th><th style=\"padding:8px;text-align:left\">DUN</th></tr></thead>\n                    <tbody>\n                      ").concat(linhas.map(function (ln, j) { return "<tr><td style=\"padding:8px\"><input class=\"field\" id=\"aud-prod-".concat(item.id, "-").concat(j, "\" value=\"").concat(esc(ln.produto_nome || ''), "\" style=\"height:40px!important;font-size:.85rem!important\"/></td><td style=\"padding:8px\"><input class=\"field\" id=\"aud-data-").concat(item.id, "-").concat(j, "\" value=\"").concat(esc(ln.data || ''), "\" style=\"height:40px!important;font-size:.85rem!important\"/></td><td style=\"padding:8px\"><input class=\"field\" id=\"aud-capa-").concat(item.id, "-").concat(j, "\" value=\"").concat(esc(ln.capa_palete || ''), "\" style=\"height:40px!important;font-size:.85rem!important\"/></td><td style=\"padding:8px\"><input class=\"field\" id=\"aud-qtd-").concat(item.id, "-").concat(j, "\" value=\"").concat(esc(ln.quantidade_dun || ''), "\" style=\"height:40px!important;font-size:.85rem!important\" inputmode=\"numeric\"/></td></tr>"); }).join(''), "\n                    </tbody>\n                  </table>\n                </div>\n                <button class=\"btn btn-success\" style=\"margin-top:10px\" onclick=\"confirmarAuditoriaItem('").concat(item.id, "')\">\u2713 Confirmar endere\u00E7o</button>\n              </div>\n            </div>");
            }).join(''), "\n        </div>\n      </div>");
        }).join('');
    };
    window.confirmarAuditoriaItem = function (id) {
        return __awaiter(this, void 0, void 0, function () {
            var item, origem, confirmados, semAjuste, payload, e_1;
            var _a, _b, _c, _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        item = (APP.auditorias || []).find(function (a) { return a.id === id; });
                        if (!item)
                            return [2 /*return*/];
                        origem = item.itens || [];
                        confirmados = origem.map(function (ln, j) {
                            var _a, _b, _c, _d, _e, _f, _g, _h;
                            return ({
                                codigo_produto: ln.codigo_produto || '',
                                produto_nome: ((_b = (_a = document.getElementById("aud-prod-".concat(id, "-").concat(j))) === null || _a === void 0 ? void 0 : _a.value) === null || _b === void 0 ? void 0 : _b.trim()) || '',
                                data: ((_d = (_c = document.getElementById("aud-data-".concat(id, "-").concat(j))) === null || _c === void 0 ? void 0 : _c.value) === null || _d === void 0 ? void 0 : _d.trim()) || '',
                                capa_palete: ((_f = (_e = document.getElementById("aud-capa-".concat(id, "-").concat(j))) === null || _e === void 0 ? void 0 : _e.value) === null || _f === void 0 ? void 0 : _f.trim()) || '',
                                quantidade_dun: ((_h = (_g = document.getElementById("aud-qtd-".concat(id, "-").concat(j))) === null || _g === void 0 ? void 0 : _g.value) === null || _h === void 0 ? void 0 : _h.trim()) || '',
                            });
                        });
                        semAjuste = _audSignature(confirmados) === _audSignature(origem);
                        payload = {
                            itens_confirmados: confirmados,
                            confirmado_por: ((_a = APP.operador) === null || _a === void 0 ? void 0 : _a.name) || '',
                            confirmado_por_email: ((_b = APP.operador) === null || _b === void 0 ? void 0 : _b.email) || '',
                            confirmado_em: new Date().toISOString(),
                            com_ajuste: !semAjuste,
                            status: semAjuste ? 'CONFIRMADO_SEM_AJUSTE' : 'CONFIRMADO_COM_AJUSTE',
                            disponivel_coletor: false,
                            liberada_coletor: true,
                            atualizado_em: new Date().toISOString(),
                        };
                        _e.label = 1;
                    case 1:
                        _e.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, FS.collection(FCOL.auditorias).doc(((_c = APP.inventario) === null || _c === void 0 ? void 0 : _c.auditoria_id) || ((_d = APP.inventario) === null || _d === void 0 ? void 0 : _d.id)).collection('enderecos').doc(id).set(payload, { merge: true })];
                    case 2:
                        _e.sent();
                        APP.auditorias = (APP.auditorias || []).filter(function (a) { return a.id !== id; });
                        renderAuditoriaColetor();
                        toast(semAjuste ? '✅ Confirmado sem ajuste' : '✅ Confirmado com ajuste', 's');
                        return [3 /*break*/, 4];
                    case 3:
                        e_1 = _e.sent();
                        toast('Erro ao confirmar auditoria: ' + e_1.message, 'e');
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    window._marcarAuditoriaBatidaSeHouver = function (contagem) {
        return __awaiter(this, void 0, void 0, function () {
            var endNorm, docId_1, a, snap, status_1, linhas, bateu, e_2;
            var _a, _b, _c, _d, _e, _f;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0:
                        // [OTIMIZADO] Usa cache em memória (APP.auditorias) em vez de .get() no Firestore.
                        // Cada contagem salva gerava uma leitura extra — agora zero leituras adicionais.
                        if (!((_a = APP.inventario) === null || _a === void 0 ? void 0 : _a.id))
                            return [2 /*return*/, false];
                        endNorm = _audEndNorm(contagem.endereco || '');
                        if (!endNorm)
                            return [2 /*return*/, false];
                        _g.label = 1;
                    case 1:
                        _g.trys.push([1, 6, , 7]);
                        docId_1 = "".concat(APP.inventario.id, "__").concat(endNorm);
                        a = (APP.auditorias || []).find(function (x) { return x.id === docId_1 || _audEndNorm(x.endereco || '') === endNorm; });
                        if (!!a) return [3 /*break*/, 3];
                        APP._auditoriaConfirmadaCache = APP._auditoriaConfirmadaCache || {};
                        if (APP._auditoriaConfirmadaCache[docId_1] === false)
                            return [2 /*return*/, false]; // já checado, não existe
                        return [4 /*yield*/, FS.collection(FCOL.auditorias).doc(((_b = APP.inventario) === null || _b === void 0 ? void 0 : _b.auditoria_id) || ((_c = APP.inventario) === null || _c === void 0 ? void 0 : _c.id)).collection('enderecos').doc(docId_1).get()];
                    case 2:
                        snap = _g.sent();
                        if (!snap.exists) {
                            APP._auditoriaConfirmadaCache[docId_1] = false;
                            return [2 /*return*/, false];
                        }
                        a = snap.data() || {};
                        APP._auditoriaConfirmadaCache[docId_1] = a; // guarda para não buscar de novo
                        _g.label = 3;
                    case 3:
                        status_1 = String(a.status || '').toUpperCase();
                        if (!['CONFIRMADO_SEM_AJUSTE', 'CONFIRMADO_COM_AJUSTE'].includes(status_1))
                            return [2 /*return*/, false];
                        linhas = (((_d = a.itens_confirmados) === null || _d === void 0 ? void 0 : _d.length) ? a.itens_confirmados : a.itens || []);
                        bateu = linhas.some(function (ln) {
                            return _audNorm(ln.capa_palete || '') === _audNorm(contagem.capa || '') &&
                                _audNorm(ln.data || '') === _audNorm(contagem.validade || '') &&
                                String(ln.quantidade_dun || '').trim() === String(contagem.quantidade || '').trim() &&
                                (_audNorm(ln.produto_nome || '') === _audNorm(contagem.descricao || contagem.descricao_produto || '') || _audNorm(ln.codigo_produto || '') === _audNorm(contagem.codigo_produto || ''));
                        });
                        if (!bateu) return [3 /*break*/, 5];
                        return [4 /*yield*/, FS.collection(FCOL.auditorias).doc(((_e = APP.inventario) === null || _e === void 0 ? void 0 : _e.auditoria_id) || ((_f = APP.inventario) === null || _f === void 0 ? void 0 : _f.id)).collection('enderecos').doc(docId_1).set({ bateu_contagem: true, ultima_contagem_bateu_em: new Date().toISOString(), ultima_contagem_uuid: contagem.uuid || '' }, { merge: true })];
                    case 4:
                        _g.sent();
                        return [2 /*return*/, true];
                    case 5: return [3 /*break*/, 7];
                    case 6:
                        e_2 = _g.sent();
                        console.warn('[AUD] Falha ao comparar auditoria:', e_2.message);
                        return [3 /*break*/, 7];
                    case 7: return [2 /*return*/, false];
                }
            });
        });
    };
})();
