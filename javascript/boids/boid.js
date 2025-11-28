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

                const material = new THREE.MeshStandardMaterial({
                    color: 0xff0000,
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

/**
 * Boid class - represents a single flying entity in the flock simulation.
 *
 * Boid behavior parameters:
 * - constantVel: Target velocity magnitude (speed) in units/second
 * - boundaryForce: Strength of push away from boundaries (floor and radius cylinder)
 * - gravity: Downward acceleration applied each frame
 * - attractForce: Pull toward nearby boids (cohesion)
 * - avoidForce: Push away from boids too close (separation)
 * - targetDistance: Ideal spacing between boids
 * - maxAttractionDistance: Only attract to boids within this range
 * - alignmentForce: Match neighbors' flight direction (alignment)
 * - levelingForce: Tendency to fly horizontally (0-1, dampens vertical velocity)
 */
export class Boid {
    constructor({
        floorHeight,
        maxRadius,
        boidMesh = defaultBoidMesh,
        boidBehavior = {
            constantVel: 50,
            boundaryForce: 0.1,
            gravity: 0.005,
            attractForce: 2.0,
            targetDistance: 30,
            maxAttractionDistance: 100,
            avoidForce: 0.5,
            alignmentForce: 0.05,
            levelingForce: 0.1
        }
    }) {
        this.floorHeight = floorHeight;
        this.maxRadius = maxRadius;
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

    update(boids, boidid, delta) {
        let push = new THREE.Vector3();

        // Boundary forces: floor and radius cylinder
        const boundaryPush = new THREE.Vector3();

        // Floor boundary: push up when below floor
        const floorDistance = this.floorHeight - this.pos.y;
        boundaryPush.y = Math.max(0, floorDistance * 0.3);

        // Radius boundary: push inward when outside radius (horizontal only)
        const distanceFromCenter = Math.sqrt(this.pos.x * this.pos.x + this.pos.z * this.pos.z);
        const radiusDistance = distanceFromCenter - this.maxRadius;
        if (radiusDistance > 0) {
            // Outside radius - push toward center
            const pushDirection = new THREE.Vector3(-this.pos.x, 0, -this.pos.z).normalize();
            boundaryPush.x = pushDirection.x * radiusDistance * 0.3;
            boundaryPush.z = pushDirection.z * radiusDistance * 0.3;
        }

        this.vel.add(boundaryPush.multiplyScalar(this.boidBehavior.boundaryForce));

        // Boid interactions: separation, alignment, and cohesion
        for (let i = 0; i < boids.length; i++) {
            if (i !== boidid) {
                let dist = this.pos.distanceTo(boids[i].pos);

                // Only interact with nearby boids (within max attraction distance)
                if (dist < this.boidBehavior.maxAttractionDistance) {
                    if (dist < this.boidBehavior.targetDistance) {
                        // Too close: Separation (push away)
                        push.x = this.pos.x - boids[i].pos.x;
                        push.y = this.pos.y - boids[i].pos.y;
                        push.z = this.pos.z - boids[i].pos.z;
                        push.normalize().multiplyScalar(this.boidBehavior.avoidForce).divideScalar(dist + 0.00001);
                        this.vel.add(push);
                    } else {
                        // Too far but still nearby: Cohesion (pull together)
                        push.x = boids[i].pos.x - this.pos.x;
                        push.y = boids[i].pos.y - this.pos.y;
                        push.z = boids[i].pos.z - this.pos.z;
                        push.normalize().multiplyScalar(this.boidBehavior.attractForce).divideScalar(dist + 0.00001);
                        this.vel.add(push);
                    }

                    // Alignment: match neighbors' direction (only for nearby boids)
                    push.copy(boids[i].vel).normalize().multiplyScalar(this.boidBehavior.alignmentForce).divideScalar(dist + 0.00001);
                    this.vel.add(push);
                }
            }
        }

        // Apply gravity
        this.vel.y -= this.boidBehavior.gravity;

        // Leveling force: dampen vertical velocity to encourage horizontal flight
        this.vel.y *= (1.0 - this.boidBehavior.levelingForce);

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
        const bankAngle = lateralAccel.length() * 1.0;

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
