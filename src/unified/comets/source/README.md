# Orrery comet catalogue reader

Runtime files: `CometCatalogSource.js`, `cometSourceCore.js`, `contract.js` and
`transport.js`. Keep their relative imports and [MIT license](LICENSE) together.
The app opens `https://sn3p.github.io/orrery-data/comets/latest.json` and retains
one verified source pin per generation. See [Orrery comet behavior](../../../../docs/comets.md).

Vendored from [OrreryData revision 24cdc802](https://github.com/sn3p/orrery-data/tree/24cdc802e83f4a73f5bd2c33ea0a5246b83a66b4/consumer).
The [upstream README](https://github.com/sn3p/orrery-data/blob/24cdc802e83f4a73f5bd2c33ea0a5246b83a66b4/consumer/README.md)
and [v2 contract](https://github.com/sn3p/orrery-data/blob/24cdc802e83f4a73f5bd2c33ea0a5246b83a66b4/docs/comets-v2.md)
record the reference package. Common contract/transport lineage derives from
[Orrery3D f8c914c](https://github.com/sn3p/Orrery3D/tree/f8c914c96534abf94ed9b33c55f389e13b2d2faf/src/js/catalog).
Copyright (c) 2016 Matthijs Kuiper. The comet modules are OrreryData MIT code.

Local adaptations:
- Preserve Orrery's rejection of discovery fragments and verified-asset redirects.
- Omit unused asteroid validators and `linkCancellation` from the copied helpers.
- Omit the unused v1 entry module; conformance tests exercise the runtime v2 reader.
  The shared upstream core is retained. This does not remove producer v1 hosting.

The asteroid adapter remains separate in `src/unified/catalog`; it is unchanged.
The v2 fixture under `tests/fixtures/comets-v2` retains the pinned catalogue,
per-object provenance and numerical references. Compare the four modules with
the pinned upstream revision on updates and run reader/lifecycle regressions.
