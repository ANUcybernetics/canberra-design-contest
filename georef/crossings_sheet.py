"""Contact sheet of every detected grid crossing on a plan, at full resolution.

Each tile is centred on the detected crossing (blue tick marks), so a tile
whose ruled lines do not meet at the centre shows a bad detection.

Usage: uv run python crossings_sheet.py <plan> [tile_px]
"""

import csv
import sys
from pathlib import Path

from PIL import Image, ImageDraw

from paths import PLAN_GCP_DIR
from plans import BEND_PX, DEBUG, PLANS, SRC

Image.MAX_IMAGE_PIXELS = None


def sheet(name: str, tile: int = 90) -> None:
    img = Image.open(SRC / PLANS[name]["file"]).convert("RGB")
    rows = list(csv.DictReader(Path(PLAN_GCP_DIR / f"{name}_grid.csv").read_text().splitlines()))
    n = 9
    out = Image.new("RGB", (n * (tile * 2 + 4), n * (tile * 2 + 4)), "white")
    for r in rows:
        x, y = float(r["px"]), float(r["py"])
        i = [20000 - 2500 * k for k in range(9)].index(int(r["ft_west"]))
        j = int(r["ft_south"]) // 2500
        crop = img.crop((int(x) - tile, int(y) - tile, int(x) + tile, int(y) + tile))
        d = ImageDraw.Draw(crop)
        cx, cy = x - int(x) + tile, y - int(y) + tile
        for a, b in (
            ((cx - 14, cy), (cx - 5, cy)),
            ((cx + 5, cy), (cx + 14, cy)),
            ((cx, cy - 14), (cx, cy - 5)),
            ((cx, cy + 5), (cx, cy + 14)),
        ):
            d.line([a, b], fill=(0, 120, 255), width=2)
        if float(r["bend_px"]) > BEND_PX:
            d.rectangle([0, 0, crop.width - 1, crop.height - 1], outline=(255, 0, 0), width=2)
        out.paste(crop, (i * (tile * 2 + 4), j * (tile * 2 + 4)))
    DEBUG.mkdir(parents=True, exist_ok=True)
    out.save(DEBUG / f"{name}_crossings.jpg", quality=88)


if __name__ == "__main__":
    sheet(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 90)
