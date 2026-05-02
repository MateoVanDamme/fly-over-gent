import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { updateChunks, getCameraTile } from './javascript/tileLoader.js';
import { updateMinimap } from './javascript/minimap.js';

let camera, scene, renderer, stats;

const clock = new THREE.Clock();

// Rendering constants
const MAX_RENDER_DISTANCE = 4000;

const keyStates = {};
const moveVector = new THREE.Vector3();
const direction = new THREE.Vector3();

// Debug visibility state
let debugVisible = true;

init();

function init() {

    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);
    scene.fog = new THREE.Fog(0x222222, 0 , MAX_RENDER_DISTANCE);

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio, 1.5);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animate);
    renderer.sortObjects = false;
    document.body.appendChild(renderer.domElement);

    // Stats
    stats = new Stats();
    stats.dom.classList.add('debug-info');
    document.body.appendChild(stats.dom);

    // Camera setup
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, MAX_RENDER_DISTANCE);
    camera.rotation.order = 'YXZ';
    camera.position.set(500, 100, -500);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 2);
    dirLight1.position.set(1000, 1000, 1000);
    scene.add(dirLight1);

    // Hide loading indicator (chunks load dynamically)
    document.getElementById('loading').style.display = 'none';

    // Window resize handler
    window.addEventListener('resize', onWindowResize);

    // Keyboard input
    document.addEventListener('keydown', (event) => {
        keyStates[event.code] = true;
    });

    document.addEventListener('keyup', (event) => {
        keyStates[event.code] = false;
    });

    document.addEventListener('keydown', (event) => {
        if (event.code === 'KeyI') {
            debugVisible = !debugVisible;
            toggleDebugInfo();
        }
    });

    document.body.addEventListener('click', () => {
        document.body.requestPointerLock();
    });

    document.body.addEventListener('mousemove', (event) => {
        if (document.pointerLockElement === document.body) {
            if (Math.abs(event.movementX) > 200 || Math.abs(event.movementY) > 200) return;
            camera.rotation.y -= event.movementX / 500;
            camera.rotation.x -= event.movementY / 500;
        }
    });

}

function toggleDebugInfo() {
    const overlay = document.getElementById('controls-overlay');
    if (debugVisible) {
        stats.dom.style.display = 'block';
        overlay.style.display = 'block';
    } else {
        stats.dom.style.display = 'none';
        overlay.style.display = 'none';
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateCamera(deltaTime) {
    const speedDelta = deltaTime * 300;
    moveVector.set(0, 0, 0);

    if (keyStates['KeyW']) {
        camera.getWorldDirection(direction);
        moveVector.addScaledVector(direction, speedDelta);
    }
    if (keyStates['KeyS']) {
        camera.getWorldDirection(direction);
        moveVector.addScaledVector(direction, -speedDelta);
    }
    if (keyStates['KeyA']) {
        camera.getWorldDirection(direction);
        direction.cross(camera.up);
        moveVector.addScaledVector(direction, -speedDelta);
    }
    if (keyStates['KeyD']) {
        camera.getWorldDirection(direction);
        direction.cross(camera.up);
        moveVector.addScaledVector(direction, speedDelta);
    }
    if (keyStates['Space']) {
        moveVector.y += speedDelta;
    }
    if (keyStates['ShiftLeft'] || keyStates['ShiftRight']) {
        moveVector.y -= speedDelta;
    }

    camera.position.add(moveVector);
}

function animate() {
    const deltaTime = Math.min(0.05, clock.getDelta());
    updateCamera(deltaTime);
    camera.getWorldDirection(direction);
    updateChunks(scene, camera.position, direction);
    updateMinimap(camera.position);
    const tile = getCameraTile(camera.position);
    document.getElementById('tile-info').textContent = `${tile.x}, ${tile.y}`;
    renderer.render(scene, camera);
    stats.update();
}
