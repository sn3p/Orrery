# Independent Three verification references

Test-owned extraction from MIT-licensed [Orrery3D at
93a3e1f4a36d8fdceb513bdfdca20beddb3348d6](https://github.com/sn3p/Orrery3D/tree/93a3e1f4a36d8fdceb513bdfdca20beddb3348d6).
[LICENSE](LICENSE) retains the original copyright and permission notice.
[manifest.json](manifest.json) records original paths, original SHA-256 hashes,
and extracted file hashes. The original source is also reachable in Orrery's
preserved Git ancestry; see [history](../../../docs/history/orrery3d.md).

- `Orbit.js`: source numerical constructor, helpers and position methods unchanged;
  removed only the unused Three import, J2000 import and track-rendering methods.
  It imports its own pinned `constants.js`, never production orbital calculations.
- `constants.js` and `LICENSE`: byte-identical copies.
- `shader.js`: source assertions, tolerances, independent near-parabolic bisection,
  transform-feedback readback and CPU-reference Points pixel checks unchanged.
  Only imports change: actual production Asteroids/GLSL and catalogue preparation
  are subjects under test; expected positions use the independent local Orbit.
  Preserve this separation when production calculations change.

The completed source-port exact-canvas comparison no longer needs a second
application build. Production scene checks retain desktop/portrait/landscape,
DPR1/2, sparse/start/dense/reverse, independent discovery counts, exact reverse
return, screenshots, layout and keyboard focus. The independent CPU/GPU rendered
comparison, upload budgets, interactions and graphics-failure/recovery tests remain.
This is deliberate retirement of migration equality, not a frozen visual baseline
for future presentation changes.

No font or catalogue is copied here. Rendered checks use current root fonts with
[src/fonts/OFL.txt](../../../src/fonts/OFL.txt) and the unchanged attributed
[historical100k fixture](../historical100k/README.md). Imported historical font/data
notices remain available at the immutable source revision above; their original
provenance is not rewritten by removal of the current-tree snapshot.
