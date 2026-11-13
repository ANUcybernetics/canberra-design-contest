CANBERRA VISIONS
================

A walkable 3D sketch of the 1911-12 Federal Capital design competition. Several
competition entries are to be placed on one shared base landscape, the Limestone
Plains as the competitors were given them on the 1911 contour survey, so they
can be walked around and compared from the same spot.

Status (November 2026)
----------------------
Two visions run today:
  - bare    The 1911 site: the Molonglo at its natural width, the hills and bush.
  - gimson  Ernest Gimson's entry (illustrated by Alfred Powell): a lake, street
            rings round Camp Hill, and placeholder landmarks.
Three more entries have been scanned from the NLA but are not yet in the app:
the Australian entry (no. 10), the French entry (Agache, no. 4) and the Gummer
entry (no. 35). PLAN.md sets out how to bring them onto the base map.

The base landscape is still a toy. Its hills were placed by eye from Gimson's
small plan and are 0.35-4.3 km from the real summits. Fixing that is step 1 of
PLAN.md.

Run it
------
  ./start-city.sh                  serves prototype/ at http://127.0.0.1:8125
  PORT=9000 ./start-city.sh
  HOST=0.0.0.0 ./start-city.sh     reachable from a tablet on the LAN

There is no build step. PlayCanvas loads from jsDelivr. Pick a vision with the
Vision menu or ?vision=bare|gimson. Controls and URL options are listed in
prototype/README.md.

Layout
------
  README.txt                 This file.
  PLAN.md                    Steps to bring the other competition maps onto the
                             shared base map.
  start-city.sh              Serves the prototype with Python's http.server.

  prototype/                 The app (static HTML + ES modules, PlayCanvas).
    index.html               Page, HUD panels, settings, minimap canvas.
    README.md                Controls, file-by-file guide, render budget, known
                             roughness. Read this before editing code.
    assets/gimson_plan.jpg   Gimson's plan (Cusack's reproduction), used as the
                             minimap and as the source for his layout.
    src/main.js              Loads the chosen vision, builds the scene, runs walk
                             and fly controls, HUD and minimap. No vision code.
    src/base/                Shared by every vision:
      site.js                  THE BASE MAP AS DATA: world frame, hills, the
                               1911 Molonglo centreline, named places.
      terrain.js               Height field from site.js plus the vision's
                               landform (water carving, level pads, tint).
      waterways.js             Water models a vision can use (riverChannel).
      water.js                 Lake shader and reflections (one plane at y=0).
      bush.js, vegetation.js   Natural 1911 bush; instanced trees, rocks, props.
      kit.js                   Building and tree geometry kit.
      occupancy.js             4 m grid of what is built or paved.
      relief.js                Shaded-relief minimap for visions without a scan.
      noise.js, texgen.js      Perlin noise and generated textures.
      daylight.js, audio.js,   Time of day, synthesised sound, tablet controls.
      touch.js
    src/visions/
      index.js                 Registry of visions; add one line per vision.
      bare/index.js            The bare 1911 site.
      gimson/                  index.js (descriptor), layout.js (his design as
                               data), landform.js (lake, pads, lawns), city.js
                               (builds streets, blocks, houses, landmarks).

  reference/                 Source images, not loaded by the app.
    gimson/                    Powell's watercolours and the plan (via Cusack).
    australian/                NLA scan of entry 10 (Griffiths, Coulter and
                               Caswell). In copyright until end of 2026.
    french/                    NLA scan of entry 4 (Agache). Out of copyright.
    gummer/                    NLA scan of entry 35 (Schaufelberg, Rees and
                               Gummer). Out of copyright.
    Each NLA folder has a SOURCE.md: catalogue record, URL, pixel size, rights
    statement and a description of the sheet.

  docs/
    visions-plan.md          The original plan for six Canberras on one base:
                             what each scan shows, the technical blockers, and
                             the open decisions. Background for PLAN.md.
    competition-image-guide.md
                             Where images of the competition entries are held
                             (NAA, NLA, NFSA, Bridgeman and others).

  LetterfromSurveyor/        L. A. Curtis's 1912 paper "The Federal Capital
                             Designs" (The Surveyor, 31 Aug 1912), transcribed in
                             letter.md from the twelve page photographs. It
                             argues for entry 10 on grading, drainage and cost.

How a vision plugs in
---------------------
A vision is a module whose default export is
  { id, title, blurb, landform, build(), deckHeight?, isWooded?,
    landmarks, views, defaultView, plan }
The landform is { water, flatten, tint }: a water model that carves the shared
ground, level pads for big buildings, and a ground tint. Everything else (hills,
river line, bush, sky, controls, kit) comes from the base.

Coordinates: metres, x east, z south, y up, origin on the summit of Kurrajong
Hill (now Capital Hill). Water level is y = 0.
