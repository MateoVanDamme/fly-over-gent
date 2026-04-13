import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ORIGIN_X, ORIGIN_Y } from './tileLoader.js';
import { wgs84ToLambert72 } from './lambertProjection.js';

// --- Static OSM data source ---
const OSM_DATA_BASE = 'data/osm/';

async function fetchOSMTile(tileX, tileY, signal) {
    const url = `${OSM_DATA_BASE}${tileX}_${tileY}.json`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`OSM tile fetch error: ${response.status}`);
    return response.json();
}

// --- Materials ---

// Palette: everything white, water red, edges black for separation.
const WHITE = 0xffffff;
const matBuilding   = new THREE.MeshLambertMaterial({ color: WHITE, flatShading: true, side: THREE.DoubleSide });
const matRoof       = new THREE.MeshLambertMaterial({ color: WHITE, flatShading: true, side: THREE.DoubleSide });
const matEdge       = new THREE.LineBasicMaterial({ color: 0x000000 });
const RED = 0xcc0000;
const matRoad       = new THREE.MeshLambertMaterial({ color: RED });
const matFootway    = new THREE.MeshLambertMaterial({ color: RED });
const matCycleway   = new THREE.MeshLambertMaterial({ color: RED });
const matGround     = new THREE.MeshLambertMaterial({ color: WHITE, side: THREE.DoubleSide });
const matRail       = new THREE.MeshLambertMaterial({ color: WHITE });
const matBridgeDeck = new THREE.MeshLambertMaterial({ color: WHITE });
const matBridgeSide = new THREE.MeshLambertMaterial({ color: WHITE });
const matWater      = new THREE.MeshLambertMaterial({ color: 0xcc0000, side: THREE.DoubleSide });
const matGrass      = new THREE.MeshLambertMaterial({ color: WHITE, side: THREE.DoubleSide });
const matPark       = new THREE.MeshLambertMaterial({ color: WHITE, side: THREE.DoubleSide });
const matGarden     = new THREE.MeshLambertMaterial({ color: WHITE, side: THREE.DoubleSide });
const matPitch      = new THREE.MeshLambertMaterial({ color: WHITE, side: THREE.DoubleSide });
const matTreeTrunk  = new THREE.MeshLambertMaterial({ color: WHITE });
const matTreeLeaves = new THREE.MeshLambertMaterial({ color: WHITE, flatShading: true });
const matLampPole   = new THREE.MeshLambertMaterial({ color: WHITE });
const matLampHead   = new THREE.MeshLambertMaterial({ color: WHITE });
const matBarrier    = new THREE.MeshLambertMaterial({ color: WHITE });

// Vertical altitudes used for OSM features (in tile-local Z, terrain is shifted down)
const Z_TERRAIN_OFFSET = -5;   // shift terrain mesh down by 5 m
const Z_GROUND        = 0.05;  // grass/parks/pitches sit just above z=0
const Z_WATER         = 0.4;
const Z_ROAD          = 0.6;
const Z_FOOTWAY       = 0.5;
const Z_BRIDGE        = 12;    // overpass deck altitude (clearly above traffic)
const Z_BRIDGE_THICK  = 1.2;

// --- Helpers ---

/** Convert OSM nodes (lat/lon) to local tile-relative XY. */
function projectNodes(nodes, tileX, tileY) {
    const out = new Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
        const lambert = wgs84ToLambert72(nodes[i].lat, nodes[i].lon);
        out[i] = { x: lambert.x - tileX, y: lambert.y - tileY };
    }
    return out;
}

/** Resolve a way's node IDs to lat/lon. Returns null if any node missing. */
function resolveWay(way, nodeIndex) {
    const nodes = [];
    for (const nid of way.nodes) {
        const n = nodeIndex.get(nid);
        if (!n) return null;
        nodes.push(n);
    }
    return nodes;
}

function isClosed(nodes) {
    if (nodes.length < 4) return false;
    const a = nodes[0], b = nodes[nodes.length - 1];
    return a.lat === b.lat && a.lon === b.lon;
}

