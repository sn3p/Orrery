const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");

module.exports = {
  entry: {
    main: "./tests/bundled-entry.js",
  },
  output: {
    path: path.resolve(__dirname, "../.context/fixture-site"),
    filename: "bundle.js",
    // Keep one app bundle without disabling the callback wrapper HMR needs.
    asyncChunks: false,
  },
  module: { rules: [...require("../webpack.assets.cjs").rules, require("./historical-catalog.cjs").rule] },
  plugins: [
    new MiniCssExtractPlugin({ filename: "[name].css" }),
    new HtmlWebpackPlugin({
      inject: false,
      hash: true,
      template: "./tests/fixture.html",
    }),
  ],
  optimization: {
    splitChunks: false,
    minimizer: [
      new TerserPlugin({
        extractComments: false,
      }),
    ],
  },
};
