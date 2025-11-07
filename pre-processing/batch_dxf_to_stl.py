#!/usr/bin/env python3
"""
Batch convert DXF files to STL format using multiprocessing.

Usage:
    python batch_dxf_to_stl.py <directory>
    python batch_dxf_to_stl.py <directory> --pattern "*Trn_*"
    python batch_dxf_to_stl.py <directory> --skip-existing
    python batch_dxf_to_stl.py <directory> --workers 4
"""

import os
import sys
import glob
import argparse
import time
from pathlib import Path
from multiprocessing import Pool, cpu_count
from typing import List, Tuple, Optional

# Import the conversion function from the existing script
from dxf_to_stl_3dface import dxf_to_stl_3dface as convert_dxf_to_stl


class ConversionResult:
    """Result of a DXF to STL conversion"""
    def __init__(self, input_file: str, success: bool, output_file: Optional[str] = None, error: Optional[str] = None):
        self.input_file = input_file
        self.success = success
        self.output_file = output_file
        self.error = error


def find_dxf_files(directory: str, pattern: str = "*.dxf", recursive: bool = True) -> List[str]:
    """
    Find all DXF files in a directory.

    Args:
        directory: Root directory to search
        pattern: File pattern to match (default: "*.dxf")
        recursive: Search recursively in subdirectories

    Returns:
        List of absolute paths to DXF files
    """
    search_pattern = os.path.join(directory, "**", pattern) if recursive else os.path.join(directory, pattern)
    files = glob.glob(search_pattern, recursive=recursive)
    return [os.path.abspath(f) for f in files]


def should_skip_file(dxf_file: str, output_dir: Optional[str] = None) -> bool:
    """
    Check if STL output already exists for this DXF file.

    Args:
        dxf_file: Path to DXF file
        output_dir: Output directory (if specified)

    Returns:
        True if STL already exists, False otherwise
    """
    if output_dir:
        stl_file = os.path.join(output_dir, os.path.basename(dxf_file).replace('.dxf', '.stl').replace('.DXF', '.stl'))
    else:
        stl_file = dxf_file.replace('.dxf', '.stl').replace('.DXF', '.stl')
    return os.path.exists(stl_file)


def convert_single_file(args: Tuple[str, bool, Optional[str]]) -> ConversionResult:
    """
    Convert a single DXF file to STL.
    Wrapper function for multiprocessing.

    Args:
        args: Tuple of (dxf_file, verbose, output_dir)

    Returns:
        ConversionResult object
    """
    dxf_file, verbose, output_dir = args

    try:
        # Redirect stdout if not verbose
        if not verbose:
            import io
            old_stdout = sys.stdout
            sys.stdout = io.StringIO()

        # Determine output path
        if output_dir:
            output_file = os.path.join(output_dir, os.path.basename(dxf_file).replace('.dxf', '.stl').replace('.DXF', '.stl'))
        else:
            output_file = None

        # Call the conversion function
        output_file = convert_dxf_to_stl(dxf_file, output_file)

        # Restore stdout
        if not verbose:
            sys.stdout = old_stdout

        return ConversionResult(dxf_file, True, output_file)

    except Exception as e:
        # Restore stdout on error
        if not verbose:
            sys.stdout = old_stdout

        return ConversionResult(dxf_file, False, error=str(e))


def batch_convert(
    directory: str,
    pattern: str = "*.dxf",
    skip_existing: bool = False,
    workers: Optional[int] = None,
    verbose: bool = False,
    output_dir: Optional[str] = None
) -> Tuple[List[ConversionResult], List[ConversionResult]]:
    """
    Batch convert DXF files to STL.

    Args:
        directory: Directory containing DXF files
        pattern: File pattern to match
        skip_existing: Skip files that already have STL outputs
        workers: Number of parallel workers (default: CPU count - 1)
        verbose: Show detailed output for each conversion
        output_dir: Output directory for STL files (default: same as DXF)

    Returns:
        Tuple of (successful_results, failed_results)
    """
    # Create output directory if specified
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    # Find all DXF files
    print(f"Searching for DXF files in: {directory}")
    print(f"Pattern: {pattern}")
    dxf_files = find_dxf_files(directory, pattern)
    print(f"Found {len(dxf_files)} DXF files")

    if not dxf_files:
        print("No DXF files found!")
        return [], []

    # Filter out existing files if requested
    if skip_existing:
        original_count = len(dxf_files)
        dxf_files = [f for f in dxf_files if not should_skip_file(f, output_dir)]
        skipped = original_count - len(dxf_files)
        if skipped > 0:
            print(f"Skipping {skipped} files that already have STL outputs")

        if not dxf_files:
            print("All files already converted!")
            return [], []

    print(f"\nConverting {len(dxf_files)} files...")

    # Determine number of workers
    if workers is None:
        workers = max(1, cpu_count() - 1)
    print(f"Using {workers} parallel workers")
    if output_dir:
        print(f"Output directory: {output_dir}")
    print()

    # Prepare arguments for multiprocessing
    args_list = [(f, verbose, output_dir) for f in dxf_files]

    # Process files in parallel
    start_time = time.time()
    results = []

    with Pool(processes=workers) as pool:
        # Process files and show progress
        for i, result in enumerate(pool.imap_unordered(convert_single_file, args_list), 1):
            results.append(result)
            status = "OK" if result.success else "FAIL"
            filename = os.path.basename(result.input_file)
            print(f"[{i}/{len(dxf_files)}] {status} {filename}")

    elapsed = time.time() - start_time

    # Separate successful and failed conversions
    successful = [r for r in results if r.success]
    failed = [r for r in results if not r.success]

    # Print summary
    print("\n" + "="*60)
    print("CONVERSION SUMMARY")
    print("="*60)
    print(f"Total files: {len(dxf_files)}")
    print(f"Successful: {len(successful)}")
    print(f"Failed: {len(failed)}")
    print(f"Time elapsed: {elapsed:.1f}s ({elapsed/len(dxf_files):.1f}s per file)")

    # Print failed files
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
        description="Batch convert DXF files to STL format",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python batch_dxf_to_stl.py /path/to/data
  python batch_dxf_to_stl.py /path/to/data --pattern "*Trn_*"
  python batch_dxf_to_stl.py /path/to/data --skip-existing
  python batch_dxf_to_stl.py /path/to/data --workers 4
        """
    )

    parser.add_argument(
        'directory',
        help='Directory containing DXF files'
    )

    parser.add_argument(
        '--pattern',
        default='*.dxf',
        help='File pattern to match (default: *.dxf)'
    )

    parser.add_argument(
        '--skip-existing',
        action='store_true',
        help='Skip files that already have STL outputs'
    )

    parser.add_argument(
        '--workers',
        type=int,
        default=None,
        help='Number of parallel workers (default: CPU count - 1)'
    )

    parser.add_argument(
        '--verbose',
        action='store_true',
        help='Show detailed output for each conversion'
    )

    parser.add_argument(
        '--output',
        default=None,
        help='Output directory for STL files (default: same directory as DXF files)'
    )

    args = parser.parse_args()

    # Validate directory
    if not os.path.isdir(args.directory):
        print(f"Error: Directory not found: {args.directory}")
        sys.exit(1)

    # Run batch conversion
    successful, failed = batch_convert(
        args.directory,
        pattern=args.pattern,
        skip_existing=args.skip_existing,
        workers=args.workers,
        verbose=args.verbose,
        output_dir=args.output
    )

    # Exit with error code if any conversions failed
    sys.exit(0 if not failed else 1)


if __name__ == '__main__':
    main()
