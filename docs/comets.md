# Comets

Options → **comets** discovers individually selectable objects from the pinned catalogue,
using its names and order. The initial v2 catalogue contains 1P/Halley, 2P/Encke,
55P/Tempel–Tuttle, 9P/Tempel 1, 10P/Tempel 2 and 67P/Churyumov–Gerasimenko.
Membership is not restricted to these six objects. **asteroids** independently controls the existing
minor-planet population. Both renderers support both populations together or
separately. **Fit selected comets** frames their trajectories; normal zoom and
camera controls remain available. It fits the displayed trajectory windows in
the current viewing direction with a small margin, keeping the Sun centered.
**paths** toggles the comet trajectories.
Selections survive renderer changes. Reload restores asteroid-only visibility
while remembering comet selections. The footer count remains an asteroid count.
Options → **About comets** explains catalogue membership versus trajectory
availability, date coverage and model limits, with links to JPL Horizons and
OrreryData. It remains available when comets are hidden. Loading, retry and unavailable-date messages
remain beside the comet controls in Options.

## Scientific model and limits

Comets use NASA/JPL Horizons integrated geometric state vectors relative to the
Sun, in the ecliptic frame of J2000, in AU and AU/day. Queries explicitly request
UT dates to match the application's calendar. Both renderers use identical
positions; Pixi applies the existing negative-X top-view projection. Markers
are enlarged to six screen pixels and colors identify objects, not composition
or physical brightness. No tail, coma or dust density is inferred.

The pinned sample covers 1 January 1980 through 30 December 2099 at four-day
intervals. Cubic Hermite interpolation uses both position and velocity. Comets
and paths are hidden outside this interval, with an explanation in Options;
the asteroid clock is not restricted. Horizons predictions are computed from
orbit solutions and their assumptions, not direct observations at every date.
Uncertainty grows away from observations. This is an educational visualization,
not an observing ephemeris or meteor-shower prediction tool.

Known comets show approximately one orbital period centered near the displayed date.
Entries without an app display period use a fixed **10-Julian-year window**
(3652.5 days), identified in Options when selected. This presentation fallback is
not an estimate of their orbital period: it may show part of a long orbit or
several short ones. Scientific date coverage remains independent of this window.
Near either data boundary, the entire window shifts into the available interval
so the path keeps its full length. They follow the integrated trajectory rather
than an artificially closed ellipse; the endpoints need not meet. Path windows
advance in 32-day increments; markers interpolate continuously. The period is
used only to choose the window. If a dataset is shorter than one period, the
path uses all available samples without extrapolating.
Drawing and Fit use the same window, even when paths are hidden.
The original three display periods remain unchanged. The curated additions use
these approximate app-owned durations, rounded from the published Horizons
`PER` values in Julian years using 365.25 days/year:

| Comet | Display days | Published PER (years) | Source epoch (TDB) | Solution |
|---|---:|---:|---|---|
| 9P | 2038 | 5.58040281918145 | 2016-03-28 | JPL#K284/3 |
| 10P | 1958 | 5.35997037988402 | 2017-12-21 | JPL#K265/65 |
| 67P | 2353 | 6.44237116469175 | 2015-10-10 | JPL#K284/1 |

Source: each entry's `provenance.vectors.header` in the
[pinned catalogue fixture](../tests/fixtures/comets-v2/index-b1b10e6d1fba1cb94cd1e03c2e39ea7ec93b584a89f74ece193dcdf8ba379567.json),
from OrreryData revision `24cdc802e83f4a73f5bd2c33ea0a5246b83a66b4`.
These epoch-specific periods only choose the display duration; they do not
calculate positions, infer orbital elements, or promise an exact revolution
at every date. Runtime code does not parse provenance headers. Catalogue
membership remains unrestricted by this presentation lookup.

Planets and asteroids retain the application's existing approximate fixed-element
model; enabling comets does not increase their positional accuracy.

For the original bundled three, all 32,871 available interval midpoints were compared with separately requested
Horizons vectors. Maximum interpolation differences in the retrieved sample:

