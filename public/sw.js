var CACHE='dt-inventario-v90-sync-diagnostico';
var PRECACHE=[
  '/',
  '/coletor.html',
  '/manifest.json',
  '/js-legacy/shared/common-utils.js',
  '/js-legacy/shared/firebase-shared.js',
  '/js-legacy/shared/enderecos-service.js',
  '/js-legacy/coletor/00-bootstrap-manifest.js',
  '/js-legacy/coletor/01-core-firebase-cache.js',
  '/js-legacy/coletor/03-estado-app.js',
  '/js-legacy/coletor/04-auth-login.js',
  '/js-legacy/coletor/05-inventarios-download.js',
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
self.addEventListener('fetch',function(e){if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(function(r){if(r&&r.ok){var c=r.clone();caches.open(CACHE).then(function(x){return x.put(e.request,c);}).catch(function(){});}return r;}).catch(function(){return caches.match(e.request).then(function(cached){return cached||new Response('Offline',{status:503,statusText:'Offline'});});}));});
