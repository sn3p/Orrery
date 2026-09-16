const { defineConfig } = require('@playwright/test');
const config = require('./playwright.config.cjs');

// Fresh public build, two renderers, no prepared artifacts or duplicate matrix.
// This is deliberately independent of the ordinary project's selected groups.
module.exports = defineConfig({ ...config,
  globalSetup: undefined,
  projects: [{ ...config.projects.find(project => project.name === 'chromium-only'),
    name: 'standalone', testMatch: ['smoke.spec.cjs'], grep: undefined }],
});
