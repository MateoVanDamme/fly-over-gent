import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import Stats from 'three/addons/libs/stats.module.js';

let camera, scene, renderer, gridHelper, stats;
let loadedCount = 0;
const totalTiles = 4; // 2 building tiles + 2 terrain tiles

const clock = new THREE.Clock();

// Rendering constants
const MAX_RENDER_DISTANCE = 4000; // Maximum view distance in meters

// FPS controls
const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();
const keyStates = {};

init();

function init() {

    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);
    scene.fog = new THREE.Fog(0x222222, 10, MAX_RENDER_DISTANCE);

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animate);
    renderer.sortObjects = false; // Disable automatic sorting, rely on depth buffer
    document.body.appendChild(renderer.domElement);

    // Stats
    stats = new Stats();
    document.body.appendChild(stats.dom);

    // Camera setup
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, MAX_RENDER_DISTANCE);
    camera.rotation.order = 'YXZ';
    camera.position.set(0, 10, 0);

    // Lights - much brighter
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 2);
    dirLight1.position.set(1000, 1000, 1000);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 1);
    dirLight2.position.set(-1000, 500, -1000);
    scene.add(dirLight2);

    // Grid helper for reference (will be resized after tiles load)
    gridHelper = new THREE.GridHelper(2000, 20);
    scene.add(gridHelper);

    // Load STL tiles
    loadSTLTiles();

    // Window resize handler
    window.addEventListener('resize', onWindowResize);

    // FPS controls setup
    document.addEventListener('keydown', (event) => {
        keyStates[event.code] = true;
    });

    document.addEventListener('keyup', (event) => {
        keyStates[event.code] = false;
    });

    document.body.addEventListener('click', () => {
        document.body.requestPointerLock();
    });

    document.body.addEventListener('mousemove', (event) => {
        if (document.pointerLockElement === document.body) {
            camera.rotation.y -= event.movementX / 500;
            camera.rotation.x -= event.movementY / 500;
        }
    });

}

function parseLambert72Filename(filename) {
    // Format: Geb_105000_192000_10_2_N_2013.stl
    // Extract X (105000) and Y (192000) coordinates
    const parts = filename.split('/').pop().replace('.stl', '').split('_');
    return {
        x: parseInt(parts[1]),
        y: parseInt(parts[2]),
        filename: filename
    };
}

function loadSTLTiles() {

    // Building STL files to load
    const buildingFiles = [
        'data/Dwg_105000_192000_10_2_N_2009/Geb_105000_192000_10_2_N_2013.stl',
        'data/Dwg_105000_193000_10_2_N_2009/Geb_105000_193000_10_2_N_2013.stl'
    ];

    // Terrain STL files to load
    const terrainFiles = [
        'data/Dwg_105000_192000_10_2_N_2009/Trn_105000_192000_10_0_N_2013.stl',
        'data/Dwg_105000_193000_10_2_N_2009/Trn_105000_193000_10_0_N_2013.stl'
    ];

    // Parse coordinates from all files
    const allFiles = [...buildingFiles, ...terrainFiles];
    const tiles = allFiles.map(parseLambert72Filename);

    // Find the minimum coordinates to use as origin
    const minX = Math.min(...tiles.map(t => t.x));
    const minY = Math.min(...tiles.map(t => t.y));

    // Load STL files
    const loader = new STLLoader();

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
                console.log('=== Loading:', tile.filename);
                console.log('Tile coords:', tile.x, tile.y);
                console.log('Is terrain?', isTerrain);

                // Compute bounding box before any transforms
                geometry.computeBoundingBox();
                let box = geometry.boundingBox;
                console.log('Original bbox min:', box.min.x, box.min.y, box.min.z);
                console.log('Original bbox max:', box.max.x, box.max.y, box.max.z);

                // Scale geometry from millimeters to meters
                const scaleFactor = 0.001;
                geometry.scale(scaleFactor, scaleFactor, scaleFactor);

                geometry.computeBoundingBox();
                box = geometry.boundingBox;
                console.log('After scale min:', box.min.x, box.min.y, box.min.z);
                console.log('After scale max:', box.max.x, box.max.y, box.max.z);

                // Center on X/Y but not Z (height)
                const centerX = (box.min.x + box.max.x) / 2;
                const centerY = (box.min.y + box.max.y) / 2;
                geometry.translate(-centerX, -centerY, -box.min.z);

                geometry.computeBoundingBox();
                box = geometry.boundingBox;
                console.log('After center min:', box.min.x, box.min.y, box.min.z);
                console.log('After center max:', box.max.x, box.max.y, box.max.z);

                // Create mesh
                const mesh = new THREE.Mesh(geometry, material);

                // Calculate relative position from origin based on filename coordinates
                const relativeX = (tile.x - minX);
                const relativeY = (tile.y - minY);

                // Position the tile using filename coordinates
                // In Lambert-1972, Y increases northward, so we use -relativeY for Z
                mesh.position.set(relativeX, 0, -relativeY);

                console.log('Mesh position:', mesh.position);
                console.log('---');

                // Rotate to align properly (STL is typically Z-up, Three.js is Y-up)
                mesh.rotation.x = -Math.PI / 2;

                scene.add(mesh);

                loadedCount++;

                if (loadedCount === totalTiles) {
                    document.getElementById('loading').style.display = 'none';

                    // Update grid to match scene size
                    scene.remove(gridHelper);
                    const gridSize = 3000;
                    const divisions = 3;
                    gridHelper = new THREE.GridHelper(gridSize, divisions);
                    gridHelper.position.set(0, 0, 0);
                    scene.add(gridHelper);
                }
            },
            undefined,
            (error) => {
                console.error(`Error loading ${tile.filename}:`, error);
                document.getElementById('loading').textContent = `Error loading ${tile.filename}`;
            }
        );
    });

}

function onWindowResize() {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);

}

function getForwardVector() {
    camera.getWorldDirection(playerDirection);
    playerDirection.normalize();
    return playerDirection;
}

function getSideVector() {
    camera.getWorldDirection(playerDirection);
    playerDirection.normalize();
    playerDirection.cross(camera.up);
    return playerDirection;
}

function controls(deltaTime) {
    const speedDelta = deltaTime * 1000; // movement speed

    if (keyStates['KeyW']) {
        playerVelocity.add(getForwardVector().multiplyScalar(speedDelta));
    }

    if (keyStates['KeyS']) {
        playerVelocity.add(getForwardVector().multiplyScalar(-speedDelta));
    }

    if (keyStates['KeyA']) {
        playerVelocity.add(getSideVector().multiplyScalar(-speedDelta));
    }

    if (keyStates['KeyD']) {
        playerVelocity.add(getSideVector().multiplyScalar(speedDelta));
    }

    if (keyStates['Space']) {
        playerVelocity.y += speedDelta;
    }

    if (keyStates['ShiftLeft'] || keyStates['ShiftRight']) {
        playerVelocity.y -= speedDelta;
    }
}

function updatePlayer(deltaTime) {
    const damping = Math.exp(-4 * deltaTime) - 1;
    playerVelocity.addScaledVector(playerVelocity, damping);

    const deltaPosition = playerVelocity.clone().multiplyScalar(deltaTime);
    camera.position.add(deltaPosition);
}

function animate() {

    const deltaTime = Math.min(0.05, clock.getDelta());

    controls(deltaTime);
    updatePlayer(deltaTime);

    render();

    stats.update();

}

function render() {

    renderer.render(scene, camera);

}
