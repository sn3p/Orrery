# Browser tests

Orrery uses `@playwright/test` for browser selection, test lifetimes, sharding,
timings and reports. Existing numerical and lifecycle assertion helpers remain
the source of the checks. Stateful recovery sequences stay in one test; named
steps expose their timings without changing the state being exercised.

## Run locally

```sh
npm ci
npx playwright install chrome firefox webkit
npm test
```

`npm test` builds the site, runs build/Node regressions, prepares browser fixtures
and executes all browser projects. `npm run test:browser` assumes the production
site is already built, but prepares fresh fixtures automatically. `BROWSERS`
can select a subset, for example `BROWSERS=chromium npm test`.

After building the site, examples include:

```sh
npx playwright test --list
npx playwright test --project=firefox
npx playwright test --project=webkit --shard=1/4
npx playwright test --project=chromium-only
npx playwright show-report .context/playwright-report
```

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
| `chromium`, `firefox`, `webkit` | Actual root/nested deployment, preview entry/lazy assets, raw legacy/preview parity, both apps' GPU/rendering/options/DPR/benchmark-frame checks, catalogue loading/lifecycle/frame-commit recovery, and Three source parity/numerics/entry/camera/recovery |
| `chromium-only` | Both apps' scheduling, typography and benchmark CLI checks; legacy/preview and configured catalogue development commands; catalogue benchmark completion for Pixi and Three; Three configured development/HMR; ordinary-clone benchmark provenance; runner failure/cleanup diagnostics |
| Standalone configuration | Raw parity and the complete unified-app subset above, against a freshly built preview |

The browser projects retain strict orbital/pixel assertions, WebGL2 preflight,
100k data, reload/error/recovery/disposal scenarios and viewport/DPR cases. The
Chromium GPU case also exercises WebGL1. CLI benchmark checks run in Chromium
because the benchmark command itself uses Chromium; browser frame contracts
remain covered in all three engines. Scheduling and typography also retain their
original Chromium scope, without repeating identical work in Firefox/WebKit jobs.

Individual `node tests/<suite>.cjs` commands remain available for existing local
diagnostics. The default and standalone npm commands use the native test runner.

## Builds and CI

The build job finishes build-isolation and Node tests before uploading anything:
these checks can temporarily replace `dist`. It then builds each distinct
legacy/unified fixture entry once, including the unaliased parity fixture and
the lazy CSS/JSON probe and six catalogue variants (indexed/whole tied and empty
data, latest descriptor, and historical data). Three additionally has a pinned
source-renderer fixture and an instrumented real lazy preview entry, whose
numerical oracle executes the adapted production cloud/shader. The latest fixture uses a reserved
test origin that each lifecycle test forwards to its own local server, so prepared
assets contain no ephemeral port. Browser jobs download this fixture artifact and the
exact assembled Pages artifact from the same run.

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

CI has two shards each for Chromium and Firefox, four for WebKit, one
Chromium-only job and one clean-checkout preview job. WebKit has more shards
because it was the slowest engine in the first hosted run. The preview job starts
alongside the build because it consumes no prepared artifacts. It verifies
`dist/next` is absent before
`npm run test:unified`; it assembles the preview and its fixtures locally and runs
the full standalone subset. Chrome channel and Xvfb/Mesa launch settings are
preserved. Deployment requires the build and every matrix entry to succeed.

Each test job uploads a uniquely named blob report, plus JSON, screenshots
and failure traces. A report job merges them into the `browser-test-report`
artifact even when tests fail. A merged report is diagnostic; the underlying
test jobs remain the deployment gate. Hosted duration and cost must be measured
after running this workflow; local timings do not predict software-rendered CI.
