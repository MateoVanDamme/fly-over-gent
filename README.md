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

## Preprocessing

The `pre-processing/` directory contains Python scripts to convert DWG files to STL format.

### Requirements

```bash
pip install ezdxf numpy numpy-stl
```

**Note:** DWG to DXF conversion requires AutoCAD installed on Windows with `pyautocad`.

### Workflow

1. **Convert DWG to DXF** (requires AutoCAD on Windows):
   ```bash
   python pre-processing/dwg_to_dxf_v3.py <input.dwg>
   ```
   This generates DXF files in the same directory as the input file.

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

### Output Format

The scripts export STL files with coordinates in **meters** and Lambert-72 coordinate system positioning. The resulting STL files can be placed directly in the `data/` directory structure.

### File Types

The Gent 3D dataset contains two types of files per tile:
- **Buildings** (`Geb_*.dwg`) - 3D building models
- **Terrain** (`Trn_*.dwg`) - Ground elevation data

## Tech Stack

- Three.js for 3D rendering
- STL file format for city geometry
- Vanilla JavaScript (no framework)