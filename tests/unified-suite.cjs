const { execFileSync } = require('node:child_process');
// Public-entry and exact-parity checks use the raw production App. Numerical
// probes keep their existing inspection vocabulary via a test-only facade.
const rawEnvironment = { ...process.env };
delete rawEnvironment.ORRERY_TEST_APP;
execFileSync(process.execPath, ['tests/unified.cjs'], { stdio: 'inherit', env: rawEnvironment });
for (const test of ['gpu', 'scheduling', 'rendering', 'ui', 'options-browser', 'benchmark']) {
  execFileSync(process.execPath, [`tests/${test}.cjs`], {
    stdio: 'inherit', env: { ...process.env, ORRERY_TEST_APP: 'unified' },
  });
}
