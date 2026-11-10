/* Service worker: lets the app open without internet.

   Strategy "network first":
     – online:  always load the newest files from GitHub (and keep a copy)
     – offline: use the saved copy (also when the network takes longer than 4 s)
   So updates arrive the next time you open the app with internet.

   Still raise the version number below after every change (v8 → v9 …),
   and also APP_VERSION at the top of app.js – then you can see in
   Settings which version your phone is running. */
const CACHE = 'moetervlog-v9';
const FILES = ['./', './index.html', './style.css', './app.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable.png'];

self.addEventListener('install', e => {
  // cache: 'reload' = really ask GitHub, not the browser's short-term memory
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f =>
    fetch(new Request(f, { cache: 'reload' })).then(r => { if (r.ok) return c.put(f, r); }).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fromNet = fetch(e.request, { cache: 'no-cache' }).then(res => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    });
    const timeout = new Promise(resolve => setTimeout(resolve, 4000));
    try {
      const res = await Promise.race([fromNet, timeout]);
      if (res) return res;
    } catch (err) { /* offline */ }
    const cached = await cache.match(e.request, { ignoreSearch: true });
    return cached || fromNet;
  })());
});
