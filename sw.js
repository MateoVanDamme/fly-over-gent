const CACHE_NAME = 'fly-over-ghent-tiles';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
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
