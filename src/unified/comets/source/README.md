# Browser reference adapter

`CatalogSource.js`, `contract.js`, and the adapter transport extracted into
`transport.js` derive from MIT-licensed
[Orrery3D f8c914c](https://github.com/sn3p/Orrery3D/tree/f8c914c96534abf94ed9b33c55f389e13b2d2faf/src/js/catalog).
Copyright (c) 2016 Matthijs Kuiper; see the repository [MIT license](../LICENSE).

Copy these files together when migrating the reference adapters (keep their
relative paths):

```text
CatalogSource.js
CometSource.js
CometCatalogSource.js
cometSourceCore.js
contract.js
transport.js
```

For asteroid-only use, both comet adapters and `cometSourceCore.js` may be omitted.
For comet-only use,
`CatalogSource.js` may be omitted. All adapters require `contract.js` and
`transport.js`. `CometSource.js` is OrreryData's comet adapter under the same
repository MIT license. Keep the attribution and license with copied code.

These are a tested migration reference, not automatic adoption by either app.
The existing read/count/cancellation/identity semantics and indexed/whole v1
support remain. The additions are browser-distribution v1 validation and
`CatalogSource.openLatest(absoluteLatestURL, { signal })`. Browser distributions
require HTTPS discovery, with HTTP allowed only for localhost and loopback development.
They support indexed reads only. See [the distribution contract](../docs/browser-delivery.md).

The consumer owner should apply these changes to its own adapter, run both
old and new fixtures and its loader/browser suite, and connect source failures
to its existing buffering/error UI with a reload action. Do not transparently
replace the source or append new-source rows into an existing scene. This
reference is tested through real HTTP and browser workflows in this repository.

Comet migration follows the separate [comet contract](../docs/comets.md).
Errors and cancellation messages retain the product context: comet failures say
“Comet”/“comet”; the asteroid adapter retains its existing “Catalogue”/“catalogue”
wording. Both adapters share bounded transport, while the public
`CatalogSource.js` export `fetchVerified(ref, url, signal)` remains an asteroid
compatibility wrapper with the same three-argument API.

For the six-object v2 catalogue use `CometCatalogSource.js` and the separate
`comets-v2/latest.json` endpoint; see [v2 contract and handoff](../docs/comets-v2.md).
The existing `CometSource.js` continues to accept only v1. Either comet reader
can be omitted when not used; both require `cometSourceCore.js`, `contract.js`
and `transport.js`. The core shares interpolation, validation, verified loading
and cancellation; each entry module selects its own wire contract.

## Orrery vendoring
All runtime files copied without adaptation from OrreryData 24cdc802e83f4a73f5bd2c33ea0a5246b83a66b4. MIT license retained beside these files. Common contract/transport lineage: Orrery3D f8c914c96534abf94ed9b33c55f389e13b2d2faf, src/js/catalog. The asteroid adapter remains separate.

Local transport adaptations preserve Orrery guards: reject discovery fragments and reject redirects for verified assets as well as discovery.
