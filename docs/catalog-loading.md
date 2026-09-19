# Shared catalogue loading

The unified root uses the complete available discovery catalogue by default,
through `catalog-profiles/latest.json` and the reviewed indexed/latest loader.
`/?renderer=three` uses the same source and retained population. Switching
renderers does not fetch that population again or impose a population limit.

“Complete” means all eligible records in the published discovery dataset, with
real source coverage and known discovery dates. It does not mean all MPC objects.
The date still determines which discoveries are visible: normal January 1, 1980 UTC
startup, speed and discovery animation remain unchanged. The population is not all
visible at startup. No catalogue environment variable or historical setting is
needed, and source failures never silently fall back to the old bundle.

The compressed [historical100k fixture](../tests/fixtures/historical100k/README.md) remains only for test and benchmark
oracles. Production does not emit or request it. The old importer is retired;
its test and benchmark consumers use the documented fixture.

## Explicit development and test profiles

From the root package:

```sh
# Normal root: complete published discovery dataset
npm run build
npm run build:next
npm run serve:next

# Root selects the configured source and retains explicitly listed root pins
CATALOG_CONFIG=catalog-profiles/ties-indexed.json npm run build
CATALOG_CONFIG=catalog-profiles/ties-whole.json npm run serve:next

# Verified private profile assembly, preserving prior output on failure
npm run catalog:build -- catalog-profiles/ties-indexed.json .context/catalog-site
npm run test:catalog
```

`CATALOG_CONFIG` optionally overrides the unified app source for deterministic tests
or a verified private profile. Omitting it selects the latest profile. Development
selection is fixed for the process; restart to select another source. Both development
commands serve root; old `/next` page URLs return 404. Production output is `dist/`; overlapping
output/static overrides fail. Configured production builds compile and stage privately,
then atomically replace the complete current-app output, including root `data/` pins. Both build command aliases use a shared output
lock. Default builds and development servers retain webpack's output behavior and
should not write the same output concurrently.
Input protection resolves filesystem aliases before publication. Shared bundle
caches coordinate installation per pin, preserve a verified concurrent winner,
and restore previous contents if publication fails. Interrupted installation locks
retain recovery data; after a five-minute wait, the error identifies the lock for
inspection. Source failures have visible feedback; none falls back to historical data.
Offline startup reports a loading error with reload guidance. Existing bounded
retries and online/demand recovery apply after a source has opened.

The default latest profile reads the producer descriptor once per page session,
revalidates it on reload, and verifies its pinned index and content-addressed chunks. It does
not need a local producer checkout, dataset, or network access during compilation.
The producer browser distribution has no whole-file payload: whole mode is rejected.
The two fixture profiles exercise indexed and whole delivery from the same complete
consumer-v1 bundle, including equal discovery dates split across chunks.

For a real complete bundle, supply `bundle`, `pin` and `mode` in the same shape as
the fixture profiles. The pin contains the decoded `index.json` length and SHA-256.
A local bundle is resolved relative to its configuration. Alternatively supply
`archive: { url, bytes, sha256 }` plus the independent index pin; acquisition,
private staging, inventory, compressed/decoded content and provenance are verified.
Manifest verification checks the original export's complete metadata and identity
hash against the index and artifact descriptors. The original export tool version
may differ from the indexed exporter version: re-indexing an older export preserves
its original manifest. Full master-to-catalogue row reconciliation remains the
producer's responsibility; browser adapters validate received catalogue records.
Optional `retained` entries preserve explicitly chosen complete pins in a profile
output. No public retention window or data release is promised by this mechanism.

`startJed` and `speed` are optional. Normal configured app commands preserve
the January 1, 1980 UTC start and speed 1.5 unless overridden. Private
`catalog:build` trials use deterministic JD 2444270.5/speed 1.5 defaults.

## Ownership and completeness

`CatalogSource` owns verified transport, cancellation and three source-wide file
slots. A slot remains held through ordered parsing and CPU preparation. The loader
commits a contiguous prefix into one renderer-neutral numeric model, with original
row ordinals within the pin, full 3D orbital bases and Float64 phase/date data.
It retains no parsed row graph. Each committed row also stores a compact orbit-class
id from `a` and `e` for the Options group filter; adapters mask in the shader without
changing the discovery draw range. Source and catalogue identities accompany each
batch; superseded generations cannot commit.
Rejected HTTP responses cancel their bodies before returning the status error;
successful responses without a readable body fail explicitly.

The application owns demand, requested speed/date, replacement and the renderer
lifetime. Each adapter owns graphics resources and mutable packing: Pixi projection
and arrival buffers, or Three scalar phase/discovery arrays and camera. Canonical arrays are read-only to the adapter and are never detached
by disposal or rebasing. Both adapters cap catch-up at 8,192 rows per application task,
including late starts and resumption after graphics loss. Preallocation remains:
chunked transport does not eliminate full-capacity GPU allocation.

A prepared prefix is not a draw receipt. The app keeps the last complete date/count
while buffering and publishes the new state only after the active asteroid cloud is
submitted, its buffers are current and allocation/upload checks pass. Shader/link
and upload failures do not establish readiness. An empty prefix does not upload a
full asteroid cloud. Replacement temporarily retains the previous scene until the
candidate's first successful draw, then releases it. Failed submissions restore
cloud phase/arrival state and planet positions. Graphics restoration uses retained
numeric/packing data, without fetching the catalogue again.

