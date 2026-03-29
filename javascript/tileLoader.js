import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// Data source configuration
const USE_ONLINE_DATA = true;
const ONLINE_DATA_BASE = 'https://storage.googleapis.com/fly-over-ghent/';
const EDGES_ENABLED = false;

// Tile system constants
const TILE_SIZE = 1000;
const VIEW_DISTANCE = 2; // tiles in each direction (2 = 5x5 grid)
export const ORIGIN_X = 104000;
export const ORIGIN_Y = 193000;

// Track loaded tiles: key "x_y" → THREE.Group (currently in scene)
export const loadedTiles = new Map();
// Track tiles currently being loaded: key "x_y" → AbortController
export const loadingTiles = new Map();
// Cache of tiles removed from scene but kept in memory: key "x_y" → THREE.Group
export const tileCache = new Map();
// Cache last state to skip redundant updateChunks calls
let lastCameraTileKey = '';
let lastDirX = 0;
let lastDirY = 0;

const loader = new STLLoader();

// Shared materials
const buildingMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    flatShading: true,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true
});

const terrainMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    flatShading: false,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true
});

terrainMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.cutoffHeight = { value: 6.5 };
    shader.uniforms.lowColor = { value: new THREE.Color(0xcc0000) };
    shader.uniforms.highColor = { value: new THREE.Color(0xffffff) };

    shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        varying float vHeight;`
    );
    shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vHeight = position.z;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        uniform float cutoffHeight;
        uniform vec3 lowColor;
        uniform vec3 highColor;
        varying float vHeight;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `vec3 heightColor = vHeight < cutoffHeight ? lowColor : highColor;
        vec4 diffuseColor = vec4( heightColor, opacity );`
    );
};

/**
 * Convert camera world position to Lambert-72 tile coordinates
 */
function getCameraTile(cameraPosition) {
    const lambertX = ORIGIN_X + cameraPosition.x;
    const lambertY = ORIGIN_Y - cameraPosition.z;
    return {
        x: Math.floor(lambertX / TILE_SIZE) * TILE_SIZE,
        y: Math.floor(lambertY / TILE_SIZE) * TILE_SIZE
    };
}

/**
 * Build file paths for a tile
 */
function getTilePaths(tileX, tileY) {
    const dataPath = USE_ONLINE_DATA ? ONLINE_DATA_BASE : 'data/';
    const coord = `${tileX}_${tileY}`;
    return {
        building: dataPath + `stl/Geb_${coord}_10_2_N_2013.stl`,
        terrain: dataPath + `stl/Trn_${coord}_10_0_N_2013.stl`
    };
}

/**
 * Load a single STL and return a promise resolving to the mesh
 */
async function loadSTL(url, material, isTerrain, tileX, tileY, signal) {
    const response = await fetch(url, { signal });
    const buffer = await response.arrayBuffer();

    const geometry = loader.parse(buffer);
    geometry.translate(-tileX, -tileY, 0);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, material);

    if (EDGES_ENABLED) {
        const edgeThreshold = isTerrain ? 1 : 10;
        const edgeColor = isTerrain ? 0x999999 : 0x000000;
        const edges = new THREE.EdgesGeometry(geometry, edgeThreshold);
        const lineMaterial = new THREE.LineBasicMaterial({ color: edgeColor, linewidth: 1 });
        const edgeLines = new THREE.LineSegments(edges, lineMaterial);
        mesh.add(edgeLines);
    }

    return mesh;
}

/**
 * Load both building and terrain for a tile, add to scene
 */
async function loadTile(scene, tileX, tileY) {
    const key = `${tileX}_${tileY}`;
    if (loadedTiles.has(key) || loadingTiles.has(key)) return;

    // Restore from cache if available
    const cached = tileCache.get(key);
    if (cached) {
        scene.add(cached);
        loadedTiles.set(key, cached);
        tileCache.delete(key);
        return;
    }

    const controller = new AbortController();
    loadingTiles.set(key, controller);

    const paths = getTilePaths(tileX, tileY);
    const group = new THREE.Group();

    // World position: tile Lambert coords relative to origin
    const worldX = tileX - ORIGIN_X;
    const worldZ = -(tileY - ORIGIN_Y);
    group.position.set(worldX, 0, worldZ);
    group.rotation.x = -Math.PI / 2;

    // Load building and terrain in parallel, tolerating missing files
    const results = await Promise.allSettled([
        loadSTL(paths.building, buildingMaterial, false, tileX, tileY, controller.signal),
        loadSTL(paths.terrain, terrainMaterial, true, tileX, tileY, controller.signal)
    ]);

    // If tile was cancelled while loading, discard
    if (!loadingTiles.has(key)) return;
    loadingTiles.delete(key);

    let hasContent = false;
    for (const result of results) {
        if (result.status === 'fulfilled') {
            group.add(result.value);
            hasContent = true;
        }
    }

    if (hasContent) {
        scene.add(group);
        loadedTiles.set(key, group);
    }
}

/**
 * Unload a tile: dispose geometry and remove from scene
 */
function unloadTile(key) {
    // Cancel in-flight request if still loading
    const controller = loadingTiles.get(key);
    if (controller) {
        controller.abort();
        loadingTiles.delete(key);
    }

    const group = loadedTiles.get(key);
    if (!group) return;

    // Remove from scene but keep in cache
    group.parent?.remove(group);
    loadedTiles.delete(key);
    tileCache.set(key, group);
}

/**
 * Call each frame: loads/unloads tiles to maintain a 3x3 grid around the camera
 */
export function updateChunks(scene, cameraPosition, cameraDirection) {
    const cameraTile = getCameraTile(cameraPosition);
    const cameraTileKey = `${cameraTile.x}_${cameraTile.y}`;

    // Camera forward direction in Lambert-72 space (x maps to lambertX, -z maps to lambertY)
    const dirX = cameraDirection.x;
    const dirY = -cameraDirection.z;

    // Skip if neither position nor direction changed significantly
    const dirChanged = Math.abs(dirX - lastDirX) > 0.3 || Math.abs(dirY - lastDirY) > 0.3;
    if (cameraTileKey === lastCameraTileKey && !dirChanged) return;
    lastCameraTileKey = cameraTileKey;
    lastDirX = dirX;
    lastDirY = dirY;

    const desired = new Set();
    for (let dx = -VIEW_DISTANCE; dx <= VIEW_DISTANCE; dx++) {
        for (let dy = -VIEW_DISTANCE; dy <= VIEW_DISTANCE; dy++) {
            // Always keep the tile we're standing on
            if (dx === 0 && dy === 0) {
                desired.add(`${cameraTile.x}_${cameraTile.y}`);
                continue;
            }
            // Dot product between camera direction and tile offset
            const dot = dx * dirX + dy * dirY;
            if (dot >= -0.3) { // generous ~110° half-angle in front
                const tx = cameraTile.x + dx * TILE_SIZE;
                const ty = cameraTile.y + dy * TILE_SIZE;
                desired.add(`${tx}_${ty}`);
            }
        }
    }

    // Unload/cancel tiles no longer in range
    for (const key of loadedTiles.keys()) {
        if (!desired.has(key)) unloadTile(key);
    }
    for (const key of loadingTiles.keys()) {
        if (!desired.has(key)) unloadTile(key);
    }

    // Load new tiles
    for (const key of desired) {
        if (!loadedTiles.has(key) && !loadingTiles.has(key)) {
            const [x, y] = key.split('_').map(Number);
            loadTile(scene, x, y);
        }
    }
}
