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


def extract_edges(stl_path, edge_path, angle_threshold=10):
    """Extract sharp edges from an STL and save as flat binary float32 pairs.

    Deduplicates the mesh (STL files often have duplicate faces), then finds
    edges where adjacent face normals diverge beyond the angle threshold.
    """
    mesh = trimesh.load(str(stl_path))
    mesh.merge_vertices()

    threshold_dot = np.cos(np.radians(angle_threshold))
    verts = mesh.vertices
    faces = mesh.faces

    # Compute face normals from vertices and remove degenerate faces
    v0 = verts[faces[:, 0]]
    v1 = verts[faces[:, 1]]
    v2 = verts[faces[:, 2]]
    normals = np.cross(v1 - v0, v2 - v0)
    lengths = np.linalg.norm(normals, axis=1)
    valid = lengths > 1e-10
    faces = faces[valid]
    normals = normals[valid] / lengths[valid, None]

    # Directed edge matching on shared-vertex mesh.
    edge_data = {}   # directed (a, b) → face_index
    sharp = []

    for fi, face in enumerate(faces):
        for j in range(3):
            a, b = int(face[j]), int(face[(j + 1) % 3])
            rev = (b, a)

            if rev in edge_data:
                fi2 = edge_data.pop(rev)
                dot = np.dot(normals[fi], normals[fi2])
                if dot <= threshold_dot:
                    sharp.append((a, b))
            else:
                edge_data[(a, b)] = fi

    # Unmatched edges are boundary edges — always include
    for (a, b) in edge_data:
        sharp.append((a, b))

    if not sharp:
        print(f"  -> No sharp edges found, skipping {edge_path.name}")
        return

    # Build flat array: [x1,y1,z1, x2,y2,z2, ...]
    verts = mesh.vertices
    segments = np.empty((len(sharp), 6), dtype=np.float32)
    for i, (a, b) in enumerate(sharp):
        segments[i, :3] = verts[a]
        segments[i, 3:] = verts[b]

    segments.tofile(str(edge_path))
    size_kb = edge_path.stat().st_size / 1024
    print(f"  -> {edge_path.name} ({size_kb:.0f} KB, {len(sharp):,} edges)")


def _orient_outward(mesh):
    """Orient face normals outward (away from each connected component's interior).

    Source DXF entities have unreliable winding: 3DFACE faces are individually
    inconsistent, and POLYLINE poly-face-mesh is consistent but inward. Both
    are handled by: merge by position, propagate a consistent winding through
    each component, then flip components whose topmost face points down (roofs
    must be up). Components without a clear up/down face (purely vertical) are
    left as fix_winding put them.
    """
    mesh.merge_vertices()
    trimesh.repair.fix_winding(mesh)
    cc = trimesh.graph.connected_components(mesh.face_adjacency, min_len=1)
    flips = np.zeros(len(mesh.faces), dtype=bool)
    for face_idx in cc:
        if len(face_idx) == 0:
            continue
        fn = mesh.face_normals[face_idx]
        if np.abs(fn[:, 2]).max() < 0.3:
            continue
        tc = mesh.triangles_center[face_idx]
        score = tc[:, 2] + 5.0 * np.abs(fn[:, 2])
        best = face_idx[int(score.argmax())]
        if mesh.face_normals[best][2] < 0:
            flips[face_idx] = True
    if flips.any():
        new_faces = mesh.faces.copy()
        new_faces[flips] = new_faces[flips][:, ::-1]
        mesh.faces = new_faces


def dxf_to_stl(dxf_path, stl_path):
    """Convert DXF file to STL."""
    dxf_path = Path(dxf_path)
    stl_path = Path(stl_path)

    doc = ezdxf.readfile(str(dxf_path))
    msp = doc.modelspace()

    # 3DFACE and POLYFACE_MESH both encode a triangle as a 4-corner face
    # where the 4th vertex equals the 3rd (per the AutoCAD spec). We detect
    # that at the source instead of producing a degenerate triangle and
    # filtering it out later.
    all_triangles = []
    for entity in recursive_decompose(msp):
        etype = entity.dxftype()

        if etype == '3DFACE':
            v0 = (entity.dxf.vtx0.x, entity.dxf.vtx0.y, entity.dxf.vtx0.z)
            v1 = (entity.dxf.vtx1.x, entity.dxf.vtx1.y, entity.dxf.vtx1.z)
            v2 = (entity.dxf.vtx2.x, entity.dxf.vtx2.y, entity.dxf.vtx2.z)
            v3 = (entity.dxf.vtx3.x, entity.dxf.vtx3.y, entity.dxf.vtx3.z)
            all_triangles.append([v0, v1, v2])
            if v3 != v2:  # genuine quad
                all_triangles.append([v0, v2, v3])

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
                # Collect indices, dropping zeros (unused) and any that
                # repeat (triangle encoded as quad).
                indices = []
                for attr in ('vtx0', 'vtx1', 'vtx2', 'vtx3'):
                    idx = getattr(v.dxf, attr, None)
                    if idx is None or idx == 0:
                        continue
                    actual = abs(idx) - 1
                    if actual in indices or actual not in coords:
                        continue
                    indices.append(actual)
                if len(indices) == 3:
                    all_triangles.append([coords[i] for i in indices])
                elif len(indices) >= 4:
                    p = [coords[i] for i in indices]
                    all_triangles.append([p[0], p[1], p[2]])
                    all_triangles.append([p[0], p[2], p[3]])

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
    _orient_outward(mesh)
    # Backstop: drop any near-zero-area triangles that survived dedup.
    mesh.update_faces(mesh.nondegenerate_faces(height=1e-9))
    mesh.remove_unreferenced_vertices()
    mesh.export(str(stl_path))

    size_mb = stl_path.stat().st_size / (1024 * 1024)
    print(f"  -> {stl_path.name} ({size_mb:.1f} MB, {len(mesh.faces):,} faces, {n - len(mesh.faces):,} dropped)")

    # Extract precomputed edges
    if stl_path.name.startswith('Geb_'):
        edge_path = stl_path.with_name(
            stl_path.name.replace('Geb_', 'Edg_').replace('.stl', '.bin')
        )
        extract_edges(stl_path, edge_path)
    elif stl_path.name.startswith('Trn_'):
        edge_path = stl_path.with_name(
            stl_path.name.replace('Trn_', 'TrnEdg_').replace('.stl', '.bin')
        )
        extract_edges(stl_path, edge_path, angle_threshold=3)

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
