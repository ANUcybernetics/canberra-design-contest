# The 1912 Canberra design contest

In 1911 the Commonwealth of Australia invited the world to design its new capital city.
This repository gathers the sources for that competition and puts the entries back on the ground they were drawn for.

| Folder | What is in it | In git? |
| --- | --- | --- |
| [`history/`](history/README.md) | The primary sources, transcribed into markdown, and the scans they came from. | Transcriptions yes, scans no |
| [`georef/`](georef/README.md) | The pipeline that georeferences the 1910 contour survey and the plans drawn on it, and traces their streets. | Code and control points yes, scratch no |
| [`data/`](data/README.md) | The GIS outputs of that pipeline, for QGIS. | No |
| [`demos/`](demos/) | Web apps for looking at the outputs; so far, the [georef preview](demos/georef-preview/README.md). | Code yes, builds no |

Progress and next steps are in [PROGRESS.md](PROGRESS.md).
