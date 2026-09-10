(function (w, d) {
  'use strict';

  var lastTouch = 0;
  function safe(fn) {
    try {
      if (typeof w[fn] === 'function') w[fn]();
    } catch (e) {
      if (w.console && console.error) console.error('[Compat]', e);
    }
  }
  function bindTap(el, fn) {
    if (!el || el.getAttribute('data-legacy-tap')) return;
    el.setAttribute('data-legacy-tap', '1');
    el.addEventListener('touchend', function (e) {
      lastTouch = Date.now();
      e.preventDefault();
      fn(e);
    }, false);
    el.addEventListener('click', function (e) {
      if (Date.now() - lastTouch < 700) return;
      fn(e);
    }, false);
  }
  function init() {
    var form = d.getElementById('login-form-legacy'),
      btn = d.getElementById('btn-login'),
      login = d.getElementById('l-login'),
      pass = d.getElementById('l-pass');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        safe('doLogin');
      }, false);
    }
    if (btn) bindTap(btn, function (e) {
      if (e) e.preventDefault();
      safe('doLogin');
    });
    function enter(e) {
      e = e || w.event;
      var k = e.key || e.keyCode;
      if (k === 'Enter' || k === 13) {
        if (e.preventDefault) e.preventDefault();
        safe('doLogin');
        return false;
      }
    }
    if (login) login.addEventListener('keydown', enter, false);
    if (pass) pass.addEventListener('keydown', enter, false);
    // BUG AO VIVO REAL (2026-09-06): "os 3 pontinhos não funcionam pra ir em
    // diagnóstico" — este arquivo é um shim legado que ficou pra trás depois
    // que 20-menu-compat.js passou a vincular TODO botão "btn-menu3pts*" do
    // DOM de forma genérica (2026-09-04). Como este shim carrega por último
    // (depois de 20-menu-compat.js), ele adicionava um SEGUNDO listener de
    // clique nos mesmos dois botões (btn-menu3pts-login e btn-menu3pts) —
    // cada toque disparava os DOIS handlers em sequência: o de
    // 20-menu-compat.js abria o menu, e este aqui, logo em seguida, chamava
    // toggleMenu3ptsLogin()/toggleMenu3pts() de novo e fechava na mesma
    // tacada — o menu abria e fechava no mesmo clique, parecendo que o botão
    // não fazia nada. Removido; 20-menu-compat.js já cobre os dois.
    var actions = d.querySelectorAll('[data-legacy-action]');
    for (var i = 0; i < actions.length; i++) (function (el) {
      bindTap(el, function () {
        safe(el.getAttribute('data-legacy-action'));
      });
    })(actions[i]);
  }
  w.diagnosticoCompatibilidade = function () {
    var ua = navigator.userAgent || '';
    var android = (ua.match(/Android\s([0-9.]+)/i) || [])[1] || 'Não identificado';
    var chrome = (ua.match(/(?:Chrome|CriOS)\/([0-9.]+)/i) || [])[1] || 'Não identificado';
    var webview = /;\s*w?v\)|\bwv\b/i.test(ua) ? 'WebView Android' : 'Navegador/indefinido';
    var mem = navigator.deviceMemory ? navigator.deviceMemory + ' GB' : 'Não disponível';
    var info = [['Modelo/User Agent', ua], ['Android', android], ['Chrome/WebView', chrome + ' · ' + webview], ['Memória estimada', mem], ['Touch', 'ontouchstart' in w || navigator.maxTouchPoints > 0 ? 'Sim' : 'Não'], ['IndexedDB', w.indexedDB ? 'Sim' : 'Não (fallback localStorage)'], ['LocalStorage', function () {
      try {
        localStorage.setItem('__dt_t', '1');
        localStorage.removeItem('__dt_t');
        return 'Sim';
      } catch (e) {
        return 'Não';
      }
    }()], ['Cache Storage', w.caches ? 'Sim' : 'Não'], ['Service Worker', 'serviceWorker' in navigator ? 'Sim' : 'Não'], ['Câmera', navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? 'Sim' : 'Não/legada'], ['Scanner', 'Teclado/hardware wedge'], ['Resolução', screen.width + ' × ' + screen.height], ['Pixel Ratio', w.devicePixelRatio || 1], ['Conexão', navigator.onLine ? 'Online' : 'Offline'], ['Versão da aplicação', w.APP_VERSION || '24'], ['Build', 'Compatibilidade Coletor v24'], ['Data do build', '22/07/2026']];
    var html = '<div style="font-size:.75rem;padding:10px"><div style="font-weight:800;font-size:1rem;margin-bottom:10px">🔍 Diagnóstico do Coletor</div>';
    for (var i = 0; i < info.length; i++) html += '<div style="padding:7px 0;border-bottom:1px solid rgba(255,255,255,.08)"><b>' + info[i][0] + ':</b><br><span style="word-break:break-all;color:var(--muted)">' + String(info[i][1]).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span></div>';
    html += '<button type="button" onclick="carregarInventarios()" style="margin-top:12px;background:var(--primary);color:#fff;border:0;border-radius:8px;padding:9px 14px">Fechar</button></div>';
    var el = d.getElementById('inv-list');
    if (el) {
      el.innerHTML = html;
      var sc = d.getElementById('screen-inventarios');
      if (sc && w.showScreen) w.showScreen('screen-inventarios');
    } else {
      alert(info.map(function (x) {
        return x[0] + ': ' + x[1];
      }).join('\n'));
    }
  };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', init, false);else init();
})(window, document);