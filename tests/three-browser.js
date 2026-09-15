// Instrument lazy renderer startup with the explicit bundled-entry test oracle
// (aliased by three-build.cjs). Public latest startup has separate entry checks.
// Numerical helpers load only when requested to retain engine-isolation checks.
import { app, ready } from "../src/unified/index.js";
import { prepareCatalogue } from "../src/unified/catalog/prepareCatalogue.js";
window.threeTest = { app, ready, prepareCatalogue,
  constructors: async () => ({ App: (await import("../src/unified/App.js")).default,
    ThreeRenderer: (await import("../src/unified/three/ThreeRenderer.js")).default }),
  validate: async () => {
    const { validateShader } = await import("../migration/orrery3d/tests/shader.js");
    const data = await (await fetch(new URL("data/catalog.json", document.baseURI))).json();
    app.jedDelta = 0; app.jed = 2458600.5; app.renderFrame();
    return validateShader({ ...app.renderer, jed: app.jed }, data);
  },
};
