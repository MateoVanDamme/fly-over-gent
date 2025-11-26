import * as THREE from 'three';

// Provide default boid mesh (bird-like shape)
const boidSize = 2;
const boidShape = new THREE.Shape()
    .moveTo(0, 2 * boidSize)
    .lineTo(boidSize, -boidSize)
    .lineTo(0, 0)
    .lineTo(-boidSize, -boidSize)
    .lineTo(0, 2 * boidSize);
const geometry = new THREE.ShapeGeometry(boidShape);
const materialBoid = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide });
const defaultBoidMesh = new THREE.Mesh(geometry, materialBoid);

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
        this.mesh = boidMesh.clone();

        // Initialize with random velocity
        this.vel = new THREE.Vector3(
            Math.random() - 0.5,
            Math.random() - 0.5,
            Math.random() - 0.5
        );

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

        // Orient mesh to face direction of movement
        this.mesh.lookAt(this.pos.clone().add(this.vel));
        this.mesh.rotateY(Math.PI / 2);
        this.mesh.rotateZ(Math.PI / 2);
        this.mesh.position.copy(this.pos);
    }
}
