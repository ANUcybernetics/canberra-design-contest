"""Shared definitions for the four sheets of the 1910 contour survey.

The survey grid is a plane grid in feet with its origin at Trigonometrical
Station AINSLIE and its axes on the trigonometrical meridian (see the NOTES
panel on Sheet 2).  Eastings are counted in feet WEST of Ainslie, northings in
feet SOUTH of Ainslie.  Meridians and parallels are drawn every 2,500 ft.

Sheet layout (each sheet covers 10,000 x 10,000 ft of grid):

    +---------+---------+
    | Sheet 1 | Sheet 2 |   0 .. 10,000 ft S
    +---------+---------+
    | Sheet 3 | Sheet 4 |   10,000 .. 20,000 ft S
    +---------+---------+
     20k..10k   10k..0  ft W
"""

from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = HERE / "work"
SHEET_DIR = WORK / "sheets"
GCP_DIR = HERE / "gcps"

# NLA object nla.obj-232175445 is a five-image set; image 2 duplicates image 1.
SHEETS = {
    1: {"file": "sheet1.jpg", "nla_image": 1, "xs": [20000, 17500, 15000, 12500, 10000], "ys": [0, 2500, 5000, 7500, 10000]},
    2: {"file": "sheet2.jpg", "nla_image": 3, "xs": [10000, 7500, 5000, 2500, 0], "ys": [0, 2500, 5000, 7500, 10000]},
    3: {"file": "sheet3.jpg", "nla_image": 4, "xs": [20000, 17500, 15000, 12500, 10000], "ys": [10000, 12500, 15000, 17500, 20000]},
    4: {"file": "sheet4.jpg", "nla_image": 5, "xs": [10000, 7500, 5000, 2500, 0], "ys": [10000, 12500, 15000, 17500, 20000]},
}

GRID_STEP_FT = 2500
