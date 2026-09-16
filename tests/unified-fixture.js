// Raw production classes, without the legacy probe facade.
import App from "../src/unified/App.js";
import PixiRenderer from "../src/unified/pixi/PixiRenderer.js";
import planets from "../src/js/planets.js";
import catalogURL from "./fixtures/historical100k/catalog.json.gz";
import { Application } from "pixi.js";
import "../src/css/main.css";

window.fixture = { App, PixiRenderer, Application, planets, catalogURL };
