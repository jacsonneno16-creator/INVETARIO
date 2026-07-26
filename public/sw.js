var CACHE='dt-inventario-v125-recontagem-rodadas-analista';
var PRECACHE=[
  '/',
  '/coletor.html',
  '/manifest.json',
  '/js-legacy/shared/common-utils.js',
  '/js-legacy/shared/firebase-shared.js',
  '/js-legacy/shared/enderecos-service.js',
  '/js-legacy/shared/produtos-service.js',
  '/js-legacy/coletor/00-bootstrap-manifest.js',
  '/js-legacy/coletor/01-core-firebase-cache.js',
  '/js-legacy/coletor/03-estado-app.js',
  '/js-legacy/coletor/04-auth-login.js',
  '/js-legacy/coletor/05-inventarios-download.js',
  '/js-legacy/coletor/07-etapa-endereco.js',
  '/js-legacy/coletor/08-etapas-produto-quantidade-salvamento.js',
  '/js-legacy/coletor/17-auditoria-meta.js',
  '/js-legacy/coletor/18-auditoria-fluxo.js'
];
self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){
    return Promise.all(PRECACHE.map(function(url){
      return c.add(url).catch(function(){ return null; });
    }));
  }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});
self.addEventListener('fetch',function(e){
  if(e.request.method!=='GET')return;
  var u=new URL(e.request.url);
  var local=u.origin===self.location.origin;
  if(local){
    e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(function(cached){
      var atualiza=fetch(e.request).then(function(r){
        if(r&&r.ok){var copia=r.clone();caches.open(CACHE).then(function(c){return c.put(e.request,copia);}).catch(function(){});}
        return r;
      }).catch(function(){return null;});
      return cached||atualiza.then(function(r){return r||new Response('Offline',{status:503,statusText:'Offline'});});
    }));
    return;
  }
  e.respondWith(fetch(e.request).catch(function(){return caches.match(e.request);}));
});
