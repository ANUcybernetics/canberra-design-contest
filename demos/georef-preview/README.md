# Georef preview

A small Vite and MapLibre site for looking at what [`georef/`](../../georef/README.md) makes: the 1910 contour survey, the 1912 competition plans laid on it, and the streets traced from them.

## Running it

The pages read web copies of the outputs in [`data/`](../../data/README.md), which `georef/make_web.sh` and `georef/mapstyle.py` put in `public/`.
Make them first, then start the server:

```sh
cd georef && ./make_web.sh && uv run python mapstyle.py && cd -
cd demos/georef-preview
pnpm install
pnpm dev
```

It serves on port 5180, on every interface.
To reach it securely across the tailnet, run `tailscale serve --bg --https=5181 http://127.0.0.1:5180`, then open `https://<host>.<tailnet>.ts.net:5181/`.

The COGs in `public/cog/` are links into `data/`, not copies, and nothing in `public/` is committed.

## The pages

### `/` — the survey and the plans

The 1910 survey over OpenStreetMap, with an opacity slider and toggles for the 1910 grid, the sheet outlines and the control stations.
The space bar flicks the old map on and off.

The georeferenced plans sit above the survey and share one opacity slider.
Each design's traced streets have a checkbox of their own, and a click on a street gives its width.

Beneath the survey you can switch on historical aerial photo mosaics from hapmap.app (1926 MAP3584 and 12 March 1945 MAP1537), read straight from hapmap.app's COGs; add more in the `HAPMAP` list in `src/main.js`.
The 1926 mosaic reaches only as far east as about 149.116°E, so it covers just the western quarter of the survey.

### `/streets.html` — the streets over Canberra today

The traced streets over a satellite image of Canberra today (Esri World Imagery), with the plan beneath on a slider and an option to draw each street at its traced width.

### `/styled.html` — No. 10 as a modern street map

Griffiths, Coulter and Caswell's No. 10 drawn in the manner of Google Maps, from the layers `mapstyle.py` makes.
A slider fades the original drawing in over the map, and a checkbox puts today's satellite image beneath the streets.
`?plan=<id>` shows another design's streets in the same style, without water or labels.

## How the rasters are read

`src/cog.js` is the `cog://` protocol from hapmap.app.
It reads a Cloud-Optimised GeoTIFF straight from the file, a block at a time, and decodes it in a worker (`src/decoder.worker.js`).
It draws Web Mercator COGs only, which is why the pipeline writes a separate EPSG:3857 copy of every raster, compressed as WebP with an alpha band.
