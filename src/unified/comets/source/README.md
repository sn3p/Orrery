# Orrery comet readers

Vendored from [OrreryData f8c517466094b29e9f1813dabfc6d13241e9be62](https://github.com/sn3p/orrery-data/tree/f8c517466094b29e9f1813dabfc6d13241e9be62/consumer):
`CometHistorySource.js`, `cometHistoryContract.js`, `CometCatalogSource.js`,
`cometSourceCore.js`, `contract.js`, `transport.js`. Keep the [MIT license](LICENSE).
Copyright (c) 2016 Matthijs Kuiper.

Local transport adaptations omit the unused `linkCancellation` export and preserve Orrery's existing rejection of
latest-URL fragments and verified-asset redirects. All other copied modules are
unchanged. The asteroid adapter remains separate and unchanged.

Production still opens the strict schema-2 reader at
`https://sn3p.github.io/orrery-data/comets/latest.json`. Schema 3 is accessible only
through explicit candidate source injection. No hosted switch is included.
See [app behavior](../../../../docs/comets.md) and the upstream
[contract](https://github.com/sn3p/orrery-data/blob/f8c517466094b29e9f1813dabfc6d13241e9be62/docs/comet-history-candidates.md).
