const CACHE='dt-coletor-v170-r2';
const ASSETS=['/coletor.html','/manifest-coletor.json','/icons/coletor-192.png','/icons/coletor-512.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).catch(()=>{}));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.origin!==location.origin)return;
  if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r;}).catch(()=>caches.match('/coletor.html').then(cached=>cached||new Response('Sem conexão. Reconecte-se e tente novamente.',{status:200,headers:{'Content-Type':'text/plain; charset=utf-8'}}))));return;}
  e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r;}).catch(()=>caches.match(e.request).then(cached=>cached||new Response('',{status:504,statusText:'Offline'}))));
});
self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting();});
