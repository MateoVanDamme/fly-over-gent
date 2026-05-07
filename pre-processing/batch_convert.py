#!/usr/bin/env python3
"""
Batch convert DWG files to STL format.

Two-phase pipeline:
  1. DWG -> DXF (via ODA File Converter, cached in data/dxf_cache)
  2. DXF -> STL (parallel, via ezdxf + trimesh)

Usage:
    python batch_convert.py <directory> --output <output_dir>
    python batch_convert.py <directory> --skip-existing
    python batch_convert.py <directory> --workers 4
"""

import os
import sys
import glob
import argparse
import time
from pathlib import Path
from multiprocessing import Pool, cpu_count
from typing import List, Tuple, Optional

from dwg_to_stl import dwg_to_dxf, dxf_to_stl, DXF_CACHE_DIR


def find_cad_files(directory: str, pattern: str = "*.dwg", recursive: bool = True) -> List[str]:
    search_pattern = os.path.join(directory, "**", pattern) if recursive else os.path.join(directory, pattern)
    files = glob.glob(search_pattern, recursive=recursive)
    return [os.path.abspath(f) for f in files]


def get_output_filename(cad_file: str) -> str:
    name = os.path.basename(cad_file)
    return os.path.splitext(name)[0] + '.stl'


def convert_dxf_to_stl(args: Tuple[str, str]) -> Tuple[str, bool, str]:
    """Worker function: convert a single DXF to STL. Returns (filename, success, error)."""
    dxf_file, stl_file = args
    try:
        dxf_to_stl(dxf_file, stl_file)
        return (os.path.basename(stl_file), True, "")
    except Exception as e:
        return (os.path.basename(dxf_file), False, str(e))


def batch_convert(directory, pattern='*.dwg', skip_existing=False,
                  workers=None, verbose=False, output_dir=None, dxf_cache=None):
    """Run the DWG -> DXF -> STL pipeline over every matching DWG in `directory`.

    Returns (successful_count, failed_list). `failed_list` is [(name, error), ...].
    """
    if not os.path.isdir(directory):
        raise FileNotFoundError(f"Directory not found: {directory}")

    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    cache_dir = Path(dxf_cache) if dxf_cache else DXF_CACHE_DIR

    dwg_files = find_cad_files(directory, pattern)
    print(f"Found {len(dwg_files)} DWG files")
    if not dwg_files:
        return 0, []

    if skip_existing:
        original_count = len(dwg_files)
        filtered = []
        for f in dwg_files:
            stl_name = get_output_filename(f)
            stl_path = os.path.join(output_dir, stl_name) if output_dir else os.path.join(os.path.dirname(f), stl_name)
            if not os.path.exists(stl_path):
                filtered.append(f)
        skipped = original_count - len(filtered)
        if skipped > 0:
            print(f"Skipping {skipped} files with existing STL outputs")
        dwg_files = filtered

    if not dwg_files:
        print("All files already converted!")
        return 0, []

    # Phase 1: DWG -> DXF (sequential, cached)
    print(f"\n--- Phase 1: DWG -> DXF ({len(dwg_files)} files) ---")
    dxf_files = []
    start_time = time.time()
    for i, dwg_file in enumerate(dwg_files, 1):
        name = os.path.basename(dwg_file)
        dxf_path = cache_dir / Path(dwg_file).with_suffix('.dxf').name
        cached = dxf_path.exists()
        try:
            dxf = dwg_to_dxf(dwg_file, cache_dir)
            status = "CACHED" if cached else "OK"
            dxf_files.append((dwg_file, str(dxf)))
        except Exception:
            status = "FAIL"
            dxf_files.append((dwg_file, None))
        print(f"[{i}/{len(dwg_files)}] {status} {name}")
    phase1_time = time.time() - start_time
    valid = [(dwg, dxf) for dwg, dxf in dxf_files if dxf is not None]
    print(f"Phase 1 done: {len(valid)}/{len(dwg_files)} converted in {phase1_time:.1f}s")

    # Phase 2: DXF -> STL (parallel)
    workers = workers or max(1, cpu_count() - 1)
    print(f"\n--- Phase 2: DXF -> STL ({len(valid)} files, {workers} workers) ---")
    stl_args = []
    for dwg_file, dxf_file in valid:
        stl_name = get_output_filename(dwg_file)
        stl_path = os.path.join(output_dir, stl_name) if output_dir else os.path.join(os.path.dirname(dwg_file), stl_name)
        stl_args.append((dxf_file, stl_path))

    start_time = time.time()
    successful = 0
    failed = []
    with Pool(processes=workers) as pool:
        for i, (name, ok, error) in enumerate(pool.imap_unordered(convert_dxf_to_stl, stl_args), 1):
            if ok:
                successful += 1
                print(f"[{i}/{len(stl_args)}] OK {name}")
            else:
                failed.append((name, error))
                print(f"[{i}/{len(stl_args)}] FAIL {name}: {error}")
    phase2_time = time.time() - start_time

    print(f"\n{'='*60}")
    print(f"DONE: {successful} OK, {len(failed)} failed")
    print(f"Phase 1 (DWG->DXF): {phase1_time:.1f}s")
    print(f"Phase 2 (DXF->STL): {phase2_time:.1f}s")
    print(f"{'='*60}")
    if failed:
        print("\nFailed files:")
        for name, error in failed:
            print(f"  {name}: {error}")
    return successful, failed


def main():
    parser = argparse.ArgumentParser(
        description="Batch convert DWG files to STL (two-phase: DWG->DXF cached, DXF->STL parallel)",
    )
    parser.add_argument('directory', help='Directory containing DWG files')
    parser.add_argument('--pattern', default='*.dwg', help='File pattern (default: *.dwg)')
    parser.add_argument('--skip-existing', action='store_true', help='Skip files that already have STL outputs')
    parser.add_argument('--workers', type=int, default=None, help='Parallel workers for DXF->STL (default: CPU count - 1)')
    parser.add_argument('--output', default=None, help='Output directory for STL files')
    parser.add_argument('--dxf-cache', default=None, help=f'DXF cache directory (default: {DXF_CACHE_DIR})')
    args = parser.parse_args()

    _, failed = batch_convert(
        directory=args.directory,
        pattern=args.pattern,
        skip_existing=args.skip_existing,
        workers=args.workers,
        output_dir=args.output,
        dxf_cache=args.dxf_cache,
    )
    sys.exit(0 if not failed else 1)


if __name__ == '__main__':
    main()
