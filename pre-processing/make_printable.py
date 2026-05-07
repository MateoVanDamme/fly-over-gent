"""
Build a printable STL for a Lambert-72 bounding box. Auto-loads every tile
the bbox touches, fuses their terrain at the seams, and combines a watertight
terrain slab with the building shells inside the box. Slicers union the
overlapping volumes at slice time, so we don't bother with a real boolean.

Slab: terrain top surface + extruded vertical side walls + flat bottom face.
Buildings: dropped in as-is; any building whose footprint touches the bbox
edge is excluded entirely so the cropped print has clean rectangular sides.
"""

import argparse
import sys
from pathlib import Path
import numpy as np
import trimesh

sys.path.insert(0, str(Path(__file__).parent))
from dwg_to_stl import _orient_outward

TILE_SIZE = 1000
STL_DIR = Path("data/stl")


def _filter_by_centroid(mesh, x1, y1, x2, y2):
    """Keep faces whose centroid is inside the given Lambert-72 XY box."""
    c = mesh.triangles_center
    mask = (c[:, 0] >= x1) & (c[:, 0] <= x2) & (c[:, 1] >= y1) & (c[:, 1] <= y2)
    mesh.update_faces(mask)
    mesh.remove_unreferenced_vertices()
    return mesh


def _drop_components_touching_edge(mesh, x1, y1, x2, y2):
    """Keep a connected component only if every face is inside the crop box."""
    mesh.merge_vertices()
    c = mesh.triangles_center
    in_box = (c[:, 0] >= x1) & (c[:, 0] <= x2) & (c[:, 1] >= y1) & (c[:, 1] <= y2)
    cc = trimesh.graph.connected_components(
        mesh.face_adjacency, nodes=np.arange(len(mesh.faces)), min_len=1
    )
    keep = np.zeros(len(mesh.faces), dtype=bool)
    for face_idx in cc:
        if in_box[face_idx].all():
            keep[face_idx] = True
    mesh.update_faces(keep)
    mesh.remove_unreferenced_vertices()
    return mesh


def _snap_tile_boundary(mesh, tile_x, tile_y, tol=5.0, row_tol=0.5):
    """Pull only the outermost row of boundary vertices onto each tile edge.

    Adjacent tiles' terrain meshes are inset anywhere from 5 cm to ~4 m from
    the nominal kilometer line (LIDAR sampling artifact); we snap that row
    onto the exact line so the seam fuses across tiles. Tile grid spacing
    can be ~4 m, so a naive distance check would also catch the next row
    in — instead, we identify the single extreme row per edge and snap only
    that.
    """
    edges = mesh.edges_sorted
    ev = edges.view([('a', edges.dtype), ('b', edges.dtype)]).reshape(-1)
    _, idx, counts = np.unique(ev, return_index=True, return_counts=True)
    boundary = edges[idx[counts == 1]]
    bv = np.unique(boundary.flatten())

    v = mesh.vertices.copy()
    for axis, (lo, hi) in [(0, (tile_x, tile_x + TILE_SIZE)),
                            (1, (tile_y, tile_y + TILE_SIZE))]:
        coords = v[bv, axis]
        # Low edge: extreme = min of values within tol of the target line
        candidates = bv[np.abs(coords - lo) < tol]
        if len(candidates):
            edge_val = v[candidates, axis].min()
            sel = candidates[np.abs(v[candidates, axis] - edge_val) < row_tol]
            v[sel, axis] = lo
        # High edge: extreme = max
        candidates = bv[np.abs(coords - hi) < tol]
        if len(candidates):
            edge_val = v[candidates, axis].max()
            sel = candidates[np.abs(v[candidates, axis] - edge_val) < row_tol]
            v[sel, axis] = hi
    mesh.vertices = v


def _average_z_at_shared_xy(mesh):
    """For vertices sharing an XY position (snapped seam pairs), set their Z
    to the group average so merge_vertices can actually fuse them."""
    xy = np.round(mesh.vertices[:, :2] * 100).astype(np.int64)  # 1 cm bins
    keys = xy.view([('x', xy.dtype), ('y', xy.dtype)]).reshape(-1)
    _, inverse, counts = np.unique(keys, return_inverse=True, return_counts=True)
    if (counts > 1).sum() == 0:
        return
    z = mesh.vertices[:, 2]
    sum_z = np.zeros(counts.shape)
    np.add.at(sum_z, inverse, z)
    avg_z = sum_z / counts
    new_verts = mesh.vertices.copy()
    new_verts[:, 2] = avg_z[inverse]
    mesh.vertices = new_verts


def _tiles_for_bbox(x1, y1, x2, y2):
    tx_lo = int(np.floor(x1 / TILE_SIZE)) * TILE_SIZE
    ty_lo = int(np.floor(y1 / TILE_SIZE)) * TILE_SIZE
    tx_hi = int(np.ceil(x2 / TILE_SIZE)) * TILE_SIZE
    ty_hi = int(np.ceil(y2 / TILE_SIZE)) * TILE_SIZE
    return [(tx, ty) for tx in range(tx_lo, tx_hi, TILE_SIZE)
                     for ty in range(ty_lo, ty_hi, TILE_SIZE)]


