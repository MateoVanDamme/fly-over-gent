import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// Data source configuration
export const USE_ONLINE_DATA = true; // true = online storage, false = local data folder
export const ONLINE_DATA_BASE = 'https://storage.googleapis.com/fly-over-ghent/';

/**
 * Parses Lambert-72 coordinates from a filename
 * Format: Geb_105000_192000_10_2_N_2013.stl
 * Extracts X (105000) and Y (192000) coordinates
 */
function parseLambert72Filename(filename) {
    const parts = filename.split('/').pop().replace('.stl', '').split('_');
    return {
        x: parseInt(parts[1]),
        y: parseInt(parts[2]),
        filename: filename
    };
}

/**
 * Loads and processes STL tiles for buildings and terrain
 * @param {THREE.Scene} scene - The Three.js scene to add meshes to
 * @param {Function} onProgress - Callback for loading progress (loadedCount, totalTiles)
 * @param {Function} onComplete - Callback when all tiles are loaded
 * @param {Function} onError - Callback for errors
 */
export function loadSTLTiles(scene, onProgress, onComplete, onError) {
    // Data path prefix based on configuration
    const dataPath = USE_ONLINE_DATA ? ONLINE_DATA_BASE : 'data/';

    // Building STL files to load
    const buildingFiles = [
        dataPath + 'Dwg_105000_192000_10_2_N_2009/Geb_105000_192000_10_2_N_2013.stl',
        dataPath + 'Dwg_105000_193000_10_2_N_2009/Geb_105000_193000_10_2_N_2013.stl'
    ];

    // Terrain STL files to load
    const terrainFiles = [
        dataPath + 'Dwg_105000_192000_10_2_N_2009/Trn_105000_192000_10_0_N_2013.stl',
        dataPath + 'Dwg_105000_193000_10_2_N_2009/Trn_105000_193000_10_0_N_2013.stl'
    ];

    // Parse coordinates from all files
    const allFiles = [...buildingFiles, ...terrainFiles];
    const tiles = allFiles.map(parseLambert72Filename);

    // Find the minimum coordinates to use as origin
    const minX = Math.min(...tiles.map(t => t.x));
    const minY = Math.min(...tiles.map(t => t.y));

    // Load STL files
    const loader = new STLLoader();
    let loadedCount = 0;
    const totalTiles = tiles.length;

    // Material for buildings
    const buildingMaterial = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        specular: 0x111111,
        shininess: 200,
        flatShading: true,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true
    });

    // Material for terrain
    const terrainMaterial = new THREE.MeshPhongMaterial({
        color: 0xcccccc, // Bright gray
        specular: 0x050505,
        shininess: 5,
        flatShading: true,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true
    });

    tiles.forEach(tile => {
        // Determine if this is a terrain or building file
        const isTerrain = tile.filename.includes('Trn_');
        const material = isTerrain ? terrainMaterial : buildingMaterial;

        loader.load(
            tile.filename,
            (geometry) => {
                // Scale geometry from millimeters to meters
                const scaleFactor = 0.001;
                geometry.scale(scaleFactor, scaleFactor, scaleFactor);

                // Center on X/Y but not Z (height)
                geometry.computeBoundingBox();
                const box = geometry.boundingBox;
                const centerX = (box.min.x + box.max.x) / 2;
                const centerY = (box.min.y + box.max.y) / 2;
                geometry.translate(-centerX, -centerY, -box.min.z);

                // Create mesh
                const mesh = new THREE.Mesh(geometry, material);

                // Calculate relative position from origin based on filename coordinates
                const relativeX = (tile.x - minX);
                const relativeY = (tile.y - minY);

                // Position the tile using filename coordinates
                // In Lambert-1972, Y increases northward, so we use -relativeY for Z
                mesh.position.set(relativeX, 0, -relativeY);

                // Rotate to align properly (STL is typically Z-up, Three.js is Y-up)
                mesh.rotation.x = -Math.PI / 2;

                scene.add(mesh);

                loadedCount++;

                if (onProgress) {
                    onProgress(loadedCount, totalTiles);
                }

                if (loadedCount === totalTiles && onComplete) {
                    onComplete();
                }
            },
            undefined,
            (error) => {
                console.error(`Error loading ${tile.filename}:`, error);
                if (onError) {
                    onError(tile.filename, error);
                }
            }
        );
    });
}