/** Polygon area (signed, local 2D coords). */
function polyArea(pts) {
    let a = 0;
    for (let i = 0, n = pts.length - 1; i < n; i++) {
        a += pts[i].x * pts[i+1].y - pts[i+1].x * pts[i].y;
    }
    return a / 2;
}

/** Bounding box of local 2D points → {minX,minY,maxX,maxY,cx,cy}. */
function bbox(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY, cx: (minX+maxX)/2, cy: (minY+maxY)/2, w: maxX-minX, h: maxY-minY };
}

// --- Buildings ---

function getBuildingHeight(tags) {
    if (tags.height) {
        const h = parseFloat(tags.height);
        if (!isNaN(h)) return h;
    }
    if (tags['building:levels']) {
        const l = parseInt(tags['building:levels'], 10);
        if (!isNaN(l)) return l * 3;
    }
    return 10;
}

function getRoofHeight(tags, defaultH) {
    if (tags['roof:height']) {
        const h = parseFloat(tags['roof:height']);
        if (!isNaN(h)) return h;
    }
    return defaultH;
}

// Push a geometry into a per-material bucket for later merging.
// Strips attributes that are incompatible across sources so mergeGeometries can work.
function pushGeo(buckets, material, geometry) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geometry.attributes.position);
    if (geometry.attributes.normal) g.setAttribute('normal', geometry.attributes.normal);
    if (geometry.index) g.setIndex(geometry.index);
    let list = buckets.get(material);
    if (!list) buckets.set(material, list = []);
    list.push(g);
}

/**
 * Build a pyramidal roof (single apex at centroid). Returns BufferGeometry.
 */
