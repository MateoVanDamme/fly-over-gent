import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// Data source configuration
export const USE_ONLINE_DATA = true; // true = online storage, false = local data folder
export const ONLINE_DATA_BASE = 'https://storage.googleapis.com/fly-over-ghent/';

// Shared materials for better performance (reused across all tiles)
const buildingMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    flatShading: true,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: true
});

// Terrain material - Lambert with height-based color modification
const terrainMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    flatShading: false,
    side: THREE.BackSide,
    depthTest: true,
    depthWrite: true
});

// Inject height cutoff into Lambert shader
terrainMaterial.onBeforeCompile = (shader) => {
    // Add uniform for cutoff height
    shader.uniforms.cutoffHeight = { value: 6.5 };
    shader.uniforms.lowColor = { value: new THREE.Color(0x5577ff) };
    shader.uniforms.highColor = { value: new THREE.Color(0xffffff) };

    // Add varying to pass height from vertex to fragment shader
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

    // Modify fragment shader to use height-based color
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
 * Tiles are automatically centered around the origin (0, 0, 0)
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
        dataPath + 'stl/ACAD-Geb_103000_192000_10_2_N_2013.stl',
        dataPath + 'stl/ACAD-Geb_103000_193000_10_2_N_2013.stl',
        dataPath + 'stl/ACAD-Geb_103000_194000_10_2_N_2013.stl',
        dataPath + 'stl/ACAD-Geb_104000_192000_10_2_N_2013.stl',
        dataPath + 'stl/ACAD-Geb_104000_193000_10_2_N_2013.stl',
        dataPath + 'stl/ACAD-Geb_104000_194000_10_2_N_2013.stl',
        dataPath + 'stl/ACAD-Geb_105000_192000_10_2_N_2013.stl',
        dataPath + 'stl/ACAD-Geb_105000_193000_10_2_N_2013.stl',
        dataPath + 'stl/ACAD-Geb_105000_194000_10_2_N_2013.stl'
    ];

    // Terrain STL files to load
    const terrainFiles = [
        dataPath + 'stl/ACAD-Trn_103000_192000_10_0_N_2013.stl',
        dataPath + 'stl/ACAD-Trn_103000_193000_10_0_N_2013.stl',
        dataPath + 'stl/ACAD-Trn_103000_194000_10_0_N_2013.stl',
        dataPath + 'stl/ACAD-Trn_104000_192000_10_0_N_2013.stl',
        dataPath + 'stl/ACAD-Trn_104000_193000_10_0_N_2013.stl',
        dataPath + 'stl/ACAD-Trn_104000_194000_10_0_N_2013.stl',
        dataPath + 'stl/ACAD-Trn_105000_192000_10_0_N_2013.stl',
        dataPath + 'stl/ACAD-Trn_105000_193000_10_0_N_2013.stl',
        dataPath + 'stl/ACAD-Trn_105000_194000_10_0_N_2013.stl'
    ];

    // Parse coordinates from all files
    const allFiles = [...buildingFiles, ...terrainFiles];
    const tiles = allFiles.map(parseLambert72Filename);

    // Find the minimum and maximum coordinates
    const minX = Math.min(...tiles.map(t => t.x));
    const minY = Math.min(...tiles.map(t => t.y));
    const maxX = Math.max(...tiles.map(t => t.x));
    const maxY = Math.max(...tiles.map(t => t.y));

    // Calculate center of all tiles for offsetting
    const centerX = (maxX - minX) / 2 + 500;
    const centerY = (maxY - minY) / 2 + 500;

    // Load STL files
    const loader = new STLLoader();
    let loadedCount = 0;
    const totalTiles = tiles.length;

    tiles.forEach(tile => {
        // Determine if this is a terrain or building file
        const isTerrain = tile.filename.includes('Trn_');
        const material = isTerrain ? terrainMaterial : buildingMaterial;

        loader.load(
            tile.filename,
            (geometry) => {
                // STL files exported from the new DXF workflow are already in meters
                // No scaling needed (1:1)

                // Translate by Lambert-72 coordinates to maintain alignment
                // Subtract tile coordinates to move geometry to relative position
                geometry.translate(-tile.x, -tile.y, 0);

                // Compute normals properly
                geometry.computeVertexNormals();

                // Compute bounding sphere for efficient frustum culling
                geometry.computeBoundingSphere();

                // Create mesh
                const mesh = new THREE.Mesh(geometry, material);

                // Add edge highlighting - different thresholds and colors for terrain vs buildings
                const edgeThreshold = isTerrain ? 1 : 10; // Lower threshold for terrain
                const edgeColor = isTerrain ? 0x999999 : 0x000000; // Gray for terrain, black for buildings
                const edges = new THREE.EdgesGeometry(geometry, edgeThreshold);
                const lineMaterial = new THREE.LineBasicMaterial({ color: edgeColor, linewidth: 1 });
                const edgeLines = new THREE.LineSegments(edges, lineMaterial);
                mesh.add(edgeLines);

                // Calculate relative position from origin based on filename coordinates
                const relativeX = (tile.x - minX);
                const relativeY = (tile.y - minY);

                // Position the tile centered around (0, 0, 0) by subtracting center offset
                // In Lambert-1972, Y increases northward, so we use -relativeY for Z
                mesh.position.set(relativeX - centerX, 0, -(relativeY - centerY));

                // Rotate to align properly (STL is typically Z-up, Three.js is Y-up)
                mesh.rotation.x = -Math.PI / 2;

                scene.add(mesh);

                loadedCount++;

                if (onProgress) {
                    onProgress(loadedCount, totalTiles, tile.filename);
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
