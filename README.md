# Fly Over Gent

Interactive 3D viewer for flying through the city of Gent using real city data.

The site is live at: https://mateovandamme.github.io/fly-over-gent/

## Features

- First-person flight controls with mouse look
- Real 3D city models from official city data
- Lambert-1972 coordinate system positioning
- Smooth movement with WASD controls

## Controls

- **Click** to capture mouse
- **Mouse** to look around
- **WASD** to move
- **Space** to fly up
- **Shift** to fly down
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
pip install ezdxf numpy numpy-stl requests
```

**Note:** DWG to DXF conversion requires AutoCAD installed on Windows with `pyautocad`.

#### Workflow

**Single File Conversion:**

1. **Convert DWG to DXF** (requires AutoCAD on Windows):
   Enter AutoCAD and do DXFOUT manually. 

2. **Inspect DXF** (optional - to verify geometry):
   ```bash
   python pre-processing/inspect_dwg.py <output.dxf>
   ```
   Shows entity counts and types in the DXF file.

3. **Convert DXF to STL**:
   ```bash
   python pre-processing/dxf_to_stl_3dface.py <output.dxf>
   ```
   Converts 3DFACE entities and POLYLINE meshes to STL format.

**Batch Conversion:**

Convert all DXF files in a directory using parallel processing:

```bash
# Convert all DXF files to a specific output directory
python pre-processing/batch_dxf_to_stl.py data/ --output data/stl

# Convert only terrain files
python pre-processing/batch_dxf_to_stl.py data/ --pattern "*Trn_*.dxf" --output data/stl

# Skip files that already have STL outputs
python pre-processing/batch_dxf_to_stl.py data/ --skip-existing --output data/stl

# Use specific number of workers
python pre-processing/batch_dxf_to_stl.py data/ --workers 4 --output data/stl
```

**Windows Example:**
```cmd
python pre-processing\batch_dxf_to_stl.py "C:\Repos\home\fly-over-gent\data" --output "C:\Repos\home\fly-over-gent\data\stl" --skip-existing
```

This command will:
- Search recursively for all DXF files in the `data` directory
- Convert them to STL format using parallel processing
- Output all STL files to `data\stl\`
- Skip files that are already converted (saves time on subsequent runs)

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