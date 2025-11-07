#!/usr/bin/env python3
"""
Download all Gent 3D dataset files from the City of Gent open data portal.

Downloads ZIP files containing DWG files and extracts them into the data/ directory.

Usage:
    python download_gent_data.py
    python download_gent_data.py --output data/
    python download_gent_data.py --limit 10
"""

import os
import sys
import json
import argparse
import time
from pathlib import Path
from typing import List, Dict
import zipfile
import io

try:
    import requests
except ImportError:
    print("ERROR: requests library not installed. Run:")
    print("  pip install requests")
    sys.exit(1)


# API endpoint for the Gent 3D dataset
GENT_3D_API = "https://data.stad.gent/api/explore/v2.1/catalog/datasets/gent-in-3d/exports/json"


def fetch_dataset_index() -> List[Dict]:
    """
    Fetch the complete dataset index from the Gent 3D API.

    Returns:
        List of dictionaries containing 'vaknummer' and 'link_naar_open_data'
    """
    print("Fetching dataset index from Gent 3D API...")
    print(f"API: {GENT_3D_API}\n")

    try:
        response = requests.get(GENT_3D_API, timeout=30)
        response.raise_for_status()
        data = response.json()

        print(f"[OK] Found {len(data)} tiles in the dataset\n")
        return data

    except requests.exceptions.RequestException as e:
        print(f"[ERROR] Failed to fetch dataset index: {e}")
        sys.exit(1)


def download_and_extract_tile(
    tile: Dict,
    output_dir: Path,
    index: int,
    total: int
) -> bool:
    """
    Download and extract a single tile ZIP file.

    Args:
        tile: Dictionary with 'vaknummer' and 'link_naar_open_data'
        output_dir: Base output directory
        index: Current tile index (for progress display)
        total: Total number of tiles

    Returns:
        True if successful, False otherwise
    """
    vaknummer = tile.get('vaknummer', 'unknown')
    url = tile.get('link_naar_open_data')

    if not url:
        print(f"[{index}/{total}] SKIP {vaknummer} - No download URL")
        return False

    # Extract directory name from URL
    # Format: Dwg_103000_190000_10_2_N_2013.zip -> Dwg_103000_190000_10_2_N_2013/
    zip_filename = url.split('/')[-1]
    dir_name = zip_filename.replace('.zip', '')
    tile_dir = output_dir / dir_name

    # Check if already downloaded
    if tile_dir.exists() and any(tile_dir.glob('*.dwg')):
        print(f"[{index}/{total}] SKIP {vaknummer} - Already downloaded")
        return True

    # Create output directory
    tile_dir.mkdir(parents=True, exist_ok=True)

    try:
        # Download ZIP file
        print(f"[{index}/{total}] Downloading {vaknummer}...", end=' ', flush=True)

        response = requests.get(url, timeout=60)
        response.raise_for_status()

        # Extract ZIP file
        with zipfile.ZipFile(io.BytesIO(response.content)) as zip_file:
            zip_file.extractall(tile_dir)

        # Count DWG files
        dwg_files = list(tile_dir.glob('*.dwg'))
        print(f"OK ({len(dwg_files)} DWG files)")

        return True

    except requests.exceptions.RequestException as e:
        print(f"FAIL - Download error: {e}")
        return False

    except zipfile.BadZipFile as e:
        print(f"FAIL - Invalid ZIP file: {e}")
        return False

    except Exception as e:
        print(f"FAIL - {type(e).__name__}: {e}")
        return False


def download_all_tiles(
    output_dir: Path,
    limit: int = None,
    skip_existing: bool = True
) -> tuple:
    """
    Download all tiles from the Gent 3D dataset.

    Args:
        output_dir: Directory to save downloaded files
        limit: Maximum number of tiles to download (None = all)
        skip_existing: Skip tiles that are already downloaded

    Returns:
        Tuple of (successful_count, failed_count)
    """
    # Fetch dataset index
    tiles = fetch_dataset_index()

    # Apply limit if specified
    if limit:
        tiles = tiles[:limit]
        print(f"Limiting download to first {limit} tiles\n")

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"Output directory: {output_dir}\n")

    # Download tiles
    print("="*60)
    print("DOWNLOADING TILES")
    print("="*60)

    start_time = time.time()
    successful = 0
    failed = 0

    for i, tile in enumerate(tiles, 1):
        if download_and_extract_tile(tile, output_dir, i, len(tiles)):
            successful += 1
        else:
            failed += 1

        # Small delay to be nice to the server
        time.sleep(0.5)

    elapsed = time.time() - start_time

    # Print summary
    print("\n" + "="*60)
    print("DOWNLOAD SUMMARY")
    print("="*60)
    print(f"Total tiles: {len(tiles)}")
    print(f"Successful: {successful}")
    print(f"Failed: {failed}")
    print(f"Time elapsed: {elapsed:.1f}s")

    if successful > 0:
        print(f"Average: {elapsed/successful:.1f}s per tile")

    return successful, failed


def main():
    parser = argparse.ArgumentParser(
        description="Download all Gent 3D dataset files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python download_gent_data.py
  python download_gent_data.py --output data/
  python download_gent_data.py --limit 10
  python download_gent_data.py --no-skip-existing
        """
    )

    parser.add_argument(
        '--output',
        default='data',
        help='Output directory for downloaded files (default: data/)'
    )

    parser.add_argument(
        '--limit',
        type=int,
        default=None,
        help='Limit number of tiles to download (for testing)'
    )

    parser.add_argument(
        '--no-skip-existing',
        action='store_true',
        help='Re-download tiles that already exist'
    )

    args = parser.parse_args()

    output_dir = Path(args.output)
    skip_existing = not args.no_skip_existing

    # Download all tiles
    successful, failed = download_all_tiles(
        output_dir,
        limit=args.limit,
        skip_existing=skip_existing
    )

    # Exit with error code if any downloads failed
    sys.exit(0 if failed == 0 else 1)


if __name__ == '__main__':
    main()
