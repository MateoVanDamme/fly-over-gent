import * as THREE from 'three';
import { Boid, droneModelPromise, defaultBoidMesh } from './boid.js';

export class BoidManager extends THREE.Group {
    constructor({
        camera,
        amount,
        cubeSize,
        floorHeight,
        boidMesh,
        boidBehavior
    }) {
        super();
        this.camera = camera;
        this.amount = amount;
        this.boids = [];
        this.cubeSize = cubeSize;
        this.floorHeight = floorHeight;
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
                cubeSize: this.cubeSize,
                floorHeight: this.floorHeight,
                camera: this.camera,
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

        let center = this.calculateCentroid();
        // Alternative: let center = this.boids[0].pos; // leader-following behavior

        for (let i = 0; i < this.amount; i++) {
            this.boids[i].update(this.boids, center, i, delta);
        }
    }

    calculateCentroid() {
        let pos = new THREE.Vector3();
        for (let i = 0; i < this.amount; i++) {
            pos.add(this.boids[i].pos);
        }
        return pos.divideScalar(this.boids.length);
    }
}
