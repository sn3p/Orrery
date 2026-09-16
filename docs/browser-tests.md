# Browser tests

Orrery uses `@playwright/test` for browser selection, test lifetimes, sharding,
timings and reports. Existing numerical and lifecycle assertion helpers remain
the source of the checks. Stateful recovery sequences stay in one test; named
steps expose their timings without changing the state being exercised.

## Choose a test scope

```sh
npm ci
npx playwright install chrome firefox webkit
npm run test:pr       # build, fast Node tests, Chromium core + all-engine smoke
npm run test:unified  # fresh public build + just two clean-checkout smoke cases
npm test             # complete build/Node/browser suite, including legacy oracles
```

`npm run test:browser` retains the complete native suite by default. After a
production build, select additional groups explicitly:

```sh
ORRERY_TEST_GROUPS=core,ui npx playwright test
ORRERY_TEST_GROUPS=core,graphics,data npx playwright test
ORRERY_TEST_GROUPS=full npx playwright test --project=webkit --shard=1/4
npx playwright test --list
npx playwright show-report .context/playwright-report
```

The core selection has **24 executions**: 19 Chromium production/functional
checks, one Chromium scheduling check, and two public-renderer smoke cases each
in Firefox and WebKit. CI's separate clean-checkout job adds two more, for **26**.
The complete browser selection has **128 executions**, preserving all 119
original cases and adding six smoke and three representative parity executions.
The old 33-case standalone repeat is replaced by two independent smoke cases.

| Group | Coverage |
| --- | --- |
| `core` | Chromium public assets/layout/lazy loading, two exact legacy/production pixel comparisons, indexed data loading/recovery/frame commits, renderer switching, Three entry/data/recovery/lifecycle, unified scheduling |
| Smoke (always selected) | Both public renderers in every selected engine: startup, real keyboard control, small verified indexed catalogue, DPR, graphics-context recovery, reverse playback and reload |
| `ui` | Public responsive/keyboard/loading states, unified rendering/readouts/options/DPR/texture tests, renderer switching, Chromium typography |
| `graphics` | Both legacy and unified GPU/rendering/DPR/benchmark-frame suites, full 74-comparison parity, Three source/numerical parity, graphics recovery, scheduling and benchmark CLI checks |
| `data` | Catalogue transport/commit/recovery, both renderer data paths, catalogue CLI benchmarks/development and relevant loading/switching behavior |
| `build` | Public root/retired payloads/configured promotion, real CLI and ordinary-clone provenance checks |
| `dev` | Real watch/HMR/development entry points and runner failure diagnostics |
| `full` | Every original native case plus the new smoke/compact parity checks in all applicable engines |

Use `BROWSERS=chromium` for an explicit local engine subset. Standalone always
uses Chrome independently of this variable. No group changes assertion tolerances
or adds retries. Full-size numerical/scale checks remain intact in the extended
suite; everyday public-entry smoke uses a small, hash-valid indexed fixture.
Pure numerical Node tests still run for every code change.

Every shard of a sharded run is required for complete coverage. The worker count
is one: these tests exercise substantial WebGL workloads, with CPU software
rendering on CI. Separate machines supply parallelism. Native Playwright contexts
are closed at the end of every case; output directories are unique per case,
project and retry. Failed assertions fail the job; automatic retries are disabled.

Options controls, display resolution and texture recovery are independent cases
with separate timeout budgets. Stateful transitions inside each case remain
together. This avoids consuming one case's timeout across three unrelated pages.

Failure traces retain actions, sources and attachments. Continuous screencasts
and per-action DOM snapshots are disabled because they add substantial overhead
to software-rendered WebGL tests; failure screenshots and explicit visual checks
are still retained. Use `npx playwright test --project=webkit --grep 'texture recovery'
--trace on` to record a full visual trace for a targeted investigation.

## Coverage ownership

| Project | Checks |
| --- | --- |
| `chromium`, `firefox`, `webkit` | Actual promoted root/nested deployment, removed preview entry, absence of retired payloads, missing chunks/lazy assets, default indexed Pixi/direct Three startup and retained switching, raw legacy/preview parity, both apps' GPU/rendering/options/DPR/benchmark-frame checks, catalogue loading/lifecycle/frame-commit recovery, Three source parity/numerics/entry/camera/recovery, and in-page renderer switching with retained data, faults, views, options and resource checks |
| `chromium-only` | Both apps' scheduling, typography and benchmark CLI checks; legacy/preview and configured catalogue development commands; catalogue benchmark completion for Pixi and Three; Three configured development/HMR; ordinary-clone benchmark provenance; runner failure/cleanup diagnostics |
| Standalone configuration | Two public-renderer smoke checks against a fresh promoted build, without prepared browser fixtures |

