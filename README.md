# Fly Over Ghent

Interactive 3D viewer for flying through the city of Ghent using real city data.

## Features

- **Free Flight**: Fly freely through the 3D city
- **Real 3D City Models**: Official city data from Gent
- **Lambert-1972 Coordinate System**: Accurate geographic positioning

## Controls

- **Click** to capture mouse
- **Mouse** to look around
- **WASD** to move
- **Space** to fly up
- **Shift** to fly down
- **I** - Toggle debug info
- **ESC** to release mouse

## Data Source & License

This project uses 3D city data from the City of Gent, made available under the **Modellicentie Gratis Hergebruik Vlaanderen v1.0** (Free Reuse Model License Flanders v1.0).

**Source:** City of Gent - Gent in 3D
**Dataset:** https://data.stad.gent/explore/dataset/gent-in-3d/table/
**License:** https://www.vlaanderen.be/digitaal-vlaanderen/onze-diensten-en-platformen/open-data/voorwaarden-voor-het-hergebruik-van-overheidsinformatie/modellicentie-gratis-hergebruik

Contains government information obtained under the free reuse model license Flanders v1.0.

## Data Pipeline

### 1. Download Data

Download all DWG files from the Gent 3D dataset:

```bash
python pre-processing/download_gent_data.py
```

This will download all building and terrain tiles from the City of Gent open data portal and organize them into the `data/` directory.

### 2. Convert to STL Format

The `pre-processing/` directory contains Python scripts to convert DWG files to STL format.

#### Requirements

```bash
pip install ezdxf numpy trimesh requests
```

**Note:** DWG reading requires the free [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter) (~30MB). Install to default location; ezdxf auto-detects it.

#### Workflow

**Single File Conversion:**

```bash
python pre-processing/dwg_to_stl.py <input.dwg|dxf> [output.stl]
```
Converts DWG/DXF files (3DFACE entities and POLYLINE meshes) directly to STL format.

**Batch Conversion:**

```bash
# Convert all DWG files
python pre-processing/run_all.py

# Skip already converted files
python pre-processing/run_all.py --skip-existing

# Download data first, then convert
python pre-processing/run_all.py --download

# Only terrain or building files
python pre-processing/run_all.py --pattern "*Trn_*"
python pre-processing/run_all.py --pattern "*Geb_*"
```

Scans `data/input/` for DWG files and outputs to `data/stl/`. For custom directories use `batch_convert.py` directly.

#### Output Format

The scripts export STL files with coordinates in **meters** and Lambert-72 coordinate system positioning. The resulting STL files can be placed directly in the `data/` directory structure.

#### File Types

The Gent 3D dataset contains two types of files per tile:
- **Buildings** (`Geb_*.dwg`) - 3D building models
- **Terrain** (`Trn_*.dwg`) - Ground elevation data

## Tech Stack

- Three.js for 3D rendering
- STL file format for city geometry
- Vanilla JavaScript (no framework)

## Performance Optimizations

The following optimizations have been implemented to improve rendering performance:

### Rendering Optimizations
- **Lambert Shading**: Using `MeshLambertMaterial` instead of `MeshPhongMaterial` for cheaper per-pixel lighting calculations (~30-40% faster)
- **Flat Shading**: Enabled `flatShading: true` for simpler normal calculations and better visual clarity on architectural geometry
- **Reduced Lighting**: Using 1 ambient + 1 directional light (down from 1 ambient + 2 directional) for fewer lighting calculations per fragment
- **Single-Sided Rendering**: Using `THREE.BackSide` instead of `THREE.DoubleSide` renders only one face per triangle (50% fewer fragments). The STL files have inverted normals, so BackSide is the correct choice and is faster than DoubleSide

### Geometry & Memory Optimizations
- **Material Reuse**: Materials are created once at module scope and shared across all tiles, improving GPU batching efficiency and reducing memory overhead
- **Bounding Sphere Computation**: Each tile geometry has computed bounding spheres (`computeBoundingSphere()`), enabling Three.js frustum culling to automatically skip rendering tiles outside the camera view
  - Critical for future dynamic tile loading system (Minecraft-style)
  - Only visible tiles are rendered, providing massive performance gains when looking at portions of the city

### Performance Impact
These optimizations provide significant FPS improvements, especially when:
- Not all tiles are in view (frustum culling skips off-screen tiles)
- Running on lower-end hardware (simpler shading models)
- Preparing for dynamic tile loading with 50+ tiles (material reuse and culling become essential)
