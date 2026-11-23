import { createCometSource } from './cometSourceCore.js';

const { CometSource, validateComet } = createCometSource({ version: 1, targets: { "1P": "1P/Halley", "2P": "2P/Encke", "55P": "55P/Tempel-Tuttle" } });

export default CometSource;
export { validateComet };
export { interpolateComet } from './cometSourceCore.js';
