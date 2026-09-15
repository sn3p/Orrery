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

The build includes an unlinked `/next/` Pixi preview while the current app
stays at the root. Run `npm run serve:next` after building to develop the preview
at `/next/` (uses `CONDUCTOR_PORT` when set, otherwise 3000). See the
[approved unification plan](docs/unification.md) for source pins, scope, build
isolation and verification. The preview uses an app-owned clock, HUD/options
and lazy Pixi adapter with the same historical 100k catalogue.

Watch changes and rebuild:

```bash
npm run watch
```

Install the test browsers, then run numerical, production browser and benchmark checks:

```bash
npx playwright install chrome firefox webkit
npm test
```

These checks cover GPU orbit accuracy, discovery markers, playback, catalogue
replacement, context recovery, development hot updates, font loading and
desktop/mobile layout. Playwright Test reports individual cases and lifecycle
steps. Results, screenshots and failure traces are saved in
`.context/playwright-results/`; open the HTML report with
`npx playwright show-report .context/playwright-report`.
The default browser suite also checks the preview against the legacy pixels,
numerics, lifecycle and options; `npm run test:unified` builds the preview and
runs that subset, including from a clean checkout after installing dependencies.
The default suite runs Chromium, Firefox and Playwright WebKit. For a local
Chrome-only pass, use `BROWSERS=chromium npm test`. See
[the browser test workflow](docs/browser-tests.md) for projects, shards and fixture builds.
Playwright WebKit does not substitute for testing actual Safari or iOS.

The UI uses self-hosted [JetBrains Mono Variable](src/fonts/README.md),
distributed with its SIL Open Font License.

### Conductor

Setup installs the locked dependencies with `npm ci`. When asdf is installed,
it adds the Node.js plugin if needed and installs the version pinned in `.tool-versions`.
Run starts the development server on the workspace's assigned port; use Open
to view the app. Each workspace can run its own server concurrently.

Test the setup script with Python 3.11 or later:

```bash
python3 -m unittest discover -s tests -v
```

## Options

Open `[+] options` in the top-right corner for playback speed and rendering
resolution. Click outside or press Escape to close it. Speed 0 pauses; negative
values reverse. Speed 1 advances 60 days per second (default 1.5).

Every load starts at 1× DPR, with the options panel closed. On displays with
native DPR of at least 2, choose 1× or 2×: 2× is sharper but requires more graphics
processing. The choice lasts for the current page only. Moving to a lower-DPR
display hides the selector and uses 1× (or native DPR below 1); moving back restores
the page's selection. Canvas CSS size, view position and dot sizes stay the same.

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

Paused scenes render on demand and show `0 FPS`. Initial/async catalogue loading,
date changes, wheel zoom, resize/DPR changes and graphics/visibility recovery
request a redraw; simultaneous requests share one frame. Orrery owns the RAF
scheduler and keeps Pixi's independent automatic ticker stopped. Tests and
benchmarks use `new Orrery({ autoRender: false })`: setters and recovery never
start scene rendering. Both the app and benchmark use `renderFrame(timestamp)`
for one clock/scene/readout update and draw; this helper never schedules a frame.
Its optional `beforeRender`/`afterRender` hooks bracket drawing alone, preserving
separate update and submission timings. `render(timestamp)` owns scheduling,
and explicit Pixi ticker updates still work. Context recovery still regenerates
the offscreen circle texture in manual mode. Resolution changes regenerate and
rebind that texture before the next scene draw, keeping its logical size. The
circle texture uses integer density (at least 1×) so fractional display ratios
do not alter planet sizes; the canvas still uses the selected effective DPR.
Manual test/benchmark instances can pass an explicit `resolution` independent
of the user option; samples verify requested, native, renderer and buffer ratios. GUI teardown is safe to repeat;
FPS sampling resets on pause and excludes inactive time when playback resumes.

In a Chrome 151 measurement on this Mac, the previous GPU implementation drew
66 paused frames in 502 ms (about 131/second); on-demand rendering produces zero
recurring paused draws or asteroid updates. This is a draw-count observation,
not a measured power saving. Browser regressions count renderer calls and actual
production WebGL submissions, including instanced draws.

The shader uses relative dates and refreshes phases from canonical Float64
references after more than 256 simulation days, including hidden records. A
refresh uploads one Float32 mean anomaly per asteroid (400,000 bytes at 100k),
down from three floats (1,200,000 bytes); eccentricity and mean motion stay in
a separate fixed buffer. The threshold, solver and total typed-array storage
are unchanged. This reduces upload bytes without claiming an FPS gain.

