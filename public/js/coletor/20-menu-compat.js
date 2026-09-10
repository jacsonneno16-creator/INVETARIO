(function () {
  'use strict';

  // BUG AO VIVO REAL (2026-09-04): "os 3 pontinhos funciona só em algumas
  // telas" — esta lista era FIXA (só 5 pares) e cada tela nova com seu
  // próprio menu3pts (screen-recebimento-modo, screen-paletes-menu,
  // screen-nova-movimentacao-menu...) ficava sem o botão funcionar,
  // silenciosamente, até alguém lembrar de adicionar aqui. Agora descobre
  // TODOS os pares `btn-menu3pts...`/`menu3pts-dropdown...` já presentes no
  // DOM (o id do dropdown é sempre o id do botão trocando `btn-menu3pts`
  // por `menu3pts-dropdown` — convenção já usada em toda tela nova) — tela
  // nova passa a funcionar sozinha, sem precisar editar este arquivo de
  // novo. Consultado ao vivo (não cacheado uma vez só) porque é barato e
  // remove qualquer dependência de ORDEM entre este script e o HTML.
  function eachMenu(fn) {
    var botoes = document.querySelectorAll('[id^="btn-menu3pts"]');
    var i, buttonId, menuId;
    for (i = 0; i < botoes.length; i += 1) {
      buttonId = botoes[i].id;
      menuId = buttonId.replace('btn-menu3pts', 'menu3pts-dropdown');
      if (document.getElementById(menuId)) fn(buttonId, menuId);
    }
  }
  function closeAllMenus(exceptId) {
    eachMenu(function (buttonId, menuId) {
      if (menuId === exceptId) return;
      var menu = document.getElementById(menuId);
      var button = document.getElementById(buttonId);
      if (menu) menu.style.display = 'none';
      if (button && button.classList) button.classList.remove('aberto');
      if (button) button.setAttribute('aria-expanded', 'false');
    });
  }
  function toggleByIds(buttonId, menuId, event) {
    if (event) {
      if (event.preventDefault) event.preventDefault();
      if (event.stopPropagation) event.stopPropagation();
    }
    var menu = document.getElementById(menuId);
    var button = document.getElementById(buttonId);
    if (!menu) return false;
    var opening = menu.style.display === 'none' || menu.style.display === '';
    closeAllMenus(opening ? menuId : null);
    menu.style.display = opening ? 'block' : 'none';
    if (button && button.classList) button.classList.toggle('aberto', opening);
    if (button) button.setAttribute('aria-expanded', opening ? 'true' : 'false');
    return false;
  }
  window.toggleMenu3pts = function (event) {
    return toggleByIds('btn-menu3pts', 'menu3pts-dropdown', event || window.event);
  };
  window.toggleMenu3ptsMode = function (event) {
    return toggleByIds('btn-menu3pts-mode', 'menu3pts-dropdown-mode', event || window.event);
  };
  window.toggleMenu3ptsLogin = function (event) {
    return toggleByIds('btn-menu3pts-login', 'menu3pts-dropdown-login', event || window.event);
  };
  window._fecharMenu3pts = function () {
    closeAllMenus(null);
  };
  window._fecharMenu3ptsLogin = function () {
    closeAllMenus(null);
  };
  function notify(message, type) {
    try {
      if (typeof window.toast === 'function') window.toast(message, type || 'i');else window.alert(message);
    } catch (e) {
      window.alert(message);
    }
  }
  function safeCall(name, args) {
    closeAllMenus(null);
    try {
      var fn = window[name];
      if (typeof fn !== 'function') {
        notify('A opção "' + name + '" não está disponível nesta versão. Atualize o aplicativo.', 'w');
        return false;
      }
      var result = fn.apply(window, args || []);
      if (result && typeof result.catch === 'function') {
        result.catch(function (error) {
          notify('Não foi possível executar a opção: ' + (error && error.message || error), 'e');
        });
      }
      return false;
    } catch (error) {
      notify('Não foi possível executar a opção: ' + (error && error.message || error), 'e');
      return false;
    }
  }
  function bindMenuButton(buttonId, menuId) {
    var button = document.getElementById(buttonId);
    if (!button || button.getAttribute('data-menu-bound') === '1') return;
    button.setAttribute('data-menu-bound', '1');
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');

    // Use somente o evento click. Em telas touch, touchend + click eram
    // disparados em sequencia: o primeiro abria e o segundo fechava o menu.
    button.onclick = function (event) {
      return toggleByIds(buttonId, menuId, event);
    };
  }
  function bindAction(selector, actionName) {
    var nodes = document.querySelectorAll(selector);
    var i;
    for (i = 0; i < nodes.length; i += 1) {
      (function (node) {
        node.type = 'button';
        node.onclick = function (event) {
          if (event) {
            if (event.preventDefault) event.preventDefault();
            if (event.stopPropagation) event.stopPropagation();
          }
          if (node.getAttribute('data-menu-running') === '1') return false;
          node.setAttribute('data-menu-running', '1');
          window.setTimeout(function () {
            node.removeAttribute('data-menu-running');
          }, 500);
          return safeCall(actionName);
        };
      })(nodes[i]);
    }
  }
  function initMenus() {
    eachMenu(bindMenuButton);
    bindAction('[data-menu-action="update-app"]', 'atualizarAplicativo');
    bindAction('[data-menu-action="update-base"]', 'atualizarBase');
    bindAction('[data-menu-action="install-app"]', typeof window.instalarAplicativo === 'function' ? 'instalarAplicativo' : 'instalarPWA');
    bindAction('[data-menu-action="switch-inventory"]', 'voltarInventarios');
    bindAction('[data-menu-action="diagnostic"]', typeof window.mostrarDiagnosticoColetor === 'function' ? 'mostrarDiagnosticoColetor' : 'diagnosticoCompatibilidade');
    bindAction('[data-menu-action="logout"]', 'doLogout');
    document.addEventListener('click', function (event) {
      var target = event.target;
      var inside = false;
      eachMenu(function (buttonId, menuId) {
        var button = document.getElementById(buttonId);
        var menu = document.getElementById(menuId);
        if (button && button.contains(target) || menu && menu.contains(target)) inside = true;
      });
      if (!inside) closeAllMenus(null);
    }, false);
    document.addEventListener('keydown', function (event) {
      if ((event.key || event.keyCode) === 'Escape' || event.keyCode === 27) closeAllMenus(null);
    }, false);
    // Mesma correção de fundo do eachMenu() acima: descobre TODO elemento
    // "*-ver-label" já presente no DOM, em vez de uma lista fixa que ficava
    // pra trás a cada tela nova.
    var version = window.APP_VERSION || '—';
    var labels = document.querySelectorAll('[id$="-ver-label"]');
    var i;
    for (i = 0; i < labels.length; i += 1) {
      labels[i].textContent = version;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMenus);else initMenus();
})();