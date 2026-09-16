# Orrery3D history import (H)

H preserves the original history from [sn3p/Orrery3D](https://github.com/sn3p/Orrery3D)
before the loader and Three ports. It imports reviewed master
[`93a3e1f4a36d8fdceb513bdfdca20beddb3348d6`](https://github.com/sn3p/Orrery3D/commit/93a3e1f4a36d8fdceb513bdfdca20beddb3348d6),
the merge of [PR31](https://github.com/sn3p/Orrery3D/pull/31), using
`git subtree add` without `--squash`. The [machine-readable record](orrery3d.json)
contains all 147 original reachable commit IDs, the exact source tree, the
destination base, the import commit and the observed remote branch/tag inventory.

The original commits retain their IDs, authors, committer metadata, dates,
messages, parents and historical paths. The new import commit places the exact
127-file source tree under `migration/orrery3d/` at
[the immutable import commit](https://github.com/sn3p/Orrery/tree/b12a407e26e96b49e4a2a8343ce5ac387dcb67ba/migration/orrery3d).
Its [MIT license](https://github.com/sn3p/Orrery/blob/b12a407e26e96b49e4a2a8343ce5ac387dcb67ba/migration/orrery3d/LICENSE), font license and fixture
provenance remain intact in that historical tree. Original GitHub PRs, issues, discussions and releases
remain in Orrery3D; this import does not transfer those records or archive it.

H merged through [PR67](https://github.com/sn3p/Orrery/pull/67) as
`e1e80ec00a23ba7d2d99e3df625d512ec3486a41`. A fresh ordinary full master clone
verified all 147 original commits, the exact snapshot and original ancestry.
PR3 adopts selected files through the [active catalogue mapping](../catalog-loading.md#adopted-source-and-provenance);
unit 7c removes the current-tree snapshot after extracting the
[independent Three test references](../../tests/fixtures/three-reference/README.md).
The original import tree and all 147 original commits remain reachable.

## Current source boundary

There is one maintained application, root package and lockfile. Unit 7c removes
all 127 imported snapshot files, including its inactive package, workflow,
compiler, app and duplicate assets. No production code imports that directory.
The source-port exact-canvas comparison is deliberately retired after the port;
independent numerical/GPU/pixel references and current production scene,
interaction, upload, lifecycle and recovery checks remain test-owned.

The extracted reference license is retained alongside its source/hash manifest.
Current root fonts retain their OFL notice; the historical100k and producer
fixtures retain their data attribution. Historical notices and the import JSON
are unchanged. `tests/history-import.cjs` and the history workflow continue to
check the original import commit, independently of HEAD's file layout.

## Other refs

At capture there were seven remote branch heads and no remote tags. The record
lists each head and how many of its commits are outside imported master.
Only master ancestry is joined to Orrery. Experimental branches and generated
`gh-pages` history are not adopted as application behavior.

All seven remote heads and 28 observed local source heads were additionally
retained in a verified, self-contained Git bundle in the local durable migration
records. The complete local inventory, bundle SHA-256 and verification evidence
are in the implementation handoff. This Mac-local backup is separate from this
repository and does not make those other refs ancestors of Orrery master.
The original repository remains the public home of its other branches. Preserve
any later source commits before adopting their changes in PR3/PR4.

## Verify and merge

From a full checkout, with Node matching `.tool-versions`:

```sh
node tests/history-import.cjs
# Also verify a particular target after fetching it:
node tests/history-import.cjs origin/master
```

The verifier checks every recorded commit's object ID and reachability, original
import parents, the exact historical snapshot tree and the import-only boundary.
It rejects shallow clones and targets that lost the original import ancestry.
It checks the snapshot at the recorded import commit, so later deliberate moves
and cleanup can change current files without erasing their preserved history.

H must land using **Create a merge commit**, only when explicitly authorized.
Do not squash, rebase, flatten or recreate its import commit. Keep the original
two-parent subtree commit reachable from the PR head. A passing PR check cannot
prove the eventual merge method: after merging, clone Orrery afresh, check out
master and run the verifier there. PR3 starts only after that gate passes.

Before publishing H, compare all root/preview build files against the pre-import
baseline in the same environment and run the existing build, numerical, browser
and ordinary-clone benchmark regressions. The history verifier does not replace
those application checks or certify the future functional ports.

Historical commits keep their original root-relative paths. Local Git history
can inspect them directly using their recorded IDs. GitHub's automatic file
history/blame traversal across the prefix addition and later moves is a separate
UI behavior; do not assume that preserving ancestry guarantees that traversal.
For the imported loader, local `git log --follow` returned no entries at the new
path. Its original history is accessible explicitly:

```sh
git log 93a3e1f4a36d8fdceb513bdfdca20beddb3348d6 -- src/js/catalog/CatalogLoader.js
```

The GitHub commits API reports the import commit for the prefixed path and the
original history for the original pin/path. Automatic cross-prefix traversal is
not promised.
