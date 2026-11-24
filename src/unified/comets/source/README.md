# Orrery comet readers

Vendored from [OrreryData a967c6a3548727c98ba3998dafaeb9dde4588123](https://github.com/sn3p/orrery-data/tree/a967c6a3548727c98ba3998dafaeb9dde4588123/consumer):
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
[contract](https://github.com/sn3p/orrery-data/blob/a967c6a3548727c98ba3998dafaeb9dde4588123/docs/comet-history-candidates.md).
