#!/usr/bin/env python3
"""
Convert all DWG tiles to STL using project defaults.

Usage:
    python run_all.py                    # Convert all
    python run_all.py --download         # Download data first
    python run_all.py --skip-existing    # Resume incomplete run
    python run_all.py --pattern "*Trn_*" # Only terrain
"""

import argparse
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
INPUT_DIR = PROJECT_ROOT / "data" / "input"
OUTPUT_DIR = PROJECT_ROOT / "data" / "stl"


def main():
    parser = argparse.ArgumentParser(description="Convert all DWG tiles to STL")
    parser.add_argument('--download', action='store_true', help='Download data first')
    parser.add_argument('--skip-existing', action='store_true', help='Skip already converted files')
    parser.add_argument('--pattern', default='*.dwg', help='File pattern (default: *.dwg)')
    parser.add_argument('--workers', type=int, default=None, help='Parallel workers')
    parser.add_argument('--verbose', action='store_true', help='Detailed output')
    args = parser.parse_args()

    if args.download:
        print("Downloading data...")
        ret = os.system(f'python "{SCRIPT_DIR / "download_gent_data.py"}"')
        if ret != 0:
            sys.exit(1)
        print()

    if not INPUT_DIR.is_dir():
        print(f"Input directory not found: {INPUT_DIR}")
        print("Run with --download to fetch data first.")
        sys.exit(1)

    from batch_convert import batch_convert

    successful, failed = batch_convert(
        str(INPUT_DIR),
        pattern=args.pattern,
        skip_existing=args.skip_existing,
        workers=args.workers,
        verbose=args.verbose,
        output_dir=str(OUTPUT_DIR),
    )

    sys.exit(0 if not failed else 1)


if __name__ == '__main__':
    main()
