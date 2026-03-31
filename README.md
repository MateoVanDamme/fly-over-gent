# Fly Over Ghent

Interactive 3D viewer for flying through the city of Ghent using real city data.

## Features

- **Free Flight** — Fly freely through the 3D city with WASD + mouse controls
- **Real 3D City Models** — Official open data from the City of Gent (199 building tiles, 211 terrain tiles)
- **Dynamic Tile Loading** — Minecraft-style chunk system loads tiles around the camera in real time
- **Direction-Based Culling** — Only loads tiles in the camera's forward ~110° cone
- **Service Worker Caching** — Tiles are cached locally after first download for instant revisits
- **Minimap** — Real-time 2D overview showing tile states (available, cached, loading, loaded)
- **Terrain Height Coloring** — Shader-based coloring: red below 6.5m, white above
- **Precomputed Edge Lines** — Sharp edges on buildings and terrain rendered as lightweight line segments

## Controls

| Key | Action |
|-----|--------|
| **Click** | Capture mouse |
| **Mouse** | Look around |
| **WASD** | Move |
| **Space** | Fly up |
| **Shift** | Fly down |
| **I** | Toggle debug info & minimap |
| **ESC** | Release mouse |

## Data Source & License

This project uses 3D city data from the City of Gent, made available under the **Modellicentie Gratis Hergebruik Vlaanderen v1.0** (Free Reuse Model License Flanders v1.0).

**Source:** City of Gent - Gent in 3D
**Dataset:** https://data.stad.gent/explore/dataset/gent-in-3d/table/
**License:** https://www.vlaanderen.be/digitaal-vlaanderen/onze-diensten-en-platformen/open-data/voorwaarden-voor-het-hergebruik-van-overheidsinformatie/modellicentie-gratis-hergebruik

Contains government information obtained under the free reuse model license Flanders v1.0.

## Data Pipeline

### 1. Download Data

```bash
python pre-processing/download_gent_data.py
```

Downloads all building and terrain DWG tiles from the City of Gent open data portal into `data/input/`.

### 2. Convert DWG to STL

#### Requirements

```bash
pip install ezdxf numpy trimesh requests
```

DWG reading requires the free [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter). Install to default location; ezdxf auto-detects it.

#### Single file

```bash
python pre-processing/dwg_to_stl.py <input.dwg|dxf> [output.stl]
```

#### Batch conversion

```bash
python pre-processing/run_all.py              # convert all
python pre-processing/run_all.py --skip-existing  # skip already converted
python pre-processing/run_all.py --download       # download first, then convert
python pre-processing/run_all.py --pattern "*Geb_*"  # only buildings
python pre-processing/run_all.py --pattern "*Trn_*"  # only terrain
```

STL output goes to `data/stl/` with Lambert-72 coordinates in meters.

### 3. Edge Extraction

Sharp edges are precomputed automatically during STL conversion. To regenerate edges for a single tile:

```bash
python pre-processing/regen_edges.py 104 193            # default terrain angle=3
python pre-processing/regen_edges.py 104 193 --angle 5  # custom terrain threshold
```

Edge files are saved alongside STLs in `data/stl/`:
- **Building edges** (`Edg_*.bin`) — angle threshold 10°
- **Terrain edges** (`TrnEdg_*.bin`) — angle threshold 3°

Binary format: flat `float32` array of `[x1,y1,z1, x2,y2,z2, ...]` line segment pairs.

### 4. Upload to GCS

STL and edge `.bin` files are hosted on Google Cloud Storage at `https://storage.googleapis.com/fly-over-ghent/stl/`. Upload the contents of `data/stl/` there for the online viewer to use.

### File types per tile

| Type | STL | Edges | Description |
|------|-----|-------|-------------|
| Buildings | `Geb_*.stl` | `Edg_*.bin` | 3D building geometry |
| Terrain | `Trn_*.stl` | `TrnEdg_*.bin` | Ground elevation mesh |

## Tech Stack

- **Three.js** 0.160.0 — 3D rendering
- **STL** — City geometry format
- **Service Worker** — Offline tile caching
- **Vanilla JavaScript** — No framework

# Performance

## Tile Loading

Tiles are loaded dynamically in a Minecraft-style chunk system (`javascript/tileLoader.js`):

- **View distance**: 2 tiles in each direction (up to 5x5 grid)
- **Direction-based loading**: Uses the dot product between camera direction and tile offset to only load tiles in a ~110° forward cone, skipping tiles behind the camera
- **Three-tier cache**: Loaded (in scene) → In-memory cache (removed from scene, geometry kept) → Unloaded (disposed)
- **Abort on leave**: In-flight fetch requests are cancelled via `AbortController` when a tile leaves the view range
- **Deduplication**: Skips redundant `updateChunks` calls when neither camera tile nor direction changed

## Caching

### Service Worker (`sw.js`)

A service worker intercepts fetch requests for STL and edge files from Google Cloud Storage. On first load, tiles are fetched from the network and stored in the browser's Cache API. Subsequent visits serve tiles from cache instantly (cache-first strategy).

### In-Memory Tile Cache

When a tile leaves the view range, its Three.js Group is removed from the scene but kept in memory (`tileCache`). If the camera returns, the tile is re-added to the scene instantly without re-fetching or re-parsing.

## Rendering

- **Lambert shading**: `MeshLambertMaterial` for cheaper per-pixel lighting
- **Flat shading**: `flatShading: true` on buildings for clear architectural edges
- **Precomputed edges**: Sharp edges extracted at build time and stored as binary files, replacing the expensive runtime `EdgesGeometry` computation
- **Material reuse**: Single shared material per geometry type across all tiles
- **Frustum culling**: `computeBoundingSphere()` on every geometry lets Three.js skip off-screen tiles
- **Fog**: Linear fog from 0–4000 units hides tile pop-in at the edges
- **Sort disabled**: `renderer.sortObjects = false` for a faster render loop
- **Terrain height shader**: Custom `onBeforeCompile` shader colors terrain by elevation (red below 6.5m, white above) without extra draw calls
