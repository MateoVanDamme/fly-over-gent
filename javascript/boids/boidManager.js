import * as THREE from 'three';
import { Boid } from './boid.js';

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

        for (let i = 0; i < this.amount; i++) {
            let boid = new Boid({
                cubeSize: cubeSize,
                floorHeight: floorHeight,
                camera: camera,
                boidMesh: boidMesh,
                boidBehavior: boidBehavior
            });
            this.add(boid.createBoid());
            this.boids.push(boid);
        }
    }

    tick(delta) {
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
