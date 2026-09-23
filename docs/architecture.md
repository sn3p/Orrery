# Architecture

Orrery is one application with renderer-neutral state and two graphics adapters.
Pixi is the default 2D selection and Three is the optional 3D selection. Both
adapters load on demand and consume the same retained catalogue model and
application clock.

## Ownership boundary

### Application

`src/unified/App.js` owns:

- Julian date, requested playback speed and active-time accounting;
- the single animation-frame scheduler and frame-commit boundary;
- catalogue transport, the renderer-neutral numeric model and replacement state;
- the HUD, options, introduction and status/error coordination;
- common renderer options, viewport and display-pixel-ratio selection; and
- renderer creation, switching, recovery coordination and final disposal.

The application publishes a new date, discovery count and readout only after the
active adapter has committed the matching draw. Buffering, failed draws and
replacement candidates therefore retain the last complete scene and readout.

### Renderer adapters

Each adapter owns its graphics resources, catalogue packing, projection or camera,
renderer-specific options and view state. It validates and commits draws, restores
graphics state and disposes its own resources. Adapters do not fetch catalogue data,
advance the application clock or schedule their own animation loop.

`src/unified/renderers.js` is the renderer registry. Both entries use dynamic
imports. The default route selects Pixi, so its startup does not load Three code
or require WebGL2.

## State and persistence

Switching renderers preserves the current date, requested speed, retained catalogue,
common options and last committed readout. Each renderer's view and the shared DPR
choice last for the page session. A reload returns to the renderer named by the URL
(`renderer=three`; Pixi is the omitted default) and to a `date=YYYY-MM-DD` UTC day
when present, paused like a HUD jump. An unrecognized `renderer` value stays in the
query so reload still shows the Pixi fallback notice. Without `date`, playback still starts at the
configured beginning (publicly 1980-01-01) and plays. Invalid dates are ignored.
Options switches, successful intro renderer choices, date jumps and pauses update
that query with `history.replaceState`; playback frames do not. Camera, DPR, planet orbit lines and the
group preset are still page-session only.

Explicit planet-label and real-time choices are stored under
`orrery.planetLabels` and `orrery.realTime`; they apply to both adapters.
Real time defaults on.
Introduction dismissal is stored separately under `orrery.intro`. Renderer choice and
date are named only by the URL, not `localStorage`. Renderer-specific view state, DPR,
planet orbit lines and the minor-planet group preset are not persisted.
Choosing Jupiter Trojans may ease the active camera out so Jupiter’s orbit fits;
switching still restores each renderer’s last stored view.

## Renderer switching

The options panel changes renderer in place without reloading or fetching the
catalogue again. Requests are serialized and coalesced. Destination code loads while
the current view remains usable; the app then captures that view and disposes its
graphics before allocating the candidate. The candidate packs the retained model
and must commit a complete frame before it becomes active.

A failed candidate is cleaned up and the previous renderer is rebuilt from retained
state when possible. If restoration also fails, the status remains accessible and
offers retry or renderer-selection recovery. Switching does not replay historical
discovery pulses, and queued requests converge on the latest selection.

## Detailed contracts

- [Rendering and options](rendering.md): clock, scheduling, GPU rendering, DPR and benchmarks.
- [Catalogue loading](catalog-loading.md): transport, retained data and frame commitment.
- [Three adapter](three-renderer.md): 3D presentation, packing and graphics recovery.
- [Browser tests](browser-tests.md): regression scopes and CI selection.
- [Development](development.md): commands, fixtures and contribution workflow.
- [Deployment](deployment.md) and [release/rollback](promotion.md): publication and recovery.
