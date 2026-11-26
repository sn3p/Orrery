# Named planets and dwarf planets

OrreryData owns the scientific definitions of all eight planets and Ceres,
Pluto, Haumea, Makemake and Eris. Orrery owns marker sizes and colours, keyed by
stable ID. `src/js/planets.js` contains no hand-authored orbital data.

The reader is adapted from, and the transport, contract and bundled definitions are copied from
[OrreryData 1466f2c](https://github.com/sn3p/orrery-data/tree/1466f2c2c0c0e95f72e9a7fca86eba386c0227d9),
`consumer/{NamedBodySource,transport,contract}.js` and
`research/named-bodies/definitions.json` (MIT). The bundled JSON is byte-identical;
update it from the producer, never by editing coefficients here. Source hashes,
centre choices, measured residuals and source URLs travel with the definitions.
The [producer contract](https://github.com/sn3p/orrery-data/blob/1466f2c2c0c0e95f72e9a7fca86eba386c0227d9/docs/named-bodies.md)
is authoritative.

## Activation

Producer PR22 did not publish named-body endpoints. Until a separately reviewed
paired release is activated, the default shows the existing six planets using
the generated producer definitions. This is a compatibility display subset, not
another scientific source. It also works when catalogue loading is offline.

A catalogue profile may include `namedBodies: {url, bytes, sha256}`: an explicit,
trusted product-index reference. `url` is absolute HTTPS (HTTP allowed only on
loopback). Both `latest` and pinned asteroid selection support this field.
The product index pins definitions and a mapping to **the exact asteroid index**.
The app verifies both before preparing a candidate scene. Missing, corrupt,
stale or mismatched data fails the replacement; it never infers dwarf identities.
No named-body latest endpoint, periodic polling or automatic activation is added.

A successful draw commits the new catalogue and all thirteen reference bodies
as one scene. Failed/skipped draws roll back both; stale loads are cancelled.
Source lifetime controls pending pair reads. Switching renderers rebuilds from
the committed pair. Explicit unpaired catalogue replacement restores the baseline.

Dwarf ordinals suppress only anonymous GPU instances, including highlights.
The original rows, discovery dates, classes, prefixes and raw discovery/group
counts remain unchanged. Named reference markers contribute no extra discoveries.
A mapped discovery date is also checked when its chunk arrives. Valid absence
from an export still shows the named reference body.

## Display and accuracy

The existing Planets section controls labels and orbit lines for both classes.
Dwarf labels append “· dwarf”. Earth remains the default label. All thirteen
bodies are independent of discovery date and asteroid filters; offscreen bodies
stay clipped. Initial framing, zoom, saved renderer views and group fits are
unchanged. No new Fit action or comet playback is involved.

Positions use the producer's `namedPosition`: empirical linear-rate Kepler
fits, heliocentric geometric ecliptic J2000 (IAU76 relative to ICRF), AU/degrees,
epoch JDTDB2451545.0 and rates per36525-day century. Some outer targets are system
barycentres; the definitions identify each centre explicitly. These are not
published JPL approximate coefficients or sampled comet trajectories.

Validation is 1800-01-01 through2100-01-01 TDB (6947 samples/body), with sampled
residuals rather than continuous error guarantees. The timeline remains unrestricted.
Outside that interval shape/orientation freeze at the nearest boundary while mean
anomaly continues at its fitted rate. The position result exposes
`approximate-extrapolation`; About explains the policy. Orbit lines sample the
instantaneous date-dependent ellipse with the same boundary freeze. The adapted
reader shares one ellipse/date calculation between markers and tracks; the app
model only converts units. Tracks keep their initial geometry and use an exact
affine transform as the ellipse changes, avoiding per-frame path/vertex uploads.
Dash spacing follows that small deformation. Pixi projects
negative X / positive Y; Three uses XYZ; both use100world units/AU.

The existing UTC calendar's Julian number is used as approximate TDB; Orrery does
not model UTC/TT/TDB clock corrections. The fitting residuals do not include that
clock approximation. This is an illustrative orrery, not an ephemeris service.
