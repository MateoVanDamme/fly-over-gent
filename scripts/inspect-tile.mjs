import fs from 'fs';
const files = ['data/osm/104000_193000.json', 'data/osm/104000_194000.json', 'data/osm/105000_193000.json', 'data/osm/105000_194000.json'];
for (const f of files) {
    const d = JSON.parse(fs.readFileSync(f));
    const water = d.elements.filter(e => e.tags && (e.tags.natural === 'water' || e.tags.water));
    const ways = d.elements.filter(e => e.tags && e.tags.waterway);
    const rels = d.elements.filter(e => e.type === 'relation' && e.tags && (e.tags.natural === 'water' || e.tags.waterway || e.tags.water));
    console.log(f);
    console.log('  natural=water count:', water.length, 'types:', water.map(e => e.type + (e.tags.name ? ':'+e.tags.name : '')));
    console.log('  waterway=* count:', ways.length, 'types:', ways.map(e => e.tags.waterway + (e.tags.name ? ':'+e.tags.name : '')));
    console.log('  water relations:', rels.length);
}
