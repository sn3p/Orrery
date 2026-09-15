const path = require('node:path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

async function build(output) {
  const source = require('../migration/orrery3d/webpack.config.js');
  const target = require('../webpack.next.config.js');
  const root = path.resolve(__dirname, '..');
  const configs = [
    { ...source, entry: './tests/three-reference.js',
      output: { ...source.output, path: path.join(output, 'reference') },
      plugins: [new webpack.DefinePlugin({ __CATALOG_TRIAL__: 'null' }),
        new MiniCssExtractPlugin({ filename: 'main.css' }),
        new HtmlWebpackPlugin({ inject: false, template: 'migration/orrery3d/src/index.html' })] },
    { ...target, entry: './tests/three-browser.js',
      output: { ...target.output, path: path.join(output, 'next') },
      // Execute the unchanged source numerical tests with the adapted production
      // cloud and neutral model; their independent 3D orbit oracle stays intact.
      resolve: { alias: Object.fromEntries([
        ['Asteroids', 'src/unified/three/Asteroids.js'],
        ['prepareCatalogue', 'src/unified/catalog/prepareCatalogue.js'],
      ].map(([name, file]) => [path.join(root, `migration/orrery3d/src/js/${name}`), path.join(root, file)])) } },
  ];
  for (const config of configs) await new Promise((resolve, reject) => {
    const compiler = webpack({ ...config, context: root, mode: 'production', performance: { hints: false } });
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error || new Error(stats.toString('errors-only')));
      else resolve();
    }));
  });
}
module.exports = { build };
if (require.main === module) build(path.resolve('.context/pr4/three-fixtures')).catch(error => { console.error(error); process.exitCode = 1; });
