import * as THREE from 'three';
import { Boid, droneModelPromise, defaultBoidMesh } from './boid.js';

export class BoidManager extends THREE.Group {
    constructor({
        camera,
        amount,
        floorHeight,
        maxRadius,
        boidBehavior
    }) {
        super();
        this.camera = camera;
        this.amount = amount;
        this.boids = [];
        this.floorHeight = floorHeight;
        this.maxRadius = maxRadius;
        this.boidBehavior = boidBehavior;
        this.initialized = false;

        // Wait for the drone model to load before creating boids
        droneModelPromise.then(() => {
            this.initializeBoids();
        });
    }

    initializeBoids() {
        for (let i = 0; i < this.amount; i++) {
            let boid = new Boid({
                floorHeight: this.floorHeight,
                maxRadius: this.maxRadius,
                boidMesh: defaultBoidMesh,
                boidBehavior: this.boidBehavior
            });
            this.add(boid.createBoid());
            this.boids.push(boid);
        }
        this.initialized = true;
        console.log(`Initialized ${this.amount} boids with drone model`);
    }

    tick(delta) {
        // Only update if boids are initialized
        if (!this.initialized || this.boids.length === 0) return;

        for (let i = 0; i < this.amount; i++) {
            this.boids[i].update(this.boids, i, delta);
        }
    }

    respawnBoids() {
        // Reset all boids to random initial positions and velocities
        for (let i = 0; i < this.boids.length; i++) {
            const boid = this.boids[i];

            // Reset position to random starting position
            boid.pos.set(
                (Math.random() - 0.5) * 200,
                this.floorHeight + Math.random() * 100 + 50,
                (Math.random() - 0.5) * 200
            );

            // Reset velocity to random direction
            boid.vel.set(
                Math.random() - 0.5,
                Math.random() - 0.5,
                Math.random() - 0.5
            );

            // Reset previous velocity
            boid.prevVel.copy(boid.vel);

            // Update mesh position
            boid.mesh.position.copy(boid.pos);
        }

        console.log('Boids respawned');
    }
}
