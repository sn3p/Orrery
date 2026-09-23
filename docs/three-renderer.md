# Three adapter

Open `/` for 3D. `/?renderer=pixi` opens 2D, and `/?renderer=three` still selects 3D.
`?date=YYYY-MM-DD` starts paused on that UTC day in either mode. The old `/next/` entry is removed. Both modes use the complete published
discovery catalogue. An unknown renderer falls back to Three.js with feedback.
A Three startup failure reports the failure and offers the accessible Pixi recovery
link (`Open Pixi preview`), preserving the deployment prefix. Terminal Three shader/upload/draw failures
offer the same recovery link; successful graphics recovery clears it.
Missing code and unavailable WebGL2 use
neutral reload guidance. The 2D entry does not load Three.js or require WebGL2.

## Ownership and presentation

The shared App owns date, speed, scheduler, HUD/options and catalogue. The Three
adapter owns scene resources, camera/input and restoration; it never fetches data
or schedules its own loop. The shared Renderer/Speed/planet-label/planet-orbit/groups/DPR
panel operates on the current adapter. Its renderer selector changes modes in
place without reloading or fetching retained data.
Each renderer keeps its own view for the page session, and the shared DPR choice
also lasts for that session; reload uses the entry URL (including a renderer or date
written by Options, a jump or a pause) and their existing view/DPR defaults.
Explicit planet-label choices persist in local storage and apply to both adapters.
Planet orbit lines last for the page visit and start visible again on reload. See [renderer switching](architecture.md#renderer-switching).

The source is the preserved MIT-licensed Orrery3D `93a3e1f` revision. The port
keeps its 60-degree perspective camera at `(500,500,400)`, Z-up, clipping range
`.001–2,000,000`, OrbitControls gestures, sphere bodies, dashed tracks and full
XYZ orbital bases. Points retain size 1 and fade from green to `0x999999` across
200 simulated Julian days. Newly revealed points also shrink from 3× to 1× over
two-thirds of an active playback second, using the same presentation clock as Pixi.
Load, seek and renderer switches do not replay that pulse. Group filters hide unmatched points by moving them out
of clip space and discarding them; WebGL point size cannot go below 1. Pixi still
snaps arrival colour from green to grey when the pulse ends. Choosing Jupiter Trojans dollies out when
Jupiter’s orbit is off-screen, without resetting the current viewing direction.

`Orbit`, `Planet`, `Sun` and `createSphere` retain source mechanics with local
imports. `Asteroids` retains the source shader/material and adapts CPU ownership,
bounded packing, frame rollback and GPU receipts. The current-tree imported snapshot is removed;
[history verification](history/orrery3d.md) guards its original tree and ancestry.
[Test-owned references](../tests/fixtures/three-reference/README.md) retain
independent orbital calculations and the original GPU/pixel assertions.

## Retained data and graphics commitment

Three references canonical `p`, `q` and `elements` arrays read-only. Its own
Float32 phase, discovery and arrival arrays add 12 bytes per row to the shared model's
60 bytes per row. Nominal asteroid GPU attributes use 44 bytes per row; this
excludes driver overhead, scene bodies and render targets. Parsed source objects
are not retained. Final disposal releases CPU references and GPU resources;
context loss retains CPU state for restoration.

Streamed catalogue catch-up packs at most 8,192 rows per app task, with contiguous ordered commitment.
Full-capacity allocation still occurs on the first nonempty draw. Subsequent
uploads use changed ranges. Ordinary frames change uniforms and draw range;
rebases update only one scalar phase per committed asteroid. The normal source
4096-day interval remains, shortened for unusually fast valid orbits so phase
advance cannot exceed the shared precision budget. Empty populations defer
uploads until a nonempty draw; this intentionally differs from the source's
unnecessary empty-cloud upload.

A completed frame requires an actual POINTS submission, current uploaded
attributes and successful GL allocation/upload/draw checks. Frustum culling is
disabled for the asteroid cloud so an offscreen camera still receives a valid
submission receipt; the GPU clips offscreen points. This does not change pixels.
Missing submissions restore the previous frame and retry. Errors restore date,
count, phases, planets and the previous scene, then stop recurring rendering.
Bundled attachment and replacement use the same receipt boundary, retaining the
previous scene and readouts through first-allocation failures and repeated hidden
replacements. Manual attachment performs its first draw synchronously.
`loadAsteroids()` returns true only when that first draw commits the new model.
Failed or deferred draws return false while retaining pending data for recovery.
Pending clouds are attached only within `renderFrame()`, including after hidden
or failed loads. Direct `tick()` calls update already committed bundled scenes;
pending/streamed catalogues require the full frame receipt, and terminal graphics
failures suspend direct ticks too. Drawing the adapter alone cannot activate a
pending catalogue or publish its readouts.
Graphics restoration and catalogue retries re-enable frame preparation, while
recovery feedback and the Pixi escape link remain until a full frame commits.
Hidden or missing-receipt frames cannot clear them. Explicit teardown also clears
startup-failure feedback after initialization has already disposed its resources;
stale instances cannot erase a newer app's status.
Two context restorations must rebuild resources from retained CPU data without
catalogue requests. Loss and restoration failures have explicit status feedback.

## Verification entry points

```sh
npm run build
npx playwright test three.spec.cjs
npx playwright test --project=chromium-only --grep Three
npm run test:unified
RENDERER=three HEADLESS=1 DURATION_SECONDS=120 PROFILES=native \
  npm run benchmark:catalog -- /absolute/path/indexed.json /absolute/path/whole.json
```

Native projects include the real direct entry at root and Pages subpaths,
WebGL1-only Pixi fallback, missing Three chunk/WebGL2 recovery, production scene/reverse-return
checks, independent XYZ GLSL/colour and rendered CPU-reference comparisons, upload budgets, catalogue modes,
camera/time/visibility, failed frames and retained graphics restoration. The complete native suite selects all
Three cases; standalone verification covers the two public renderer smoke cases. Benchmark reports
separate first submission from GPU fence completion and retain backend, array
ownership, CPU/GPU byte counts and memory-sampling limits.

The current app benchmark's `setupMs` includes bundled attachment's
first submission. Its `tickMs` covers scene/FPS updates; `renderSubmitMs` also
includes receipt and readout commitment after drawing. Legacy timing boundaries
remain unchanged, so keep these differences explicit when comparing old runs.

Physical Safari/iOS hardware and native monitor transitions need separate device
evidence; browser automation does not certify them. Renderer switching, promotion
and source-snapshot cleanup retain regression coverage in the current suites.
