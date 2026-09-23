const browsers = require("playwright");

function launchOptions(name) {
  const graphics = process.env.ORRERY_TEST_GRAPHICS;
  if (graphics && graphics !== "mesa") throw new Error(`Unknown test graphics backend: ${graphics}`);
  const mesa = graphics === "mesa";
  if (mesa && process.platform !== "linux") throw new Error("Mesa test graphics requires Linux and Xvfb");
  return {
    headless: !mesa && process.env.HEADLESS !== "0",
    ...(name === "firefox" ? {
      // A cold Firefox window on the software display can refuse the first
      // WebGL context. These prefs keep that context available for the probe.
      firefoxUserPrefs: {
        "webgl.disabled": false,
        "webgl.force-enabled": true,
        "webgl.enable-webgl2": true,
      },
    } : {}),
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

// The public app opens its introduction on a first visit and holds playback
// while it is open. Suites start with it dismissed; tests/intro.cjs covers the
// first visit itself through firstVisitContext.
const INTRO = Symbol("orrery.introDismissed");
const dismissIntro = () => { try { localStorage.setItem("orrery.intro", "seen"); } catch { /* opaque origin */ } };

function withIntroDismissed(browser) {
  if (browser[INTRO]) return browser;
  const newContext = browser.newContext.bind(browser), newPage = browser.newPage.bind(browser);
  browser[INTRO] = { newContext };
  browser.newContext = async (...args) => {
    const context = await newContext(...args);
    await context.addInitScript(dismissIntro);
    return context;
  };
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    await page.addInitScript(dismissIntro);
    return page;
  };
  return browser;
}

const firstVisitContext = (browser, options) => (browser[INTRO]?.newContext ?? browser.newContext.bind(browser))(options);

const launchBrowser = async name => withIntroDismissed(await browsers[name].launch(launchOptions(name)));
module.exports = { launchBrowser, launchOptions, withIntroDismissed, firstVisitContext };
