/* SBro PWA v1.0.2 – caches only the public app shell, never financial API responses. */
const CACHE = 'sbro-pwa-shell-v102';
const PREFIX = 'sbro-pwa-shell-';
const SHELL = ['./', './index.html', './styles.css', './app.js', './pwa.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => response.ok ? response : Promise.reject(Error('Navigation fehlgeschlagen'))).catch(() => caches.match('./index.html')));
    return;
  }
  const staticFiles = ['/index.html','/styles.css','/app.js','/pwa.js','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/apple-touch-icon.png'];
  if (!staticFiles.some(path => url.pathname.endsWith(path))) return;
  event.respondWith(fetch(request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(c=>c.put(request,copy));}return response;}).catch(()=>caches.match(request)));
});