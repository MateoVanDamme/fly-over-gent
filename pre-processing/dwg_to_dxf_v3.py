"""
Convert DWG to DXF using AutoCAD SAVEAS command
"""

import sys
import time
from pathlib import Path

try:
    from pyautocad import Autocad
    import pythoncom
except ImportError:
    print("ERROR: pyautocad not installed. Run: pip install pyautocad")
    sys.exit(1)


def dwg_to_dxf(dwg_path, dxf_path=None):
    """Convert DWG to DXF using SAVEAS command"""

    dwg_path = Path(dwg_path).resolve()

    if not dwg_path.exists():
        raise FileNotFoundError(f"DWG file not found: {dwg_path}")

    if dxf_path is None:
        dxf_path = dwg_path.with_suffix('.dxf')
    else:
        dxf_path = Path(dxf_path).resolve()

    print(f"Input:  {dwg_path}")
    print(f"Output: {dxf_path}")

    pythoncom.CoInitialize()

    try:
        print("\nConnecting to AutoCAD...")
        acad = Autocad(create_if_not_exists=True)
        acad.app.Visible = True

        print(f"Connected to {acad.app.Name} {acad.app.Version}")

        print(f"\nOpening {dwg_path.name}...")
        doc = acad.app.Documents.Open(str(dwg_path))

        print("Waiting for document to load...")
        time.sleep(3)

        # Verify loaded
        for i in range(10):
            try:
                name = doc.Name
                print(f"Document opened: {name}")
                break
            except:
                if i < 9:
                    time.sleep(2)
                else:
                    raise Exception("Failed to load document")

        # Make active
        acad.app.ActiveDocument = doc
        time.sleep(1)

        print(f"\nExporting to DXF...")
        print("Using DXFOUT command...")

        # Use DXFOUT command to export to DXF
        doc.SendCommand('_DXFOUT ')
        time.sleep(1)
        doc.SendCommand(f'"{str(dxf_path)}" ')
        time.sleep(2)
        doc.SendCommand('16 ')  # 16 = AutoCAD 2013 DXF format
        time.sleep(1)

        print("Waiting for export to complete...")
        time.sleep(8)  # Give it more time to complete

        # Close without saving
        print("\nClosing document...")
        doc.Close(False)
        time.sleep(2)

        # Check multiple times since file system might be slow
        for i in range(5):
            if dxf_path.exists():
                size_mb = dxf_path.stat().st_size / (1024 * 1024)
                print(f"\n{'='*60}")
                print("✓ SUCCESS!")
                print(f"  File: {dxf_path}")
                print(f"  Size: {size_mb:.2f} MB")
                print(f"{'='*60}")
                return dxf_path
            time.sleep(1)

        # If still not found, check parent directory in case it saved there
        alt_path = dwg_path.parent / f"ACAD-{dwg_path.stem}.dxf"
        if alt_path.exists():
            size_mb = alt_path.stat().st_size / (1024 * 1024)
            print(f"\n{'='*60}")
            print("✓ SUCCESS!")
            print(f"  File created at: {alt_path}")
            print(f"  Size: {size_mb:.2f} MB")
            print(f"{'='*60}")
            return alt_path

        print(f"\n⚠ Could not verify DXF file at: {dxf_path}")
        print("Please check if the file was created.")
        return None

    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        pythoncom.CoUninitialize()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        input_file = sys.argv[1]
        output_file = sys.argv[2] if len(sys.argv) > 2 else None
    else:
        input_file = "Geb_104000_193000_10_2_N_2013.dwg"
        output_file = None

    try:
        result = dwg_to_dxf(input_file, output_file)
        if result:
            print(f"\n✓ Conversion complete!")
            print(f"\nNext: Inspect the DXF file:")
            print(f"  python inspect_dwg.py {result.name}")
        else:
            print("\nPlease manually export to DXF from AutoCAD")
    except Exception as e:
        print(f"\n✗ Conversion failed: {e}")
        sys.exit(1)
