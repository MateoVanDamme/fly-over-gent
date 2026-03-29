import { ORIGIN_X, ORIGIN_Y } from './tileLoader.js';

const TILE_SIZE = 1000;
const PIXEL_SIZE = 10; // pixels per tile on the minimap
const PADDING = 10;

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
export { canvas as minimapCanvas };

let ctx, staticCanvas, minX, maxY;
let ready = false;

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
            staticCtx.fillStyle = '#ff3333';
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

    // Draw camera dot
    const camPx = ((lambertX - minX) / TILE_SIZE) * PIXEL_SIZE;
    const camPy = ((maxY - lambertY) / TILE_SIZE) * PIXEL_SIZE;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(camPx - 4, camPy - 4, 8, 8);
}
