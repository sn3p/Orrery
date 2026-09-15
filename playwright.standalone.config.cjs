const { defineConfig } = require('@playwright/test');
const config = require('./playwright.config.cjs');

// The same assertions run against a freshly assembled standalone preview.
// Raw legacy/preview parity remains included; deployed-root tests stay in CI's
// production-artifact jobs. Chromium-only preview checks still run once.
module.exports = defineConfig(config, { grep: /@standalone/ });
