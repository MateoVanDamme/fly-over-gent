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

1. Open DWG file in AutoCAD
2. Convert to IGES format
3. Open in FreeCAD
4. Export as STL with proper scale (1 unit = 1 meter)

## Tech Stack

- Three.js for 3D rendering
- STL file format for city geometry
- Vanilla JavaScript (no framework)