function verify(needs) {
  if (needs.plan?.result !== 'success') throw new Error('Test planning did not succeed');
  for (const name of ['code', 'build-required', 'build-reused']) {
    if (!['true', 'false'].includes(needs.plan.outputs?.[name])) throw new Error(`Invalid plan output: ${name}`);
  }
  const reused = !!needs.plan.outputs['source-run'];
  if (reused && (!/^[1-9][0-9]*$/.test(needs.plan.outputs['source-run'])
    || !/^[1-9][0-9]*$/.test(needs.plan.outputs['source-attempt']))) throw new Error('Invalid source run identity');
  const code = needs.plan.outputs.code === 'true';
  const buildRequired = needs.plan.outputs['build-required'] === 'true';
  const buildReused = needs.plan.outputs['build-reused'] === 'true';
  const execution = JSON.parse(needs.plan.outputs.execution);
  if (execution['build-tests'] !== (buildRequired && !buildReused) || (buildReused && !reused)
    || execution.build !== execution['browser-tests']
    || (!code && Object.values(execution).some(Boolean))
    || (code && !reused && ['node', 'build', 'browser-tests', 'standalone'].some(job => execution[job] !== true))) {
    throw new Error('Inconsistent execution requirements');
  }
  for (const job of ['node', 'build', 'build-tests', 'browser-tests', 'standalone']) {
    if (typeof execution[job] !== 'boolean') throw new Error(`Invalid execution requirement: ${job}`);
    const expected = execution[job] ? 'success' : 'skipped';
    if (needs[job]?.result !== expected) throw new Error(`${job}: expected ${expected}, got ${needs[job]?.result}`);
  }
}
if (require.main === module) {
  verify(JSON.parse(process.env.CI_NEEDS));
  console.log('All selected checks passed; only planned checks were skipped.');
}
module.exports = { verify };
