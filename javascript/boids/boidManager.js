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
}
