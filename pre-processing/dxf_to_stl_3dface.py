"""
Convert DXF to STL - Extract 3DFACE entities directly
Works around FreeCAD's complaints about "malformed" 3DFACE entities
"""

import sys
from pathlib import Path
import numpy as np

try:
    import ezdxf
    import trimesh
except ImportError:
    print("ERROR: Required libraries not installed. Run:")
    print("  pip install ezdxf trimesh")
    sys.exit(1)


def dxf_to_stl_3dface(dxf_path, stl_path=None):
    """
    Convert DXF file to STL by extracting 3DFACE entities
    Ignores malformed faces and only uses valid ones
    """
    dxf_path = Path(dxf_path)

    if not dxf_path.exists():
        raise FileNotFoundError(f"DXF file not found: {dxf_path}")

    if stl_path is None:
        stl_path = dxf_path.with_suffix('.stl')
    else:
        stl_path = Path(stl_path)

    print(f"Input:  {dxf_path}")
    print(f"Output: {stl_path}")
    print("\n" + "="*60)
    print("Reading DXF file...")
    print("="*60)

    # Read the DXF file with error recovery
    try:
        doc = ezdxf.readfile(str(dxf_path))
    except Exception as e:
        print(f"Normal read failed: {e}")
        print("Trying recovery mode...")
        doc = ezdxf.readfile(str(dxf_path), errors='ignore')

    msp = doc.modelspace()

    print(f"[OK] Loaded DXF version: {doc.dxfversion}")
    print(f"[OK] Modelspace entities: {len(msp)}")

    # Count entity types
    entity_counts = {}
    for entity in msp:
        etype = entity.dxftype()
        entity_counts[etype] = entity_counts.get(etype, 0) + 1

    print("\nEntity types found:")
    for etype, count in sorted(entity_counts.items(), key=lambda x: -x[1])[:10]:
        print(f"  {etype}: {count:,}")

    # Collect all vertices and faces from 3DFACE and POLYLINE entities
    all_vertices = []
    all_faces = []
    vertex_offset = 0

    valid_3dface = 0
    invalid_3dface = 0
    valid_polyline = 0
    invalid_polyline = 0

    print("\n" + "="*60)
    print("Extracting 3D geometry...")
    print("="*60)

    # First check for direct 3DFACE in modelspace
    print("Checking modelspace for direct 3DFACE entities...")
    direct_3dface_count = entity_counts.get('3DFACE', 0)
    print(f"  Found {direct_3dface_count} direct 3DFACE entities")

    # Also check inside blocks (INSERT entities)
    insert_count = entity_counts.get('INSERT', 0)
    print(f"  Found {insert_count} INSERT (block) entities")
    print("  Will check inside blocks for 3DFACE entities...")

    # Process direct 3DFACE entities in modelspace
    for entity in msp.query('3DFACE'):
        try:
            # Extract the 4 vertices of the 3D face
            vertices = []

            for attr in ['vtx0', 'vtx1', 'vtx2', 'vtx3']:
                if hasattr(entity.dxf, attr):
                    pt = getattr(entity.dxf, attr)
                    if pt is not None:
                        vertices.append([pt.x, pt.y, pt.z])

            # Need at least 3 vertices for a valid face
            if len(vertices) >= 3:
                # Check if vertices are unique (not degenerate)
                unique_verts = []
                for v in vertices:
                    is_duplicate = False
                    for uv in unique_verts:
                        if abs(v[0] - uv[0]) < 0.001 and abs(v[1] - uv[1]) < 0.001 and abs(v[2] - uv[2]) < 0.001:
                            is_duplicate = True
                            break
                    if not is_duplicate:
                        unique_verts.append(v)

                if len(unique_verts) >= 3:
                    # Add vertices to global list
                    start_idx = len(all_vertices)
                    all_vertices.extend(unique_verts)

                    # Create triangles
                    if len(unique_verts) == 3:
                        all_faces.append([start_idx, start_idx+1, start_idx+2])
                    else:  # 4 unique vertices - split into 2 triangles
                        all_faces.append([start_idx, start_idx+1, start_idx+2])
                        all_faces.append([start_idx, start_idx+2, start_idx+3])

                    valid_3dface += 1
                else:
                    invalid_3dface += 1
            else:
                invalid_3dface += 1

        except Exception as e:
            invalid_3dface += 1
            if invalid_3dface <= 5:
                print(f"  Warning: Skipped malformed 3DFACE: {e}")

        # Progress indicator
        if (valid_3dface + invalid_3dface) % 10000 == 0:
            print(f"  Processed {valid_3dface + invalid_3dface:,} faces ({valid_3dface:,} valid, {invalid_3dface:,} invalid)...")

    # Now check inside INSERT entities (block references)
    if insert_count > 0:
        print(f"\nChecking inside {insert_count} block references...")
        blocks_processed = 0

        for entity in msp.query('INSERT'):
            block_name = entity.dxf.name
            block = doc.blocks.get(block_name)

            if block is None:
                continue

            blocks_processed += 1

            # Get the transformation matrix for this block instance
            # This applies position, rotation, and scale
            insert_matrix = entity.matrix44()

            # Process 3DFACE entities within the block
            for block_entity in block.query('3DFACE'):
                try:
                    # Extract the 4 vertices of the 3D face
                    vertices = []

                    for attr in ['vtx0', 'vtx1', 'vtx2', 'vtx3']:
                        if hasattr(block_entity.dxf, attr):
                            pt = getattr(block_entity.dxf, attr)
                            if pt is not None:
                                # Apply block transformation to get world coordinates
                                transformed = insert_matrix.transform(pt)
                                vertices.append([transformed.x, transformed.y, transformed.z])

                    # Need at least 3 vertices for a valid face
                    if len(vertices) >= 3:
                        # Check if vertices are unique (not degenerate)
                        unique_verts = []
                        for v in vertices:
                            is_duplicate = False
                            for uv in unique_verts:
                                if abs(v[0] - uv[0]) < 0.001 and abs(v[1] - uv[1]) < 0.001 and abs(v[2] - uv[2]) < 0.001:
                                    is_duplicate = True
                                    break
                            if not is_duplicate:
                                unique_verts.append(v)

                        if len(unique_verts) >= 3:
                            # Add vertices to global list
                            start_idx = len(all_vertices)
                            all_vertices.extend(unique_verts)

                            # Create triangles
                            if len(unique_verts) == 3:
                                all_faces.append([start_idx, start_idx+1, start_idx+2])
                            else:  # 4 unique vertices - split into 2 triangles
                                all_faces.append([start_idx, start_idx+1, start_idx+2])
                                all_faces.append([start_idx, start_idx+2, start_idx+3])

                            valid_3dface += 1
                        else:
                            invalid_3dface += 1
                    else:
                        invalid_3dface += 1

                except Exception as e:
                    invalid_3dface += 1

            # Progress indicator
            if blocks_processed % 100 == 0:
                print(f"  Processed {blocks_processed} blocks... ({valid_3dface:,} faces found)")

        print(f"  Processed all {blocks_processed} blocks")

    # Now check for POLYLINE entities (polyface meshes) - common in terrain files
    polyline_count = entity_counts.get('POLYLINE', 0)
    if polyline_count > 0:
        print(f"\nChecking {polyline_count} POLYLINE entities...")

        for entity in msp.query('POLYLINE'):
            if entity.is_poly_face_mesh:
                try:
                    valid_polyline += 1

                    # Process the polyface mesh
                    vertices = []
                    vertex_map = {}
                    vertex_list = list(entity.vertices)

                    # Collect vertex coordinates
                    for i, vertex in enumerate(vertex_list):
                        if hasattr(vertex.dxf, 'location'):
                            loc = vertex.dxf.location
                            vertex_idx = len(vertices)
                            vertices.append([loc.x, loc.y, loc.z])
                            vertex_map[i] = vertex_idx

                    # Extract faces
                    for vertex in vertex_list:
                        if hasattr(vertex.dxf, 'vtx0'):
                            face_indices = []

                            for attr in ['vtx0', 'vtx1', 'vtx2', 'vtx3']:
                                if hasattr(vertex.dxf, attr):
                                    idx = getattr(vertex.dxf, attr)
                                    if idx is not None and idx != 0:
                                        actual_idx = abs(idx) - 1
                                        if actual_idx in vertex_map:
                                            face_indices.append(vertex_map[actual_idx] + vertex_offset)

                            if len(face_indices) >= 3:
                                if len(face_indices) == 3:
                                    all_faces.append(face_indices)
                                elif len(face_indices) == 4:
                                    all_faces.append([face_indices[0], face_indices[1], face_indices[2]])
                                    all_faces.append([face_indices[0], face_indices[2], face_indices[3]])

                    all_vertices.extend(vertices)
                    vertex_offset += len(vertices)

                except Exception as e:
                    invalid_polyline += 1
                    if invalid_polyline <= 5:
                        print(f"  Warning: Skipped malformed POLYLINE: {e}")

            # Progress indicator
            if (valid_polyline + invalid_polyline) % 50 == 0:
                print(f"  Processed {valid_polyline + invalid_polyline} polylines... ({valid_polyline} valid)")

        print(f"  Found {valid_polyline} valid polyface meshes")

    print(f"\n[OK] Valid 3DFACE entities: {valid_3dface:,}")
    print(f"[OK] Invalid/skipped 3DFACE entities: {invalid_3dface:,}")
    print(f"[OK] Valid POLYLINE entities: {valid_polyline:,}")
    print(f"[OK] Invalid/skipped POLYLINE entities: {invalid_polyline:,}")
    print(f"[OK] Extracted {len(all_vertices):,} vertices")
    print(f"[OK] Extracted {len(all_faces):,} faces")

    if len(all_vertices) == 0 or len(all_faces) == 0:
        raise RuntimeError(
            "No valid 3D geometry found!\n"
            "All 3DFACE entities were malformed or degenerate."
        )

    # Create trimesh object
    print("\n" + "="*60)
    print("Creating STL mesh...")
    print("="*60)

    vertices_array = np.array(all_vertices)
    faces_array = np.array(all_faces)

    # Debug: Check vertex bounds
    print(f"\nVertex bounds:")
    print(f"  X: {vertices_array[:, 0].min():.2f} to {vertices_array[:, 0].max():.2f}")
    print(f"  Y: {vertices_array[:, 1].min():.2f} to {vertices_array[:, 1].max():.2f}")
    print(f"  Z: {vertices_array[:, 2].min():.2f} to {vertices_array[:, 2].max():.2f}")

    mesh = trimesh.Trimesh(vertices=vertices_array, faces=faces_array)

    print(f"\n[OK] Created mesh:")
    print(f"  Vertices: {len(mesh.vertices):,}")
    print(f"  Faces: {len(mesh.faces):,}")
    print(f"  Watertight: {mesh.is_watertight}")

    # Export to STL
    print(f"\nExporting to STL: {stl_path.name}")
    mesh.export(str(stl_path))

    # Verify
    if stl_path.exists():
        size_mb = stl_path.stat().st_size / (1024 * 1024)
        print(f"\n{'='*60}")
        print("[OK] SUCCESS!")
        print(f"  File: {stl_path}")
        print(f"  Size: {size_mb:.2f} MB")
        print(f"{'='*60}")
        return stl_path
    else:
        raise RuntimeError("STL file was not created")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        input_file = sys.argv[1]
        output_file = sys.argv[2] if len(sys.argv) > 2 else None
    else:
        print("Usage: python dxf_to_stl_3dface.py <input.dxf> [output.stl]")
        sys.exit(1)

    try:
        result = dxf_to_stl_3dface(input_file, output_file)
        print(f"\n[OK] Conversion complete!")
        print(f"Output: {result}")
    except Exception as e:
        print(f"\n[ERROR] Conversion failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
