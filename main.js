import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { loadSTLTiles } from './javascript/tileLoader.js';

let camera, scene, renderer, gridHelper, stats;

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
    camera.position.set(0, 50, 0);

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
    loadSTLTiles(
        scene,
        (loadedCount, totalTiles, filename) => {
            // Progress callback
            const tileName = filename.split('/').pop();
            console.log(`Loading tiles: ${loadedCount}/${totalTiles} - ${tileName}`);
        },
        () => {
            // Complete callback
            document.getElementById('loading').style.display = 'none';

            // Update grid to match scene size
            scene.remove(gridHelper);
            const gridSize = 3000;
            const divisions = 3;
            gridHelper = new THREE.GridHelper(gridSize, divisions);
            gridHelper.position.set(0, 0, 0);
            scene.add(gridHelper);
        },
        (filename, error) => {
            // Error callback
            document.getElementById('loading').textContent = `Error loading ${filename}`;
        }
    );

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
