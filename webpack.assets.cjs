const path = require("node:path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
module.exports = {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
        },
      },
      {
        test: /\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          { loader: "css-loader", options: { importLoaders: 1 } },
          "postcss-loader",
        ],
      },
      {
        test: /\.(woff2|txt)$/,
        include: path.resolve(__dirname, "src/fonts"),
        type: "asset/resource",
        generator: {
          filename: "fonts/[name][ext]",
        },
      },
      {
        test: /\.json$/,
        type: "asset/resource",
        generator: {
          filename: "data/[name][ext]",
        },
      },
    ],
  };
