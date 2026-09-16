const fs = require('node:fs');
const path = require('node:path');

// Call only for owned, generated fixture paths, never for source directories.
function replaceDeploymentLink(target, link) {
  fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(path.resolve(target), link, 'dir');
}
module.exports = { replaceDeploymentLink };
