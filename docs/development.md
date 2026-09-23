# Development

Setup, test and contribution details behind the README's short version.

## Node.js and commands

Use Node.js 24.15.0 or later in the 24.x release line (recommended, `.tool-versions`
pins 24.19.0), 22.22.3 or later in the 22.x line, or 26.0.0 or later.

```bash
npm ci               # locked dependencies
npm run serve        # development server
npm run build        # production build and bundle
npm run watch        # rebuild on changes
```

The unified app runs at `/`, with Three.js by default and Pixi at `/?renderer=pixi`.
`?date=YYYY-MM-DD` (UTC) starts paused on that day; combine as
`/?date=2005-05-03` or `/?renderer=pixi&date=2005-05-03`. Invalid dates are ignored. The old `/next` entry
is removed. `npm run serve` uses `CONDUCTOR_PORT` when set,
otherwise 3000. `serve:next` and `build:next` remain aliases for the main app.
Production builds emit only the unified application; retired root and preview
payloads are no longer deployed. See [catalogue loading](catalog-loading.md), the
[current architecture](architecture.md) and the [release/rollback procedure](promotion.md).

## Tests

Install the test browsers, then run numerical, production browser and benchmark checks:

```bash
npx playwright install chrome firefox webkit
npm run test:pr  # everyday checks
npm test         # complete regression matrix
```

These checks cover GPU orbit accuracy, discovery markers, playback, catalogue
replacement, context recovery, development hot updates, font loading and
desktop/mobile layout. Playwright Test reports individual cases and lifecycle
steps. Results, screenshots and failure traces are saved in
`.context/playwright-results/`; open the HTML report with
`npx playwright show-report .context/playwright-report`.

The default browser suite checks current production pixels, numerics, lifecycle
and options in Chromium, Firefox and Playwright WebKit. `npm run test:unified`
builds the public app and runs two clean-checkout smoke cases, one per renderer.
CI runs Chromium core and affected checks plus Firefox/WebKit smoke on ordinary
changes; exhaustive graphics/benchmark checks and the full matrix run nightly or
manually. For a local Chrome-only pass, use `BROWSERS=chromium npm test`. See
[browser tests](browser-tests.md) for scope, groups, shards and fixture builds.
Playwright WebKit does not substitute for testing actual Safari or iOS.

Test the Conductor setup script with Python 3.11 or later:

```bash
python3 -m unittest discover -s tests -v
```

## Historical test data

The public app reads the catalogue published by [orrery-data](https://github.com/sn3p/orrery-data).
Tests and benchmarks use an immutable [historical 100k fixture](../tests/fixtures/historical100k/README.md).
It retains the original catalogue bytes, compressed in the repository with source
provenance and a verified SHA-256. Test builders decompress it to an asynchronous
JSON resource; it is never included in the production site. The old local importer
and `npm run setup` have been retired. Data updates belong to the producer.

On 12 September 2026, a full import of fresh MPC data produced 895,910 objects from
1,563,495 orbital records. Unnumbered objects lacked matching discovery records in
`NumberedMPs.txt` and were excluded; these are historical counts, not current
coverage guarantees. See [issue #47](https://github.com/sn3p/Orrery/issues/47).

## Conductor

Setup installs the locked dependencies with `npm ci`. When asdf is installed, it adds
the Node.js plugin if needed and installs the version pinned in `.tool-versions`.
Run starts the development server on the workspace's assigned port; use Open to
view the app. Each workspace can run its own server concurrently.

## Fonts

The UI uses self-hosted [JetBrains Mono Variable](../src/fonts/README.md),
distributed with its SIL Open Font License.

## Writing copy and pull requests

Visible text stays short but complete: purpose, behaviour and usage in a few
sentences, with depth moved into these docs and linked. Preserve meaning when
shortening. Status strings in `src/unified/App.js` are asserted by tests; keep them
in sync when rewording.

Pull request bodies follow the same rule, one or two lines per heading:

```markdown
## Purpose
Why the change exists and what the user sees differently.

## Behaviour
What changed, including defaults and anything persisted.

## Verification
Commands run and their results; anything not verified.

## Limits
Known gaps, follow-ups and decisions left open.
```
