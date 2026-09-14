# Orrery unification — approved blueprint v2

Approved September 14, 2026. This is the repository edition of the agreed
blueprint and start guide, with historical status reconciled and local planning
paths removed. No further architecture approval is required. Each implementation
unit still needs its own tests, review and explicit merge instruction.

## Current unit: PR1, isolated preview

PR1 means the first planned review unit, not GitHub pull request number 1.
It adds `src/unified/` and a real `dist/next/index.html` placeholder. Current
Orrery continues at the root with its existing Pixi application and historical
100,000-record catalogue. No renderer, loader, renderer selector or new product
control is implemented in this unit.

The preview is unlinked from the current application's UI and carries
`noindex, nofollow`. Once merged and deployed it is public at
`https://sn3p.github.io/Orrery/next/`; these measures are not access control.
PR heads are not deployed. Merging master deploys the assembled root and preview
only after all build and browser gates pass.

## Source pins and prerequisite

Verified September 14, 2026 against GitHub and local Git objects:

| Input | Pinned revision | Role |
| --- | --- | --- |
| [Orrery master](https://github.com/sn3p/Orrery/tree/5e4eb1c02cf0e2bbef3538f5fa1537f97f9c4a77) | `5e4eb1c02cf0e2bbef3538f5fa1537f97f9c4a77` | Current Pixi behavior, visuals, tests and historical catalogue |
| [Orrery3D PR30 merge](https://github.com/sn3p/Orrery3D/commit/f8c914c96534abf94ed9b33c55f389e13b2d2faf) | `f8c914c96534abf94ed9b33c55f389e13b2d2faf` | Reviewed loader and Three source for later ports |
| [orrery-data PR4](https://github.com/sn3p/orrery-data/tree/f6f4a1d4e807362417c74ecbd2b74ce73306d41d) | `f6f4a1d4e807362417c74ecbd2b74ce73306d41d` | Producer 0.4.0, consumer contract v1 and real fixtures |

[PR30](https://github.com/sn3p/Orrery3D/pull/30) merged at
**2026-09-14T10:23:14Z**. Its tree
`b2d6117e02347da5aaa39256abdb83b3a0b41818` equals reviewed head
`b6bf448bf2f1f796b06041c8eb73061e5b8560d4`.
[Merge CI](https://github.com/sn3p/Orrery3D/actions/runs/34832913066) passed build,
Chromium, Firefox, WebKit and Pages deployment. This satisfies the prerequisite
for PR1; old blueprint observations describing an open draft are superseded.

The later port must carry the [final review fixes](https://github.com/sn3p/Orrery3D/blob/f8c914c96534abf94ed9b33c55f389e13b2d2faf/docs/catalog-trial-review-response.md):
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
late-start costs, physical mobile hardware and delivery acceptance remain explicit
later checks. Do not fabricate discovery dates or claim this is all orbital data.

[Orrery3D PR31](https://github.com/sn3p/Orrery3D/pull/31),
`sn3p/enable-indexed-catalog-default`, was open at
`1e547e8132d23d2653ef46a9b4a6dee13690df83` when PR1 started. Its separate data
selection/provisioning work does not block this scaffold. Recheck its final
reviewed revision and any producer-hosting decisions before planned PR3.
Changing Orrery3D's default does not itself change Orrery's default. A proposed
shared current-data host remains separate work; this scaffold adopts no hosting
or release-distribution contract.

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
| 3 — Reviewed loader | Reuse final reviewed loader/contract/provisioning/fixtures; retained CPU data and incremental Pixi upload | Bundled/indexed/whole conformance, ties, buffering, replacement/retry/cancellation/recovery and memory checks |
| 4 — Three adapter | Port final Three renderer onto that shell/loader; direct Three entry | Both engines independently pass data/numeric/visual/lifecycle baselines; Pixi starts without Three/WebGL2 |
| 5 — Switching/options | Enable selector, separate views and renderer-specific options hook | Repeated switching, in-flight loading, partial-init errors, option isolation and resource cleanup |
| 6 — Promotion | After acceptance and explicit release approval, serve unified app at root; `/next/` forwards preserving renderer choice | Root asset paths, both mode URLs, cached/missing chunks, live release and rollback |
| 7 — Cleanup | After promoted release acceptance, remove legacy duplication/temporary preview plumbing | One maintained app/build; source tests/provenance/importers/benchmarks accounted for |

Merge sequentially only on explicit instruction. Each later PR starts in a fresh
Orrery workspace/branch based on updated master after its dependency merges.
Drafts are the default; retire branches after their one PR closes/merges.
Publication, new Copilot requests, readiness changes and archival are separate
actions. PR1 does not automatically start any later unit.

Keep the legacy source through PR6. Retain a known-good artifact/source and test
rollback without depending on an expiring CI artifact. Test the root asset base
independently of `/next/`; retain needed chunks or provide tested stale-session
reload/recovery. After release, use a separate Orrery3D review unit for its move
notice and direct link to Orrery's Three mode. Verify old URLs before and after
any explicitly approved archival.

## Build and development

`webpack.config.js` remains the legacy configuration. `webpack.next.config.js`
owns preview HTML, CSS, assets and lazy chunks under `dist/next/`. Only unchanged
loader rules are reused. `webpack.build.config.js` orders the legacy compiler
before the preview with an explicit dependency; both cleaning operations are
scoped to their output. The Pages `--output-clean` argument is safe. The assembled
command rejects `--output-path` before compilation because webpack would apply
it to both compilers, making preview cleaning erase the root. To relocate the
assembled site, build `dist/` and copy that directory. Root code
never imports preview code; preview-only builds cannot clean the root.

```sh
npm ci
npm run build -- --output-clean  # assemble both pages, root first
npm run build:next              # rebuild only dist/next
npm run serve                  # existing current-app development command
npm run serve:next              # /next/, CONDUCTOR_PORT when set, otherwise 3000
```

Preview development serves a previously built `dist/` as its static root so
“Open Orrery” returns to the current app. Build once first. The preview is
compiled in memory at `/next/`; use that nested path for direct navigation and
reload. `npm run serve:next -- --port 55310 --no-open` explicitly selects a port;
use the receiving workspace's assigned port instead of copying that example.
The existing Conductor Run/Open defaults are unchanged. Existing `watch`, data
import scripts and benchmark commands retain their roles. Preview output is
generated/ignored; existing tracked legacy output handling is preserved in PR1.

## Verification contract

Run `npm test` with Chrome installed. For the complete local browser matrix:

```sh
npx playwright install firefox webkit
BROWSERS=chromium,firefox,webkit npm test
```

`test:build` exercises mode/watch behavior, repeated actual Pages clean builds,
byte equality against standalone legacy output and preview-only clean safety.
`test:browser` covers both assembled production pages, assets and lazy chunks,
real legacy behavior plus development HMR/reload. After the build regression
checks, CI uploads the final assembled Pages artifact for all three browser jobs
to test. Deployment depends on all jobs. Diagnostics are retained per browser;
no root promotion is implicit.

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
| Entries/build | Clean install, root/preview/direct Three when available; domain and Pages subpaths; no cross-clean/collisions; lazy chunks; HMR/reload; default catalogue preserved |
| Time | Pause/forward/reverse/startup date; unchanged speed/date on switching; hidden/long-stall exclusion; paused camera input and no recurring scene draws |
| Catalogue | Same pinned bundled/indexed/whole population, malformed/empty input, equal-date splits, late chunks, buffering, retries/cancellation/replacement/stale work; no mixed pins/duplicates |
| Loading switches | Partial retention, buffering/replacement, independent CPU/GPU prefixes, coherent date/count, no retained-data refetch, rapid teardown/failure recovery |
| GPU/numerics | Existing independent orbital vectors and extreme/date cases; Pixi projection/motion bounds; Three Z/inclination; adapter-specific phase refresh/uploads; no CPU asteroid frame path |
| Visuals | Fixed catalogue/date/viewport/DPR; sparse/dense discoveries, pause/reverse, close/overview; preserve colours/shapes/tracks and distinct source effects |
| Options | Shared preservation, per-renderer isolation, active section, validation, reload/DPR policy and independent benchmark options |
| Lifecycle | At least 20 alternating switches; init/fetch/upload disposal; two context-loss/recovery cycles per mode; one canvas/scheduler; listener/resource trends |
| Interaction | Desktop/narrow/short viewports, overflow/wrapping/control placement, keyboard/focus/labels/Escape/outside dismissal, mouse/touch and error/loading copy; no console errors |
| Compatibility | Chromium/Firefox/WebKit; Pixi's WebGL compatibility; optional Three's WebGL2 requirement must not block Pixi |
| Performance | Historical100k and real indexed trial data; first complete draw, cold/warm switches, CPU/GPU/frame timing, transfer and retained/peak memory; fixed baselines and agreed budgets |
| Release | Assembled static entries throughout preview, both promoted mode URLs, forwarding selection, cached/missing chunks, legacy notice/destination and prior-version rollback |

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
