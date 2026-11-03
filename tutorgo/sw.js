const K='nismcaa-tutor-v1';self.addEventListener('install',e=>e.waitUntil(caches.open(K).then(c=>c.addAll(['./','icon.svg','manifest.webmanifest']))));
self.addEventListener('fetch',e=>e.respondWith(fetch(e.request).catch(()=>caches.match(e.request))));
