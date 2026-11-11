/**
 * High-Performance Service Worker
 * Network-First for core app files (guarantees instant updates) with Cache Fallback for 100% offline support
 */

const CACHE_NAME = 'physio-tracker-v11';
const CORE_ASSETS = [
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
  './js/auth.js',
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
      return cache.addAll(CORE_ASSETS);
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

  // Network-First strategy for core app files to guarantee immediate update visibility
  event.respondWith(
    fetch(req).then(networkResponse => {
      if (networkResponse && networkResponse.status === 200) {
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, responseToCache));
      }
      return networkResponse;
    }).catch(() => {
      // Offline fallback to cache
      return caches.match(req).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        if (req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
          return caches.match('./index.html');
        }
      });
    })
  );
});
