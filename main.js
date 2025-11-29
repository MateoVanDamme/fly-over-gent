import * as THREE from 'three';
import Stats from 'three/addons/libs/stats.module.js';
import { GUI } from 'lil-gui';
import { loadSTLTiles } from './javascript/tileLoader.js';
import { BoidManager } from './javascript/boids/boidManager.js';

let camera, scene, renderer, stats, boidManager, gui;

const clock = new THREE.Clock();

// Rendering constants
const MAX_RENDER_DISTANCE = 4000; // Maximum view distance in meters

// Camera system
const cameraSystem = {
    mode: 'chase', // 'follow', 'orbit', 'chase', 'manual'
    target: new THREE.Vector3(),
    offset: new THREE.Vector3(0, 50, -100),
    lookAhead: 50,
    smoothness: 0.05,
    currentBoidIndex: 0
};

const keyStates = {};

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
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animate);
    renderer.sortObjects = false; // Disable automatic sorting, rely on depth buffer
    document.body.appendChild(renderer.domElement);

    // Stats
    stats = new Stats();
    stats.dom.classList.add('debug-info');
    document.body.appendChild(stats.dom);

    // Camera setup - positioned at center since tiles are centered around origin
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, MAX_RENDER_DISTANCE);
    camera.rotation.order = 'YXZ';
    camera.position.set(0, 100, 0);

    // Lights - ambient + one directional for performance
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 2);
    dirLight1.position.set(1000, 1000, 1000);
    scene.add(dirLight1);

    // Boid configuration object
    const boidConfig = {
        amount: 100,
        floorHeight: 180,
        maxRadius: 500,
        constantVel: 50,
        boundaryForce: 0.1,
        gravity: 0.5,
        attractForce: 0.6,
        avoidForce: 1.5,
        targetDistance: 40,
        maxAttractionDistance: 150,
        alignmentForce: 0.2,
        levelingForce: 0.001
    };

    // Create boids
    boidManager = new BoidManager({
        camera: camera,
        amount: boidConfig.amount,
        floorHeight: boidConfig.floorHeight,
        maxRadius: boidConfig.maxRadius,
        boidBehavior: {
            constantVel: boidConfig.constantVel,
            boundaryForce: boidConfig.boundaryForce,
            gravity: boidConfig.gravity,
            attractForce: boidConfig.attractForce,
            avoidForce: boidConfig.avoidForce,
            targetDistance: boidConfig.targetDistance,
            maxAttractionDistance: boidConfig.maxAttractionDistance,
            alignmentForce: boidConfig.alignmentForce,
            levelingForce: boidConfig.levelingForce
        }
    });
    scene.add(boidManager);

    // Setup GUI
    setupGUI(boidConfig);

    // Load STL tiles (tiles are centered around origin, so camera stays at 0,0,0)
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

    // Camera mode switching and debug toggle
    document.addEventListener('keydown', (event) => {
        if (event.code === 'Digit1') {
            cameraSystem.mode = 'follow';
            console.log('Camera Mode: Follow (behind boid)');
        } else if (event.code === 'Digit2') {
            cameraSystem.mode = 'chase';
            console.log('Camera Mode: Chase (close follow)');
        } else if (event.code === 'Digit3') {
            cameraSystem.mode = 'orbit';
            console.log('Camera Mode: Orbit (circular around flock)');
        } else if (event.code === 'Digit4') {
            cameraSystem.mode = 'manual';
            console.log('Camera Mode: Manual (free control)');
        } else if (event.code === 'Tab') {
            event.preventDefault();
            if (boidManager && boidManager.boids.length > 0) {
                cameraSystem.currentBoidIndex = (cameraSystem.currentBoidIndex + 1) % boidManager.boids.length;
                console.log(`Following boid ${cameraSystem.currentBoidIndex + 1}/${boidManager.boids.length}`);
            }
        } else if (event.code === 'KeyI') {
            debugVisible = !debugVisible;
            toggleDebugInfo();
        }
    });

    document.body.addEventListener('click', () => {
        if (cameraSystem.mode === 'manual') {
            document.body.requestPointerLock();
        }
    });

    document.body.addEventListener('mousemove', (event) => {
        if (cameraSystem.mode === 'manual' && document.pointerLockElement === document.body) {
            camera.rotation.y -= event.movementX / 500;
            camera.rotation.x -= event.movementY / 500;
        }
    });

}

