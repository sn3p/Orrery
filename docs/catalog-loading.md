# Shared catalogue loading in the preview

The public root and `/next/` still use the historical 100,000-object catalogue.
The preview also supports the reviewed producer indexed and whole-file contracts,
including the separately versioned `latest.json` browser distribution. There is
no catalogue selector or new runtime population cap. Three and renderer switching
remain later unification units.

## Explicit development and test profiles

From the root package:

```sh
# Normal root + preview: historical 100k
npm run build
npm run serve:next

# Assembled root stays historical; preview selects the configured source
CATALOG_CONFIG=catalog-profiles/ties-indexed.json npm run build
CATALOG_CONFIG=catalog-profiles/ties-whole.json npm run serve:next
CATALOG_CONFIG=catalog-profiles/latest.json npm run build:next

# Verified private profile assembly, preserving prior output on failure
npm run catalog:build -- catalog-profiles/ties-indexed.json .context/catalog-site
npm run test:catalog
```

`CATALOG_CONFIG` is an explicit selection for the preview. Development selection
is fixed for the process; restart to select another source. The root development
command and Conductor's root destination retain their existing behavior. Configured
preview output remains `dist/next`; overlapping output/static overrides fail.
Configured production builds compile and stage privately, then atomically replace
the complete output. Combined builds protect both root and preview; standalone
builds preserve the root sibling. A shared output lock coordinates configured
production builds; default builds and development servers retain their existing
webpack output behavior and should not write the same output concurrently.
Input protection resolves filesystem aliases before publication. Shared bundle
caches coordinate installation per pin, preserve a verified concurrent winner,
and restore previous contents if publication fails. Interrupted installation locks
retain recovery data; after a five-minute wait, the error identifies the lock for
inspection. An explicitly selected source fails
with visible feedback; it never falls back to historical data.

The latest profile reads the producer descriptor once per page session, revalidates
it on reload, and verifies its pinned index and content-addressed chunks. It does
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

`startJed` and `speed` are optional. Normal configured preview commands preserve
the browser-local February 1980 start and speed 1.5 unless overridden. Private
`catalog:build` trials use deterministic JD 2444270.5/speed 1.5 defaults.

## Ownership and completeness

`CatalogSource` owns verified transport, cancellation and two source-wide file
slots. A slot remains held through ordered parsing and CPU preparation. The loader
commits a contiguous prefix into one renderer-neutral numeric model, with original
row ordinals within the pin, full 3D orbital bases and Float64 phase/date data.
It retains no parsed row graph. Source and catalogue identities accompany each
batch; superseded generations cannot commit.
Rejected HTTP responses cancel their bodies before returning the status error;
successful responses without a readable body fail explicitly.

The application owns demand, requested speed/date, replacement and the renderer
lifetime. Pixi owns its projection, mutable phase and arrival buffers, textures and
GPU resources. Canonical arrays are read-only to the adapter and are never detached
by disposal or rebasing. Pixi catch-up is capped at 8,192 rows per application task,
including late starts and resumption after graphics loss. Preallocation remains:
chunked transport does not eliminate full-capacity GPU allocation.

A prepared prefix is not a draw receipt. The app keeps the last complete date/count
while buffering and publishes the new state only after the active Pixi mesh is
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
required, including ties across files. Paused/hidden state suppresses unnecessary
lookahead; required reads remain bounded. Network failures have bounded automatic
retries and demand/resume/online recovery. Preparation/adapter failures are distinct
from transport failures. Buffering, hidden time and graphics suspension do not age
Pixi arrivals or produce playback catch-up.

Ordinary asteroid positions still run on the GPU. Pixi keeps its 256-day phase
rebase cadence, negative-X/positive-Y projection, 2/3-active-second discovery effect
and WebGL1 full-update fallback. Direct `setAsteroids`, manual frames and benchmark
inspection remain supported. Manual frame failures propagate after cleanup so
finite benchmarks can stop; automatic failures update the status and stop recurring
draws. No Three buffers or renderer are retained.

## Verification and measurements

`npm run test:node` includes real producer contract, transport, cancellation,
provisioning, archive and neutral-model tests. `npm test` includes the actual
configured production entry through fetch, CPU commitment, Pixi upload/draw and
HUD, plus the existing legacy/preview numerical, rendered, input, options,
DPR, lifecycle, development and benchmark suites. `npm run test:catalog` selects
the native Playwright catalogue cases; loading, lifecycle and frame commitment
run in all three browser projects, with benchmark and configured development
checks in the Chromium-only project. These cases are also part of
`npm run test:unified`, which builds the standalone preview before running its
tests. CI retains its Mesa/Xvfb path
and the existing strict numerical thresholds.

```sh
# Same-population full-scale comparison; configuration contains your verified pin
HEADLESS=1 DURATION_SECONDS=120 PROFILES=10mbps-100ms \
  npm run benchmark:catalog -- /absolute/path/indexed.json /absolute/path/whole.json
node tests/history-import.cjs
```

`DURATION_SECONDS` must be finite and non-negative; `PROFILES` accepts `native`
and/or `10mbps-100ms`. Invalid settings fail before building. Empty catalogues are
valid benchmark inputs. Browser contexts and the local server close on setup or
launch failure.

Measurements distinguish retained CPU backing storage, sampled peak heap/storage,
nominal GPU capacity, transfer and the first complete GPU submission/completion.
Reports identify Pixi's actual `webGLVersion` and `initialGpuMethod`: WebGL2
`fenceSync` polling or the blocking WebGL1 `finish()` fallback. These timestamps
are not compositor presentation or physical-phone certification. A whole-file
control still has large parse/preparation tasks; late starts must obtain the
complete preceding population. See the PR's verification report for measured
conditions and limitations. Physical Safari/iOS and real monitor transitions
remain unverified.

## Adopted source and provenance

Source: [Orrery3D master 93a3e1f](https://github.com/sn3p/Orrery3D/tree/93a3e1f4a36d8fdceb513bdfdca20beddb3348d6),
including final PR30 and PR31. The original ancestry and exact import snapshot
remain preserved by [the history-import record](history/orrery3d.md). The remaining
`migration/orrery3d` package/workflow is inactive and is not another application.

| Source under `migration/orrery3d` | Active adaptation |
| --- | --- |
| `src/js/catalog/{CatalogSource,CatalogLoader,contract}.js` | `src/unified/catalog/`; loader CPU ownership and explicit graphics receipt |
| `src/js/prepareCatalogue.js` | `src/unified/catalog/prepareCatalogue.js`; neutral buffers, row diagnostics and Pixi precision bounds |
| `scripts/build.cjs`, `catalog.cjs`, `catalog-archive.cjs` | Root `scripts/`; preview entry/output and historical default adaptation |
| `webpack.app.config.cjs` | `webpack.next.app.config.cjs`; configured preview development/staging |
| `tests/fixtures/{consumer-v1,browser-v1}` | Root `tests/fixtures/`; unchanged producer fixtures/provenance |
| Source contract/delivery/loading tests and benchmark | Root catalogue tests and `benchmarks/catalog-loading.cjs`; actual Pixi/preview boundaries |

All source is MIT-licensed; the imported license, original authorship/history and
fixture provenance remain available. This port deliberately retains Orrery's
historical default instead of adopting Orrery3D PR31's app-only default rollout.
