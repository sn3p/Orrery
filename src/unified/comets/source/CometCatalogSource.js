import { createCometSource } from './cometSourceCore.js';

const { CometSource, validateComet } = createCometSource({ version: 2 });

export default CometSource;
export { validateComet };
export { interpolateComet } from './cometSourceCore.js';
