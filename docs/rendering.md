# Rendering and options

Detailed behaviour of the playback clock, the options panel, GPU asteroid rendering
and the benchmark. The README keeps the short version; this document records the
current rendering and options contract.

## Options

Open `[+] options` in the top-left corner. Renderer and resolution come first,
then playback speed and real time, then planet labels, orbit lines and
minor-planet groups. A line separates those groups. Click outside or press Escape to close it. Speed 0 pauses;
negative values reverse. Speed 1 advances 60 days per second (default 1.5).

**Real time** is off by default and remembered in this browser (`orrery.realTime`),
not in the address bar. While it is on, the date runs forward only until the
current UTC time, then stays on that time and orbits move at their real rate.
Pause freezes it. Play resumes it. A jump into the past, or reverse speed, leaves
real time until forward playback reaches the current time again. Turning it on
while the date is already today, or later, moves to the current instant, shows
`(real time)`, and plays forward. An earlier day only arms that stop and leaves
pause as it is. Opening the page is not that gesture: a shared `?date=` still
opens paused on that day, even today's, and a future day opens paused at the
current instant. While the wall clock drives the date, the speed row dims and
its hint reads one second per second; 0 still pauses and a negative speed still
rewinds. **Today** follows the option. With real time off, it jumps
to the current instant and pauses, like any other date. With real time on, the
button reads `today (real time)`, the jump keeps playback running, and the
dialog says a chosen date stays paused while Today keeps playing. The date
readout shows `(real time)` in the same green while that mode is active.

Minor-planet groups name numbered objects already in this catalogue, sun
outward: All, Near Earth, Hungarias, Main belt, Inner belt, Middle belt, Outer
belt, Hildas, Jupiter Trojans, Distant, or Without the belt. The menu decides
which objects are drawn: everything, one group alone, or everything but the
belt. The belt zones are cut by semi-major axis at the Kirkwood gaps (2.5 and
2.82 AU) and the belt edge (3.28 AU); Cybeles and Mars-crossers join the
nearest zone. Hildas are 3.7–4.2 AU; Hungarias are inside 2 AU with 16–34°
inclination and eccentricity at most 0.18. Without the belt hides the three
zones and keeps Hungarias and Hildas. Group colors, on by default and not
remembered, never changes that set; it paints it. Near Earth is teal, Hungarias
orange, the belt one rose hue from light inner to dark outer, Hildas blue,
Jupiter Trojans gold, Distant violet. Every new arrival is pure green and then
settles to its group color, or to gray. The trial constant `PAINT_BELT_ON_ALL`
in `population.js` decides whether All paints the belt zones (true) or leaves
the belt gray and paints the zones only on the belt presets (false). Neither choice changes the discovery prefix or
downloads extra data. Reload returns to All.
One-line help sits under the control; **What is this?** opens a short glossary,
as does the **minor-planet groups** shortcut in the introduction card. The
bottom-left count is what the group menu shows at the committed date, colored
or gray, not a live MPC census. While groups are colored, swatches beside that
count name the hues. Cuts are by
orbit shape in this app, not official MPC `Orbit_type`. Choosing a group frames it,
easing the current camera in or out: All, Hildas, Jupiter Trojans and Without
the belt frame Jupiter’s orbit, Near Earth and Hungarias frame the inner system
out to 2.5 AU, the belt and its zones frame 3.5 AU, and Distant frames
Neptune’s distance. A view that already fits is left alone.
Wheel or drag cancels the motion.
Switching renderers restores each mode’s last view and does not repeat that
courtesy.

Planetary orbit lines are shown by default. Hiding them leaves the planets and
their motion unchanged. The choice lasts for the page visit and applies to both
renderers; a reload shows the lines again. Planet-label choices are remembered
in local storage and apply to both renderers; unavailable or invalid storage falls
back to the Earth-only label default.

The app uses 12px UI text, with date and space-grouped discovery count at the
bottom-left (`2005-05-03 / 353 381`), Orrery at the bottom-right and FPS at the
top-right. The footer Orrery button opens the introduction card, which also appears once on a
first visit; playback holds while it is open and the chosen speed is kept. Dismissal
is remembered in `localStorage` under `orrery.intro`. Initial loading occupies the date/count position; later buffering
or recovery feedback appears above the last committed readout.

The address bar is the shareable renderer and date. Choosing 2D or 3D in Options (or
the introduction) updates `renderer` in place; Three.js is omitted. Jumping to a UTC day
or pausing writes `date=YYYY-MM-DD`; the 1980 beginning is omitted so `/` stays
clean. A shared date is the initial inspection JED and does not change the story
beginning. Playing does not rewrite the date every frame. Neither value is stored in
`localStorage`. Camera, orbit lines, groups and DPR stay page-session only.

Every load starts at 2× DPR when the display’s native ratio is at least 2, and
at 1× otherwise, with the options panel closed. On displays with
native DPR of at least 2, choose 1× or 2×: 2× is sharper but requires more graphics
processing. The choice lasts for the current page only. Reload returns to that
supported default. Moving to a lower-DPR
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
Three keeps the 200-day colour fade and uses the same 3× size pulse on that
presentation clock. Reverse playback hides future discoveries; replaying them flashes them again.
Date jumps reveal the newly included records immediately. Hidden/context
downtime is excluded, and individual elapsed intervals are capped at 250 ms.

Paused scenes render on demand and show `0 FPS`. Initial/async catalogue loading,
date changes, wheel zoom, a Trojan view-fit animation, resize/DPR changes and graphics/visibility recovery
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
# Same finite-frame probes through the current controller and adapter:
COUNTS=100000 REPEATS=3 npm run benchmark:next
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
identifies the executed `application` (`unified` for current builds; older external fixtures may identify
`legacy` or `unknown`), independently of the runner environment; `BUNDLE=/path/to/app npm run benchmark` uses that build record only while
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
