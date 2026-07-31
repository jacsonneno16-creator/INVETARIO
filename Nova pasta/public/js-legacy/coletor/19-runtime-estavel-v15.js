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
(function () {
    'use strict';
    var lastInstallPrompt = null;
    var diag = [];
    function addDiag(msg) {
        try {
            diag.push(new Date().toLocaleTimeString('pt-BR') + ' — ' + msg);
            if (diag.length > 20)
                diag.shift();
            localStorage.setItem('dt_diag_coletor_v15', JSON.stringify(diag));
        }
        catch (e) { }
    }
    window.addEventListener('error', function (e) { addDiag('JS: ' + (e.message || 'erro') + ' @ ' + (e.filename || '') + ':' + (e.lineno || '')); });
    window.addEventListener('unhandledrejection', function (e) { addDiag('Promise: ' + ((e.reason && e.reason.message) || e.reason || 'erro')); });
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); lastInstallPrompt = e; addDiag('Instalação PWA disponível'); });
    function closeMenus() { ['menu3pts-dropdown', 'menu3pts-dropdown-login'].forEach(function (id) { var x = document.getElementById(id); if (x)
        x.style.display = 'none'; }); }
    window.instalarAplicativo = function () {
        return __awaiter(this, void 0, void 0, function () {
            var e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        closeMenus();
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 4, , 5]);
                        if (!lastInstallPrompt) return [3 /*break*/, 3];
                        lastInstallPrompt.prompt();
                        return [4 /*yield*/, lastInstallPrompt.userChoice];
                    case 2:
                        _a.sent();
                        lastInstallPrompt = null;
                        return [2 /*return*/];
                    case 3:
                        if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
                            if (typeof toast === 'function')
                                toast('Aplicativo já está instalado.', 's');
                            return [2 /*return*/];
                        }
                        alert('Para instalar: abra este endereço no Google Chrome, toque no menu do navegador e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”. O navegador interno de alguns coletores não permite instalação PWA.');
                        return [3 /*break*/, 5];
                    case 4:
                        e_1 = _a.sent();
                        addDiag('Instalação: ' + e_1.message);
                        alert('Não foi possível iniciar a instalação: ' + e_1.message);
                        return [3 /*break*/, 5];
                    case 5: return [2 /*return*/];
                }
            });
        });
    };
    window.mostrarDiagnosticoColetor = function () {
        var auth = (window.AUTH && AUTH.currentUser) ? AUTH.currentUser.email : 'não autenticado';
        var info = ['Versão: ' + (window.APP_VERSION || 'v15'), 'Device ID: ' + (typeof obterDeviceId === 'function' ? obterDeviceId() : 'indisponível'), 'Online: ' + navigator.onLine, 'Firebase: ' + (window.firebase ? 'carregado' : 'não carregado'), 'Usuário: ' + auth, 'Navegador: ' + navigator.userAgent, '', 'Últimos erros:'].concat(diag.length ? diag : ['nenhum erro registrado']);
        alert(info.join('\n'));
    };
    document.addEventListener('DOMContentLoaded', function () {
        try {
            diag = JSON.parse(localStorage.getItem('dt_diag_coletor_v15') || '[]');
        }
        catch (e) {
            diag = [];
        }
        // Acrescenta diagnóstico aos dois menus sem depender do restante do aplicativo.
        ['menu3pts-dropdown-login', 'menu3pts-dropdown'].forEach(function (id) { var d = document.getElementById(id); if (!d || d.querySelector('[data-dt-diagnostico]'))
            return; var b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-dt-diagnostico', '1'); b.textContent = '🩺 Diagnóstico do coletor'; b.style.cssText = 'display:block;width:100%;padding:12px;text-align:left;background:transparent;color:inherit;border:0;font:inherit'; b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); closeMenus(); window.mostrarDiagnosticoColetor(); }; d.appendChild(b); });
        // Garante que as opções de instalar chamem a função estável.
        ['menu-instalar-pwa-login', 'menu-instalar-pwa-app'].forEach(function (id) { var el = document.getElementById(id); if (el) {
            el.style.display = 'block';
            el.onclick = function (e) { e.preventDefault(); e.stopPropagation(); window.instalarAplicativo(); };
        } });
        // Atualiza IP somente depois da tela estar funcional.
        setTimeout(function () { if (typeof atualizarIPColetorEmSegundoPlano === 'function')
            atualizarIPColetorEmSegundoPlano(); }, 5000);
    });
})();
