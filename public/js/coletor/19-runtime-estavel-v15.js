(function () {
  'use strict';

  var lastInstallPrompt = null;
  var diag = [];
  function addDiag(msg) {
    try {
      diag.push(new Date().toLocaleTimeString('pt-BR') + ' — ' + msg);
      if (diag.length > 20) diag.shift();
      localStorage.setItem('dt_diag_coletor_v15', JSON.stringify(diag));
    } catch (e) {
      console.warn("[Erro tratado]", e);
    }
  }
  // Exposto pra outros arquivos (ex.: 02-sync-dispositivo.js) registrarem
  // erros que são tratados internamente (try/catch que nunca vira
  // unhandledrejection) — sem isso, um erro real de permissão no registro
  // do aparelho ficava invisível na tela de Diagnóstico (bug ao vivo
  // relatado: "diagnóstico tá tudo correto" mesmo com o registro falhando).
  window.dtAddDiag = addDiag;
  window.addEventListener('error', function (e) {
    addDiag('JS: ' + (e.message || 'erro') + ' @ ' + (e.filename || '') + ':' + (e.lineno || ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    addDiag('Promise: ' + (e.reason && e.reason.message || e.reason || 'erro'));
  });
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    lastInstallPrompt = e;
    addDiag('Instalação PWA disponível');
  });
  function closeMenus() {
    ['menu3pts-dropdown', 'menu3pts-dropdown-login'].forEach(function (id) {
      var x = document.getElementById(id);
      if (x) x.style.display = 'none';
    });
  }
  window.instalarAplicativo = async function () {
    closeMenus();
    try {
      if (lastInstallPrompt) {
        lastInstallPrompt.prompt();
        await lastInstallPrompt.userChoice;
        lastInstallPrompt = null;
        return;
      }
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
        if (typeof toast === 'function') toast('Aplicativo já está instalado.', 's');
        return;
      }
      alert('Para instalar: abra este endereço no Google Chrome, toque no menu do navegador e escolha “Instalar aplicativo” ou “Adicionar à tela inicial”. O navegador interno de alguns coletores não permite instalação PWA.');
    } catch (e) {
      addDiag('Instalação: ' + e.message);
      alert('Não foi possível iniciar a instalação: ' + e.message);
    }
  };
  // Pedido ao vivo do usuário: "não consigo rastrear qual é o UID dele, se
  // é o mesmo ou se mudou" — antes só mostrava o e-mail, e a lista de erros
  // misturava sessões/contas diferentes do MESMO aparelho físico (1
  // aparelho passa por vários operadores ao longo do tempo) sem separar o
  // que é de agora do que é histórico, deixando impossível confirmar "esse
  // UID que está dando erro AGORA é o mesmo que o Analista configurou?".
  // BUG AO VIVO REAL (2026-09-06): "os 3 pontinhos não funcionam pra ir em
  // diagnóstico" — esta função usava alert() nativo. Todo o resto do app já
  // tinha abandonado confirm()/alert() nativos por um modal customizado (ver
  // comentário em 14-toast.js) exatamente porque este app roda dentro de
  // WebViews antigas de coletor físico (Zebra/Honeywell/Chainway/Urovo —
  // daí o sufixo "webview66-compat" em todo script), onde o app nativo que
  // hospeda a WebView nem sempre implementa o callback que exibe diálogos JS
  // (onJsAlert/onJsConfirm) — quando falta, alert()/confirm() não fazem
  // nada visível, o que looks exactly like "o botão não funciona". Esta
  // função tinha ficado pra trás dessa limpeza. Agora usa um modal próprio
  // (mesmo padrão de _showUpdateModal em 16-menu-atualizacao.js), que
  // renderiza como HTML normal e funciona em qualquer WebView.
  function _montarInfoDiagnostico() {
    var user = window.AUTH && AUTH.currentUser ? AUTH.currentUser : null;
    return ['Versão: ' + (window.APP_VERSION || 'v15'), 'Device ID: ' + (typeof obterDeviceId === 'function' ? obterDeviceId() : 'indisponível'), 'Online: ' + navigator.onLine, 'Firebase: ' + (window.firebase ? 'carregado' : 'não carregado'), '', '=== QUEM ESTÁ LOGADO AGORA ===', 'E-mail: ' + (user ? user.email : 'não autenticado'), 'UID: ' + (user ? user.uid : '—'), '(compare esse UID com o que aparece no Diagnóstico de acesso, na tela de Usuários e Permissões do Analista)', '', 'Navegador: ' + navigator.userAgent, '', 'Últimos erros (histórico deste APARELHO — pode ter entradas de contas/logins anteriores, não só a de agora):'].concat(diag.length ? diag : ['nenhum erro registrado']).join('\n');
  }
  function _fecharModalDiagnostico() {
    var overlay = document.getElementById('dt-diag-overlay');
    if (overlay) overlay.style.display = 'none';
  }
  window.mostrarDiagnosticoColetor = function () {
    closeMenus();
    var texto = _montarInfoDiagnostico();
    var overlay = document.getElementById('dt-diag-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'dt-diag-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:20px';
      overlay.innerHTML =
        '<div style="background:#1a1a2e;color:#f1f5f9;border-radius:14px;max-width:480px;width:100%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.5)">' +
          '<div style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.1);font-weight:800;font-size:.95rem">🩺 Diagnóstico do coletor</div>' +
          '<pre id="dt-diag-texto" style="margin:0;padding:16px 18px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;font:11px/1.5 monospace;flex:1"></pre>' +
          '<div style="display:flex;gap:8px;padding:14px 18px;border-top:1px solid rgba(255,255,255,.1)">' +
            '<button type="button" id="dt-diag-servidor" style="flex:1;background:rgba(0,214,143,.15);color:#00d68f;border:1px solid rgba(0,214,143,.3);border-radius:8px;padding:10px;font-size:.8rem;cursor:pointer">🔬 Verificar no servidor</button>' +
            '<button type="button" id="dt-diag-copiar" style="flex:1;background:rgba(255,255,255,.08);color:#f1f5f9;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:10px;font-size:.8rem;cursor:pointer">📋 Copiar</button>' +
            '<button type="button" id="dt-diag-fechar" style="flex:1;background:#00d68f;color:#0a0a0a;border:none;border-radius:8px;padding:10px;font-weight:700;font-size:.8rem;cursor:pointer">Fechar</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) _fecharModalDiagnostico(); });
      document.getElementById('dt-diag-fechar').onclick = _fecharModalDiagnostico;
      document.getElementById('dt-diag-copiar').onclick = function () {
        var t = document.getElementById('dt-diag-texto').textContent;
        var feito = function () { if (typeof toast === 'function') toast('Diagnóstico copiado.', 's'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).then(feito).catch(feito);
        } else feito();
      };
      // BUG AO VIVO REAL (2026-09-06): o erro de permission-denied sozinho
      // não diz QUAL parte da regra bloqueou. Este botão chama uma Cloud
      // Function (Admin SDK, ignora as regras) que devolve o estado REAL
      // gravado hoje pra esta conta e este aparelho, direto na tela —
      // funciona mesmo com o aparelho ainda pendente/bloqueado, porque só
      // exige estar logado (não exige o aparelho já aprovado).
      document.getElementById('dt-diag-servidor').onclick = async function () {
        var btnS = document.getElementById('dt-diag-servidor');
        var pre = document.getElementById('dt-diag-texto');
        btnS.disabled = true;
        btnS.textContent = 'Consultando…';
        try {
          if (!window.firebase || typeof getDTFirebaseApp !== 'function' || !AUTH.currentUser) {
            throw new Error('Faça login antes de consultar o servidor.');
          }
          var callable = getDTFirebaseApp().functions('southamerica-east1').httpsCallable('diagnosticarAparelhoColetor');
          var resp = await callable({ deviceId: typeof obterDeviceId === 'function' ? obterDeviceId() : null });
          var d = (resp && resp.data) || {};
          pre.textContent += '\n\n=== ESTADO REAL NO SERVIDOR (agora) ===\n' + JSON.stringify(d, null, 2);
        } catch (e) {
          pre.textContent += '\n\n=== ESTADO REAL NO SERVIDOR ===\nFalhou: ' + (e.code || '') + ' ' + (e.message || e);
        } finally {
          btnS.disabled = false;
          btnS.textContent = '🔬 Verificar no servidor';
        }
      };
    }
    document.getElementById('dt-diag-texto').textContent = texto;
    overlay.style.display = 'flex';
  };
  window.limparDiagnosticoColetor = function () {
    var limpar = function () {
      diag = [];
      try {
        localStorage.removeItem('dt_diag_coletor_v15');
      } catch (e) {
        console.warn("[Erro tratado]", e);
      }
      if (typeof toast === 'function') toast('Histórico de diagnóstico limpo.', 's');
    };
    if (typeof window.showConfirm === 'function') {
      window.showConfirm('Apagar o histórico de erros deste aparelho? Não afeta login nem permissões, só limpa a lista.', limpar, { title: 'Limpar diagnóstico', icon: '🧹', okLabel: 'Apagar', okColor: '#ff4757' });
    } else {
      limpar();
    }
  };
  document.addEventListener('DOMContentLoaded', function () {
    try {
      diag = JSON.parse(localStorage.getItem('dt_diag_coletor_v15') || '[]');
    } catch (e) {
      diag = [];
    }
    // Acrescenta diagnóstico aos dois menus sem depender do restante do aplicativo.
    ['menu3pts-dropdown-login', 'menu3pts-dropdown'].forEach(function (id) {
      var d = document.getElementById(id);
      if (!d || d.querySelector('[data-dt-diagnostico]')) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-dt-diagnostico', '1');
      b.textContent = '🩺 Diagnóstico do coletor';
      b.style.cssText = 'display:block;width:100%;padding:12px;text-align:left;background:transparent;color:inherit;border:0;font:inherit';
      b.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeMenus();
        window.mostrarDiagnosticoColetor();
      };
      d.appendChild(b);
      var bLimpar = document.createElement('button');
      bLimpar.type = 'button';
      bLimpar.setAttribute('data-dt-diagnostico-limpar', '1');
      bLimpar.textContent = '🧹 Limpar histórico de erros';
      bLimpar.style.cssText = 'display:block;width:100%;padding:12px;text-align:left;background:transparent;color:inherit;border:0;font:inherit';
      bLimpar.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeMenus();
        window.limparDiagnosticoColetor();
      };
      d.appendChild(bLimpar);
    });
    // Garante que as opções de instalar chamem a função estável.
    ['menu-instalar-pwa-login', 'menu-instalar-pwa-app'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.style.display = 'block';
        el.onclick = function (e) {
          e.preventDefault();
          e.stopPropagation();
          window.instalarAplicativo();
        };
      }
    });
    // Atualiza IP somente depois da tela estar funcional.
    setTimeout(function () {
      if (typeof atualizarIPColetorEmSegundoPlano === 'function') atualizarIPColetorEmSegundoPlano();
    }, 5000);
  });
})();