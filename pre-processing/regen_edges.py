"""Regenerate edge .bin files for one tile.

Usage:
  python regen_edges.py 104 192            # defaults
  python regen_edges.py 104 192 --angle 5  # custom terrain threshold
"""
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from dwg_to_stl import extract_edges

STL_DIR = Path(__file__).parent.parent / 'data' / 'stl'

parser = argparse.ArgumentParser()
parser.add_argument('x', type=int, help='tile X in thousands (e.g. 104)')
parser.add_argument('y', type=int, help='tile Y in thousands (e.g. 192)')
parser.add_argument('--angle', type=float, default=3, help='terrain angle threshold (default 3)')
args = parser.parse_args()

coord = f'{args.x * 1000}_{args.y * 1000}'

geb = STL_DIR / f'Geb_{coord}_10_2_N_2013.stl'
trn = STL_DIR / f'Trn_{coord}_10_0_N_2013.stl'

if geb.exists():
    extract_edges(geb, geb.with_name(geb.name.replace('Geb_', 'Edg_').replace('.stl', '.bin')))
else:
    print(f'No building STL: {geb.name}')

if trn.exists():
    extract_edges(trn, trn.with_name(trn.name.replace('Trn_', 'TrnEdg_').replace('.stl', '.bin')),
                  angle_threshold=args.angle)
else:
    print(f'No terrain STL: {trn.name}')
