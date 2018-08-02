const path = require("path");

module.exports = {
  mode: "development",
  entry: "./src/index.js",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "bundle.js"
  },
  externals: {
    "pixi.js": "PIXI"
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader"
        }
      }
    ]
  },
  devServer: {
    port: 8080,
    publicPath: "/dist",
    contentBase: "./",
    watchContentBase: true,
    watchOptions: {
      ignored: /node_modules/
    }
  }
};
