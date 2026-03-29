import { ORIGIN_X, ORIGIN_Y, loadedTiles, loadingTiles, tileCache } from './tileLoader.js';

const TILE_SIZE = 1000;
const PIXEL_SIZE = 10; // pixels per tile on the minimap
const PADDING = 10;

// Colors (blackbody heat: dark red → red → orange → yellow → white)
const COLOR_TILE = '#551100';       // available tiles (dark ember)
const COLOR_SW_CACHED = '#882200';  // in service worker cache (warm ember)
const COLOR_CACHED = '#cc3300';     // in memory, not in scene (red)
const COLOR_LOADING = '#ff8800';    // loading (orange)
const COLOR_LOADED = '#ffee55';     // loaded in scene (yellow-hot)
const COLOR_CAMERA = '#ffffff';     // camera position (white-hot)

// Create canvas (initially hidden until data loads)
const canvas = document.createElement('canvas');
canvas.style.cssText = `
    position: fixed;
    top: ${PADDING}px;
    right: ${PADDING}px;
    background: transparent;
    image-rendering: pixelated;
    z-index: 100;
    pointer-events: none;
`;
document.body.appendChild(canvas);
let ctx, staticCanvas, minX, maxY;
let ready = false;

// Tiles known to be in the Service Worker cache
const swCachedTiles = new Set();

// Query SW cache for stored tiles
async function refreshSWCache() {
    if (!('caches' in self)) return;
    try {
        const cache = await caches.open('fly-over-ghent-tiles');
        const keys = await cache.keys();
        swCachedTiles.clear();
        for (const request of keys) {
            const match = request.url.match(/(?:Geb|Trn)_(\d+)_(\d+)/);
            if (match) swCachedTiles.add(`${match[1]}_${match[2]}`);
        }
    } catch (e) { /* SW not available */ }
}
refreshSWCache();
// Refresh SW cache list every 5 seconds
setInterval(refreshSWCache, 5000);

// Load tile data and build the static grid
fetch('data/gent-in-3d.json')
    .then(r => r.json())
    .then(tileData => {
        const tileSet = new Set();
        let _minX = Infinity, _maxX = -Infinity, _minY = Infinity, _maxY = -Infinity;

        for (const entry of tileData) {
            const [tx, ty] = entry.vaknummer.split('_').map(n => n * 1000);
            tileSet.add(`${tx}_${ty}`);
            if (tx < _minX) _minX = tx;
            if (tx > _maxX) _maxX = tx;
            if (ty < _minY) _minY = ty;
            if (ty > _maxY) _maxY = ty;
        }

        minX = _minX;
        maxY = _maxY;

        const gridW = (_maxX - _minX) / TILE_SIZE + 1;
        const gridH = (_maxY - _minY) / TILE_SIZE + 1;

        canvas.width = gridW * PIXEL_SIZE;
        canvas.height = gridH * PIXEL_SIZE;
        ctx = canvas.getContext('2d');

        // Pre-render static tile grid
        staticCanvas = document.createElement('canvas');
        staticCanvas.width = canvas.width;
        staticCanvas.height = canvas.height;
        const staticCtx = staticCanvas.getContext('2d');

        for (const key of tileSet) {
            const [tx, ty] = key.split('_').map(Number);
            const px = ((tx - _minX) / TILE_SIZE) * PIXEL_SIZE;
            const py = ((_maxY - ty) / TILE_SIZE) * PIXEL_SIZE;
            staticCtx.fillStyle = COLOR_TILE;
            staticCtx.fillRect(px, py, PIXEL_SIZE - 1, PIXEL_SIZE - 1);
        }

        ready = true;
    });

/**
 * Call each frame with the camera position to update the minimap
 */
export function updateMinimap(cameraPosition) {
    if (!ready) return;

    const lambertX = ORIGIN_X + cameraPosition.x;
    const lambertY = ORIGIN_Y - cameraPosition.z;

    // Draw static grid
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticCanvas, 0, 0);

    // Highlight SW-cached tiles
    ctx.fillStyle = COLOR_SW_CACHED;
    for (const key of swCachedTiles) {
        if (loadedTiles.has(key) || tileCache.has(key)) continue;
        const [tx, ty] = key.split('_').map(Number);
        const px = ((tx - minX) / TILE_SIZE) * PIXEL_SIZE;
        const py = ((maxY - ty) / TILE_SIZE) * PIXEL_SIZE;
        ctx.fillRect(px, py, PIXEL_SIZE - 1, PIXEL_SIZE - 1);
    }

    // Highlight in-memory cached tiles
    ctx.fillStyle = COLOR_CACHED;
    for (const key of tileCache.keys()) {
        const [tx, ty] = key.split('_').map(Number);
        const px = ((tx - minX) / TILE_SIZE) * PIXEL_SIZE;
        const py = ((maxY - ty) / TILE_SIZE) * PIXEL_SIZE;
        ctx.fillRect(px, py, PIXEL_SIZE - 1, PIXEL_SIZE - 1);
    }

    // Highlight loading tiles
    ctx.fillStyle = COLOR_LOADING;
    for (const key of loadingTiles.keys()) {
        const [tx, ty] = key.split('_').map(Number);
        const px = ((tx - minX) / TILE_SIZE) * PIXEL_SIZE;
        const py = ((maxY - ty) / TILE_SIZE) * PIXEL_SIZE;
        ctx.fillRect(px, py, PIXEL_SIZE - 1, PIXEL_SIZE - 1);
    }

    // Highlight loaded tiles
    ctx.fillStyle = COLOR_LOADED;
    for (const key of loadedTiles.keys()) {
        const [tx, ty] = key.split('_').map(Number);
        const px = ((tx - minX) / TILE_SIZE) * PIXEL_SIZE;
        const py = ((maxY - ty) / TILE_SIZE) * PIXEL_SIZE;
        ctx.fillRect(px, py, PIXEL_SIZE - 1, PIXEL_SIZE - 1);
    }

    // Draw camera position
    const camPx = ((lambertX - minX) / TILE_SIZE) * PIXEL_SIZE;
    const camPy = ((maxY - lambertY) / TILE_SIZE) * PIXEL_SIZE;

    ctx.fillStyle = COLOR_CAMERA;
    ctx.fillRect(camPx - 4, camPy - 4, 8, 8);
}
