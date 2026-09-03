// Service worker : met en cache l'essentiel de l'app pour qu'elle s'ouvre hors
// ligne. Après une modification du code, pensez à incrémenter CACHE_NAME
// (v4 -> v5, etc.) pour forcer le rafraîchissement du cache chez les
// utilisateurs. Les appels vers des domaines externes (Firebase, etc.) ne
// sont jamais interceptés : seul le "coquille" de l'app est mis en cache ici.
const CACHE_NAME = 'budget-couple-v18';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/storage.js',
  './js/calculations.js',
  './js/recurring.js',
  './js/github-backup.js',
  './js/firebase-sync.js',
  './js/firebase-config.js',
  './js/app.js',
  './fonts/manrope-400.woff2',
  './fonts/manrope-500.woff2',
  './fonts/manrope-600.woff2',
  './fonts/manrope-700.woff2',
  './fonts/manrope-800.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
