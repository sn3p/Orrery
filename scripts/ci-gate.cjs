function verify(needs) {
  if (needs.plan?.result !== 'success') throw new Error('Test planning did not succeed');
  for (const name of ['code', 'build-tests']) {
    if (!['true', 'false'].includes(needs.plan.outputs?.[name])) throw new Error(`Invalid plan output: ${name}`);
  }
  const code = needs.plan.outputs.code === 'true';
  const build = needs.plan.outputs['build-tests'] === 'true';
  for (const [job, required] of Object.entries({ node: code, build: code, 'build-tests': build, 'browser-tests': code, standalone: code })) {
    const expected = required ? 'success' : 'skipped';
    if (needs[job]?.result !== expected) throw new Error(`${job}: expected ${expected}, got ${needs[job]?.result}`);
  }
}
if (require.main === module) {
  verify(JSON.parse(process.env.CI_NEEDS));
  console.log('All selected checks passed; only planned checks were skipped.');
}
module.exports = { verify };
