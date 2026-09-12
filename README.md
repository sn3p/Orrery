# Orrery

**Also check out [Orrery3D](https://github.com/sn3p/Orrery3D) ✨**

[Visualization](https://sn3p.github.io/Orrery) showing the orbits of [minor planets](https://en.wikipedia.org/wiki/Minor_planet) and their discovery over time.

Two datasets are used to extract the orbital elements and discovery circumstances of minor planets. The data used is maintained by [The Minor Planet Center (MPC)](https://minorplanetcenter.net/):

- [The MPC Orbit (MPCORB) Database](https://minorplanetcenter.net/iau/MPCORB.html) Database containing orbital elements of minor planets.
- [NumberedMPs.txt](https://minorplanetcenter.net/iau/lists/NumberedMPs.txt) Discovery circumstances of numbered minor planets.

## How to use

Use Node.js 24.15.0 or later in the 24.x release line (recommended),
22.22.3 or later in the 22.x release line, or 26.0.0 or later.

Install dependencies:

```bash
npm install
```

Start server:

```bash
npm run serve
```

Build and bundle:

```bash
npm run build
```

Watch changes and rebuild:

```bash
npm run watch
```

Run numerical, production browser and benchmark checks with Google Chrome installed:

```bash
npm test
```

These checks cover GPU orbit accuracy, discovery markers, playback, catalogue
replacement, context recovery, font loading and desktop/mobile layout. Results
and screenshots are saved in `.context/gpu-orbits/` and `.context/font-qa/`.
To include Firefox and Playwright WebKit, install their browsers with
`npx playwright install firefox webkit`, then run `BROWSERS=chromium,firefox,webkit npm test`.
Playwright WebKit does not substitute for testing actual Safari or iOS.

The UI uses self-hosted [JetBrains Mono Variable](src/fonts/README.md),
distributed with its SIL Open Font License.

Deploy to gh-pages:

```bash
npm run deploy
```

### Conductor

Setup installs the locked dependencies with `npm ci`. When asdf is installed,
it adds the Node.js plugin if needed and installs the version pinned in `.tool-versions`.
Run starts the development server on the workspace's assigned port; use Open
to view the app. Each workspace can run its own server concurrently.

Test the setup script with Python 3.11 or later:

```bash
python3 -m unittest discover -s tests -v
```

## GPU asteroid rendering

Asteroids use one Pixi WebGL instanced mesh. Static orbital bases and elements
feed a bounded Kepler solver in the vertex shader; ordinary frames change time
uniforms rather than calculating and uploading every asteroid's position.
Planets keep their CPU orbit calculation. The circle texture, projection,
parent pan/zoom transforms, blending and discovery colours remain the same.

Speed 1 is 60 days/second; the default 1.5 is 90 days/second, independent of frame
rate. Pausing freezes motion and marker animation. Green discoveries shrink
from 3× to 1× over two-thirds of an active playback second, then turn grey.
Reverse playback hides future discoveries; replaying them flashes them again.
Date jumps reveal the newly included records immediately. Hidden/context
downtime is excluded, and individual elapsed intervals are capped at 250 ms.

The shader uses relative dates and refreshes phases from double-precision
references after 256 simulation days. Discovery timestamps update only when
records are revealed, with an occasional animation-clock refresh after 4096
active seconds. WebGL1 uses the same GPU path with instancing support, but
uploads the full timestamp buffer on discovery because Pixi's partial upload
API uses WebGL2. There is no CPU asteroid renderer setting or fallback.

Catalogue replacement validates finite, float32-representable elliptic orbits
and discovery dates before replacing valid data. Positive `n` is required when
supplied; absent/null `n` can use a positive period `P`. Failed loads retain the
current catalogue. Context recovery recreates the generated particle texture
as well as restoring GPU resources.

Run the production-class benchmark with Chrome:

```bash
npm run benchmark
# Shorter run with only the bundled population:
COUNTS=100000 REPEATS=3 npm run benchmark
```

The benchmark uses a fixed date trajectory, 1280×800 at DPR 1, three repetitions,
3 seconds of warmup and 5 seconds of sampling. It reports frame distributions,
CPU update/render submission, upload bytes, fetch/parse/setup, CPU phase-refresh
time and available JS heap measurements. Runs interrupted by focus, visibility,
context or resolution changes are rejected. Only a report with `complete: true`
is a completed matrix. The million-record case repeats the bundled records and
overlaps their positions; it does not represent a larger unique catalogue.
JS heap is not total process/GPU memory, and submission timing is not GPU time.

Measured on 12 September 2026 with Chrome 151, an M3 Max (30 GPU cores, 36 GB),
battery/automatic power mode, and matching conditions above (median of 3 runs):

| Population | Previous CPU renderer | GPU renderer | Frame time p95, before → after |
|---|---:|---:|---:|
| 100,000 bundled objects | 36.8 FPS | 120.8 FPS | 33.4 → 9.2 ms |
| 1,000,000 repeated records | 3.79 FPS | 120.0 FPS | 275.1 → 9.2 ms |

The comparison used CPU source `56a3806` and GPU source `cb29d4a`. Browser pacing
limits the GPU results around 120 FPS. Catalogue setup took 64.9 → 29.9 ms at
100k, excluding fetch/parse and initial GPU upload. CPU phase refresh measured
0.6 ms at 100k and 11.8 ms at 1m; these are occasional O(N) operations.
The full catalogue's shader error stayed below 0.14 pixels at 20× zoom across
seven tested dates, including ±50,000 days. Extreme zoom/dates, other GPUs,
actual Safari/iOS and larger unique catalogues remain unverified. The bundled
catalogue is unchanged; these measurements do not establish a new data limit.

## Get updated data

Data files are stored in the `data` directory.
You can either download the data files manually using the links above, or use the download script:

Download the data and parse it to JSON:

```bash
cd data
./download_data.sh && ./data_to_json.py
```

The bundled `data/catalog.json` contains **100,000 objects**. Running the importer without a limit replaces it with all numbered minor planets that have matching discovery dates.

On **12 September 2026**, a full import of fresh MPC data produced **895,910 objects** from **1,563,495 orbital records**. Unnumbered objects lack matching discovery records in `NumberedMPs.txt` and are excluded. These counts change as MPC updates its datasets; see [issue #47](https://github.com/sn3p/Orrery/issues/47) for the verified counts and upstream limitation.

A full export produces a large JSON file and is expensive to render. You can limit the maximum number of results by passing a number as an argument:

```bash
./data_to_json.py 9999
```

The limit selects the first matching objects in MPCORB order, then sorts them by discovery date. It does not sample across the full discovery timeline.

## Screenshot

![Orrery screenshot](screenshot.png)
