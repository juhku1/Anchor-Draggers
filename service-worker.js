// Cache version - automatically uses version from query string (?v=X.XX)
// Update app-version meta tag in index.html to trigger cache update
const urlParams = new URLSearchParams(self.location.search);
const VERSION = urlParams.get('v') || '1.29';
const CACHE_NAME = 'anchor-draggers-v' + VERSION;

const urlsToCache = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/map.js',
  './js/data.js',
  './js/buoy.js',
  './js/vessel.js',
  './js/utils.js',
  './js/visualization.js',
  './baltic_maritime_boundaries.geojson',
  './helcom_territorial.geojson',
  './territorial_labels.geojson',
  './mmsi_countries.csv'
];

// Install event - cache resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.log('Cache install error:', err);
      })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, then cache
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  // Skip external requests (MapLibre, AIS API, etc.)
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Clone the response
        const responseToCache = response.clone();
        
        // Update cache with new response
        caches.open(CACHE_NAME)
          .then(cache => {
            cache.put(event.request, responseToCache);
          });
        
        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request)
          .then(response => {
            if (response) {
              return response;
            }
            // If not in cache, return offline page or error
            return new Response('Offline - resource not cached', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
      })
  );
});