function buildPyramidalRoofGeo(pts, baseZ, roofH) {
    const cx = pts.reduce((s,p)=>s+p.x,0) / pts.length;
    const cy = pts.reduce((s,p)=>s+p.y,0) / pts.length;
    const apex = [cx, cy, baseZ + roofH];

    const positions = [];
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        positions.push(a.x, a.y, baseZ,  b.x, b.y, baseZ,  apex[0], apex[1], apex[2]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.computeVertexNormals();
    return geo;
}

/**
 * Build a gabled (tent) roof. Uses bbox: ridge runs along the longer axis.
 */
function buildGabledRoofGeo(pts, baseZ, roofH) {
    const bb = bbox(pts);
    const along = bb.w >= bb.h; // ridge along X (true) or Y
    const ridgeZ = baseZ + roofH;

    const positions = [];
    if (along) {
        // Ridge: two points at (minX, cy, ridgeZ) → (maxX, cy, ridgeZ)
        const r1 = [bb.minX, bb.cy, ridgeZ];
        const r2 = [bb.maxX, bb.cy, ridgeZ];
        // Two roof slopes (front/back) + two triangular gable ends
        // Front slope (y < cy): rectangle (minX,minY)-(maxX,minY)-r2-r1
        positions.push(
            bb.minX, bb.minY, baseZ,  bb.maxX, bb.minY, baseZ,  r2[0], r2[1], r2[2],
            bb.minX, bb.minY, baseZ,  r2[0], r2[1], r2[2],     r1[0], r1[1], r1[2],
            // Back slope
            bb.maxX, bb.maxY, baseZ,  bb.minX, bb.maxY, baseZ,  r1[0], r1[1], r1[2],
            bb.maxX, bb.maxY, baseZ,  r1[0], r1[1], r1[2],      r2[0], r2[1], r2[2],
            // Gable ends (triangles)
            bb.minX, bb.minY, baseZ,  r1[0], r1[1], r1[2],      bb.minX, bb.maxY, baseZ,
            bb.maxX, bb.maxY, baseZ,  r2[0], r2[1], r2[2],      bb.maxX, bb.minY, baseZ
        );
    } else {
        const r1 = [bb.cx, bb.minY, ridgeZ];
        const r2 = [bb.cx, bb.maxY, ridgeZ];
        positions.push(
            bb.minX, bb.minY, baseZ,  bb.minX, bb.maxY, baseZ,  r2[0], r2[1], r2[2],
            bb.minX, bb.minY, baseZ,  r2[0], r2[1], r2[2],      r1[0], r1[1], r1[2],

            bb.maxX, bb.maxY, baseZ,  bb.maxX, bb.minY, baseZ,  r1[0], r1[1], r1[2],
            bb.maxX, bb.maxY, baseZ,  r1[0], r1[1], r1[2],      r2[0], r2[1], r2[2],

            bb.minX, bb.minY, baseZ,  r1[0], r1[1], r1[2],      bb.maxX, bb.minY, baseZ,
            bb.maxX, bb.maxY, baseZ,  r2[0], r2[1], r2[2],      bb.minX, bb.maxY, baseZ
        );
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.computeVertexNormals();
    return geo;
}

function addBuilding(buckets, way, nodeIndex, tileX, tileY) {
    const nodes = resolveWay(way, nodeIndex);
    if (!nodes || nodes.length < 4) return;
    const pts = projectNodes(nodes, tileX, tileY);
    if (Math.abs(polyArea(pts)) < 0.5) return;

    const tags = way.tags;
    const totalH = getBuildingHeight(tags);
    const roofShape = tags['roof:shape'];
    const roofH = (roofShape && roofShape !== 'flat')
        ? getRoofHeight(tags, Math.min(4, totalH * 0.4))
        : 0;
    const wallH = totalH - roofH;

    // Walls (extruded shape)
    const shape = new THREE.Shape();
    shape.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);

    const wallGeo = new THREE.ExtrudeGeometry(shape, { depth: wallH, bevelEnabled: false });
    wallGeo.computeVertexNormals();
    pushGeo(buckets, matBuilding, wallGeo);

    // Roof
    if (roofH > 0) {
        let roofGeo;
        if (roofShape === 'pyramidal' || roofShape === 'dome' || roofShape === 'cone') {
            roofGeo = buildPyramidalRoofGeo(pts, wallH, roofH);
        } else if (roofShape === 'gabled' || roofShape === 'hipped' || roofShape === 'mansard' || roofShape === 'skillion') {
            roofGeo = buildGabledRoofGeo(pts, wallH, roofH);
        }
        if (roofGeo) pushGeo(buckets, matRoof, roofGeo);
    }
}

// --- Roads / paths / rails ---

const ROAD_WIDTHS = {
    motorway: 12, trunk: 11, primary: 9, secondary: 8, tertiary: 7,
    residential: 6, living_street: 5, unclassified: 5, service: 4,
    pedestrian: 5, footway: 2, path: 1.5, steps: 2, cycleway: 2.5, track: 3, corridor: 2, construction: 5
};

function getRoadWidth(tags) {
    if (tags.width) {
        const w = parseFloat(tags.width);
        if (!isNaN(w)) return w;
    }
    return ROAD_WIDTHS[tags.highway] || 4;
}

function getRoadMaterial(tags) {
    const h = tags.highway;
    if (h === 'footway' || h === 'pedestrian' || h === 'path' || h === 'steps') return matFootway;
    if (h === 'cycleway') return matCycleway;
    return matRoad;
}

/**
 * Build a flat ribbon (extruded line with thickness) along the road centerline.
 * Thickness = small vertical extrusion so it sits on the ground.
 */
function buildRibbonGeo(pts, width, baseZ, thickness) {
    if (pts.length < 2) return null;

    // Build a quad strip perpendicular to each segment
    const positions = [];
    const indices = [];
    const half = width / 2;

    // Compute left/right offsets per node (averaged between adjacent segments)
    const left = [];
    const right = [];
    for (let i = 0; i < pts.length; i++) {
        let nx = 0, ny = 0;
        // segment direction(s)
        if (i > 0) {
            const dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y;
            const L = Math.hypot(dx, dy) || 1;
            nx += -dy / L; ny += dx / L;
        }
        if (i < pts.length - 1) {
            const dx = pts[i+1].x - pts[i].x, dy = pts[i+1].y - pts[i].y;
            const L = Math.hypot(dx, dy) || 1;
            nx += -dy / L; ny += dx / L;
        }
        const L = Math.hypot(nx, ny) || 1;
        nx /= L; ny /= L;
        left.push({ x: pts[i].x + nx * half, y: pts[i].y + ny * half });
        right.push({ x: pts[i].x - nx * half, y: pts[i].y - ny * half });
    }

    // Top + bottom rings
    const topZ = baseZ + thickness;
    for (let i = 0; i < pts.length; i++) {
        positions.push(left[i].x, left[i].y, topZ);
        positions.push(right[i].x, right[i].y, topZ);
    }
    for (let i = 0; i < pts.length; i++) {
        positions.push(left[i].x, left[i].y, baseZ);
        positions.push(right[i].x, right[i].y, baseZ);
    }

    const N = pts.length;
    // Top surface
    for (let i = 0; i < N - 1; i++) {
        const a = i*2, b = i*2+1, c = (i+1)*2, d = (i+1)*2+1;
        indices.push(a, b, d,  a, d, c);
    }
    // Sides (left/right edges)
    const bot = N * 2;
    for (let i = 0; i < N - 1; i++) {
        const tlA = i*2,       tlB = (i+1)*2;
        const blA = bot + i*2, blB = bot + (i+1)*2;
        indices.push(tlA, blA, blB,  tlA, blB, tlB); // left
        const trA = i*2 + 1,       trB = (i+1)*2 + 1;
        const brA = bot + i*2 + 1, brB = bot + (i+1)*2 + 1;
        indices.push(trB, brB, brA,  trB, brA, trA); // right
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
}

function addRoad(buckets, way, nodeIndex, tileX, tileY) {
    const nodes = resolveWay(way, nodeIndex);
    if (!nodes || nodes.length < 2) return;
    const pts = projectNodes(nodes, tileX, tileY);
    const width = getRoadWidth(way.tags);
    const isFoot = way.tags.highway === 'footway' || way.tags.highway === 'pedestrian'
                || way.tags.highway === 'path' || way.tags.highway === 'steps';

    const baseZ = isFoot ? Z_FOOTWAY : Z_ROAD;
    const thickness = 0.3;
    const geo = buildRibbonGeo(pts, width, baseZ, thickness);
    if (geo) pushGeo(buckets, getRoadMaterial(way.tags), geo);
}

function addRail(buckets, way, nodeIndex, tileX, tileY) {
    const nodes = resolveWay(way, nodeIndex);
    if (!nodes || nodes.length < 2) return;
    const pts = projectNodes(nodes, tileX, tileY);
    const geo = buildRibbonGeo(pts, 2, Z_ROAD, 0.25);
    if (geo) pushGeo(buckets, matRail, geo);
}

// --- Polygons (water, parks, grass, pitches) ---

function makePolygonGeo(pts, holes, baseZ) {
    const shape = new THREE.Shape();
    shape.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);

    if (holes) {
        for (const h of holes) {
            if (h.length < 3) continue;
            const path = new THREE.Path();
            path.moveTo(h[0].x, h[0].y);
            for (let i = 1; i < h.length; i++) path.lineTo(h[i].x, h[i].y);
            shape.holes.push(path);
        }
    }

    const geo = new THREE.ShapeGeometry(shape);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, baseZ);
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
}