Discovery timestamps update only when
records are revealed, with an occasional animation-clock refresh after 4096
active seconds. WebGL1 uses the same GPU path with instancing support, but
uploads the full timestamp buffer on discovery because Pixi's partial upload
API uses WebGL2. There is no CPU asteroid renderer setting or fallback.

Catalogue replacement validates finite, float32-representable elliptic orbits
and discovery dates before replacing valid data. Positive `n` is required when
supplied; absent/null `n` can use a positive period `P`. Packed motion must advance
at most 1024 radians across the 256-day rebase interval to keep shader arithmetic
bounded. Failed loads retain the current catalogue. Context recovery recreates
the generated particle texture as well as restoring GPU resources.

Run the production-class benchmark with Chrome:

```bash
npm run benchmark
# Shorter run with only the bundled population:
COUNTS=100000 REPEATS=3 npm run benchmark
# Same finite-frame probes through the preview controller and adapter:
COUNTS=100000 REPEATS=3 OUTPUT=.context/pr2/benchmark npm run benchmark:next
```

The benchmark uses a fixed date trajectory, 1280×800 at DPR 1, three repetitions,
3 seconds of warmup and 5 seconds of sampling. It reports frame distributions,
CPU update/render submission, upload bytes, fetch/parse/setup, CPU phase-refresh
time and available JS heap measurements. Runs interrupted by focus, visibility,
context or resolution changes are rejected. Only a report with `complete: true`
is a completed matrix. The million-record case repeats the bundled records and
overlaps their positions; it does not represent a larger unique catalogue.
`COUNTS` (comma-separated) and `REPEATS` must be positive safe integers; invalid
inputs fail before building or launching Chrome and leave an incomplete report.
JS heap is not total process/GPU memory, and submission timing is not GPU time.
Frame errors and interruptions terminate the run, restore measurement hooks and
leave an incomplete error report. Interruption cleanup does not wait for another
animation frame, which a background tab may stop delivering. Reports fingerprint the complete served build, including HTML,
CSS, scripts, fonts and catalogue. Added, removed or changed files invalidate a recorded source;
symbolic links and other non-regular build inputs are rejected. The source stamp
itself is excluded from its own fingerprint. Local builds save a matching
`benchmark-source.json` with the checkout revision and dirty
state, including untracked source changes during compilation. Each report and run
identifies the executed `application` (`legacy`, `unified`, or `unknown` for older
external fixtures), independently of the runner environment; `BUNDLE=/path/to/app npm run benchmark` uses that build record only while
its build fingerprint still matches. Default test/benchmark outputs are Git-ignored
in ordinary clones as well as Conductor workspaces. Missing or stale records
report an unknown source revision, separately from the runner's revision.

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

## Deployment

[GitHub Pages](https://sn3p.github.io/Orrery/) updates automatically after every
push or merged pull request to `master`. The [GitHub Pages workflow](.github/workflows/pages.yml)
installs locked dependencies with the Node.js version in `.tool-versions`, builds
a clean `dist/` from source, and deploys it. Pull requests targeting `master` check
the production build without deploying. A failed build prevents deployment.

Overlapping runs for the same branch retain up to 100 pending runs, processed in
the order they enter GitHub's concurrency queue. New runs beyond that limit are
canceled by GitHub; see the [queue documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#example-queueing-multiple-pending-runs).

No local build, generated-file commit, or push to `gh-pages` is needed to deploy.
The workflow publishes the checked-in catalogue; it does not download fresh MPC
data.

To deploy `master` again, open **Actions → GitHub Pages → Run workflow**, select
`master`, or use the authenticated [GitHub CLI](https://cli.github.com/):

```bash
npm run deploy
```

This command deploys the remote `master` branch, including when run from a local
feature branch; it does not publish uncommitted local changes. Check progress in
the repository's [Actions tab](https://github.com/sn3p/Orrery/actions/workflows/pages.yml).

Repository setup (once, also required for forks): in **Settings → Pages**, set
**Build and deployment → Source** to **GitHub Actions**. In **Settings → Environments
→ github-pages**, allow deployments from the `master` branch. The workflow must be
merged into `master` before automatic or manual deployment is available. It uses
GitHub's built-in token; no personal access token or deploy key is needed.

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
