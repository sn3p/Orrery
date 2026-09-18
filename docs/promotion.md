# Release and rollback

PR74 promoted the unified Pixi/Three app to root. Its merged Pages release was
verified on September 16, 2026: all 38 deployed files matched the artifact;
Chromium, Firefox and WebKit passed live startup, chronology, switching, reverse
and reload checks in both modes. Retired preview entries returned 404.

## Current public build

- `/` starts Pixi; `/?renderer=three` starts Three. Assets resolve relative to
  the deployment base, including `/Orrery/` on Pages.
- `/next`, `/next/` and `/next/index.html` remain retired, without forwarding.
- The build publishes one application with lazy renderer chunks. Historical
  catalogue payloads, legacy bundles, preview assets and frozen compatibility
  snapshots are not part of the site.
- Cached PR73 documents can no longer load their removed dependencies. Open
  `/` or `/?renderer=three` to load the current application; reloading a retired
  preview URL still returns 404. Current missing-chunk guidance and Pixi recovery
  remain available.
- Configured builds publish verified data and explicitly retained pins only
  under root `data/`. Atomic replacement, input protection and the 900 MB site
  budget remain enforced. Use `npm run build` or its `build:next` alias;
  direct configured invocation of `webpack.build.config.js` fails before cleaning.
- `serve` and `serve:next` use the root application. `watch` retains current
  root chunks and catalogue pins, removes old payloads and rejects clean overrides.
  Avoid simultaneous writers to the same output.

Generated `dist/` is ignored. Source fonts and their license remain in `src/fonts/`
and are emitted by the app build. A clean checkout requires a build or dev server.

## Verification and release

Before merging, run build, Node, browser and history checks. Cover actual
root/subpath entries, both renderers, lazy errors/recovery, catalogue failures,
configured sources, development/HMR and responsive layouts. Review the complete
change and independent findings. PRs are drafts by default; merge/release requires
explicit approval. After release, verify the actual deployed files and both modes.
A merged commit or successful Pages workflow alone is not live acceptance.

## Rollback

Keep known-good source, lockfile, complete site and SHA-256 inventory independently
of expiring CI artifacts. Verify retained bytes before restoring them. PR73's
pre-promotion baseline is `2b2326e330d729da194f3fa38cb24fc60f9cf94d`; the accepted
PR74 baseline is `d378c28a3b5b1dae58de0264cd8c6ab6a3a04ed6`.

Use a **fresh branch/workspace** for any rollback. Revert the relevant change while
preserving separately accepted intervening work, build and verify both renderer
entries, then obtain explicit merge/release approval. Never reuse a merged PR
branch or silently overwrite later master changes. The normal Pages workflow can
rebuild a pinned source checkout with `npm ci && npm run build -- --output-clean`;
a retained artifact can also be served separately for local verification.

## Retained history and verification

The exact historical 100k catalogue remains a compressed, attributed
[test fixture](../tests/fixtures/historical100k/README.md); benchmark hashes cover
its decompressed bytes. Attributed
[independent Three shader/numerical references](../tests/fixtures/three-reference/README.md)
support GPU, pixel, interaction, upload and recovery checks. Relevant licenses,
provenance and original imported Git commits remain available, while historical
rollback checkouts and artifacts stay independent of current fixture builds.
