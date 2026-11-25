# Orrery comet readers

Vendored from [OrreryData 53a6ce491c5b5a119236fc629e54449bf15920a5](https://github.com/sn3p/orrery-data/tree/53a6ce491c5b5a119236fc629e54449bf15920a5/consumer):
`CometDirectorySource.js`, `cometDirectoryContract.js`, `CometHistorySource.js`,
`cometHistoryContract.js`, `CometCatalogSource.js`, `cometSourceCore.js`,
`contract.js`, `transport.js`. Keep the [MIT license](LICENSE).
Copyright (c) 2016 Matthijs Kuiper.

Local adaptations retain schema-2/3 `openDescriptor` entry points and reject
latest-URL fragments and verified-asset redirects. Other reader logic is unchanged.
The asteroid adapter remains separate.

Production dispatch accepts schemas 2, 3 and 4 at the existing endpoint.
Schemas 2/3 retain their existing acquisition path. Schema 4 uses bounded date
windows, the directory reader's verified cache and legacy discovery metadata.
No hosted descriptor or data is changed. See [integration](../../../../docs/comet-directory.md).
