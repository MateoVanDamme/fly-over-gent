import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// Data source configuration
export const USE_ONLINE_DATA = false;
export const ONLINE_DATA_BASE = 'https://storage.googleapis.com/fly-over-ghent/';
const EDGES_ENABLED = false;

// Tile system constants
const TILE_SIZE = 1000;
const VIEW_DISTANCE = 2; // tiles in each direction (2 = 5x5 grid)
export const ORIGIN_X = 104000;
export const ORIGIN_Y = 193000;

// Track loaded tiles: key "x_y" → THREE.Group
const loadedTiles = new Map();
// Track tiles currently being loaded to avoid duplicate requests
const loadingTiles = new Set();
// Cache last tile coord to skip redundant updateChunks calls
let lastCameraTileKey = '';

const loader = new STLLoader();

// Shared materials
const buildingMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    flatShading: true,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: true
});

const terrainMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    flatShading: false,
    side: THREE.BackSide,
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
        building: dataPath + `stl/ACAD-Geb_${coord}_10_2_N_2013.stl`,
        terrain: dataPath + `stl/ACAD-Trn_${coord}_10_0_N_2013.stl`
    };
}

/**
 * Load a single STL and return a promise resolving to the mesh
 */
function loadSTL(url, material, isTerrain, tileX, tileY) {
    return new Promise((resolve, reject) => {
        loader.load(
            url,
            (geometry) => {
                // Translate geometry from Lambert-72 coords to local origin
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

                resolve(mesh);
            },
            undefined,
            (error) => reject(error)
        );
    });
}

/**
 * Load both building and terrain for a tile, add to scene
 */
async function loadTile(scene, tileX, tileY) {
    const key = `${tileX}_${tileY}`;
    if (loadedTiles.has(key) || loadingTiles.has(key)) return;

    loadingTiles.add(key);

    const paths = getTilePaths(tileX, tileY);
    const group = new THREE.Group();

    // World position: tile Lambert coords relative to origin
    const worldX = tileX - ORIGIN_X;
    const worldZ = -(tileY - ORIGIN_Y);
    group.position.set(worldX, 0, worldZ);
    group.rotation.x = -Math.PI / 2;

    // Load building and terrain in parallel, tolerating missing files
    const results = await Promise.allSettled([
        loadSTL(paths.building, buildingMaterial, false, tileX, tileY),
        loadSTL(paths.terrain, terrainMaterial, true, tileX, tileY)
    ]);

    // If tile was unloaded while we were loading, abort
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
        console.log(`Loaded tile ${key}`);
    }
}

/**
 * Unload a tile: dispose geometry and remove from scene
 */
function unloadTile(key) {
    const group = loadedTiles.get(key);
    if (!group) return;

    group.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material && child.material !== buildingMaterial && child.material !== terrainMaterial) {
            child.material.dispose();
        }
    });

    group.parent?.remove(group);
    loadedTiles.delete(key);
    loadingTiles.delete(key);
    console.log(`Unloaded tile ${key}`);
}

/**
 * Call each frame: loads/unloads tiles to maintain a 3x3 grid around the camera
 */
export function updateChunks(scene, cameraPosition) {
    const cameraTile = getCameraTile(cameraPosition);
    const cameraTileKey = `${cameraTile.x}_${cameraTile.y}`;
    if (cameraTileKey === lastCameraTileKey) return;
    lastCameraTileKey = cameraTileKey;

    const desired = new Set();
    for (let dx = -VIEW_DISTANCE; dx <= VIEW_DISTANCE; dx++) {
        for (let dy = -VIEW_DISTANCE; dy <= VIEW_DISTANCE; dy++) {
            const tx = cameraTile.x + dx * TILE_SIZE;
            const ty = cameraTile.y + dy * TILE_SIZE;
            desired.add(`${tx}_${ty}`);
        }
    }

    // Unload tiles no longer in range
    for (const key of loadedTiles.keys()) {
        if (!desired.has(key)) {
            unloadTile(key);
        }
    }

    // Load new tiles
    for (const key of desired) {
        if (!loadedTiles.has(key) && !loadingTiles.has(key)) {
            const [x, y] = key.split('_').map(Number);
            loadTile(scene, x, y);
        }
    }
}
