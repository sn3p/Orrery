// Exercise the real production startup with a build-time paired test profile.
import { app, ready } from '../src/unified/index.js';
import { namedPosition } from '../src/unified/named/source/NamedBodySource.js';
import planets from '../src/js/planets.js';
window.namedTest = { app, ready, namedPosition, planets };
