"""Unpack the four sheet scans from the NLA download into work/sheets/.

The NLA object nla.obj-232175445 downloads as a zip of five JPEGs.  Image 2
is a byte-for-byte duplicate of image 1, so the sheets are images 1, 3, 4, 5.

Usage: uv run python extract_sheets.py [path/to/nla.obj-232175445.zip]
"""

import sys
import zipfile
from pathlib import Path

from sheets import HERE, SHEET_DIR, SHEETS

ZIP_NAME = "nla.obj-232175445.zip"
CANDIDATES = [HERE.parent / "scans" / "1910-contour-survey" / ZIP_NAME, HERE.parent / ZIP_NAME, HERE.parent.parent / ZIP_NAME]


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else next((p for p in CANDIDATES if p.exists()), None)
    if src is None or not src.exists():
        sys.exit(f"Can't find {ZIP_NAME}; download it from https://nla.gov.au/nla.obj-232175445 and pass its path.")
    SHEET_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(src) as z:
        for n, spec in SHEETS.items():
            member = f"nla.obj-232175445-{spec['nla_image']}.jpg"
            (SHEET_DIR / spec["file"]).write_bytes(z.read(member))
            print(f"  sheet {n} <- {member}")


if __name__ == "__main__":
    main()
