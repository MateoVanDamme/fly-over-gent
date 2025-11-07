"""
Inspect DWG file to see what entity types it contains
"""

import sys
from pathlib import Path

try:
    import ezdxf
    from ezdxf.addons import odafc
except ImportError:
    print("ERROR: ezdxf not installed. Run: pip install ezdxf")
    sys.exit(1)


def inspect_dwg(dwg_path):
    """
    Inspect a DWG file and report what entity types it contains
    """
    dwg_path = Path(dwg_path)

    if not dwg_path.exists():
        print(f"File not found: {dwg_path}")
        return

    print(f"Inspecting: {dwg_path.name}")
    print("="*60)

    try:
        # Check if it's DWG or DXF
        if dwg_path.suffix.lower() == '.dwg':
            print("\nDWG file detected. Need to convert to DXF first.")
            print("\nOption 1: Use AutoCAD to convert DWG → DXF")
            print("Option 2: Use ODA File Converter (free)")
            print("  Download: https://www.opendesign.com/guestfiles/oda_file_converter")
            print("\nFor now, let's use AutoCAD to convert it...")

            # Try to convert using AutoCAD
            try:
                import win32com.client
                import pythoncom

                pythoncom.CoInitialize()

                print("\nConnecting to AutoCAD...")
                acad = win32com.client.Dispatch("AutoCAD.Application")
                print(f"Connected to {acad.Name}")

                # Open DWG
                print(f"Opening {dwg_path.name}...")
                doc_acad = acad.Documents.Open(str(dwg_path))

                import time
                time.sleep(3)

                # Save as DXF
                dxf_path = dwg_path.with_suffix('.dxf')
                print(f"Converting to DXF: {dxf_path.name}...")

                # Use SaveAs to export to DXF
                doc_acad.SaveAs(str(dxf_path), 12)  # 12 = acR12_dxf format

                print("✓ Converted to DXF")

                # Close without saving
                doc_acad.Close(False)

                pythoncom.CoUninitialize()

                # Now read the DXF
                print(f"\nReading DXF file...")
                doc = ezdxf.readfile(str(dxf_path))

            except Exception as e:
                print(f"\n✗ AutoCAD conversion failed: {e}")
                print("\nPlease manually convert the DWG to DXF and run:")
                print(f"  python inspect_dwg.py {dwg_path.with_suffix('.dxf').name}")
                return
        else:
            # Try to read the DXF file
            print("\nAttempting to read DXF with ezdxf...")
            doc = ezdxf.readfile(str(dwg_path))

        print(f"✓ Successfully opened!")
        print(f"DXF Version: {doc.dxfversion}")
        print(f"Number of layouts: {len(doc.layouts)}")

        # Analyze modelspace
        msp = doc.modelspace()
        print(f"\nModelspace entities: {len(msp)}")

        # Count entity types
        entity_types = {}
        for entity in msp:
            entity_type = entity.dxftype()
            entity_types[entity_type] = entity_types.get(entity_type, 0) + 1

        print("\nEntity types found:")
        print("-" * 60)
        for etype, count in sorted(entity_types.items(), key=lambda x: -x[1]):
            print(f"  {etype:20s} : {count:6d}")

        # Look for 3D entities
        print("\n" + "="*60)
        print("3D Entity Analysis:")
        print("="*60)

        has_3d = False

        # Check for blocks
        if 'INSERT' in entity_types:
            print(f"\n✓ Found {entity_types['INSERT']} INSERT (block references)")
            print("  Blocks found:")
            block_refs = {}
            for entity in msp.query('INSERT'):
                block_name = entity.dxf.name
                block_refs[block_name] = block_refs.get(block_name, 0) + 1

            for block_name, count in sorted(block_refs.items(), key=lambda x: -x[1])[:20]:
                print(f"    {block_name:30s} : {count} instances")
            has_3d = True

        # Check for 3D solids
        if '3DSOLID' in entity_types:
            print(f"\n✓ Found {entity_types['3DSOLID']} 3DSOLID entities")
            has_3d = True

        # Check for meshes
        if 'MESH' in entity_types:
            print(f"\n✓ Found {entity_types['MESH']} MESH entities")
            has_3d = True

        # Check for polyface meshes
        if 'POLYLINE' in entity_types:
            polyface_count = 0
            for entity in msp.query('POLYLINE'):
                if entity.is_poly_face_mesh:
                    polyface_count += 1
            if polyface_count > 0:
                print(f"\n✓ Found {polyface_count} POLYFACE MESH entities")
                has_3d = True

        # Check for 3DFACE
        if '3DFACE' in entity_types:
            print(f"\n✓ Found {entity_types['3DFACE']} 3DFACE entities")
            has_3d = True

        if not has_3d:
            print("\n⚠ No obvious 3D entities found")
            print("This might be a 2D drawing or use custom ACA objects")

        # Check blocks
        print("\n" + "="*60)
        print("Block Definitions:")
        print("="*60)

        for block in list(doc.blocks)[:10]:  # First 10 blocks
            if not block.name.startswith('*'):  # Skip anonymous blocks
                print(f"\nBlock: {block.name}")
                print(f"  Entities: {len(block)}")

                # Count entity types in block
                block_entities = {}
                for entity in block:
                    etype = entity.dxftype()
                    block_entities[etype] = block_entities.get(etype, 0) + 1

                for etype, count in list(block_entities.items())[:5]:
                    print(f"    {etype}: {count}")

        print("\n" + "="*60)
        print("Summary:")
        print("="*60)

        if has_3d:
            print("✓ This file contains 3D geometry")
            print("✓ ezdxf can read the file")
            print("\nNext steps:")
            print("  - We can extract the 3D geometry using ezdxf")
            print("  - Convert to meshes and export to STL")
        else:
            print("⚠ No clear 3D geometry detected")
            print("  - May need AutoCAD to export")

    except ezdxf.DXFStructureError as e:
        print(f"✗ Cannot read DWG structure: {e}")
        print("\nThis DWG file may need to be converted to DXF first.")
        print("Try using ODA File Converter or AutoCAD to convert to DXF.")

    except Exception as e:
        print(f"✗ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        dwg_file = sys.argv[1]
    else:
        dwg_file = "Geb_104000_193000_10_2_N_2013.dwg"

    inspect_dwg(dwg_file)
