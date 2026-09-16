# Temporary PR73 assets

`pr73-main.css` is the unmodified `next/assets/main.ee865e1e.css` from PR73
(`2b2326e330d729da194f3fa38cb24fc60f9cf94d`), retained for cached HTML while the
current application receives UI updates. Its SHA-256 is recorded and checked in
`tests/fixtures/promotion/pr73-hashes.json`. It contains the app's MIT-licensed CSS;
font attribution remains in `src/fonts/OFL.txt`.

This is a frozen build artifact, not a maintained theme. Remove it and its emission
with cached-page compatibility cleanup after promotion acceptance.

`pr73-assets/*.js.gz` retains the three original scripts whose hashes changed
with the Pixi texture lifecycle fix: the main entry, Pixi adapter, and shared
Pixi chunk. They come from the same PR73 build and are stored losslessly
compressed; `PromotionAssetsPlugin` emits the original uncompressed bytes at
their original URLs. The existing promotion hash inventory verifies all three.
They include the original application and bundled dependency code, with the
same licenses and provenance as the PR73 build and its lockfile. The promoted
root uses current scripts. Remove these snapshots with the stylesheet during
cached-page compatibility cleanup.