A missing draw receipt restores and repaints the previous scene, retains the
candidate's packing, and schedules another attempt. Bundled-catalogue frames use
the same rollback boundary, including failed direct date changes; the requested
date is applied only when a later draw succeeds.
Throwing submissions also make one bounded attempt to repaint the retained scene.
Failed uploads invalidate Pixi's recorded buffer version and capacity so a repaint
cannot skip missing GPU storage. A terminal graphics failure prevents subsequent
control invalidations from advancing or publishing a frame; context restoration
or an explicit catalogue replacement can recover it.

Requested dates survive source opening. Every discovery at or before a date is
required, including ties across files. While playing forward, speculative reads
cover ten seconds of playback at the current speed, never fewer than three
chunks, using the chunk discovery-date bounds; at speed 8 the horizon spans
thirteen years, so the dense 2000s download during the sparse decades before
them, while the 1980s at normal speed still need only three chunks. Paused/hidden state suppresses
lookahead; required reads remain bounded. The numeric model is preallocated at
full capacity, so lookahead does not grow retained memory. Network failures have bounded automatic
retries and demand/resume/online recovery. Preparation/adapter failures are distinct
from transport failures. Buffering, hidden time and graphics suspension do not age
Pixi arrivals or produce playback catch-up.

Ordinary asteroid positions still run on the GPU. Pixi keeps its 256-day phase
rebase cadence, negative-X/positive-Y projection, 2/3-active-second discovery effect
and WebGL1 full-update fallback. Direct `setAsteroids`, manual frames and benchmark
inspection remain supported. Manual frame failures propagate after cleanup so
finite benchmarks can stop; automatic failures update the status and stop recurring
draws. Only the selected engine and its packing are loaded.
Three retains the source 3D presentation and date-based discovery fade; see
[its adapter contract and source mapping](three-renderer.md).

## Verification and measurements

Public default-entry tests route hash-valid, small producer fixtures at the real
compiled descriptor URL, including direct Three and reload. Explicit
`tests/bundled-entry.js` builds retain whole-file inputs for renderer pixel/numeric
oracles and bundled-loading regressions; these are test fixtures, not public
defaults. Live full-population verification is recorded separately with the
observed descriptor/index pin and source coverage.

`npm run test:node` includes real producer contract, transport, cancellation,
provisioning, archive and neutral-model tests. `npm test` includes the actual
configured production entry through fetch, CPU commitment, adapter upload/draw and
HUD, plus the current production numerical, rendered, input, options,
DPR, lifecycle, development and benchmark suites. `npm run test:catalog` selects
the native Playwright catalogue cases; loading, lifecycle and frame commitment
run in all three browser projects, with benchmark and configured development
checks in the Chromium-only project. `npm run test:unified` is a separate
clean-checkout boundary: it builds the current app and runs two public-renderer
smoke cases. CI retains its Mesa/Xvfb path
and the existing strict numerical thresholds.

```sh
# Same-population full-scale comparison; configuration contains your verified pin
HEADLESS=1 DURATION_SECONDS=120 PROFILES=10mbps-100ms \
  npm run benchmark:catalog -- /absolute/path/indexed.json /absolute/path/whole.json
node tests/history-import.cjs
```

`DURATION_SECONDS` must be finite and non-negative; `PROFILES` accepts `native`
and/or `10mbps-100ms`. Invalid settings fail before building. Empty catalogues are
valid benchmark inputs. `RENDERER=three` selects the direct Three entry;
`RENDERER=pixi` is the default. Other renderer IDs fail before building. Browser contexts and the local server close on setup or
launch failure.

Measurements distinguish retained CPU backing storage, sampled peak heap/storage,
nominal GPU capacity, transfer and the first complete GPU submission/completion.
Reports identify the active `renderer`, `webGLVersion` and `initialGpuMethod`: WebGL2
`fenceSync` polling or the blocking WebGL1 `finish()` fallback. These timestamps
are not compositor presentation or physical-phone certification. A whole-file
control still has large parse/preparation tasks; late starts must obtain the
complete preceding population. See the PR's verification report for measured
conditions and limitations. Physical Safari/iOS and real monitor transitions
remain unverified.

## Adopted source and provenance

Source: [Orrery3D master 93a3e1f](https://github.com/sn3p/Orrery3D/tree/93a3e1f4a36d8fdceb513bdfdca20beddb3348d6),
including final PR30 and PR31. The original ancestry and exact import snapshot
remain preserved by [the history-import record](history/orrery3d.md). The
current-tree snapshot and its inactive package/workflow are removed; retained
[independent Three references](../tests/fixtures/three-reference/README.md) are test-owned.

| Original source path at the pinned revision | Active adaptation |
| --- | --- |
| `src/js/catalog/{CatalogSource,CatalogLoader,contract}.js` | `src/unified/catalog/`; loader CPU ownership and explicit graphics receipt |
| `src/js/prepareCatalogue.js` | `src/unified/catalog/prepareCatalogue.js`; neutral buffers, row diagnostics and Pixi precision bounds |
| `scripts/build.cjs`, `catalog.cjs`, `catalog-archive.cjs` | Root `scripts/`; current app output and atomic publication |
| `webpack.app.config.cjs` | Root `webpack.app.config.cjs`; configured development/staging |
| `tests/fixtures/{consumer-v1,browser-v1}` | Root `tests/fixtures/`; unchanged producer fixtures/provenance |
| Source contract/delivery/loading tests and benchmark | Root catalogue tests and `benchmarks/catalog-loading.cjs`; current app/renderer boundaries |

All source is MIT-licensed; the [retained license](../tests/fixtures/three-reference/LICENSE), original authorship/history and
fixture provenance remain available. The public default is now independently
approved for Orrery. Historical fixture builds exercise current production classes; Orrery3D and OrreryData remain separately owned.
