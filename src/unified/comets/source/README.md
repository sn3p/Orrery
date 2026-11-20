# OrreryData comet adapter

Vendored from sn3p/orrery-data commit `9cee185caba34a79994b8e30716f94133bdf85bf`
(MIT, see LICENSE). CometSource.js, contract.js and transport.js are kept separate
from the existing asteroid adapter. Local adaptations: fetchVerified rejects
redirects as well as descriptor discovery; discovery rejects URL fragments; unused
asteroid validators and the cancellation-link helper are omitted. Compare all three modules on upstream
updates and run comet conformance tests. The asteroid adapter has a different
contract and transport API; sharing it requires a separate compatibility audit.

The deterministic fixture in tests/fixtures/comets is the hosted v1 product,
retrieved 2026-11-19. Index SHA-256:
`b66b8e10a505ac3312f4d6d316604d034b0183133c9d036f0cfc3beba730310e`.
All three series equal the retained bundled baseline numerically. The index
retains source queries, response hashes, solution identities and validation.
