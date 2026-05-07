// Bump this whenever the STL contents on GCS change. Old caches are deleted
// on activate so existing visitors don't keep serving stale tiles.
const CACHE_NAME = 'fly-over-ghent-tiles-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const url = event.request.url;

    // Only cache STL files from GCS
    if (!url.includes('storage.googleapis.com/fly-over-ghent/') || !url.endsWith('.stl')) {
        return;
    }

    event.respondWith(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(url);
            if (cached) return cached;

            const response = await fetch(url);
            if (response.ok) {
                cache.put(url, response.clone());
            }
            return response;
        })()
    );
});