function addPolygon(buckets, way, nodeIndex, tileX, tileY, baseZ, material) {
    const nodes = resolveWay(way, nodeIndex);
    if (!nodes || nodes.length < 4) return;
    const pts = projectNodes(nodes, tileX, tileY);
    if (Math.abs(polyArea(pts)) < 1) return;
    pushGeo(buckets, material, makePolygonGeo(pts, null, baseZ));
}

/**
 * Stitch a multipolygon relation's ways into outer + inner rings.
 * Returns [{outer: pts, holes: [pts...]}].
 */
function buildMultipolygon(relation, wayIndex, nodeIndex, tileX, tileY) {
    const outers = [];
    const inners = [];
    for (const m of relation.members || []) {
        if (m.type !== 'way') continue;
        const way = wayIndex.get(m.ref);
        if (!way) continue;
        const nodes = resolveWay(way, nodeIndex);
        if (!nodes) continue;
        const list = m.role === 'inner' ? inners : outers;
        list.push(nodes);
    }
    // Stitch open ways into closed rings (greedy match endpoints)
    const stitch = (segs) => {
        const rings = [];
        const remaining = segs.map(s => s.slice());
        while (remaining.length) {
            let ring = remaining.shift();
            let closed = ring[0].lat === ring.at(-1).lat && ring[0].lon === ring.at(-1).lon;
            while (!closed && remaining.length) {
                const head = ring.at(-1);
                let i = remaining.findIndex(r => r[0].lat === head.lat && r[0].lon === head.lon);
                if (i >= 0) { ring = ring.concat(remaining[i].slice(1)); remaining.splice(i, 1); }
                else {
                    i = remaining.findIndex(r => r.at(-1).lat === head.lat && r.at(-1).lon === head.lon);
                    if (i >= 0) { ring = ring.concat(remaining[i].slice().reverse().slice(1)); remaining.splice(i, 1); }
                    else break;
                }
                closed = ring[0].lat === ring.at(-1).lat && ring[0].lon === ring.at(-1).lon;
            }
            if (ring.length >= 4) rings.push(ring);
        }
        return rings;
    };
    const outerRings = stitch(outers).map(r => projectNodes(r, tileX, tileY));
    const innerRings = stitch(inners).map(r => projectNodes(r, tileX, tileY));

    // Assign each inner ring to an outer (point-in-polygon on first vertex)
    const result = outerRings.map(o => ({ outer: o, holes: [] }));
    for (const ih of innerRings) {
        for (const o of result) {
            if (pointInPolygon(ih[0], o.outer)) { o.holes.push(ih); break; }
        }
    }
    return result;
}

