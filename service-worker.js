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
	'./js/visualization.js',
	'./js/vessel.js',
	'./js/buoy.js',
	'./js/data.js',
	'./js/utils.js',
	'./js/buoy-old.js',
	'./js/data-old.js',
	'./js/map-old.js',
	'./js/utils-old.js',
	'./manifest.json',
	'./mmsi_countries.csv',
	'./baltic_maritime_boundaries.geojson',
	'./helcom_territorial.geojson',
	'./territorial_labels.geojson',
	'./data/ais/latest.json',
	'./icon-192.png',
	'./icon-192.svg',
	'./icon-512.png',
	'./icon-512.svg',
];

self.addEventListener('install', function(event) {
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then(function(cache) {
				return cache.addAll(urlsToCache);
			})
	);
});

self.addEventListener('activate', function(event) {
	event.waitUntil(
		caches.keys().then(function(cacheNames) {
			return Promise.all(
				cacheNames.filter(function(cacheName) {
					return cacheName.startsWith('anchor-draggers-v') && cacheName !== CACHE_NAME;
				}).map(function(cacheName) {
					return caches.delete(cacheName);
				})
			);
		})
	);
});

self.addEventListener('fetch', function(event) {
	event.respondWith(
		caches.match(event.request)
			.then(function(response) {
				return response || fetch(event.request);
			})
	);
});
