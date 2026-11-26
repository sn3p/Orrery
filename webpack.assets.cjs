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
        // Icons required by index.html; hashed so browsers notice a new icon.
        test: /\.(?:svg|png)$/,
        include: path.resolve(__dirname, "src/unified"),
        type: "asset/resource",
        generator: {
          filename: "assets/[name].[contenthash:8][ext]",
        },
      },
      {
        test: /\.json$/,
        exclude: path.resolve(__dirname, "src/unified/named/definitions.json"),
        type: "asset/resource",
        generator: {
          filename: "data/[name][ext]",
        },
      },
    ],
  };