function setupGUI(boidConfig) {
    gui = new GUI();
    gui.domElement.classList.add('debug-info');

    // Camera controls
    const cameraFolder = gui.addFolder('Camera');
    cameraFolder.add(cameraSystem, 'mode', ['follow', 'chase', 'orbit', 'manual']).name('Mode');
    cameraFolder.add(cameraSystem, 'smoothness', 0.01, 0.2, 0.01).name('Smoothness');
    cameraFolder.add(cameraSystem, 'lookAhead', 0, 200, 10).name('Look Ahead');
    cameraFolder.open();

    // Boid behavior controls
    const boidFolder = gui.addFolder('Boid Behavior');
    boidFolder.add(boidConfig, 'constantVel', 10, 100, 1).name('Speed').onChange(updateBoidBehavior);
    boidFolder.add(boidConfig, 'gravity', 0, 2, 0.01).name('Gravity').onChange(updateBoidBehavior);
    boidFolder.add(boidConfig, 'attractForce', 0, 2, 0.1).name('Cohesion').onChange(updateBoidBehavior);
    boidFolder.add(boidConfig, 'avoidForce', 0, 5, 0.1).name('Separation').onChange(updateBoidBehavior);
    boidFolder.add(boidConfig, 'alignmentForce', 0, 1, 0.01).name('Alignment').onChange(updateBoidBehavior);
    boidFolder.add(boidConfig, 'targetDistance', 10, 100, 5).name('Target Spacing').onChange(updateBoidBehavior);
    boidFolder.add(boidConfig, 'maxAttractionDistance', 50, 300, 10).name('Interaction Range').onChange(updateBoidBehavior);
    boidFolder.add(boidConfig, 'levelingForce', 0, 0.1, 0.001).name('Leveling').onChange(updateBoidBehavior);
    boidFolder.open();

    // Boundary controls
    const boundaryFolder = gui.addFolder('Boundaries');
    boundaryFolder.add(boidConfig, 'floorHeight', 50, 300, 10).name('Floor Height').onChange(updateBoundaries);
    boundaryFolder.add(boidConfig, 'maxRadius', 200, 1000, 50).name('Max Radius').onChange(updateBoundaries);
    boundaryFolder.add(boidConfig, 'boundaryForce', 0, 1, 0.05).name('Boundary Force').onChange(updateBoidBehavior);
    boundaryFolder.open();

    function updateBoidBehavior() {
        if (boidManager && boidManager.boids) {
            boidManager.boids.forEach(boid => {
                boid.boidBehavior.constantVel = boidConfig.constantVel;
                boid.boidBehavior.boundaryForce = boidConfig.boundaryForce;
                boid.boidBehavior.gravity = boidConfig.gravity;
                boid.boidBehavior.attractForce = boidConfig.attractForce;
                boid.boidBehavior.avoidForce = boidConfig.avoidForce;
                boid.boidBehavior.targetDistance = boidConfig.targetDistance;
                boid.boidBehavior.maxAttractionDistance = boidConfig.maxAttractionDistance;
                boid.boidBehavior.alignmentForce = boidConfig.alignmentForce;
                boid.boidBehavior.levelingForce = boidConfig.levelingForce;
            });
        }
    }

    function updateBoundaries() {
        if (boidManager && boidManager.boids) {
            boidManager.floorHeight = boidConfig.floorHeight;
            boidManager.maxRadius = boidConfig.maxRadius;
            boidManager.boids.forEach(boid => {
                boid.floorHeight = boidConfig.floorHeight;
                boid.maxRadius = boidConfig.maxRadius;
            });
        }
    }
}

function toggleDebugInfo() {
    if (debugVisible) {
        stats.dom.style.display = 'block';
        gui.domElement.style.display = 'block';
    } else {
        stats.dom.style.display = 'none';
        gui.domElement.style.display = 'none';
    }
}

function onWindowResize() {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);

}

