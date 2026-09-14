const browsers = require("playwright");

function launchOptions(name) {
  const graphics = process.env.ORRERY_TEST_GRAPHICS;
  if (graphics && graphics !== "mesa") throw new Error(`Unknown test graphics backend: ${graphics}`);
  const mesa = graphics === "mesa";
  if (mesa && process.platform !== "linux") throw new Error("Mesa test graphics requires Linux and Xvfb");
  return {
    headless: !mesa && process.env.HEADLESS !== "0",
    ...(name === "chromium" ? {
      channel: process.env.CHROME_CHANNEL || "chrome",
      // Hosted Linux has no hardware GPU. Use Mesa through the virtual display
      // instead of Chromium's SwiftShader fallback, whose trig precision fails
      // the existing orbital accuracy checks. Keep those checks unchanged.
      ...(mesa ? {
        args: ["--use-gl=angle", "--use-angle=gl", "--ignore-gpu-blocklist"],
        ignoreDefaultArgs: ["--enable-unsafe-swiftshader"],
      } : {}),
    } : {}),
  };
}

const launchBrowser = name => browsers[name].launch(launchOptions(name));
module.exports = { launchBrowser, launchOptions };
