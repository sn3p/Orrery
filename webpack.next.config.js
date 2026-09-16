const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");

module.exports = {
  entry: "./src/unified/index.js",
  output: {
    path: path.resolve(__dirname, "dist/next"),
    filename: "assets/[name].[contenthash:8].js",
    chunkFilename: "assets/[name].[contenthash:8].js",
    publicPath: "auto",
    uniqueName: "orrery-next",
    clean: true,
  },
  // Shared production asset transforms; test-only fixtures have separate builders.
  module: require("./webpack.assets.cjs"),
  plugins: [
    new (require("webpack").DefinePlugin)({
      __CATALOG_SELECTION__: JSON.stringify(require("./catalog-profiles/latest.json")),
    }),
    new MiniCssExtractPlugin({
      filename: "assets/[name].[contenthash:8].css",
      chunkFilename: "assets/[name].[contenthash:8].css",
    }),
    new HtmlWebpackPlugin({ template: "./src/unified/index.html" }),
  ],
  optimization: {
    splitChunks: { chunks: "async" },
    minimizer: [new TerserPlugin({ extractComments: false })],
  },
  devServer: {
    port: Number(process.env.CONDUCTOR_PORT || 3000),
    open: ["/next/"],
    static: { directory: path.resolve(__dirname, "dist") },
    devMiddleware: { publicPath: "/next/" },
    historyApiFallback: false,
    watchFiles: ["src/unified/**/*.html"],
    setupMiddlewares(middlewares, server) {
      // The static legacy page has no favicon; keep its automatic browser
      // request quiet when returning from the preview during development.
      server.app.get("/favicon.ico", (_req, res) => res.status(204).end());
      return middlewares;
    },
  },
};