function pointInPolygon(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
        if (((yi > p.y) !== (yj > p.y)) &&
            (p.x < (xj - xi) * (p.y - yi) / (yj - yi + 1e-12) + xi)) inside = !inside;
    }
    return inside;
}

function addMultipolygon(buckets, relation, wayIndex, nodeIndex, tileX, tileY, baseZ, material) {
    const polys = buildMultipolygon(relation, wayIndex, nodeIndex, tileX, tileY);
    for (const p of polys) {
        if (p.outer.length < 4) continue;
        if (Math.abs(polyArea(p.outer)) < 1) continue;
        try { pushGeo(buckets, material, makePolygonGeo(p.outer, p.holes, baseZ)); } catch {}
    }
}

// --- Point features ---

// Unit geometries (created once, reused via InstancedMesh per tile).
// Cylinder axis is Y; we pre-rotate to Z so we can drop tile-local instance matrices in directly.
const TREE_TRUNK_GEO = new THREE.CylinderGeometry(0.3, 0.4, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5);
const TREE_CROWN_GEO = new THREE.IcosahedronGeometry(1, 0);
const LAMP_POLE_GEO  = new THREE.CylinderGeometry(0.08, 0.1, 1, 5).rotateX(Math.PI / 2).translate(0, 0, 0.5);
const LAMP_HEAD_GEO  = new THREE.SphereGeometry(0.3, 6, 4);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

