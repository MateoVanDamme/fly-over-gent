#!/usr/bin/env python3
"""
Batch convert DWG/DXF files to STL format using multiprocessing.

Usage:
    python batch_convert.py <directory> --output <output_dir>
    python batch_convert.py <directory> --pattern "*Trn_*"
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

from dwg_to_stl import cad_to_stl


class ConversionResult:
    def __init__(self, input_file: str, success: bool, output_file: Optional[str] = None, error: Optional[str] = None):
        self.input_file = input_file
        self.success = success
        self.output_file = output_file
        self.error = error


def find_cad_files(directory: str, pattern: str = "*.dwg", recursive: bool = True) -> List[str]:
    search_pattern = os.path.join(directory, "**", pattern) if recursive else os.path.join(directory, pattern)
    files = glob.glob(search_pattern, recursive=recursive)
    return [os.path.abspath(f) for f in files]


def get_output_filename(cad_file: str) -> str:
    name = os.path.basename(cad_file)
    return os.path.splitext(name)[0] + '.stl'


def should_skip_file(cad_file: str, output_dir: Optional[str] = None) -> bool:
    stl_name = get_output_filename(cad_file)
    if output_dir:
        stl_file = os.path.join(output_dir, stl_name)
    else:
        stl_file = os.path.join(os.path.dirname(cad_file), stl_name)
    return os.path.exists(stl_file)


def convert_single_file(args: Tuple[str, bool, Optional[str]]) -> ConversionResult:
    cad_file, verbose, output_dir = args

    try:
        if not verbose:
            import io
            old_stdout = sys.stdout
            sys.stdout = io.StringIO()

        stl_name = get_output_filename(cad_file)
        if output_dir:
            output_file = os.path.join(output_dir, stl_name)
        else:
            output_file = os.path.join(os.path.dirname(cad_file), stl_name)

        output_file = cad_to_stl(cad_file, output_file)

        if not verbose:
            sys.stdout = old_stdout

        return ConversionResult(cad_file, True, output_file)

    except Exception as e:
        if not verbose:
            sys.stdout = old_stdout

        return ConversionResult(cad_file, False, error=str(e))


def batch_convert(
    directory: str,
    pattern: str = "*.dwg",
    skip_existing: bool = False,
    workers: Optional[int] = None,
    verbose: bool = False,
    output_dir: Optional[str] = None
) -> Tuple[List[ConversionResult], List[ConversionResult]]:
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    print(f"Searching for CAD files in: {directory}")
    print(f"Pattern: {pattern}")
    cad_files = find_cad_files(directory, pattern)
    print(f"Found {len(cad_files)} files")

    if not cad_files:
        print("No CAD files found!")
        return [], []

    if skip_existing:
        original_count = len(cad_files)
        cad_files = [f for f in cad_files if not should_skip_file(f, output_dir)]
        skipped = original_count - len(cad_files)
        if skipped > 0:
            print(f"Skipping {skipped} files that already have STL outputs")

        if not cad_files:
            print("All files already converted!")
            return [], []

    print(f"\nConverting {len(cad_files)} files...")

    if workers is None:
        workers = max(1, cpu_count() - 1)
    print(f"Using {workers} parallel workers")
    if output_dir:
        print(f"Output directory: {output_dir}")
    print()

    args_list = [(f, verbose, output_dir) for f in cad_files]

    start_time = time.time()
    results = []

    with Pool(processes=workers) as pool:
        for i, result in enumerate(pool.imap_unordered(convert_single_file, args_list), 1):
            results.append(result)
            status = "OK" if result.success else "FAIL"
            filename = os.path.basename(result.input_file)
            print(f"[{i}/{len(cad_files)}] {status} {filename}")

    elapsed = time.time() - start_time

    successful = [r for r in results if r.success]
    failed = [r for r in results if not r.success]

    print("\n" + "="*60)
    print("CONVERSION SUMMARY")
    print("="*60)
    print(f"Total files: {len(cad_files)}")
    print(f"Successful: {len(successful)}")
    print(f"Failed: {len(failed)}")
    print(f"Time elapsed: {elapsed:.1f}s ({elapsed/len(cad_files):.1f}s per file)")

    if failed:
        print("\n" + "="*60)
        print("FAILED CONVERSIONS")
        print("="*60)
        for result in failed:
            print(f"\n{result.input_file}")
            print(f"  Error: {result.error}")

    return successful, failed


def main():
    parser = argparse.ArgumentParser(
        description="Batch convert DWG/DXF files to STL format",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python batch_convert.py data/input --output data/stl
  python batch_convert.py data/input --pattern "*Trn_*.dwg" --output data/stl
  python batch_convert.py data/input --skip-existing --output data/stl
  python batch_convert.py data/input --workers 4 --output data/stl
        """
    )

    parser.add_argument('directory', help='Directory containing DWG/DXF files')
    parser.add_argument('--pattern', default='*.dwg', help='File pattern to match (default: *.dwg)')
    parser.add_argument('--skip-existing', action='store_true', help='Skip files that already have STL outputs')
    parser.add_argument('--workers', type=int, default=None, help='Number of parallel workers (default: CPU count - 1)')
    parser.add_argument('--verbose', action='store_true', help='Show detailed output for each conversion')
    parser.add_argument('--output', default=None, help='Output directory for STL files (default: same as input)')

    args = parser.parse_args()

    if not os.path.isdir(args.directory):
        print(f"Error: Directory not found: {args.directory}")
        sys.exit(1)

    successful, failed = batch_convert(
        args.directory,
        pattern=args.pattern,
        skip_existing=args.skip_existing,
        workers=args.workers,
        verbose=args.verbose,
        output_dir=args.output,
    )

    sys.exit(0 if not failed else 1)


if __name__ == '__main__':
    main()
