"""
Convert DWG/DXF to STL using ezdxf's built-in recursive decomposition.
Supports DWG files via ODA File Converter (ezdxf.addons.odafc).
DXF intermediates are cached to avoid repeated ODA conversions.
"""

import sys
import shutil
import tempfile
from pathlib import Path
import numpy as np

try:
    import ezdxf
    from ezdxf.disassemble import recursive_decompose
    import trimesh
except ImportError:
    print("ERROR: Required libraries not installed. Run:")
    print("  pip install ezdxf trimesh")
    sys.exit(1)

# Default cache directory for intermediate DXF files
DXF_CACHE_DIR = Path(__file__).parent.parent / 'data' / 'dxf_cache'


def _setup_oda():
    """Ensure ODA File Converter is available."""
    from ezdxf.addons import odafc
    if not odafc.is_installed():
        import glob as _glob
        for pattern in [
            r"C:\Program Files\ODA\ODAFileConverter*\ODAFileConverter.exe",
            r"C:\Program Files (x86)\ODA\ODAFileConverter*\ODAFileConverter.exe",
        ]:
            matches = _glob.glob(pattern)
            if matches:
                ezdxf.options.set("odafc-addon", "win_exec_path", matches[0])
                break
    if not odafc.is_installed():
        raise RuntimeError(
            "ODA File Converter is not installed.\n"
            "Download free from: https://www.opendesign.com/guestfiles/oda_file_converter"
        )
    return odafc


def dwg_to_dxf(dwg_path, cache_dir=None):
    """Convert DWG to DXF, using cache if available. Returns path to DXF."""
    dwg_path = Path(dwg_path).absolute()
    if cache_dir is None:
        cache_dir = DXF_CACHE_DIR
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    dxf_path = cache_dir / dwg_path.with_suffix('.dxf').name
    if dxf_path.exists():
        return dxf_path

    odafc = _setup_oda()
    with tempfile.TemporaryDirectory(prefix='odafc_') as tmp_dir:
        version = odafc._detect_version(str(dwg_path))
        args = odafc._odafc_arguments(
            dwg_path.name, str(dwg_path.parent), tmp_dir,
            output_format='DXF', version=version, audit=False,
        )
        odafc._execute_odafc(args)
        tmp_dxf = Path(tmp_dir) / dwg_path.with_suffix('.dxf').name
        shutil.copy2(tmp_dxf, dxf_path)

    return dxf_path


def dxf_to_stl(dxf_path, stl_path):
    """Convert DXF file to STL."""
    dxf_path = Path(dxf_path)
    stl_path = Path(stl_path)

    doc = ezdxf.readfile(str(dxf_path))
    msp = doc.modelspace()

    # Flatten all block references and extract geometry
    all_triangles = []
    for entity in recursive_decompose(msp):
        etype = entity.dxftype()

        if etype == '3DFACE':
            pts = [(entity.dxf.vtx0.x, entity.dxf.vtx0.y, entity.dxf.vtx0.z),
                   (entity.dxf.vtx1.x, entity.dxf.vtx1.y, entity.dxf.vtx1.z),
                   (entity.dxf.vtx2.x, entity.dxf.vtx2.y, entity.dxf.vtx2.z),
                   (entity.dxf.vtx3.x, entity.dxf.vtx3.y, entity.dxf.vtx3.z)]
            if abs(pts[2][0]-pts[3][0]) < 0.001 and abs(pts[2][1]-pts[3][1]) < 0.001:
                all_triangles.append(pts[:3])
            else:
                all_triangles.append(pts[:3])
                all_triangles.append([pts[0], pts[2], pts[3]])

        elif etype == 'POLYLINE' and entity.is_poly_face_mesh:
            vertex_list = list(entity.vertices)
            coords = {}
            for i, v in enumerate(vertex_list):
                loc = getattr(v.dxf, 'location', None)
                if loc is not None:
                    coords[i] = (loc.x, loc.y, loc.z)
            for v in vertex_list:
                if getattr(v.dxf, 'vtx0', None) is None:
                    continue
                face_pts = []
                for attr in ('vtx0', 'vtx1', 'vtx2', 'vtx3'):
                    idx = getattr(v.dxf, attr, None)
                    if idx is not None and idx != 0:
                        actual_idx = abs(idx) - 1
                        if actual_idx in coords:
                            face_pts.append(coords[actual_idx])
                if len(face_pts) == 3:
                    all_triangles.append(face_pts)
                elif len(face_pts) >= 4:
                    all_triangles.append(face_pts[:3])
                    all_triangles.append([face_pts[0], face_pts[2], face_pts[3]])

    if not all_triangles:
        raise RuntimeError("No valid 3D geometry found!")

    n = len(all_triangles)
    vertices = np.empty((n * 3, 3), dtype=np.float64)
    faces = np.empty((n, 3), dtype=np.int32)

    for i, tri in enumerate(all_triangles):
        base = i * 3
        vertices[base] = tri[0]
        vertices[base + 1] = tri[1]
        vertices[base + 2] = tri[2]
        faces[i] = (base, base + 1, base + 2)

    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    mesh.export(str(stl_path))

    size_mb = stl_path.stat().st_size / (1024 * 1024)
    print(f"  -> {stl_path.name} ({size_mb:.1f} MB, {n:,} faces)")
    return stl_path


def cad_to_stl(cad_path, stl_path=None, cache_dir=None):
    """Convert DWG/DXF file to STL. Caches intermediate DXF for DWG files."""
    cad_path = Path(cad_path)
    if not cad_path.exists():
        raise FileNotFoundError(f"CAD file not found: {cad_path}")

    if stl_path is None:
        stl_path = cad_path.with_suffix('.stl')
    else:
        stl_path = Path(stl_path)

    # If DWG, convert to DXF first (cached)
    if cad_path.suffix.lower() == '.dwg':
        dxf_path = dwg_to_dxf(cad_path, cache_dir)
    else:
        dxf_path = cad_path

    return dxf_to_stl(dxf_path, stl_path)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        input_file = sys.argv[1]
        output_file = sys.argv[2] if len(sys.argv) > 2 else None
    else:
        print("Usage: python dwg_to_stl.py <input.dwg|dxf> [output.stl]")
        sys.exit(1)

    try:
        cad_to_stl(input_file, output_file)
    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
