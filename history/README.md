# History

In 1911 the Commonwealth of Australia invited the world to design its new capital city.
This folder holds the primary sources for that competition, transcribed into markdown so they can be read, searched and quoted without opening a scan.

Each transcription begins with a note on how it was made and where it departs from the original.
The originals are always the authority; follow the links below to check a reading.

## The documents

They are listed in the order the competition unfolded: the survey of the site, the call for designs, and the judging.

### 1. Map of Contour Survey of the Site for the Federal Capital of Australia (1910)

The official survey of the city site, issued to every competitor.
Most of the entries were drawn directly on top of it.
It comes in four sheets; we have all four, and have stitched them into one georeferenced image.

- **Transcription:** [1910-contour-survey-map-sheet-1.md](transcriptions/1910-contour-survey-map-sheet-1.md)
- **Original:** National Library of Australia, [nla.obj-232175459](https://nla.gov.au/nla.obj-232175459)
- **Made by:** drawn on stone by O. Fischer and A.G. von Stach under the direction of E.S. Vautin; lithograph no. 10.483 D.
- **Copyright:** out of copyright (published 1910), according to the NLA.
- **All four sheets:** National Library of Australia, [nla.obj-232175445](https://nla.gov.au/nla.obj-232175445).
- **Georeferenced composite:** see [georef/](georef/README.md), which builds a GeoTIFF of all four sheets in GDA2020 / MGA zone 55 for QGIS.
- **Note:** the transcription records the printed words on Sheet 1 and describes the sheet; it does not reproduce the contour heights.

### 2. Information, Conditions and Particulars for Guidance in the Preparation of Competitive Designs for the Federal Capital City of the Commonwealth of Australia (1911)

The booklet that set out the rules of the competition.

- **Transcription:** [1911-information-conditions-and-particulars-cover.md](transcriptions/1911-information-conditions-and-particulars-cover.md)
- **Original:** National Library of Australia, [nla.obj-232173787](https://nla.gov.au/nla.obj-232173787) (the scanned page), part of the work [nla.obj-232173779](https://nla.gov.au/nla.obj-232173779), holding JAFp HIST 74.
- **Collection:** *Competition design of Federal Capital City, Commonwealth of Australia: [information for competitors]*, [nla.obj-232173765](https://nla.gov.au/nla.obj-232173765), which the NLA catalogues as incomplete.
- **Copyright:** out of copyright (published 1911), according to the NLA.
- **Note:** only the cover has been digitised, so the conditions themselves are not yet here.

### 3. Federal Capital City: Report of Board Appointed to Investigate and Report to the Minister for Home Affairs in Regard to Competitive Designs (1912)

The judges' report.
The three-member board split two to one, and the Minister, King O'Malley, sided with the majority, placing Walter Burley Griffin first, Eliel Saarinen second and Alfred Agache third.
The report also names the authors of the six shortlisted designs and of two more that the majority commended.

- **Transcription:** [1912-federal-capital-designs-board-report.md](transcriptions/1912-federal-capital-designs-board-report.md)
- **Original:** Parliament of Australia, ParlInfo tabled paper [HPP022016000107](https://parlinfo.aph.gov.au/parlInfo/download/publications/tabledpapers/HPP022016000107/upload_pdf/HPP022016000107.pdf) (PDF, 22 pages).
- **Citation:** Commonwealth of Australia, Parliamentary Paper No. 17 of 1912 (F.9752); presented by command and ordered to be printed 19 July 1912.
- **Note:** the plates of the competing designs are described by their captions; the maps themselves are in the PDF.

### 4. The significant entries at the National Library (compiled 2026)

Not a transcription but a finding list.
It gathers the NLA catalogue records, image links and catalogue notes for the eight designs named in the Board's report, and for André Bérard's design No. 37.

- **List:** [1912-significant-entries-nla.md](1912-significant-entries-nla.md)

### 5. L. A. Curtis, "The Federal Capital Designs" (1912)

A surveyor's critique of the competition, read to the Institution of Surveyors, N.S.W., on 20 August 1912 and printed in *The Surveyor* of 31 August 1912, with a reply from Charles H. Caswell, co-author of design No. 10.
Curtis comments on 33 designs; the folder lists each one with his words and the NLA's records for it.

- **Finding list:** [curtis/README.md](curtis/README.md)
- **Original:** photographed page by page in `curtis/photos/` (not committed).

## How this folder is laid out

| Folder | What is in it | In git? |
| --- | --- | --- |
| `transcriptions/` | The markdown transcriptions of the three primary sources. | Yes |
| `thumbnails/1912-plans/` | JPEG thumbnails, 1,200 pixels on the long edge, of each plan scan in `scans/1912-plans/`, under the same names. | Yes |
| `curtis/` | The finding list for L. A. Curtis's 1912 critique, with the page photographs in `curtis/photos/`. | List yes, photos no |
| `scans/` | The original scans as downloaded. | No |
| `georef/` | The pipeline that georeferences the 1910 contour survey and the plans drawn on it. | Code yes, outputs no |

## Original scans

The scans live in `scans/`, which git ignores, because they are large and can be fetched again from the links above.

| File | What it is |
| --- | --- |
| `scans/1910-contour-survey/nla.obj-232175445.zip` | NLA download of all four contour map sheets: five JPEGs (the second repeats the first) and the copyright note. |
| `scans/1910-contour-survey/nla.obj-232175459.tif` | Full-resolution TIFF of Sheet 1 (about 240 MB). |
| `scans/1911-conditions/nla.obj-232173787.zip` | NLA download of the conditions booklet cover: a JPEG and the NLA copyright note. |
| `scans/1912-plans/1912-design-NN-*-nla.obj-*.tif` | Full-resolution NLA master TIFFs of the plan drawings for the significant entries (40–310 MB each), plus Ernest Gimson's two views for design No. 15. The design number and designer are in the name; see [1912-significant-entries-nla.md](1912-significant-entries-nla.md) and [curtis/README.md](curtis/README.md) for each record. |
| `scans/1912-plans/1912-design-NN-*-nla.obj-*.jpg` | The two plans with no downloadable master: Griffin's copy A and Saarinen's lantern slide, each at the largest JPEG the NLA serves. |

The plan TIFFs come from `https://nla.gov.au/tarkine/nla.obj-<id>/m`, the link behind the NLA viewer's "TIF (high resolution)" download.

The single-sheet download of Sheet 1, `nla.obj-232175459.zip`, is not kept: its JPEG is byte-for-byte the first image in `nla.obj-232175445.zip`.

The ParlInfo PDF is not kept here; download it from the link above.

## Still to find

- The inside pages of the 1911 conditions booklet. The NLA's microform copy, [nla.obj-3416633692](https://nla.gov.au/nla.obj-3416633692), appears to hold all 12 pages.
