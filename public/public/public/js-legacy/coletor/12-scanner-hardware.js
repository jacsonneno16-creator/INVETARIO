// ═══════════════════════════════════════════════════
//  SCANNER DE HARDWARE (Zebra / Honeywell)
//  O scanner funciona como teclado (keyboard wedge):
//  envia os caracteres do código + Enter no campo focado.
//  Não precisa de câmera nem ZXing.
// ═══════════════════════════════════════════════════
// Foco automático: ao entrar na etapa, focar o campo correto
function focarCampoAtivo() {
    var steps = ['step-endereco', 'step-capa', 'step-gtin', 'step-validade', 'step-quantidade'];
    var _loop_1 = function (id) {
        var el = document.getElementById(id);
        if (el && el.style.display !== 'none') {
            var input_1 = el.querySelector('input:not([disabled])');
            if (input_1) {
                setTimeout(function () { return input_1.focus(); }, 80);
                return "break";
            }
        }
    };
    for (var _i = 0, steps_1 = steps; _i < steps_1.length; _i++) {
        var id = steps_1[_i];
        var state_1 = _loop_1(id);
        if (state_1 === "break")
            break;
    }
}
// Interceptor: detectar leitura do scanner (sequência rápida + Enter)
// O Zebra envia todos os caracteres em <50ms antes do Enter
var _scanBuffer = '';
var _scanTimer = null;
var _scanField = null;
document.addEventListener('keydown', function (e) {
    var _a;
    if (e.key === 'Enter') {
        var id = (_a = document.activeElement) === null || _a === void 0 ? void 0 : _a.id;
        if (id === 'l-login') {
            document.getElementById('l-pass').focus();
            return;
        }
        if (id === 'l-pass') {
            doLogin();
            return;
        }
        if (id === 'f-endereco') {
            e.preventDefault();
            confirmarEndereco();
            return;
        }
        if (id === 'f-capa') {
            e.preventDefault();
            confirmarCapa();
            return;
        }
        if (id === 'f-gtin') {
            e.preventDefault();
            confirmarGtin();
            return;
        }
        if (id === 'f-validade') {
            e.preventDefault();
            confirmarValidade();
            return;
        }
        if (id === 'f-qty') {
            e.preventDefault();
            salvarContagem();
            return;
        }
    }
    if (e.ctrlKey && (e.key === '+' || e.key === '-' || e.key === '=')) {
        e.preventDefault();
    }
});
// Feedback visual no campo quando recebe leitura do scanner
function flashField(fieldId) {
    var el = document.getElementById(fieldId);
    if (!el)
        return;
    el.style.transition = 'box-shadow .15s';
    el.style.boxShadow = '0 0 0 3px rgba(0,229,150,.6)';
    setTimeout(function () { el.style.boxShadow = ''; }, 600);
}
// Interceptar oninput dos campos de barcode para detectar leitura do scanner
// (input muito rápido = scanner; lento = digitação manual)
function onScannerInput(fieldId, value, tipo) {
    flashField(fieldId);
    // Se for scanner (valor chegou de uma vez, >4 chars), confirmar automaticamente
    // Isso é detectado indiretamente: o scanner preenche e manda Enter,
    // mas caso o modelo Zebra não mande Enter automaticamente:
    if (tipo === 'endereco')
        onEnderecoInput();
    if (tipo === 'gtin')
        onGtinInput();
}
