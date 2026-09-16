# Historical 100k regression fixture

This is the exact historical Orrery catalogue, compressed for test-only storage.
`manifest.json` pins the original source revision, decompressed SHA-256, byte size
and 100,000-row population. It is an immutable numerical/scene/benchmark fixture,
not the public app catalogue or a current scientific dataset. Original row order,
discovery ties, orbital values and JSON bytes are preserved. Do not regenerate it
from a newer upstream download. The original importer is available at the same
immutable source revision; current data production belongs to `sn3p/orrery-data`.

The original catalogue contains numbered minor planets from the Minor Planet
Center, matched with discovery dates. See the repository's MIT license and the
original source/data attribution in the README and immutable source revision.
Compression changes storage only. Test builders emit the exact decompressed
bytes at `data/catalog.json`; production builds do not import this fixture.

`tests/historical-catalog.cjs` validates the pinned bytes when reading the fixture.
`tests/historical-catalog-loader.cjs` handles only fixture builds. Full-population
allocation, reverse/inclusive discovery and GPU recovery tests retain their
original input. Benchmarks still fingerprint served decompressed bytes. Runs
above 100,000 rows repeat this population and remain labeled synthetic; the
100,000-row input has not become synthetic or a different benchmark population.
