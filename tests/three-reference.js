// Pinned source application is only a verification fixture, never a preview import.
import startApp from "../migration/orrery3d/src/start.js";
import catalogue from "./fixtures/historical100k/catalog.json.gz";
window.threeReference = startApp(async app => {
  const data = await (await fetch(catalogue)).json();
  app.setupAsteroids(data);
  app.renderFrame(2458600.5, { trackFps: false });
}, { autoRender: false, jedDelta: 0 });
