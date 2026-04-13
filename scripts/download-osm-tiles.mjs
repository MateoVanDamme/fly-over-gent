#!/usr/bin/env node
/**
 * Downloads OSM data for all Ghent tiles using multiple Overpass mirrors in parallel.
 * Each mirror has its own per-IP rate limit, so running N workers gives ~Nx throughput.
 *
 * Usage: node scripts/download-osm-tiles.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { lambert72ToWGS84 } from '../javascript/lambertProjection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'data', 'osm');
const TILE_INDEX = path.join(__dirname, '..', 'data', 'gent-in-3d.json');

// Each mirror runs as an independent worker. Status URL is used to poll for free slots.
const MIRRORS = [
    { name: 'main', url: 'https://overpass-api.de/api/interpreter',       statusUrl: 'https://overpass-api.de/api/status' },
    { name: 'kumi', url: 'https://overpass.kumi.systems/api/interpreter', statusUrl: 'https://overpass.kumi.systems/api/status' },
];

const USER_AGENT = 'fly-over-ghent-tile-downloader/1.0 (https://github.com/your/repo)';
const MIRROR_FAIL_LIMIT = 8;

// --- Helpers ---

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function buildQuery(tileX, tileY) {
    const sw = lambert72ToWGS84(tileX, tileY);
    const ne = lambert72ToWGS84(tileX + 1000, tileY + 1000);
    const bbox = `${sw.lat},${sw.lon},${ne.lat},${ne.lon}`;
    // Only request features we actually render. Lighter query → fewer 504s.
    return `[out:json][timeout:60];
(
  way["building"](${bbox});
  relation["building"](${bbox});
  way["building:part"](${bbox});
  relation["building:part"](${bbox});
  way["highway"](${bbox});
  way["railway"](${bbox});
  way["waterway"](${bbox});
  way["natural"](${bbox});
  relation["natural"](${bbox});
  node["natural"](${bbox});
  way["landuse"](${bbox});
  relation["landuse"](${bbox});
  way["leisure"](${bbox});
  relation["leisure"](${bbox});
  way["barrier"](${bbox});
  node["highway"="street_lamp"](${bbox});
);
out body;
>;
out skel qt;`;
}

/**
 * Poll Overpass /api/status. Returns seconds to wait (0 if a slot is free now).
 * Status response format:
 *   Connected as: <id>
 *   Current time: <iso>
 *   Rate limit: <N>
 *   <N slots free now>  OR
 *   Slot available after: <iso>, in <S> seconds.
 *   ...
 */
async function checkSlot(mirror) {
    try {
        const r = await fetch(mirror.statusUrl, { headers: { 'User-Agent': USER_AGENT } });
        if (!r.ok) return 0; // can't check → just try
        const text = await r.text();
        if (/\d+ slots? available now/.test(text)) return 0;
        // Parse "in <N> seconds." lines, take the smallest.
        const matches = [...text.matchAll(/in (\d+) seconds?\./g)].map(m => parseInt(m[1], 10));
        if (matches.length === 0) return 0;
        return Math.max(1, Math.min(...matches)) + 1; // +1 second of grace
    } catch {
        return 0;
    }
}

async function fetchTile(mirror, tileX, tileY) {
    const query = buildQuery(tileX, tileY);
    const response = await fetch(mirror.url, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT
        }
    });
    if (response.status === 429 || response.status === 504 || response.status === 503) {
        const e = new Error(`HTTP ${response.status}`);
        e.retryable = true;
        throw e;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

// --- Worker: each mirror pulls tiles from the shared queue ---

async function worker(mirror, queue, totalRemaining, stats) {
    let consecutiveFails = 0;
    while (queue.length > 0) {
        const tile = queue.shift();
        if (!tile) break;
        const [x, y] = tile;
        const outFile = path.join(OUT_DIR, `${x}_${y}.json`);
        if (fs.existsSync(outFile)) continue;

        // Wait for a free slot before sending the request.
        const waitSec = await checkSlot(mirror);
        if (waitSec > 0) {
            console.log(`  [${mirror.name}] no slot, waiting ${waitSec}s for next slot`);
            await sleep(waitSec * 1000);
        }

        try {
            const data = await fetchTile(mirror, x, y);
            fs.writeFileSync(outFile, JSON.stringify(data));
            const buildings = data.elements.filter(e => e.type === 'way' && e.tags?.building).length;
            const kb = (JSON.stringify(data).length / 1024).toFixed(0);
            stats.ok++;
            console.log(`[${stats.ok}/${totalRemaining}] [${mirror.name}] ${x}_${y} OK (${buildings} buildings, ${kb}KB)`);
            consecutiveFails = 0;
        } catch (err) {
            queue.push(tile);
            consecutiveFails++;
            console.log(`  [${mirror.name}] ${x}_${y} ${err.message} → requeue (consec fails ${consecutiveFails})`);
            if (consecutiveFails >= MIRROR_FAIL_LIMIT) {
                console.log(`  [${mirror.name}] giving up after ${consecutiveFails} consecutive failures`);
                return;
            }
            // Heavier backoff if retryable (server overloaded)
            await sleep(err.retryable ? 30000 : 5000);
        }
    }
}

// --- Main ---

async function main() {
    const tileIndex = JSON.parse(fs.readFileSync(TILE_INDEX, 'utf-8'));
    const allTiles = tileIndex.map(entry => {
        const [xShort, yShort] = entry.vaknummer.split('_').map(Number);
        return [xShort * 1000, yShort * 1000];
    });

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const remaining = allTiles.filter(([x, y]) => !fs.existsSync(path.join(OUT_DIR, `${x}_${y}.json`)));

    console.log(`${allTiles.length} tiles total, ${allTiles.length - remaining.length} already downloaded, ${remaining.length} remaining`);
    console.log(`Using ${MIRRORS.length} mirrors in parallel: ${MIRRORS.map(m => m.name).join(', ')}\n`);

    const queue = remaining.slice();
    const stats = { ok: 0, fail: 0 };
    const totalRemaining = remaining.length;

    await Promise.all(MIRRORS.map(m => worker(m, queue, totalRemaining, stats)));

    console.log(`\nDone! ok=${stats.ok} fail=${stats.fail}. Upload data/osm/ to GCP bucket.`);
}

main().catch(console.error);