The browser projects retain strict orbital/pixel assertions, WebGL2 preflight,
explicit 100k whole-file oracles, indexed fixtures, reload/error/recovery/disposal
scenarios and viewport/DPR cases. Public default-entry checks intercept the actual
compiled producer URL with hash-valid deterministic fixtures; live catalogue
verification records its observed pin and coverage separately. The
Chromium GPU case also exercises WebGL1. CLI benchmark checks run in Chromium
because the benchmark command itself uses Chromium; browser frame contracts
remain covered in all three engines. Scheduling and typography also retain their
original Chromium scope, without repeating identical work in Firefox/WebKit jobs.

Individual `node tests/<suite>.cjs` commands remain available for existing local
diagnostics. The default and standalone npm commands use the native test runner.

## Builds and CI

The planner reads the real PR merge-base diff or push range, including both
sides of renames and deleted paths. It never relies on a remembered label:

- CSS/fonts/public HTML and unified HUD/options changes add `ui`.
- Legacy GUI or dat-gui CSS changes also select their legacy graphics/UI checks.
- Public entry/routing changes and removed compatibility assets add UI/build/development and build integrations.
- Catalogue implementation/profiles/data changes add `data,build` and build integrations.
- Other existing JS/renderer changes add `graphics,ui,data`.
- Benchmark changes add graphics/build/development and build integrations.
- Unknown files, dependency/lockfile, tests, CI and build configuration/scripts
  select `full`, as does an unavailable or untrustworthy Git range.
- Explicit documentation-only changes skip expensive jobs; the aggregate `CI`
  check still verifies that only planned jobs were skipped.
- Scheduled nightly and manually dispatched runs always select `full`.

Fast Node validation, artifact production, conditional build/CLI integrations,
and clean-checkout smoke run in separate checkouts. Build tests may mutate their
own `dist` without delaying or altering the browser artifact. The artifact job
builds only fixture variants needed by the selected groups; the core reuses raw
parity, legacy asset-boundary, lazy probe, catalogue, Three and unified scheduling fixtures, omitting
legacy/unified GPU/benchmark fixtures. Broad graphics/build/development selections
prepare all variants. Each variant is built once and copied privately by tests.

`ORRERY_PREBUILT_FIXTURES` selects the prepared fixture directory. Its manifest
checks source identity (including provisioning scripts, catalogue profiles and
the imported source files used by Three verification)
and asset hashes; missing, stale, corrupt or wrong-variant
fixtures fail without falling back to a local compilation. Writable copies are
made in each test's output directory. Fixture production entries intentionally
differ from the public lazy preview, which has its own deployment tests.

HMR, build-isolation and ordinary-clone provenance tests keep their real builds.
The ordinary-clone test clears prepared-fixture configuration and confirms
generated test output does not dirty the source checkout. Fixture builds and
Playwright reports are ignored by Git in ordinary clones too.

## Workflow gates and runtime budget

Core runs use two Chromium shards, one Firefox, one WebKit and one
Chromium-only job. Expanded selections retain two Chromium/two Firefox/four
WebKit shards. The clean-checkout job independently builds the public site and
runs its two smoke cases without global fixture setup or a download.

The aggregate `CI` check requires every selected job to succeed. A missing,
failed, cancelled or unexpectedly skipped job fails that gate. Deployment waits
for it and the site artifact. Pushes to master and explicit manual deployment
can publish; the nightly run only verifies. PR updates cancel obsolete work for
that PR; production runs retain their queue. Documentation changes do not launch
a deployment.

Each browser job uploads a unique blob report, JSON evidence, screenshots and
failure traces. The report job merges available reports even after test failure;
it is diagnostic rather than a replacement for the test/deployment gate.

The ordinary PR budget is **3–5 minutes as a target, not a measured guarantee**.
Changes to shared renderer or infrastructure code intentionally run more checks.
Selection reduces repeated execution; it does not establish that every browser
combination was tested before every merge. Nightly failures need prompt triage.
New tests should identify the unique regression boundary they cover; large
parameter matrices belong in the relevant extended group. Inspect native step
and job durations when any new case exceeds roughly 30 seconds. Keep stateful
recovery sequences together, and split independent checks before adding shards.
