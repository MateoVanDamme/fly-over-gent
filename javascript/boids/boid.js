import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// Load the drone model
let defaultBoidMesh = null;

// Return a promise so we can wait for the model to load
const loadDroneModel = () => {
    return new Promise((resolve, reject) => {
        const loader = new STLLoader();
        loader.load(
            'models/drone.stl',
            (geometry) => {
                console.log('Drone model loaded successfully');

                // Center the geometry so it rotates around its actual center
                geometry.computeBoundingBox();
                const center = new THREE.Vector3();
                geometry.boundingBox.getCenter(center);
                geometry.translate(-center.x, -center.y, -center.z);

                // Create a red material
                const material = new THREE.MeshStandardMaterial({
                    color: 0xff0000, // Red color
                    metalness: 0.3,
                    roughness: 0.7
                });

                // Create mesh from geometry
                const droneMesh = new THREE.Mesh(geometry, material);

                // Scale the drone to smaller size
                droneMesh.scale.set(0.1, 0.1, 0.1);

                defaultBoidMesh = droneMesh;
                resolve(droneMesh);
            },
            (progress) => {
                console.log('Loading drone model:', (progress.loaded / progress.total * 100).toFixed(2) + '%');
            },
            (error) => {
                console.error('Error loading drone model:', error);
                reject(error);
            }
        );
    });
};

const droneModelPromise = loadDroneModel();

export class Boid {
    constructor({
        cubeSize,
        floorHeight,
        camera,
        boidMesh = defaultBoidMesh,
        boidBehavior = {
            constantVel: 50,
            centeringForce: 0.1,
            gravity: 0.005,
            attractForce: 2.0,
            minDistance: 30,
            avoidForce: 0.5,
            conformDirection: 0.05
        }
    }) {
        if (typeof (cubeSize) === 'undefined' && typeof (floorHeight) !== 'undefined')
            this.floorMode = true;
        else if (typeof (cubeSize) !== 'undefined' && typeof (floorHeight) === 'undefined')
            this.floorMode = false;
        else
            throw new Error('Either specify a cube for the boids to fly in OR a minimum floor');

        this.floorHeight = floorHeight;
        this.cubeSize = cubeSize;
        this.camera = camera;
        this.boidBehavior = boidBehavior;

        // Clone the mesh
        this.mesh = boidMesh.clone();

        // Initialize with random velocity
        this.vel = new THREE.Vector3(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
        );

        // Track previous velocity for banking calculation
        this.prevVel = this.vel.clone();

        // Start at random position above the floor, centered at (0, 0)
        this.pos = new THREE.Vector3(
            (Math.random() - 0.5) * 200,
            floorHeight + Math.random() * 100 + 50,
            (Math.random() - 0.5) * 200
        );
    }

    createBoid() {
        this.mesh.position.copy(this.pos);
        return this.mesh;
    }

    update(boids, center, boidid, delta) {
        let push = new THREE.Vector3();

        // Boundary constraints
        if (this.floorMode) {
            // Pull boids back toward city center (0, 0) - force increases with distance
            const distanceFromCenter = Math.sqrt(this.pos.x * this.pos.x + this.pos.z * this.pos.z);
            const pullStrength = distanceFromCenter / 1000; // Stronger pull the further away
            push.x = -this.pos.x * pullStrength;
            push.z = -this.pos.z * pullStrength;

            // Strong force to stay above floor
            push.y = Math.max(0, this.floorHeight - this.pos.y);
        } else {
            // Cube mode boundaries
            push.x = Math.min(0, this.cubeSize / 2 - this.pos.x) + Math.max(0, -this.pos.x - this.cubeSize / 2);
            push.y = Math.min(0, this.cubeSize / 2 - this.pos.y) + Math.max(0, -this.pos.y - this.cubeSize / 2);
            push.z = Math.min(0, this.cubeSize / 2 - this.pos.z) + Math.max(0, -this.pos.z - this.cubeSize / 2);
        }
        this.vel.add(push.multiplyScalar(this.boidBehavior.centeringForce));

        // Separation and alignment with nearby boids
        for (let i = 0; i < boids.length; i++) {
            if (i !== boidid) {
                let dist = this.pos.distanceTo(boids[i].pos);
                if (dist < this.boidBehavior.minDistance) {
                    // Separation: avoid crowding
                    push.x = this.pos.x - boids[i].pos.x;
                    push.y = this.pos.y - boids[i].pos.y;
                    push.z = this.pos.z - boids[i].pos.z;
                    push.normalize().multiplyScalar(this.boidBehavior.avoidForce).divideScalar(dist + 0.00001);
                    this.vel.add(push);

                    // Alignment: match neighbors' direction
                    push.copy(boids[i].vel).normalize().multiplyScalar(this.boidBehavior.conformDirection).divideScalar(dist + 0.00001);
                    this.vel.add(push);
                }
            }
        }

        // Cohesion: move toward center of flock
        push.x = center.x - this.pos.x;
        push.y = center.y - this.pos.y;
        push.z = center.z - this.pos.z;
        push.normalize();
        this.vel.add(push.multiplyScalar(this.boidBehavior.attractForce));

        // Apply gravity
        this.vel.y -= this.boidBehavior.gravity;

        // Maintain constant speed
        this.vel.normalize().multiplyScalar(this.boidBehavior.constantVel);

        // Update position
        this.pos.add(this.vel.clone().multiplyScalar(delta));

        // Calculate banking angle based on turn rate
        // Get the acceleration (change in velocity direction)
        const acceleration = this.vel.clone().sub(this.prevVel);

        // Project acceleration onto horizontal plane to get lateral turn component
        const lateralAccel = new THREE.Vector3(acceleration.x, 0, acceleration.z);

        // Calculate bank angle (roll) - proportional to lateral acceleration
        // More aggressive turns = more bank
        const bankAngle = lateralAccel.length() * 1.0; // Adjust multiplier for more/less banking

        // Determine bank direction using cross product
        const forward = this.vel.clone().normalize();
        const lateralDir = new THREE.Vector3().crossVectors(forward, lateralAccel).y;
        const bankSign = lateralDir > 0 ? 1 : -1;

        // Orient mesh to face direction of movement
        const targetPosition = this.pos.clone().add(forward);
        this.mesh.lookAt(targetPosition);
        this.mesh.rotateX(-Math.PI / 2); // Tilt drone to fly forward
        this.mesh.rotateY(bankAngle * bankSign); // Apply bank angle (roll)

        this.mesh.position.copy(this.pos);

        // Store current velocity for next frame's banking calculation
        this.prevVel.copy(this.vel);
    }
}

// Export the promise and mesh for external use
export { droneModelPromise, defaultBoidMesh };
