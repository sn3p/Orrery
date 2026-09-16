# Orrery unification — approved blueprint v2

Approved September 14, 2026. This is the repository edition of the agreed
blueprint and start guide, with historical status reconciled and local planning
paths removed. No further architecture approval is required. Each implementation
unit still needs its own tests, review and explicit merge instruction.

## Current unit: root promotion after UI polish

These numbers identify planned review units, not GitHub PR numbers. PR1 shipped
in [PR64](https://github.com/sn3p/Orrery/pull/64), PR2 in
[PR65](https://github.com/sn3p/Orrery/pull/65), and history import H in
[PR67](https://github.com/sn3p/Orrery/pull/67). H's merge `e1e80ec` preserves all
147 original commits; a fresh full master clone passed the ancestry/tree verifier.

PR3 shipped in [PR68](https://github.com/sn3p/Orrery/pull/68), retaining neutral CPU
data, incremental Pixi packing and explicit indexed/whole/latest profiles.
PR4 shipped in [PR70](https://github.com/sn3p/Orrery/pull/70), adding the lazy
`/next/?renderer=three` entry using the same shell and catalogue. PR5 shipped in
[PR71](https://github.com/sn3p/Orrery/pull/71), adding in-page renderer switching,
separate views and the optional renderer control builder.
[PR72](https://github.com/sn3p/Orrery/pull/72) made the complete published discovery
catalogue the default for both engines. [PR73](https://github.com/sn3p/Orrery/pull/73)
polished the shared controls, footer and loading feedback.

This is planned unit 6: serve that unified application at root and retire the
old preview entry. Chronological visibility, startup/date/speed
and both renderer scenes stay unchanged. Shared UI polish gives HUD, labels,
values and help separate colors and lets the footer receive pointer input.
The Pixi adapter also releases shader texture bindings before texture replacement
or disposal, preventing warnings during DPR changes and renderer switching.
Legacy 100k assets remain for
cached-page compatibility, rollback and test/benchmark oracles until cleanup.
Explicit release approval is required before merging this candidate. Planned
unit 7 cleanup follows acceptance of the live promoted release.
See the [catalogue contract](catalog-loading.md) and [Three adapter](three-renderer.md).

`src/unified/App.js` owns Julian day, requested speed, active presentation time,
one scheduler, shared DPR choice, initialization/disposal, catalogue sources
and loading/error feedback. `ui/Hud.js` and `ui/Options.js` bind one existing-style
HUD/options panel. `pixi/PixiRenderer.js` owns scene/projection, GPU allocations,
textures, CPU planets, wheel zoom, resize and context recovery; it consumes
frame state and requests invalidation without fetching or advancing a clock.
`three/ThreeRenderer.js` uses the same boundary for Three scene resources,
3D orbital packing, perspective camera, OrbitControls and graphics restoration.
Pixi's automatic ticker stays stopped and has no app clock callback. Manual
`renderFrame(timestamp, hooks)` shares the same update/draw boundary.

The small `createRenderer` seam defaults to a lazy import. On async initialization
it reads the controller's current viewport again before generating textures.
Disposal during import/init prevents late UI/resources; failed initialization
cleans partial resources. Data generations reject stale/aborted results and
failed replacements keep usable data. Graphics-recovery errors retain their
feedback even if an outstanding data request subsequently succeeds.

Startup remains local `new Date(1980, 1)` with speed 1.5 (90 days/second), the existing
250 ms stall cap and fresh 1× DPR on every load. Suspension does not overwrite
requested speed. Pixi keeps 3× discovery markers shrinking over 2/3 active seconds,
wheel zoom and stage translation through resize. Three keeps the source's
date-based discovery fade and OrbitControls camera gestures.

### Temporary source mapping

The Pixi mappings originate at PR64's merged tree; Three uses the preserved
Orrery3D snapshot. Keep live source stable until the promotion/cleanup units:

| Preview | Legacy source / change |
| --- | --- |
| `App.js`, `ui/Hud.js`, `pixi/PixiRenderer.js` | Responsibilities extracted from `src/js/Orrery.js` |
| `ui/Options.js` | `src/js/Gui.js`, identical behavior with renamed class |
| `pixi/Planet.js`, `Orbit.js`, `Controls.js` | Temporary copies; only helper import paths differ |
| `pixi/Asteroids.js` | Original GPU shader/effects plus neutral catalogue packing, append ranges and draw acknowledgement |
| `three/ThreeRenderer.js` | Graphics/camera responsibilities from preserved Orrery3D `Orrery3D.js`; shared App keeps clock/loader/UI |
| `three/{Asteroids,Planet,Orbit,Sun,createSphere}.js` | Orrery3D `93a3e1f`; source shader/presentation, retained neutral data and frame/draw commitment adaptation |
| Shared imports from `src/js/` | Unchanged `PlaybackClock`, `Stats`, `utils`, `constants`, `planets`, `asteroidOrbits` |
| Shared CSS/fonts | Existing font assets; preview typography, footer, controls and status placement are isolated in `preview.css` |

`asteroidOrbits` keeps the existing legacy Pixi packing and shared shader helpers.
The preview retains full 3D bases and Float64 phase/date data independently from
Pixi's mutable buffers. Its source is Orrery3D PR31 merge
`93a3e1f4a36d8fdceb513bdfdca20beddb3348d6`. The unified app's full-catalogue default
is separately approved for Orrery; it does not change the preserved legacy source or the
source application's ownership.

The promoted app uses the main public URL `https://sn3p.github.io/Orrery/`.
Old preview page URLs return 404; no redirect to the app remains. PR heads are not
deployed; an explicitly approved merge to master releases the assembled site.
The main HTML no longer carries preview branding or a noindex directive.

## Source pins and prerequisite

Source pins rechecked September 15, 2026 against GitHub and local Git objects:

| Input | Pinned revision | Role |
| --- | --- | --- |
| [Orrery PR68 merge](https://github.com/sn3p/Orrery/tree/b7ec81ea4a22f3f30d9e958875a4b3aa9bf5b5e4) | `b7ec81ea4a22f3f30d9e958875a4b3aa9bf5b5e4` | Shared catalogue, Pixi behavior, native tests and historical catalogue |
| [Orrery3D PR31 merge](https://github.com/sn3p/Orrery3D/commit/93a3e1f4a36d8fdceb513bdfdca20beddb3348d6) | `93a3e1f4a36d8fdceb513bdfdca20beddb3348d6` | Adopted loader and Three source reference |
| [orrery-data PR5](https://github.com/sn3p/orrery-data/commit/c01d694d71c1734aa9d600afd7f0c58d81654b66) | `c01d694d71c1734aa9d600afd7f0c58d81654b66` | Consumer/browser contracts and real fixtures |

[PR30](https://github.com/sn3p/Orrery3D/pull/30) merged at
**2026-09-14T10:23:14Z**. Its tree
`b2d6117e02347da5aaa39256abdb83b3a0b41818` equals reviewed head
`b6bf448bf2f1f796b06041c8eb73061e5b8560d4`.
[Merge CI](https://github.com/sn3p/Orrery3D/actions/runs/34832913066) passed build,
Chromium, Firefox, WebKit and Pages deployment. This satisfies the prerequisite
for PR1; old blueprint observations describing an open draft are superseded.

The loader port preserves the [final review fixes](https://github.com/sn3p/Orrery3D/blob/f8c914c96534abf94ed9b33c55f389e13b2d2faf/docs/catalog-trial-review-response.md):
opening/shader failures preserve unaffected rendering; pending dates survive
loading; speculative exhaustion recovers only on meaningful demand; cancellation
preserves required reads; preparation/commit failures do not retry as network
failures; empty prefixes avoid full uploads; GPU readiness requires an actual
cloud render; verified cache replacement repairs corrupt generated caches.
Preserve bounded source-wide processing, task yields, signal cleanup, webpack
definitions and WebKit's single-context shader verification.

[PR30 measurements and limits](https://github.com/sn3p/Orrery3D/blob/f8c914c96534abf94ed9b33c55f389e13b2d2faf/docs/catalog-trial-results.md)
are source-owner evidence, not new Orrery verification. The retained real trial
profile has 895,910 dated records in 114 chunks; the full master also includes
667,585 records without matched discovery dates. Index pin: 265,372 decoded
bytes, SHA-256 `bf4252e0e20b6db07df83a2d87f731788235067fbcd2d3a78c98f92083880db2`.
Chunking does not eliminate full-capacity allocations. Transfer, buffering,
late-start costs and physical mobile hardware remain explicit measurement limits. Do not fabricate discovery dates or claim this is all orbital data.

[Orrery3D PR31](https://github.com/sn3p/Orrery3D/pull/31) merged as `93a3e1f`.
Its latest-descriptor and provisioning fixes are the PR3 reference. The producer's
automatic Pages publication also landed in PR6 (`22a9e6d`); MPC acquisition and
regeneration remain manual. Orrery's default preview profile consumes that browser
contract. This data-default unit follows PR5 and precedes PR6; it leaves the legacy
root and data producer unchanged. Public promotion remains a separate approval.

## Approved product and architecture decisions

- Orrery is the destination application; orrery-data remains the separate
  producer. Orrery3D stays available during migration and becomes historical only
  after source/work disposition, verified release and explicit archival approval.
- Preserve Pixi's 2D appearance and Three's 3D appearance, including their
  distinct projections, colours, point sizes, planets, tracks and discovery
  effects. The target uses its existing JavaScript, webpack and UI conventions.
- One application owns catalogue identity/data, date, speed, scheduling, HUD and
  common options. Adapters own graphics resources, packing, projection, camera
  controls and recovery. Catalogue loading does not belong to a renderer.
- Pixi is the normal default; Three gains a direct `?renderer=three` entry when
  its adapter works. Unknown renderer IDs fall back with feedback; known renderer
  startup failures report failure and offer recovery. No broken selector is
  exposed while only one or neither adapter exists.
- Options and separate renderer views last for the page only. Reload uses the
  existing defaults: no localStorage; DPR starts at 1×, offers 2× when available,
  and preserves the page's choice through supported display transitions.
  Benchmark DPR remains independent.
- Switching preserves date, requested speed, common options and separate camera
  states. It is not a discovery event: do not replay historic Pixi arrivals.
  Transient Pixi pulses may end on exit; Three's date-derived fade is rebuilt.
- Shared Renderer/Speed/DPR controls use one existing-style options panel.
  A small optional renderer control builder mounts and disposes its own section.
  Validate shared and per-renderer settings; store the latter under stable IDs.
  Test the extension with a fixture, without inventing public effect settings.

Use ordinary modules under `src/unified/`: application, catalogue, neutral
orbital calculations, UI, and `pixi`/`three` renderer adapters. These are ownership
boundaries, not a class/package per noun. Reuse unchanged pure helpers/assets;
adapt mutable code within the preview so the live import graph stays stable.
Keep one manifest/lockfile. No framework migration, submodule, shared package,
backend, event bus, universal scene graph or speculative plugin system is needed.

The controller owns one scheduler and authoritative Julian day/speed. Speed 0
pauses; negative speed reverses. Paused frames draw only on invalidation. Hidden
tabs, graphics loss, buffering and switching suspend effective playback without
changing requested speed; resume resets elapsed-time accounting. Preserve
manual rendering for tests and benchmarks. Asteroid orbital evaluation stays on
the GPU; no per-frame CPU position array crosses the adapter boundary.

Reuse PR30's source/validation/scheduling/recovery, separating verified retained
CPU data from each renderer's uploaded prefix. `countThrough(T)` includes ties
across chunks. Display a date only when its whole population is GPU-ready; keep
the last complete scene while buffering. Bound parsed/prepared batches as well
as fetches. Separate catalogue and renderer generations reject stale work.
Source replacement cannot mix pins; graphics loss retains verified CPU data.
Retain neutral numeric data including Z, not the parsed object graph or a 2D
projection. Adapter disposal/rebasing must not mutate canonical arrays. Measure
array ownership, copies and retained/peak memory before freezing their layout.

Load engines lazily and run one transition at a time. Keep the old renderer
usable while loading destination code, then dispose its GPU resources before
creating the candidate. Restore its catalogue, complete prefix, options, viewport
and saved/default view before committing the selection. On partial startup
failure clean up and recreate the previous mode from retained data; if recovery
also fails, expose retry/mode choice without an invisible render loop. Keep focus
sensible, expose loading, disable the selector during transitions and coalesce
programmatic requests. Preserve each adapter's resize/DPR/context recovery.

An adapter needs only creation, catalogue attachment/synchronization, options,
resize, draw, view capture/restore and idempotent disposal. Exact method names,
neutral array layout and measured budgets remain engineering choices grounded
in the existing tests. Selection, filtering and follow features are later scope.

## Sequential review units

| Unit | Deliverable | Exit evidence |
| --- | --- | --- |
| 1 — Isolated preview | Tracked plan/pins, placeholder, separate build/dev and CI | Both static entries, clean assembly, legacy regression/visual checks and no preview requests from root |
| 2 — Pixi and shared shell | Port Pixi into the preview with app-owned time/HUD/options and neutral math | Pixi visuals/numerics/playback/input/DPR/recovery match; one clock/UI/scheduler; live root preserved |
| H — Preserve Orrery3D history | After PR2, import the pinned Orrery3D history and an inactive source snapshot in a separate PR | Original commits and ancestry retained; snapshot matches source; current app/build unchanged; true merge and fresh-clone verification |
| 3 — Reviewed loader | Reuse final reviewed loader/contract/provisioning/fixtures; retained CPU data and incremental Pixi upload | Bundled/indexed/whole conformance, ties, buffering, replacement/retry/cancellation/recovery and memory checks |
| 4 — Three adapter | Port final Three renderer onto that shell/loader; direct Three entry | Both engines independently pass data/numeric/visual/lifecycle baselines; Pixi starts without Three/WebGL2 |
| 5 — Switching/options | Enable selector, separate views and renderer-specific options hook | Repeated switching, in-flight loading, partial-init errors, option isolation and resource cleanup |
| 6 — Promotion | After acceptance and explicit release approval, serve unified app at root; remove the old `/next` entry | Root asset paths, both mode URLs, cached/missing chunks, live release and rollback |
| 7 — Cleanup | After promoted release acceptance, remove legacy duplication/temporary preview plumbing | One maintained app/build; source tests/provenance/importers/benchmarks accounted for |

Merge sequentially only on explicit instruction. Each later PR starts in a fresh
Orrery workspace/branch based on updated master after its dependency merges.
Drafts are the default; retire branches after their one PR closes/merges.
Publication, new Copilot requests, readiness changes and archival are separate
actions. PR1 does not automatically start any later unit.

### Preserve Orrery3D history before the loader port

The agreed sequence is **PR2 → H (history import) → PR3 (loader) → PR4
(Three) → PR5–PR7**. H is an additional review unit; existing planned PR
numbers keep their meaning. H imports the pinned history and snapshot described
in the [source record](history/orrery3d.md); loader/Three ports remain later work.

After PR2 merges, create a fresh Orrery workspace and branch for H. Pin the
reviewed Orrery3D source revision, record its reachable commits, and inventory
other branches and tags separately. Use a non-squashed `git subtree add` to
import that history and its exact snapshot under an inactive temporary path,
such as `migration/orrery3d/`. Keep the snapshot outside runtime imports,
build/deployment inputs and active package discovery. It is migration source;
the root package and lockfile remain the maintained application configuration.

Verify original commit hashes, metadata and ancestry, exact snapshot contents,
and unchanged existing app/build output. Publish H as a draft when requested.
When its merge is explicitly authorized, use **Create a merge commit**.
Squashing collapses the imported ancestry and rebasing changes commit hashes.
Verify that the original source tip and all recorded source commits remain
reachable from Orrery master in a fresh clone after the merge.

PR3 then moves/adapts the imported loader into the unified application; PR4
ports Three from the same imported history. Reconcile and preserve any later
Orrery3D commits before adopting their changes. Later cleanup removes the
temporary snapshot while retaining the merged Git ancestry. Historical commits
keep their original paths; verify file-history traversal after moves without
assuming automatic GitHub blame continuity.

GitHub PRs, issues, discussions and release records remain in Orrery3D. Preserve
the original repository and its links; archival still needs separate approval.

Keep the legacy source through PR6. Retain a known-good artifact/source and test
rollback without depending on an expiring CI artifact. Test the root asset base
independently of `/next/`; retain needed chunks or provide tested stale-session
reload/recovery. After release, use a separate Orrery3D review unit for its move
notice and direct link to Orrery's Three mode. Verify old URLs before and after
any explicitly approved archival.

## Build and development

The root-promotion candidate now serves the unified application at `/` and
`/?renderer=three`. `/next`, `/next/` and `/next/index.html` return 404;
there is no preview page or redirect to the app.
See [release and rollback](promotion.md) for acceptance and temporary compatibility.


`webpack.config.js` retains the legacy compiler for test oracles and cached-page
assets. `webpack.next.config.js` retains the lazy application compiler primitives;
`webpack.app.config.cjs` configures the root app and development.
`webpack.build.config.js` first cleans/builds the legacy assets, then replaces its
HTML with the unified root without deleting compatibility files. The build command
owns cleaning once; Pages' `--output-clean` remains supported. Output-path overrides
are rejected before cleaning. Build `dist/` and copy the complete directory to relocate it.

```sh
npm ci
npm run build -- --output-clean
npm run serve                 # root; CONDUCTOR_PORT when set, otherwise 3000
npm run watch                 # root app development output
npm run build:next            # compatibility alias: same complete site
npm run serve:next            # compatibility alias: same root development server
```

Root URLs work in development without a previous build; retired preview entries
return 404 even when old HTML remains in the static output.
Normal and configured production commands keep the old root assets and duplicate
unified compiler assets at their PR73 `/next/` paths. Configured catalogue builds
also retain their staged current/explicitly retained pins under `/next/data/`.
Development selects the configured source at process startup. The old
`webpack.next.app.config.cjs` and test-only nested compilation remain until cleanup.
Legacy source, imported source snapshot, tests, data/importer and benchmark oracles
remain in this review unit. Promotion does not remove them or rewrite Git history.

## Verification contract

The default Playwright Test suite runs all three browser engines:

```sh
npx playwright install chrome firefox webkit
npm test
```

`test:build` exercises mode/watch behavior, repeated actual Pages clean builds,
byte equality for retained PR73 assets and repeated promoted-build/alias safety.
`test:browser` covers both assembled production pages, assets and lazy chunks,
real legacy behavior plus development HMR/reload. `test:unified` also runs the
strict GPU, scheduling, rendering/lifecycle, UI/DPR and finite benchmark probes
against the extracted classes, building the promoted site first so the standalone
command works from a clean checkout. The combined browser suite invokes the
same probes directly to preserve the assembled production artifact under test.
`tests/unified-app.js` is an inspection facade
only for existing probes, including their explicit stopped-ticker calls;
production has no facade or ticker bridge. Separate raw-App tests verify async
failures/disposal, actual clock ownership and exact scene/HUD parity at fixed
catalogue/date/viewport/DPR, including recovery. Public root and removed `/next/` entries are tested with real HTML and lazy chunks
at root and Pages prefixes, including cached PR73 documents. `benchmark:next`
identifies unified execution independently of the benchmark runner source.
After the build regression
checks, CI uploads the final assembled Pages artifact and distinct compiled test
fixtures. Chromium and Firefox use two shards each, and WebKit uses four, with one worker per runner;
Chromium-only checks run once per applicable app in their own job.
A separate Chromium job runs the standalone preview command from a
clean checkout with no preview build. Deployment depends on all jobs.
Diagnostics are retained per case and merged into a Playwright HTML report;
no root promotion is implicit.
See [browser test workflow](browser-tests.md) for the coverage mapping and commands.

Hosted Linux browser jobs use Xvfb and Mesa software rendering, with a preflight
that records the actual renderer and requires WebGL2 so numerical coverage cannot
silently be skipped. This also gives Firefox a working graphics context. Chrome
uses ANGLE's OpenGL backend: its default SwiftShader fallback reproduces a legacy
orbital error above the existing 0.25px limit at 20x zoom. That driver-specific
precision issue remains a legacy follow-up; this scaffold changes neither the
orbital shader nor its tolerance. Hardware and real-device verification remains
part of the later renderer migration gates.

Every subsequent unit applies the relevant rows below at real entry/request/
render boundaries, not solely through shared internals. Add automated regression
coverage for valid failures; inspect rendered states and the full diff before
handoff. Review shared state/loader/switching changes independently.

| Area | Required coverage |
| --- | --- |
| Entries/build | Clean install, root/preview/direct Three when available; domain and Pages subpaths; no cross-clean/collisions; lazy chunks; HMR/reload; legacy root catalogue preserved; preview default uses complete discovery data |
| Time | Pause/forward/reverse/startup date; unchanged speed/date on switching; hidden/long-stall exclusion; paused camera input and no recurring scene draws |
| Catalogue | Same pinned bundled/indexed/whole population, malformed/empty input, equal-date splits, late chunks, buffering, retries/cancellation/replacement/stale work; no mixed pins/duplicates |
| Loading switches | Partial retention, buffering/replacement, independent CPU/GPU prefixes, coherent date/count, no retained-data refetch, rapid teardown/failure recovery |
| GPU/numerics | Existing independent orbital vectors and extreme/date cases; Pixi projection/motion bounds; Three Z/inclination; adapter-specific phase refresh/uploads; no CPU asteroid frame path |
| Visuals | Fixed catalogue/date/viewport/DPR; sparse/dense discoveries, pause/reverse, close/overview; preserve colours/shapes/tracks and distinct source effects |
| Options | Shared preservation, per-renderer isolation, active section, validation, reload/DPR policy and independent benchmark options |
| Lifecycle | At least 20 alternating switches; init/fetch/upload disposal; two context-loss/recovery cycles per mode; one canvas/scheduler; listener/resource trends |
| Interaction | Desktop/narrow/short viewports, overflow/wrapping/control placement, keyboard/focus/labels/Escape/outside dismissal, mouse/touch and error/loading copy; no console errors |
| Compatibility | Chromium/Firefox/WebKit; Pixi's WebGL compatibility; optional Three's WebGL2 requirement must not block Pixi |
| Performance | Historical 100k and real indexed trial data; first complete draw, cold/warm switches, CPU/GPU/frame timing, transfer and retained/peak memory; fixed baselines and agreed budgets |
| Release | Assembled static entries throughout preview, both promoted mode URLs, removed preview entries, cached/missing chunks, legacy notice/destination and prior-version rollback |

PR1 exercises the scaffold and legacy rows. Renderer ports, shared state, loader
adoption, switching, indexed scale and release/device acceptance remain assigned
to their later units. WebKit automation does not establish actual Safari/iOS or
native display-transition behavior. Record precise verification limits without
claiming those states complete.

The enhancement backlog stays parked: play/pause/date UI, population filters,
planet identification/focus/follow, About, orbit visibility, softness/glow and
stronger Three discoveries; camera presets, scale/orientation, timeline,
share/export, legend, exploration, outer planets and date ranges. Three discovery
emphasis is Three-specific; date-range scope remains Orrery with former 3D
applicability unresolved. No adapter abstraction is added merely to anticipate
those features.

## Renderer switching

The root options panel offers Pixi.js (2D) and Three.js (3D). Switching keeps
one App, clock, HUD, retained CPU catalogue, date, requested speed and DPR choice.
Each mode remembers its own view for this page. There is no camera conversion or
browser-storage persistence. The preview uses the same complete discovery source
in both modes; cached legacy documents can still access their historical 100k bundle.

The controller loads destination code while the outgoing camera remains usable,
suspends playback and speculative catalogue lookahead, then disposes the outgoing
graphics before constructing the destination. Packing yields between 8,192-row
batches. Retained records, planets, current options, viewport and saved/default
view are restored before the complete draw receipt commits the renderer choice.
A zero visible population is a valid complete frame; future retained rows remain
available. Pending catalogue replacements/seeks stay owned by normal App frame
transactions. Transition time is excluded from resumed playback.

Loading failure leaves the outgoing renderer in place. Creation, packing or draw
failure disposes the candidate and rebuilds the previous mode. If that also fails,
feedback offers retry and the common selector remains available; there is no
recurring invisible render loop. Adapter identity guards reject stale callbacks,
including callbacks from a failed fallback. Destroy aborts pending transitions.
Programmatic requests are serialized and coalesced to the latest queued mode.

Planet additions validate the complete batch before changing the live scene or
retained input. Each adapter reuses its preparation path for detached
`validatePlanets(data, frame)` calls during the renderer-free interval; temporary
resources are disposed and no other engine is loaded. Rejected batches cannot
leave a live prefix or poison later reconstruction.

Catalogue errors take precedence over an older nonterminal switch error;
no-renderer recovery guidance remains available. New feedback and viewport
resizes close the options panel when it would obscure the message, returning
focus to the options trigger. The panel can be reopened to choose a renderer.

Switching is not a discovery event. Restored Pixi markers do not replay historical
arrival pulses; ordinary first loads and new discoveries keep their existing
behavior. Three reconstructs its date-derived color fade. Camera controls,
projection, colors, sizes, planets, tracks and GPU orbital evaluation remain
adapter-owned. Both adapters release their context on final disposal.

Registry entries keep engine-free labels and lazy `load()` factories. An optional
`buildOptions({ gui, values, setOptions, addHint })` uses the existing dat.gui
primitives and returns its listener cleanup function. Defaults and validated
options live under a stable renderer ID; `validateOptions(next)` must reject
unsupported/invalid values before the setter changes App or graphics. Empty
sections are omitted and outgoing controls are removed. A fixture setting tests
this boundary; no new public camera or effect controls are included.

`tests/playwright/switching.spec.cjs` registers real-entry state, failure,
retained-data, lifecycle and fixture-options tests in all browser projects and
standalone preview coverage. Production asset/lazy isolation, source visual and
numerical parity, loader and finite benchmark checks remain separate gates.
