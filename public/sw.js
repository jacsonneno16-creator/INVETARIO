var CACHE='dt-inventario-v237-mapper-click-20260802-1';
var PRECACHE=[
  '/',
  '/index.html',
  '/analista.html',
  '/coletor.html',
  '/manifest.webmanifest',
  '/manifest-coletor.json',
  '/vendor/xlsx-0.18.5/xlsx.full.min.js',
  '/vendor/firebase-10.12.2/firebase-app-compat.js',
  '/vendor/firebase-10.12.2/firebase-auth-compat.js',
  '/vendor/firebase-10.12.2/firebase-firestore-compat.js',
  '/vendor/firebase-10.12.2/firebase-functions-compat.js',
  '/js/legacy-polyfills.js',
  '/js/shared/common-utils.js',
  '/js/shared/address-state-engine.js',
  '/js/shared/address-state-selectors.js',
  '/js/shared/address-state-view.js',
  '/js/shared/firebase-shared.js',
  '/js/shared/enderecos-service.js',
  '/js/shared/produtos-service.js',
  '/js/analista/actions.js',
  '/js/analista/reducers.js',
  '/js/analista/store.js',
  '/js/analista/00-auth-login.js',
  '/js/analista/01-core-base-storage.js',
  '/js/analista/02-core-state-bootstrap.js',
  '/js/analista/03-core-navigation.js',
  '/js/analista/04-compat-pages.js',
  '/js/analista/09-fs-publicar.js',
  '/js/analista/10-inventarios-negocio.js',
  '/js/analista/11-importacao-base-oficial.js',
  '/js/analista/12-validacao-operacional.js',
  '/js/analista/13-enderecos-importacao-selecao.js',
  '/js/analista/20-sync-contagens.js',
  '/js/analista/21-divergencias-recontagens.js',
  '/js/analista/22-dashboard-render-sync.js',
  '/js/analista/30-render-inventarios-acompanhamento.js',
  '/js/analista/31-render-contagens-pendencias.js',
  '/js/analista/32-render-divergencias-recontagens.js',
  '/js/analista/33-render-enderecos.js',
  '/js/analista/34-coletores-modelo-dispositivo.js',
  '/js/analista/35-coletores-render.js',
  '/js/analista/36-lojas.js',
  '/js/analista/37-usuarios-permissoes.js',
  '/js/analista/38-auditoria-operacional-v22.js',
  '/js/analista/39-base-produtos.js',
  '/js/analista/40-relatorios-produtividade.js',
  '/js/analista/41-dashboard-acomp-v37.js',
  '/js/analista/41-inventario-actions-v52.js',
  '/js/analista/42-topbar-tools.js',
  '/js/analista/43-importar-exportar-api.js',
  '/js/analista/44-auditoria-remediacoes.js',
  '/js/analista/app-controller.js',
  '/js/analista/firebaseService.js',
  '/js/analista/services/inventarioService.js',
  '/js/analista/services/auditoriaService.js',
  '/js/analista/services/divergenciaService.js',
  '/js/coletor/00-bootstrap-manifest.js',
  '/js/coletor/01-core-firebase-cache.js',
  '/js/coletor/02-sync-dispositivo.js',
  '/js/coletor/03-estado-app.js',
  '/js/coletor/04-auth-login.js',
  '/js/coletor/05-inventarios-download.js',
  '/js/coletor/06-capa-fluxo-steps.js',
  '/js/coletor/07-etapa-endereco.js',
  '/js/coletor/08-etapas-produto-quantidade-salvamento.js',
  '/js/coletor/09-historico-stats.js',
  '/js/coletor/10-navegacao-estorno.js',
  '/js/coletor/11-recontagens.js',
  '/js/coletor/12-scanner-hardware.js',
  '/js/coletor/13-audio-feedback.js',
  '/js/coletor/14-toast.js',
  '/js/coletor/15-utils-init.js',
  '/js/coletor/16-menu-atualizacao.js',
  '/js/coletor/17-auditoria-meta.js',
  '/js/coletor/18-auditoria-fluxo.js',
  '/js/coletor/19-runtime-estavel-v15.js',
  '/js/legacy-ui-compat.js'
];
self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){
    return Promise.all(PRECACHE.map(function(url){
      return fetch(url,{cache:'no-store'}).then(function(response){
        if(!response||!response.ok){
          throw new Error('HTTP '+(response?response.status:'sem resposta'));
        }
        return c.put(url,response);
      }).catch(function(error){
        // Um recurso opcional indisponível não deve invalidar toda a instalação.
        // O fetch handler tentará buscá-lo novamente quando ele for solicitado.
        console.warn('[SW] Falha no pré-cache de '+url+':',error.message||error);
        return null;
      });
    }));
  }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});
self.addEventListener('fetch',function(e){
  if(e.request.method!=='GET')return;
  var u=new URL(e.request.url);
  var local=u.origin===self.location.origin;
  if(local){
    var arquivoCritico=e.request.mode==='navigate' ||
      u.pathname.slice(-5)==='.html' ||
      u.pathname.slice(-3)==='.js';
    if(arquivoCritico){
      e.respondWith(fetch(e.request,{cache:'no-store'}).then(function(r){
        if(!r||!r.ok)throw new Error('Resposta inválida');
        var copia=r.clone();
        e.waitUntil(caches.open(CACHE).then(function(c){
          return c.put(u.pathname,copia);
        }).catch(function(err){ console.warn('[SW] Falha ao atualizar cache:',err); }));
        return r;
      }).catch(function(){
        return caches.match(u.pathname,{ignoreSearch:true}).then(function(exata){
          if(exata)return exata;
          if(e.request.mode==='navigate'){
            var fallback=u.pathname.indexOf('coletor')>=0?'/coletor.html':
              (u.pathname.indexOf('analista')>=0?'/analista.html':'/index.html');
            return caches.match(fallback,{ignoreSearch:true});
          }
          return new Response('',{status:504,statusText:'Offline'});
        });
      }));
      return;
    }
    e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(function(cached){
      var atualiza=fetch(e.request).then(function(r){
        if(r&&r.ok){var copia=r.clone();caches.open(CACHE).then(function(c){return c.put(u.pathname,copia);}).catch(function(err){console.warn('[SW] Falha ao atualizar recurso:',err);});}
        return r;
      }).catch(function(){return null;});
      return cached||atualiza.then(function(r){
        if(r)return r;
        if(e.request.mode==='navigate'){
          var fallback=u.pathname.indexOf('coletor')>=0?'/coletor.html':
            (u.pathname.indexOf('analista')>=0?'/analista.html':'/index.html');
          return caches.match(fallback,{ignoreSearch:true}).then(function(page){
            return page||new Response('Sem conexão. Reconecte-se e tente novamente.',{
              status:200,
              headers:{'Content-Type':'text/plain; charset=utf-8'}
            });
          });
        }
        return new Response('',{status:504,statusText:'Offline'});
      });
    }));
    return;
  }
  e.respondWith(fetch(e.request).catch(function(){
    return caches.match(e.request).then(function(cached){
      return cached || new Response('',{status:504,statusText:'Offline'});
    });
  }));
});
