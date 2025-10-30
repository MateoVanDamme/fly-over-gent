import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import Stats from 'three/addons/libs/stats.module.js';

let camera, scene, renderer, gridHelper, stats;
let loadedCount = 0;
const totalTiles = 2;

const clock = new THREE.Clock();

// FPS controls
const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();
const keyStates = {};

init();

function init() {

    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);
    scene.fog = new THREE.Fog(0x222222, 10, 4000);

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animate);
    document.body.appendChild(renderer.domElement);

    // Stats
    stats = new Stats();
    document.body.appendChild(stats.dom);

    // Camera setup
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 10000000);
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

    // STL files to load
    const stlFiles = [
        'data/Dwg_105000_192000_10_2_N_2009/Geb_105000_192000_10_2_N_2013.stl',
        'data/Dwg_105000_193000_10_2_N_2009/Geb_105000_193000_10_2_N_2013.stl'
    ];

    // Parse coordinates
    const tiles = stlFiles.map(parseLambert72Filename);

    // Find the minimum coordinates to use as origin
    const minX = Math.min(...tiles.map(t => t.x));
    const minY = Math.min(...tiles.map(t => t.y));

    // Load STL files
    const loader = new STLLoader();

    const material = new THREE.MeshPhongMaterial({
        color: 0xffffff,
        specular: 0x111111,
        shininess: 200,
        flatShading: true
    });

    tiles.forEach(tile => {
        loader.load(
            tile.filename,
            (geometry) => {
                // Center the geometry to origin
                geometry.center();

                // Scale geometry to make it ~1000 units wide
                const scaleFactor = 0.001
                geometry.scale(scaleFactor, scaleFactor, scaleFactor);

                // Create mesh
                const mesh = new THREE.Mesh(geometry, material);

                // Calculate relative position from origin based on filename coordinates
                const scale = 1.0;
                const relativeX = (tile.x - minX) * scale;
                const relativeY = (tile.y - minY) * scale;

                // Position the tile using filename coordinates
                // In Lambert-1972, Y increases northward, so we use -relativeY for Z
                mesh.position.set(relativeX, 0, -relativeY);

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
