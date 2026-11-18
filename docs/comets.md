# Comets

Options → **comets** enables three individually selectable objects: 1P/Halley,
2P/Encke and 55P/Tempel–Tuttle. **asteroids** independently controls the existing
minor-planet population. Both renderers support both populations together or
separately. **Fit selected comets** frames their trajectories; normal zoom and
camera controls remain available. **paths** toggles the comet trajectories.
Selections last for the visit and survive renderer changes. Reload restores the
asteroid-only default. The footer count remains an asteroid count.

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

Paths show approximately one orbital period centered near the displayed date.
Near either data boundary, the entire window shifts into the available interval
so the path keeps its full length. They follow the integrated trajectory rather
than an artificially closed ellipse; the endpoints need not meet. Path windows
advance in 32-day increments; markers interpolate continuously. The period is
used only to choose the window. If a dataset is shorter than one period, the
path uses all available samples without extrapolating.
Planets and asteroids retain the application's existing approximate fixed-element
model; enabling comets does not increase their positional accuracy.

All 32,871 available interval midpoints were compared with separately requested
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

The 3.12 MiB vector asset is loaded on first enabling comets. Failure leaves the
existing scene usable and offers a retry. Builds and normal visits make no JPL
requests. The shared asteroid producer is unchanged.

- [Horizons](https://ssd.jpl.nasa.gov/horizons/) and its
  [API documentation](https://ssd-api.jpl.nasa.gov/doc/horizons.html).
- [`provenance.json`](../src/unified/comets/provenance.json): retrieval date,
  exact queries, response hashes and solution/frame/time headers. Repetitive
  Horizons internal diagnostics are omitted from retained headers.
- [`vectors.json`](../src/unified/comets/vectors.json): compact position/velocity
  samples, rounded to 12 significant digits.
- [`comet-vectors.json`](../tests/fixtures/comet-vectors.json): independent
  midpoint requests, sample references and maximum differences.

To refresh deliberately, run `python3 scripts/fetch-comets.py`. Review the
solution identifiers, date coverage and error measurements, then run the
numerical and browser regressions. The script requires network access; it does
not run during installation, build or tests. Source response hashes identify
retrieved bytes; they are not hashes of the transformed assets.
