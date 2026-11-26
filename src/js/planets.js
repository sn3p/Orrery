import definitions from '../unified/named/definitions.json' with { type: 'json' };
import { validateNamedDefinitions } from '../unified/named/source/NamedBodySource.js';
import { presentBodies } from '../unified/named/model.js';

// Generated OrreryData science, retained for offline / pre-activation startup.
// The full 13-body set activates only with its verified asteroid mapping.
export default presentBodies(validateNamedDefinitions(definitions)).slice(0, 6);
