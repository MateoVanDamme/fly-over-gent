# Fly Over Gent

Interactive 3D viewer for flying through the city of Gent using real city data.

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

## Data Source

Official Gent city data: https://data.stad.gent/explore/dataset/gent-in-3d/table/

## Preprocessing

1. Open DWG file in AutoCAD
2. Convert to IGES format
3. Open in FreeCAD
4. Export as STL with proper scale (1 unit = 1 meter)

## Tech Stack

- Three.js for 3D rendering
- STL file format for city geometry
- Vanilla JavaScript (no framework)