const CACHE_NAME = 'physio-tracker-v3';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/icons/icon.svg',
  './css/design-system.css',
  './css/app.css',
  './vendor/chart.min.js',
  './vendor/qrcode.min.js',
  './vendor/firebase-app-compat.js',
  './vendor/firebase-firestore-compat.js',
  './js/config.js',
  './js/db.js',
  './js/clinical.js',
  './js/ledger.js',
  './js/payments.js',
  './js/analytics.js',
  './js/app.js',
  './data/seed-data.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  
  if (req.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(req).then(cachedResponse => {
      if (cachedResponse) {
        fetch(req).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(req, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(req).then(networkResponse => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, responseToCache));
        return networkResponse;
      });
    }).catch(() => {
      if (req.headers.get('accept').includes('text/html')) {
        return caches.match('./index.html');
      }
    })
  );
});
