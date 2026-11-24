# Orrery comet readers

Vendored from [OrreryData a2076e1c78ffa5ae2bd8c879b77452f31af0829a](https://github.com/sn3p/orrery-data/tree/a2076e1c78ffa5ae2bd8c879b77452f31af0829a/consumer):
`CometHistorySource.js`, `cometHistoryContract.js`, `CometCatalogSource.js`,
`cometSourceCore.js`, `contract.js`, `transport.js`. Keep the [MIT license](LICENSE).
Copyright (c) 2016 Matthijs Kuiper.

Local transport adaptations omit the unused `linkCancellation` export and preserve Orrery's existing rejection of
latest-URL fragments and verified-asset redirects. Both source classes expose `openDescriptor` so production dispatch verifies the
single fetched descriptor without a second latest request. Other contract logic is unchanged. The asteroid adapter remains separate and unchanged.

Production dispatches to the strict schema-2 or schema-3 reader at
`https://sn3p.github.io/orrery-data/comets/latest.json`. Explicit candidate source injection remains available. No live data switch is included.
See [app behavior](../../../../docs/comets.md) and the upstream
[contract](https://github.com/sn3p/orrery-data/blob/a2076e1c78ffa5ae2bd8c879b77452f31af0829a/docs/comet-history-candidates.md).
