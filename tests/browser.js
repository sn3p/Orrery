import "./fixture";
import Orrery from "../src/js/Orrery";
import { shaderAccuracy, reference } from "./shader";
import { REFERENCE_JED, REBASE_DAYS } from "../src/js/asteroidOrbits";
import * as PIXI from "pixi.js";

window.ready = window.ready.then(() => {
  Object.assign(window.fixture, { Orrery, shaderAccuracy, reference, REFERENCE_JED, REBASE_DAYS, PIXI });
});