function addTreesInstanced(group, treeNodes, tileX, tileY) {
    const n = treeNodes.length;
    if (n === 0) return;
    const trunks = new THREE.InstancedMesh(TREE_TRUNK_GEO, matTreeTrunk, n);
    const crowns = new THREE.InstancedMesh(TREE_CROWN_GEO, matTreeLeaves, n);
    trunks.frustumCulled = false;
    crowns.frustumCulled = false;

    for (let i = 0; i < n; i++) {
        const node = treeNodes[i];
        const lambert = wgs84ToLambert72(node.lat, node.lon);
        const x = lambert.x - tileX;
        const y = lambert.y - tileY;
        let height = 8;
        if (node.tags && node.tags.height) {
            const h = parseFloat(node.tags.height);
            if (!isNaN(h)) height = h;
        }
        const trunkH = height * 0.35;
        const crownH = height - trunkH;
        const crownR = Math.max(1.5, height * 0.35);

        // Trunk: scale unit cylinder to height = trunkH (z axis).
        _q.identity();
        _p.set(x, y, 0);
        _s.set(1, 1, trunkH);
        _m.compose(_p, _q, _s);
        trunks.setMatrixAt(i, _m);

        // Crown: position above trunk, scale icosahedron radius.
        _p.set(x, y, trunkH + crownH * 0.5);
        _s.set(crownR, crownR, crownH / 2);
        _m.compose(_p, _q, _s);
        crowns.setMatrixAt(i, _m);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    group.add(trunks);
    group.add(crowns);
}

function addLampsInstanced(group, lampNodes, tileX, tileY) {
    const n = lampNodes.length;
    if (n === 0) return;
    const H = 5;
    const poles = new THREE.InstancedMesh(LAMP_POLE_GEO, matLampPole, n);
    const heads = new THREE.InstancedMesh(LAMP_HEAD_GEO, matLampHead, n);
    poles.frustumCulled = false;
    heads.frustumCulled = false;

    for (let i = 0; i < n; i++) {
        const node = lampNodes[i];
        const lambert = wgs84ToLambert72(node.lat, node.lon);
        const x = lambert.x - tileX;
        const y = lambert.y - tileY;
        _q.identity();
        _p.set(x, y, 0);
        _s.set(1, 1, H);
        _m.compose(_p, _q, _s);
        poles.setMatrixAt(i, _m);

        _p.set(x, y, H);
        _s.set(1, 1, 1);
        _m.compose(_p, _q, _s);
        heads.setMatrixAt(i, _m);
    }
    poles.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    group.add(poles);
    group.add(heads);
}

// --- Main loader ---

export async function loadOSMTile(scene, tileX, tileY, signal) {
    const data = await fetchOSMTile(tileX, tileY, signal);

    const nodeIndex = new Map();
    const wayIndex = new Map();
    for (const el of data.elements) {
        if (el.type === 'node') nodeIndex.set(el.id, { lat: el.lat, lon: el.lon, tags: el.tags });
        else if (el.type === 'way') wayIndex.set(el.id, el);
    }
    // Track way IDs used as members of natural=water relations so we don't double-render them.
    const waterMemberWayIds = new Set();
    for (const el of data.elements) {
        if (el.type === 'relation' && el.tags && (el.tags.natural === 'water' || el.tags.water || el.tags.waterway)) {
            for (const m of el.members || []) if (m.type === 'way') waterMemberWayIds.add(m.ref);
        }
    }

    const group = new THREE.Group();
    const worldX = tileX - ORIGIN_X;
    const worldZ = -(tileY - ORIGIN_Y);
    group.position.set(worldX, 0, worldZ);
    group.rotation.x = -Math.PI / 2;

    // White ground underlayer: a 1x1km plane sitting just below z=0 per tile.
    // In tile-local coords the tile spans (0..1000, 0..1000).
    const groundGeo = new THREE.PlaneGeometry(1000, 1000);
    groundGeo.translate(500, 500, -0.01);
    group.add(new THREE.Mesh(groundGeo, matGround));

    // Collect point features for batched (instanced) creation.
    const treeNodes = [];
    const lampNodes = [];
    // Collect one geometry bucket per material → merge at the end for minimal draw calls.
    const buckets = new Map();

    // Process all features
    for (const el of data.elements) {
        const t = el.tags;
        if (!t) continue;
        try {
            if (el.type === 'way') {
                if (t.building || t['building:part']) {
                    addBuilding(buckets, el, nodeIndex, tileX, tileY);
                } else if (t.highway === 'street_lamp') {
                    // skip — it's a node tag elsewhere
                } else if (t.highway) {
                    addRoad(buckets, el, nodeIndex, tileX, tileY);
                } else if (t.railway === 'rail' || t.railway === 'tram' || t.railway === 'light_rail') {
                    addRail(buckets, el, nodeIndex, tileX, tileY);
                } else if (t.natural === 'water' || t.water) {
                    // Skip ways that are part of a multipolygon — relation will render them
                    if (!waterMemberWayIds.has(el.id)) {
                        addPolygon(buckets, el, nodeIndex, tileX, tileY, Z_WATER, matWater);
                    }
                } else if (t.waterway === 'stream' || t.waterway === 'drain' || t.waterway === 'ditch') {
                    // Small waterways usually only have a centerline → narrow ribbon
                    const nodes = resolveWay(el, nodeIndex);
                    if (nodes && nodes.length >= 2) {
                        const pts = projectNodes(nodes, tileX, tileY);
                        const w = parseFloat(t.width) || 3;
                        const g = buildRibbonGeo(pts, w, Z_WATER, 0.05);
                        if (g) pushGeo(buckets, matWater, g);
                    }
                }
                // Big waterways (river/canal): NOT rendered as ribbons — the proper natural=water
                // polygon/multipolygon defines the actual riverbanks at full resolution.
                else if (t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'village_green' || t.landuse === 'flowerbed' || t.landuse === 'forest') {
                    addPolygon(buckets, el, nodeIndex, tileX, tileY, Z_GROUND, matGrass);
                } else if (t.leisure === 'park') {
                    addPolygon(buckets, el, nodeIndex, tileX, tileY, Z_GROUND, matPark);
                } else if (t.leisure === 'garden') {
                    addPolygon(buckets, el, nodeIndex, tileX, tileY, Z_GROUND, matGarden);
                } else if (t.leisure === 'pitch') {
                    addPolygon(buckets, el, nodeIndex, tileX, tileY, Z_GROUND, matPitch);
                } else if (t.barrier === 'wall' || t.barrier === 'fence' || t.barrier === 'hedge') {
                    const nodes = resolveWay(el, nodeIndex);
                    if (nodes && nodes.length >= 2) {
                        const pts = projectNodes(nodes, tileX, tileY);
                        const g = buildRibbonGeo(pts, 0.3, 0, t.barrier === 'hedge' ? 1.5 : 1.8);
                        if (g) pushGeo(buckets, matBarrier, g);
                    }
                }
            } else if (el.type === 'node') {
                if (t.natural === 'tree') treeNodes.push(el);
                else if (t.highway === 'street_lamp') lampNodes.push(el);
            } else if (el.type === 'relation') {
                if (t.natural === 'water' || t.water || t.waterway) {
                    addMultipolygon(buckets, el, wayIndex, nodeIndex, tileX, tileY, Z_WATER, matWater);
                } else if (t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'village_green' || t.landuse === 'forest') {
                    addMultipolygon(buckets, el, wayIndex, nodeIndex, tileX, tileY, Z_GROUND, matGrass);
                } else if (t.leisure === 'park') {
                    addMultipolygon(buckets, el, wayIndex, nodeIndex, tileX, tileY, Z_GROUND, matPark);
                }
            }
        } catch (e) {
            // skip malformed feature
        }
    }

    // Merge each material's geometries into a single mesh → ~1 draw call per material.
    // Then add one LineSegments of edges per merged mesh (cheap because only one per material).
    for (const [material, geos] of buckets) {
        if (geos.length === 0) continue;
        const merged = mergeGeometries(geos, false);
        if (!merged) continue;
        group.add(new THREE.Mesh(merged, material));
        group.add(new THREE.LineSegments(new THREE.EdgesGeometry(merged, 30), matEdge));
    }

    addTreesInstanced(group, treeNodes, tileX, tileY);
    addLampsInstanced(group, lampNodes, tileX, tileY);

    return group;
}
