const path = require('node:path');
const webpack = require('webpack');

async function build(output) {
  const target = require('../webpack.next.config.js');
  const root = path.resolve(__dirname, '..');
  // Numerical expectations live in test-owned reference helpers. Only the
  // startup entry is substituted to select the explicit historical catalogue.
  const config = { ...target, entry: './tests/three-browser.js',
    output: { ...target.output, path: path.join(output, 'next') },
    resolve: { alias: { [path.join(root, 'src/unified/index.js')]: path.join(root, 'tests/bundled-entry.js') } },
    module: { rules: [...target.module.rules, require('./historical-catalog.cjs').rule] },
    context: root, mode: 'production', performance: { hints: false } };
  await new Promise((resolve, reject) => {
    const compiler = webpack(config);
    compiler.run((error, stats) => compiler.close(closeError => {
      if (error || closeError || stats.hasErrors()) reject(error || closeError || new Error(stats.toString('errors-only')));
      else resolve();
    }));
  });
}
module.exports = { build };
if (require.main === module) build(path.resolve('.context/pr4/three-fixtures')).catch(error => { console.error(error); process.exitCode = 1; });
