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
npm test             # complete build/Node/browser suite, including historical data and independent Three oracles
```

`npm run test:browser` retains the complete native suite by default. After a
production build, select additional groups explicitly:

```sh
ORRERY_TEST_MODE=pr ORRERY_TEST_GROUPS=core,ui npx playwright test
ORRERY_TEST_GROUPS=core,graphics,data npx playwright test
ORRERY_TEST_GROUPS=full npx playwright test --project=webkit --shard=1/4
npx playwright test --list
npx playwright show-report .context/playwright-report
```

The core selection has **27 executions**: 22 Chromium production/functional
checks, one Chromium-only scheduling check, and two public-renderer smoke cases
each in Firefox and WebKit. CI's separate clean-checkout job adds two more, for
**29**. Routine CI's all-groups selection has **43 executions**, plus the two
independent clean-checkout cases. Even a test/configuration change uses this
budget; narrower affected groups select fewer Chromium cases. The complete
browser selection retains **115 executions** (or **117** including the separate
clean-checkout job).
The old 33-case standalone repeat is replaced by two independent smoke cases.

| Group | Coverage |
| --- | --- |
| `core` | Chromium public assets/layout/lazy loading, two representative production scenes and lifecycle recovery, indexed data loading/recovery/frame commits, renderer switching, Three entry/data/recovery/lifecycle, unified scheduling |
| Smoke (always selected) | Both public renderers in every selected engine: startup, real keyboard control, small verified indexed catalogue, DPR, graphics-context recovery, reverse playback and reload |
| `ui` | Public responsive/keyboard/loading states, unified rendering/readouts/options/DPR/texture tests, renderer switching, Chromium typography |
| `graphics` | Production GPU/rendering/DPR/benchmark-frame suites, full 74-scene/recovery checks, Three scenes and independent numerical/pixel checks, graphics recovery, scheduling and benchmark CLI checks |
| `data` | Catalogue transport/commit/recovery, both renderer data paths and relevant loading/switching behavior; catalogue benchmarks are extended |
| `build` | Public root/retired payloads/configured promotion, real CLI and ordinary-clone provenance checks |
| `dev` | Real watch/HMR/development entry points, including configured catalogues, and runner failure diagnostics |
| `extended` | Full scene matrices, GPU numerical sweeps, benchmark frame/CLI/catalogue suites and ordinary-clone benchmark/HMR provenance; excluded from routine PR mode |
| `full` | Every retained native case plus the smoke/compact scene checks in all applicable engines |

Use `BROWSERS=chromium` for an explicit local engine subset. Standalone always
uses Chrome independently of this variable. No group changes assertion tolerances
or adds retries. Full-size numerical/scale checks remain intact in the extended
suite; everyday public-entry smoke uses a small, hash-valid indexed fixture.
Pure numerical Node tests still run for every code change.

`ORRERY_TEST_MODE=pr` applies the routine budget: Chromium runs core plus selected
groups, Firefox/WebKit run public smoke only, and `@extended` cases are omitted.
The default mode is `full`, preserving exhaustive local `npm test` and
`npm run test:browser` behavior. Group selection and execution mode are separate:
`ORRERY_TEST_GROUPS=full ORRERY_TEST_MODE=pr` runs every routine group, not the
exhaustive matrix. No test or assertion is deleted.

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
| `chromium`, `firefox`, `webkit` | Actual promoted root/nested deployment, removed preview entry, absence of retired payloads, missing chunks/lazy assets, default indexed Three.js startup, direct Pixi startup and retained switching, raw App lifecycle and scene/recovery checks, current production GPU/rendering/options/DPR/benchmark-frame checks, catalogue loading/lifecycle/frame-commit recovery, Three scenes/numerics/entry/camera/recovery, and in-page renderer switching with retained data, faults, views, options and resource checks |
| `chromium-only` | Current production scheduling, typography and benchmark CLI checks; promoted and configured catalogue development commands; catalogue benchmark completion for Pixi and Three; Three configured development/HMR; ordinary-clone benchmark provenance; runner failure/cleanup diagnostics |
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
- Dat-gui CSS changes also select graphics/UI checks.
- Public entry/routing changes and removed compatibility assets add UI/build/development and build integrations.
- Catalogue implementation/profiles/data changes add `data,build` and build integrations.
- Other existing JS/renderer changes add `graphics,ui,data`.
- Benchmark changes add graphics/build/development and build integrations.
- Unknown files, dependency/lockfile, tests, CI and build configuration/scripts
  select all groups within the routine budget, as does an unavailable or
  untrustworthy Git range. They do not turn a PR into a nightly run.
- Explicit documentation-only changes skip expensive jobs; the aggregate `CI`
  check still verifies that only planned jobs were skipped.
- PRs and pushes use routine mode; scheduled nightly and manually dispatched
  runs always select full mode and all groups.

Configured catalogue HMR belongs to `dev`, not the browser `data` group. Entry,
build/configuration and unknown changes still select it; catalogue-only changes
retain browser transport/commit tests and Node/CLI integrations. The complete HMR
matrix also runs nightly/manual.

Fast Node validation, artifact production, conditional build/CLI integrations,
and clean-checkout smoke run in separate checkouts. Build tests may mutate their
own `dist` without delaying or altering the browser artifact. The artifact job
builds only fixture variants needed by the selected groups; the core reuses raw
App scene/recovery, historical asset-boundary, lazy probe, catalogue, Three and
unified scheduling fixtures, omitting GPU/benchmark fixtures. Routine UI/graphics
selections add the
initialization fixture; exhaustive selections prepare all variants. Each variant
is built once and copied privately by tests.

`ORRERY_PREBUILT_FIXTURES` selects the prepared fixture directory. Its manifest
checks source identity (including provisioning scripts, catalogue profiles and
the test-owned independent Three reference files)
and asset hashes; missing, stale, corrupt or wrong-variant
fixtures fail without falling back to a local compilation. Writable copies are
made in each test's output directory. Fixture production entries intentionally
differ from the public lazy preview, which has its own deployment tests.

HMR, build-isolation and ordinary-clone provenance tests keep their real builds.
The ordinary-clone test clears prepared-fixture configuration and confirms
generated test output does not dirty the source checkout. Fixture builds and
Playwright reports are ignored by Git in ordinary clones too.

## Workflow gates and runtime budget

Every routine code run uses two Chromium shards, one Firefox smoke job, one
WebKit smoke job and one Chromium-only job: five browser jobs even for changes
to tests or CI itself. Nightly/manual full runs retain two Chromium/two Firefox/
four WebKit shards plus Chromium-only. The clean-checkout job independently
builds the public site and
runs its two smoke cases without global fixture setup or a download.

The aggregate `CI` check requires every selected job to succeed. A missing,
failed, cancelled or unexpectedly skipped job fails that gate. Deployment waits
for it and the site artifact. Pushes to master and explicit manual deployment
can publish; the nightly run only verifies. PR updates cancel obsolete work for
that PR; production runs retain their queue. Documentation changes do not launch
a deployment.

Each browser job uploads a unique blob report, JSON evidence, screenshots and
failure traces. HTML is generated once centrally in CI. The report job merges
available reports even after test failure;
it is diagnostic rather than a replacement for the test/deployment gate.

The ordinary PR budget is **under three minutes as a target, not a measured
guarantee**. The prior PR78 full run took about nine minutes and 46 combined
runner-minutes; these are baseline observations, not savings from this policy.
Changes to shared renderer or infrastructure code select more Chromium checks
within the routine budget.
Selection reduces repeated execution; it does not establish that every browser
combination was tested before every merge. Nightly failures need prompt triage.
New tests should identify the unique regression boundary they cover; large
parameter matrices belong in the relevant extended group. Inspect native step
and job durations when any new case exceeds roughly 30 seconds. Keep stateful
recovery sequences together, and split independent checks before adding shards.

## Deterministic buffering regression

The speed-eight diagnostic owns application frame timestamps while the next
catalogue chunk is held. It first commits a valid intermediate date, crosses the
missing-data boundary, then checks exact date/count and rendered readout retention
over several frames. Releasing the chunk restores automatic scheduling and
checks recovery/FPS. Comparing against the date before playback started was
incorrect: valid frames can advance before buffering begins. This case stays in
routine data/graphics selections on Chromium and in all three engines nightly.
