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
127-file source tree under [`migration/orrery3d/`](../../migration/orrery3d/).
Its [MIT license](../../migration/orrery3d/LICENSE), font license and fixture
provenance remain intact. Original GitHub PRs, issues, discussions and releases
remain in Orrery3D; this import does not transfer those records or archive it.

## Inactive source boundary

The imported folder is historical migration source. Run application commands
from the Orrery root; do not install, build or maintain the snapshot as another
application. There is **one active root package and lockfile**. The snapshot's
manifests, workflow, configuration and tests remain exact historical files.

| Consumer | Boundary |
| --- | --- |
| npm install and commands | Root manifest; no npm workspaces or recursive test discovery |
| Production bundles | Explicit root `src/js/index.js` and `src/unified/index.js` import graphs |
| Assets and CSS transforms | Imported root resources; fonts restricted to root `src/fonts` |
| Development servers/watch | Root `dist`, root `src/**/*` and `src/unified/**/*.html` |
| Pages | Root workflow builds and publishes only `dist`; nested snapshot workflow is inactive |
| Python tests | Explicit `unittest discover -s tests` |
| Git provenance and clone tests | Include the snapshot as repository history/source, without executing it |

No loader, Three dependency or renderer is connected in H. Root runtime,
catalogue, maintained package/lockfile, build configuration and Pages workflow
are unchanged. The separate root history workflow only verifies ancestry;
it neither installs snapshot dependencies nor changes the deployment workflow.
Whole-repository searches, Git archives and external inventory tools can still
see the snapshot; inactive does not mean hidden from every tool.

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

GitHub traversal of the unpublished import has not been checked.