function updateCinematicCamera(deltaTime) {
    if (!boidManager || !boidManager.boids || boidManager.boids.length === 0) return;

    const time = clock.getElapsedTime();

    if (cameraSystem.mode === 'follow') {
        // Follow mode: camera behind and above the boid, looking ahead
        const boid = boidManager.boids[cameraSystem.currentBoidIndex];
        const boidPos = boid.pos.clone();
        const boidVel = boid.vel.clone().normalize();

        // Position camera behind the boid
        const cameraOffset = boidVel.clone().multiplyScalar(-80).add(new THREE.Vector3(0, 40, 0));
        const desiredPosition = boidPos.clone().add(cameraOffset);

        // Look ahead of the boid
        const lookAtPoint = boidPos.clone().add(boidVel.clone().multiplyScalar(cameraSystem.lookAhead));

        // Smooth camera movement
        camera.position.lerp(desiredPosition, cameraSystem.smoothness);

        // Smooth camera rotation
        const currentLookAt = new THREE.Vector3();
        camera.getWorldDirection(currentLookAt);
        currentLookAt.multiplyScalar(100).add(camera.position);
        currentLookAt.lerp(lookAtPoint, cameraSystem.smoothness * 2);
        camera.lookAt(currentLookAt);

    } else if (cameraSystem.mode === 'chase') {
        // Chase mode: close follow, like a pursuit camera
        const boid = boidManager.boids[cameraSystem.currentBoidIndex];
        const boidPos = boid.pos.clone();
        const boidVel = boid.vel.clone().normalize();

        // Closer camera position
        const cameraOffset = boidVel.clone().multiplyScalar(-40).add(new THREE.Vector3(0, 15, 0));
        const desiredPosition = boidPos.clone().add(cameraOffset);

        // Look directly at the boid
        camera.position.lerp(desiredPosition, cameraSystem.smoothness * 1.5);

        const lookAtPoint = boidPos.clone().add(boidVel.clone().multiplyScalar(20));
        const currentLookAt = new THREE.Vector3();
        camera.getWorldDirection(currentLookAt);
        currentLookAt.multiplyScalar(100).add(camera.position);
        currentLookAt.lerp(lookAtPoint, cameraSystem.smoothness * 3);
        camera.lookAt(currentLookAt);

    } else if (cameraSystem.mode === 'orbit') {
        // Orbit mode: camera orbits around the center of the flock
        // Calculate centroid of all boids
        const center = new THREE.Vector3();
        for (let i = 0; i < boidManager.boids.length; i++) {
            center.add(boidManager.boids[i].pos);
        }
        center.divideScalar(boidManager.boids.length);

        // Circular orbit
        const radius = 200;
        const orbitSpeed = 0.1;
        const angle = time * orbitSpeed;

        const desiredPosition = new THREE.Vector3(
            center.x + Math.cos(angle) * radius,
            center.y + 80 + Math.sin(angle * 0.5) * 30, // Gentle height variation
            center.z + Math.sin(angle) * radius
        );

        camera.position.lerp(desiredPosition, cameraSystem.smoothness);

        // Look at the center of the flock
        const currentLookAt = new THREE.Vector3();
        camera.getWorldDirection(currentLookAt);
        currentLookAt.multiplyScalar(100).add(camera.position);
        currentLookAt.lerp(center, cameraSystem.smoothness * 2);
        camera.lookAt(currentLookAt);

    } else if (cameraSystem.mode === 'manual') {
        // Manual mode: keyboard controls for fine-tuning
        const speedDelta = deltaTime * 300;
        const moveVector = new THREE.Vector3();

        if (keyStates['KeyW']) {
            const forward = new THREE.Vector3();
            camera.getWorldDirection(forward);
            moveVector.add(forward.multiplyScalar(speedDelta));
        }
        if (keyStates['KeyS']) {
            const forward = new THREE.Vector3();
            camera.getWorldDirection(forward);
            moveVector.add(forward.multiplyScalar(-speedDelta));
        }
        if (keyStates['KeyA']) {
            const left = new THREE.Vector3();
            camera.getWorldDirection(left);
            left.cross(camera.up);
            moveVector.add(left.multiplyScalar(-speedDelta));
        }
        if (keyStates['KeyD']) {
            const right = new THREE.Vector3();
            camera.getWorldDirection(right);
            right.cross(camera.up);
            moveVector.add(right.multiplyScalar(speedDelta));
        }
        if (keyStates['Space']) {
            moveVector.y += speedDelta;
        }
        if (keyStates['ShiftLeft'] || keyStates['ShiftRight']) {
            moveVector.y -= speedDelta;
        }

        camera.position.add(moveVector);
    }
}

function animate() {

    const deltaTime = Math.min(0.05, clock.getDelta());

    // Update boids
    if (boidManager) {
        boidManager.tick(deltaTime);
    }

    // Update cinematic camera
    updateCinematicCamera(deltaTime);

    render();

    stats.update();

}

function render() {

    renderer.render(scene, camera);

}