| Comet | Maximum midpoint difference (AU) |
|---|---:|
| Halley | 0.000003220 |
| Encke | 0.000050591 |
| Tempel–Tuttle | 0.000000260 |

These measure interpolation against the same underlying solution, **not the
physical uncertainty of that solution**, nor an error bound at every instant.
Offline tests retain the worst midpoint for each object and a spread of dates.

## Data and updates

Comets are distributed by [OrreryData](https://github.com/sn3p/orrery-data).
On first enable, the app discovers `https://sn3p.github.io/orrery-data/comets/latest.json`
and pins its verified index for this visit. Each selected object loads separately,
with bounded decoded length, SHA-256, schema, identity, conventions and reference
interpolation checks. Without a saved selection, the app selects Halley, Encke,
Tempel–Tuttle, 67P and 29P/Schwassmann–Wachmann 1 (`c1000079`), restricted to
entries present in the active catalogue. This app-owned starter set is independent
of the producer's legacy six-default metadata. Older schema-2/3 catalogues seed the
four available members; the bundled rollback seeds its three available members.
Saved selections, including empty selections and missing IDs, are never migrated.
Unedited starters are not saved: they follow the available starter set when the
catalogue changes and on later visits. Visitors who never saved a choice therefore
receive the current starters rather than retaining a previous release's defaults.
Missing-entry notices apply to saved or explicitly edited selections only.
29P has a dedicated blue colour distinct from the other starters; its existing
10-year display window (plus the directory acquisition margin) remains unchanged.
Every other entry stays available for explicit selection. Subsequent source replacements
preserve saved IDs, including entries temporarily absent from the active catalogue.
Only available entries load; a brief Options notice explains missing entries, which
return when available again. New entries remain available for explicit selection. Asteroid-only startup makes no comet requests.

Ready selections render and can be fitted while others load or fail. Retry loads
missing selected objects under the same pin; deselection cancels outstanding reads.
Reselection reuses verified cached data and retries previously failed objects.
Unexpected read cancellation shows a retryable failure. Reload starts a new pin. An old pin whose
objects have been pruned requires a reload; failure feedback explicitly explains
this recovery path. Retry never silently changes solutions.
Builds, tests and visits make no JPL requests. OrreryData owns future refreshes;
comet scheduling remains inactive. The asteroid adapter is unchanged.

The bundled vector asset remains packaged as an explicit developer rollback:
`app.replaceCometSource('bundled')` on an App instance. Use `'hosted'` to reopen
latest. Replacement clears the entire old generation before loading, including
paths; no mixed sources or automatic fallback. `cometSourceId` and
`cometSourceInfo` expose the active provenance; bundled identity is explicitly
labeled. These are developer APIs, not persistent preferences or public controls.

- [Horizons](https://ssd.jpl.nasa.gov/horizons/) and its
  [API documentation](https://ssd-api.jpl.nasa.gov/doc/horizons.html).
- [`provenance.json`](../src/unified/comets/provenance.json): retrieval date,
  exact queries, response hashes and solution/frame/time headers. Repetitive
  Horizons internal diagnostics are omitted from retained headers.
- [`vectors.json`](../src/unified/comets/vectors.json): compact position/velocity
  samples, rounded to 12 significant digits.
- [`comet-vectors.json`](../tests/fixtures/comet-vectors.json): independent
  midpoint requests, sample references and maximum differences.

The historical `scripts/fetch-comets.py` and bundled provenance are retained for
rollback reproducibility only. Ordinary refreshes belong to OrreryData; do not run
this script as part of installation, builds or tests. Source response hashes
identify retrieved bytes, not hashes of transformed assets.

The v2 reader verifies each catalogue entry against its own independent midpoint references and provenance. Reader source, dependencies, MIT license and lineage are retained in `src/unified/comets/source`.

## Production schema transition and historical candidates

Production reads one descriptor at the existing `comets/latest.json` URL and dispatches
to the strict schema-2 or schema-3 reader. Unknown versions and failed verification
fail closed without blending bundled trajectories. Both readers ship with the app;
enabling schema 3 needs no separate code download after descriptor discovery.
Live data activation is separate. The approved same-URL replacement can break older
schema-2-only clients; deploy and verify this loader before the separately reviewed
data activation, following the producer [rollout contract](https://github.com/sn3p/orrery-data/blob/b0909248536811f65be3d4f5405041cf83ef59f6/docs/comet-production-rollout.md).
The strict schema-3 reader can also be selected explicitly with
`app.replaceCometSource('candidate', candidateDescriptorURL)`; this is an integration
API, not a hosted rollout or a persisted preference. `replaceCometSource('hosted')`
restores production version dispatch, and the existing bundled rollback remains available.
A source replacement clears the previous generation's metadata, models and failures.

Metadata loads first. Selecting an object loads its required segments atomically;
failed pairs expose no partial marker/path/Fit. The reference reader can load modern
segments independently of historical availability; historical reads still validate
against modern and memoize only a successful immutable pair per source. The app's
selected-object acquisition intentionally remains eager and atomic across its segments. Selected validated trajectories are
retained for timeline playback. 1P and 55P use historical and modern series; modern
owns 1980-01-01 UT exactly. Separate path strips never connect across the seam, and
55P's January 2 support sample never extends historical ownership. Both renderers
and Fit share the same shifted display window and marker. Hiding paths keeps Fit
unchanged. Discovery events never change visibility or trajectory coverage.

Options and its chooser show loading, failure and date availability with retry.
For historical catalogues, the date dialog's history details retain selected objects' event
kind, date precision, calendar, notes and source citations, including disputed dates.
They offer no fabricated precise date jumps. Schema-2 metadata has no event section.

Reader provenance: OrreryData `a2076e1c78ffa5ae2bd8c879b77452f31af0829a`.
Retained candidate pin: `a9de1f2f711dd65e880102de7c1f0c14bf20598a20d9cc4e001081406e40c2e2`.
Synthetic contract fixtures run in CI; exact retained files can be checked without
servers using `COMET_HISTORY_CANDIDATE=/path/to/candidate node --test tests/comet-history.test.mjs`.
Local source storage is not a deployment. Hosted switching, retention/pruning and
old-client rollout require separate review.

The chooser opens with selected entries in catalogue order. Search matches names
and designations without case, punctuation or accent distinctions; Browse and
search page in batches of 30. The list scrolls within a viewport-bounded dialog.
Selection is remembered in this browser, including explicit empty selections.
Clear selection also clears missing saved IDs and offers Undo until another
selection edit or closing the dialog. Visibility and renderer changes preserve
selection. Share URLs carry no comet selection override. Normal rows have no
availability label; exceptional date coverage comes from catalogue metadata,
even before loading. Loaded selections show their scene colour.

Selection edits use one desired-ID state; active IDs are derived from verified
catalogue membership. Missing-entry notices describe a new condition once and
clear after interaction, while missing saved IDs remain remembered. Cross-tab
edits use per-ID operations and Web Locks rather than replacing stale snapshots.
A synchronous pending-edit journal preserves edits across reloads while a lock
is busy. Compacted snapshots retain per-ID and replacement ordering, so older
failed writes cannot override newer choices after another tab compacts its edits.
Existing plain-array preferences remain readable. Compaction uses a shared
IndexedDB readwrite transaction, also when Web Locks are present, so tabs with
different capabilities coordinate. If neither mechanism is available, the durable
journal is retained until safe compaction is possible. Failed journal writes are
retried on the next save under their original ordering keys, without requiring
either coordination mechanism.
Clear and Undo deliberately replace the whole desired selection. Search waits
briefly for typing to settle, indexes names once per catalogue revision, and
reuses row elements.

Removing browser storage restores the first-visit defaults in open tabs; an
explicit saved empty selection stays empty. External selection changes invalidate
Clear’s Undo and add newly active entries to an open Selected list, while
previously displayed unchecked rows stay in place.
