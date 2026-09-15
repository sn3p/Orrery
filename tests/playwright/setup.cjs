const fs = require('node:fs');
const path = require('node:path');
const { prepare, directory } = require('../fixture-builds.cjs');

module.exports = async () => {
  if (process.env.ORRERY_PREBUILT_FIXTURES) {
    // An explicit prepared artifact must be present. Never silently recompile
    // a missing CI download and turn an artifact integration failure green.
    fs.accessSync(path.join(process.env.ORRERY_PREBUILT_FIXTURES, 'manifest.json'));
    return;
  }
  await prepare();
  process.env.ORRERY_PREBUILT_FIXTURES = directory;
};