def _load_concat(prefix, suffix, tiles, snap_terrain=False):
    meshes = []
    missing = []
    for tx, ty in tiles:
        path = STL_DIR / f"{prefix}_{tx}_{ty}{suffix}"
        if not path.exists():
            missing.append(f"{tx}_{ty}")
            continue
        m = trimesh.load(str(path))
        if snap_terrain:
            m.update_faces(m.nondegenerate_faces(height=1e-9))
            m.merge_vertices()
            _snap_tile_boundary(m, tx, ty)
        meshes.append(m)
    if missing:
        print(f"  warning: missing {prefix} for tiles: {', '.join(missing)}")
    if not meshes:
        raise RuntimeError(f"no {prefix} tiles found for bbox")
    return trimesh.util.concatenate(meshes)


def build_slab(terrain, base_height):
    """Turn a (possibly multi-tile, already cropped) terrain mesh into a
    closed watertight slab."""
    base_z = float(terrain.bounds[0][2] - base_height)

    edges = terrain.edges_sorted
    edges_view = edges.view([('a', edges.dtype), ('b', edges.dtype)]).reshape(-1)
    _, idx, counts = np.unique(edges_view, return_index=True, return_counts=True)
    boundary = edges[idx[counts == 1]]

    n = len(terrain.vertices)
    v_bot = terrain.vertices.copy()
    v_bot[:, 2] = base_z
    verts = np.vstack([terrain.vertices, v_bot])

    walls = np.empty((len(boundary) * 2, 3), dtype=np.int64)
    for i, (a, b) in enumerate(boundary):
        walls[2 * i]     = (a, b, b + n)
        walls[2 * i + 1] = (a, b + n, a + n)

    # Walk boundary edges into a single closed loop, then fan-triangulate.
    adj = {}
    for a, b in boundary:
        adj.setdefault(int(a), []).append(int(b))
        adj.setdefault(int(b), []).append(int(a))
    start = int(boundary[0][0])
    loop = [start]
    prev = -1
    curr = start
    while True:
        candidates = [v for v in adj[curr] if v != prev]
        if not candidates:
            raise RuntimeError("boundary is not a single closed loop — "
                               "bbox crosses a tile that's missing or seams "
                               "did not fuse")
        nxt = candidates[0]
        if nxt == start:
            break
        loop.append(nxt)
        prev, curr = curr, nxt
    pivot = loop[0]
    bottom = np.array(
        [(pivot + n, loop[i] + n, loop[i + 1] + n) for i in range(1, len(loop) - 1)],
        dtype=np.int64,
    )

    faces = np.vstack([terrain.faces, walls, bottom])
    slab = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    _orient_outward(slab)
    return slab


def main():
    p = argparse.ArgumentParser(
        description="Build a printable STL for a Lambert-72 bounding box.",
    )
    p.add_argument("x1", type=float, help="Lambert-72 west edge")
    p.add_argument("y1", type=float, help="Lambert-72 south edge")
    p.add_argument("x2", type=float, help="Lambert-72 east edge")
    p.add_argument("y2", type=float, help="Lambert-72 north edge")
    p.add_argument("-o", "--output", default=None,
                   help="output STL path (default: data/print/Print_<x1>-<y1>-<x2>-<y2>.stl)")
    p.add_argument("--base-height", type=float, default=10.0,
                   help="meters of solid material below the lowest terrain point (default 10)")
    args = p.parse_args()

    if args.x1 >= args.x2 or args.y1 >= args.y2:
        print("bbox must be x1<x2 and y1<y2")
        sys.exit(1)
    bbox = (args.x1, args.y1, args.x2, args.y2)

    tiles = _tiles_for_bbox(*bbox)
    print(f"bbox spans {len(tiles)} tile(s): {', '.join(f'{tx}_{ty}' for tx, ty in tiles)}")

    # Terrain: per-tile boundary snap, concat, average Z at shared XY, fuse, crop
    terrain = _load_concat("Trn", "_10_0_N_2013.stl", tiles, snap_terrain=True)
    _average_z_at_shared_xy(terrain)
    terrain.merge_vertices()
    _filter_by_centroid(terrain, *bbox)
    if len(terrain.faces) == 0:
        print("bbox contains no terrain")
        sys.exit(1)
    slab = build_slab(terrain, args.base_height)
    print(f"slab: {len(slab.vertices):,} verts, {len(slab.faces):,} faces, watertight={slab.is_watertight}")

    # Buildings: load tiles, drop any whose component touches the bbox edge
    buildings = _load_concat("Geb", "_10_2_N_2013.stl", tiles)
    _drop_components_touching_edge(buildings, *bbox)
    print(f"buildings: {len(buildings.vertices):,} verts, {len(buildings.faces):,} faces")

    combined = trimesh.util.concatenate([slab, buildings])
    print(f"combined: {len(combined.vertices):,} verts, {len(combined.faces):,} faces")

    if args.output:
        out = Path(args.output)
    else:
        tag = f"{int(args.x1)}-{int(args.y1)}-{int(args.x2)}-{int(args.y2)}"
        out = Path(f"data/print/Print_{tag}.stl")
    out.parent.mkdir(parents=True, exist_ok=True)
    combined.export(str(out))
    size_mb = out.stat().st_size / (1024 * 1024)
    print(f"-> {out} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
