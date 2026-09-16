# Root promotion and rollback

This review unit promotes the shared Pixi/Three app after polish PR73
(`2b2326e330d729da194f3fa38cb24fc60f9cf94d`). Merging to master triggers the
Pages release. A draft PR or local verification is not release approval.

## Entries and compatibility

- `/` starts Pixi; `/?renderer=three` starts Three. Existing unknown-renderer
  fallback, source errors, retry, date/count and switching behavior remain.
- `/next`, `/next/` and `/next/index.html` have no public page or forwarding to the app;
  they return 404 (a static host may first normalize `/next` to `/next/`). Open `/` or `/?renderer=three` directly.
- Assets use the HTML/script deployment base, including `/Orrery/` on Pages.
- Keep PR73's root `bundle.js`, `main.css`, fonts and historical catalogue bytes,
  and its `/next/` JS/CSS/font paths, until promoted-release acceptance. Cached
  documents and open sessions can finish loading their old code and data.
  Configured builds stage current and explicitly retained data pins at both root
  and old preview paths. They also compile the default PR73 asset set: cached
  PR73 HTML keeps its original latest source; opening the root selects the new profile.
  Reloading an old preview URL or using its old recovery link returns 404, so
  cached preview users must navigate to `/` or `/?renderer=three` explicitly.
  The 900 MB site budget includes all compatibility assets and data copies.
- New visits receive the unified root; its source never falls back to historical
  data. The temporary “Open Pixi preview” recovery label is retained. Current CSS has
  separate HUD, label, value and help colors; the original compiled PR73 stylesheet
  and scripts with changed hashes are frozen in `src/unified/compat/` for cached
  HTML and removed during cleanup. The current Pixi adapter releases texture
  bindings before replacing or destroying their source.
  Missing lazy chunks show existing recovery guidance; reload obtains current
  HTML, and Three failures also provide a Pixi recovery link.

`npm run build` and `build:next` assemble the same complete `dist/` site.
`serve` and `serve:next` serve the main application; `watch` rebuilds that app.
Generated root HTML and hashed chunks are ignored, rather than committing HTML
that references absent generated files. The older tracked legacy assets remain
until cleanup; a fresh checkout needs a build or the development server.
Configured builds retain their atomic publication and input-protection checks.
Use `npm run build` or `build:next` for configured production output; direct
configured invocation of `webpack.build.config.js` is rejected before cleaning.
Do not run multiple builds/dev writers against the same output simultaneously.

## Before release approval

1. Run build/Node/browser/history tests, including production root/Pages URLs,
   both engines, removed preview entries and root query behavior, cached PR73 assets, missing chunks,
   source failures/retry, development/HMR and polish layouts.
2. Retain the complete PR73 site and its SHA-256 inventory outside the workspace
   and independently of expiring CI artifacts. Keep the source commit and lockfile.
   Verify the retained files before using them.
3. Restore that artifact into a separate directory and serve it. Verify its legacy
   root and both original `/next/` modes, including their data/asset paths. Keep the
   result separate from candidate verification.
4. Review the complete diff and independent findings. Publish as a draft. Request
   release approval only after the candidate and rollback are concrete and verified.

## Release and recovery

After explicit release/merge approval, merge the reviewed PR and verify the deployed
root, both mode URLs, retired `/next` entries and a stale session against the live site.
Do not infer live acceptance from local tests, merged source or a Pages job alone.

If rollback is needed, use a **fresh branch and workspace** to revert the promotion
merge, preserving PR73 and any separately accepted intervening changes. Build and
verify the restored legacy root and original preview entries, then obtain explicit
approval for the rollback merge/release. The normal Pages workflow rebuilds that
source; it does not rely on finding an old Actions artifact. A retained site can
also be restored for local verification without fetching or building dependencies.
Do not reuse a merged promotion branch or silently overwrite later master changes.

The source baseline can be reconstructed in a separate checkout at the pinned
PR73 commit with `npm ci && npm run build -- --output-clean`. Compare its complete
inventory to the retained artifact before considering it an exact restoration.

## Later cleanup

After accepting the live promoted release, planned unit 7 removes obsolete legacy
code, preview build plumbing and cached-page compatibility assets. Audit the old
100,000-row dataset, importer/build inputs, tests, benchmarks and provenance before
removing or moving them. Explicitly document any retained test fixture. Preserve
rollback evidence and original imported Git ancestry. Orrery3D's move notice is a
separate review unit; repository archival requires its own approval.
