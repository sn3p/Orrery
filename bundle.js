!function(e){var t={};function i(n){if(t[n])return t[n].exports;var r=t[n]={i:n,l:!1,exports:{}};return e[n].call(r.exports,r,r.exports,i),r.l=!0,r.exports}i.m=e,i.c=t,i.d=function(e,t,n){i.o(e,t)||Object.defineProperty(e,t,{enumerable:!0,get:n})},i.r=function(e){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})},i.t=function(e,t){if(1&t&&(e=i(e)),8&t)return e;if(4&t&&"object"==typeof e&&e&&e.__esModule)return e;var n=Object.create(null);if(i.r(n),Object.defineProperty(n,"default",{enumerable:!0,value:e}),2&t&&"string"!=typeof e)for(var r in e)i.d(n,r,function(t){return e[t]}.bind(null,r));return n},i.n=function(e){var t=e&&e.__esModule?function(){return e.default}:function(){return e};return i.d(t,"a",t),t},i.o=function(e,t){return Object.prototype.hasOwnProperty.call(e,t)},i.p="",i(i.s=3)}([function(e,t){e.exports=PIXI},function(e,t,i){"use strict";Object.defineProperty(t,"__esModule",{value:!0});t.AU=149597870,t.PIXELS_PER_AU=100,t.DEG_TO_RAD=Math.PI/180,t.RAD_TO_DEG=180/Math.PI,t.YEAR=365.25,t.J2000=2451545,t.UNIX_EPOCH_JULIAN_DATE=2440587.5},function(e,t,i){"use strict";Object.defineProperty(t,"__esModule",{value:!0});var n=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),r=i(1);var o=function(){function e(t){!function(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}(this,e),this.ephemeris=t}return n(e,[{key:"getPosAtTime",value:function(e){var t=Math.sin,i=Math.cos,n=this.ephemeris,o=n.epoch,a=n.e,s=n.a,u=n.i*r.DEG_TO_RAD,l=n.W*r.DEG_TO_RAD,c=(n.wbar||n.w+n.W)*r.DEG_TO_RAD,h=n.M*r.DEG_TO_RAD+(n.n?n.n*r.DEG_TO_RAD:2*Math.PI/n.P)*(e-o),d=h,f=void 0;do{var p=h+a*t(d);f=Math.abs(p-d),d=p}while(f>1e-7);var v=2*Math.atan(Math.sqrt((1+a)/(1-a))*Math.tan(d/2)),y=s*(1-a*a)/(1+a*i(v))*r.PIXELS_PER_AU;return{x:y*(i(l)*i(v+c-l)-t(l)*t(v+c-l)*i(u)),y:y*(t(l)*i(v+c-l)+i(l)*t(v+c-l)*i(u))}}},{key:"createOrbit",value:function(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:r.J2000,t=this.getPeriodInDays()/360,i=new PIXI.Graphics;i.lineStyle(.2,5592405);for(var n=0;n<=360;n++){e+=t;var o=this.getPosAtTime(e);0===n?i.moveTo(o.x,o.y):i.lineTo(o.x,o.y)}return i.endFill(),i}},{key:"getPeriodInDays",value:function(){return Math.sqrt(Math.pow(this.ephemeris.a,3))*r.YEAR}}]),e}();t.default=o},function(e,t,i){"use strict";var n=o(i(4)),r=o(i(12));function o(e){return e&&e.__esModule?e:{default:e}}var a=new n.default({width:window.innerWidth,height:window.innerHeight});a.addPlanets(r.default),function(e,t){var i=window.XMLHttpRequest?new XMLHttpRequest:new ActiveXObject("Microsoft.XMLHTTP");i.open("GET",e),i.onreadystatechange=function(){i.readyState>3&&200===i.status&&t(i.responseText)},i.setRequestHeader("X-Requested-With","XMLHttpRequest"),i.send()}("data/catalog.json",function(e){var t=JSON.parse(e);a.setAsteroids(t)}),window.addEventListener("resize",function(){a.resize(window.innerWidth,window.innerHeight)})},function(e,t,i){"use strict";Object.defineProperty(t,"__esModule",{value:!0});var n=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),r=function(e){if(e&&e.__esModule)return e;var t={};if(null!=e)for(var i in e)Object.prototype.hasOwnProperty.call(e,i)&&(t[i]=e[i]);return t.default=e,t}(i(0)),o=i(5),a=h(i(6)),s=h(i(7)),u=h(i(8)),l=h(i(10)),c=h(i(11));function h(e){return e&&e.__esModule?e:{default:e}}var d=function(){function e(t){!function(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}(this,e),t=t||{},this.width=t.width||800,this.height=t.height||800,this.startDate=t.startDate||new Date(1990,1),this.jedDelta=t.jedDelta||1.5,this.jed=(0,o.toJED)(this.startDate),this.planets=[],this.asteroidData=[],this.asteroids=[],this.createSystem(),this.setupGui(),this.controls=new a.default(this),this.tick()}return n(e,[{key:"setupGui",value:function(){this.gui={},this.gui.date=document.getElementById("orrery-date"),this.stats=new s.default,this.gui.fps=document.getElementById("orrery-fps"),this.gui.count=document.getElementById("orrery-count"),this.gui.controls=new u.default(this)}},{key:"updateGui",value:function(){var e=(0,o.fromJED)(this.jed).toISOString().slice(0,10);this.gui.date.textContent=e,this.gui.fps.textContent=this.stats.fps+" FPS",this.gui.count.textContent=this.asteroids.length}},{key:"createSystem",value:function(){this.renderer=new r.WebGLRenderer(this.width,this.height,{backgroundColor:0,antialias:!0}),this.stage=new r.Container,this.stage.x=this.width/2,this.stage.y=this.height/2,this.addStar(),this.planetContainer=new r.particles.ParticleContainer(10),this.stage.addChild(this.planetContainer),this.particleContainer=new r.particles.ParticleContainer(999999,{scale:!0,tint:!0},16384,!0),this.stage.addChild(this.particleContainer),this.cirleTexture=this.createCirleTexture(),document.getElementById("orrery").appendChild(this.renderer.view)}},{key:"createCirleTexture",value:function(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:5,t=new r.Graphics;return t.beginFill(16777215),t.drawCircle(0,0,e),t.endFill(),this.renderer.generateTexture(t)}},{key:"addStar",value:function(){var e=new r.Graphics;e.beginFill(16773804),e.drawCircle(0,0,5),e.endFill(),this.stage.addChild(e)}},{key:"addPlanets",value:function(e){var t=this;e.forEach(function(e){var i=new l.default(e.ephemeris,t.cirleTexture,{name:e.name,size:e.size,color:e.color}),n=i.orbit.createOrbit(t.jed);t.stage.addChild(n),t.planets.push(i),t.planetContainer.addChild(i.body)})}},{key:"setAsteroids",value:function(e){this.asteroidData=e}},{key:"discoverAsteroids",value:function(e){var t=0,i=!0,n=!1,r=void 0;try{for(var o,a=this.asteroidData[Symbol.iterator]();!(i=(o=a.next()).done);i=!0){var s=o.value;if(s.disc>e)break;t++,this.addAsteroid(s)}}catch(e){n=!0,r=e}finally{try{!i&&a.return&&a.return()}finally{if(n)throw r}}t>0&&this.asteroidData.splice(0,t)}},{key:"addAsteroid",value:function(e){var t=new c.default(e,this.cirleTexture);this.asteroids.push(t),this.particleContainer.addChild(t.body),this.asteroidCount++}},{key:"tick",value:function(){var e=this;this.stats.begin(),this.jed+=this.jedDelta,this.discoverAsteroids(this.jed),this.planets.forEach(function(t){return t.render(e.jed)}),this.asteroids.forEach(function(t){return t.render(e.jed)}),this.renderer.render(this.stage),this.updateGui(),this.stats.end(),requestAnimationFrame(this.tick.bind(this))}},{key:"resize",value:function(e,t){this.width=e,this.height=t,this.renderer.resize(e,t),this.stage.x=e/2,this.stage.y=t/2}}]),e}();t.default=d},function(e,t,i){"use strict";Object.defineProperty(t,"__esModule",{value:!0}),t.toJED=function(e){return e/864e5+n.UNIX_EPOCH_JULIAN_DATE},t.fromJED=function(e){return new Date(864e5*(-n.UNIX_EPOCH_JULIAN_DATE+e))};var n=i(1)},function(e,t,i){"use strict";Object.defineProperty(t,"__esModule",{value:!0});t.default=function e(t){var i=this,n=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{};!function(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}(this,e),this.onScroll=function(e){var t=e.wheelDelta||-e.detail,n=i.options.multiplier,r=t>0?n:1/n,o=i.orrery.stage.scale;o.set(o.x*r)},n.multiplier=n.multiplier||1.04,this.options=n,this.orrery=t,t.renderer.view.addEventListener("DOMMouseScroll",this.onScroll),t.renderer.view.addEventListener("mousewheel",this.onScroll)}},function(e,t,i){"use strict";Object.defineProperty(t,"__esModule",{value:!0});var n=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}();var r=function(){function e(){!function(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}(this,e),this.performance=performance||Date,this.fps=0,this.frames=0,this.beginTime=this.performance.now(),this.prevTime=this.beginTime}return n(e,[{key:"begin",value:function(){this.beginTime=this.performance.now()}},{key:"end",value:function(){this.frames++;var e=this.performance.now();return e>this.prevTime+1e3&&(this.fps=Math.round(1e3*this.frames/(e-this.prevTime)),this.prevTime=e,this.frames=0),e}},{key:"update",value:function(){this.beginTime=this.end()}}]),e}();t.default=r},function(e,t,i){"use strict";Object.defineProperty(t,"__esModule",{value:!0});var n=function(e){if(e&&e.__esModule)return e;var t={};if(null!=e)for(var i in e)Object.prototype.hasOwnProperty.call(e,i)&&(t[i]=e[i]);return t.default=e,t}(i(9));t.default=function e(t){!function(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}(this,e),new n.GUI({hideable:!1}).add(t,"jedDelta",0,8).name("speed")}},function(e,t){e.exports=dat},function(e,t,i){"use strict";Object.defineProperty(t,"__esModule",{value:!0});var n=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),r=function(e){if(e&&e.__esModule)return e;var t={};if(null!=e)for(var i in e)Object.prototype.hasOwnProperty.call(e,i)&&(t[i]=e[i]);return t.default=e,t}(i(0)),o=function(e){return e&&e.__esModule?e:{default:e}}(i(2));var a=function(){function e(t,i){var n=arguments.length>2&&void 0!==arguments[2]?arguments[2]:{};!function(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}(this,e),this.options=Object.assign({},e.defaultOptions,n),this.orbit=new o.default(t);var a=new r.Sprite(i);a.width=a.height=this.options.size,a.anchor.x=a.anchor.y=.5,a.tint=this.options.color,this.body=a}return n(e,[{key:"render",value:function(e){var t=this.orbit.getPosAtTime(e),i=t.x,n=t.y;this.body.position.x=i,this.body.position.y=n}}]),e}();a.defaultOptions={size:4,color:16777215},t.default=a},function(e,t,i){"use strict";Object.defineProperty(t,"__esModule",{value:!0});var n=function(){function e(e,t){for(var i=0;i<t.length;i++){var n=t[i];n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,n.key,n)}}return function(t,i,n){return i&&e(t.prototype,i),n&&e(t,n),t}}(),r=function(e){if(e&&e.__esModule)return e;var t={};if(null!=e)for(var i in e)Object.prototype.hasOwnProperty.call(e,i)&&(t[i]=e[i]);return t.default=e,t}(i(0)),o=function(e){return e&&e.__esModule?e:{default:e}}(i(2));var a=function(){function e(t,i){var n=arguments.length>2&&void 0!==arguments[2]?arguments[2]:{};!function(e,t){if(!(e instanceof t))throw new TypeError("Cannot call a class as a function")}(this,e),this.options=Object.assign({},e.defaultOptions,n),this.orbit=new o.default(t);var a=new r.Sprite(i);a.width=a.height=this.options.size,a.anchor.x=a.anchor.y=.5,a.tint=this.options.discoveryColor,this.originalScale=a.scale.x,a.scale.x=a.scale.y*=this.options.discoveryScale,this.body=a}return n(e,[{key:"render",value:function(e){this.renderPosition(e),this.body.scale.x=this.body.scale.y-=.005,this.body.scale.x<=this.originalScale&&(this.body.tint=this.options.color,this.body.scale.x=this.body.scale.y=this.originalScale,delete this.originalScale,this.render=this.renderPosition)}},{key:"renderPosition",value:function(e){var t=this.orbit.getPosAtTime(e),i=t.x,n=t.y;this.body.position.x=i,this.body.position.y=n}}]),e}();a.defaultOptions={size:1,color:11184810,discoveryColor:65280,discoveryScale:3},t.default=a},function(e,t,i){"use strict";Object.defineProperty(t,"__esModule",{value:!0}),t.default=[{name:"Mercury",size:1.6,color:15519134,ephemeris:{epoch:2451545,a:.38709893,e:.20563069,i:7.00487,W:48.33167,w:29.124,wbar:77.45645,L:252.25084,M:174.79439,P:87.969}},{name:"Venus",size:1.8,color:15519134,ephemeris:{epoch:2451545,a:.72333199,e:.00677323,i:3.39471,W:76.68069,w:29.124,wbar:131.53298,L:181.97973,M:50.44675,P:224.701}},{name:"Earth",size:2.8,color:10010879,ephemeris:{epoch:2451545,a:1.00000011,e:.01671022,i:5e-5,W:-11.26064,w:114.20783,wbar:102.94719,L:100.46435,M:-2.47311027,P:365.256}},{name:"Mars",size:2.2,color:16759939,ephemeris:{epoch:2451545,a:1.52366231,e:.09341233,i:1.85061,W:49.57854,w:286.537,wbar:336.04084,L:355.45332,M:19.41248,P:686.98}},{name:"Jupiter",size:4,color:12960701,ephemeris:{epoch:2451545,a:5.20336301,e:.04839266,i:1.3053,W:100.55615,w:275.066,wbar:14.75385,L:34.40438,M:19.65053,P:4332.589}},{name:"Saturn",size:3.2,color:15519134,ephemeris:{epoch:2451545,a:9.53707032,e:.0541506,i:2.48446,W:113.71504,w:336.013862,wbar:92.43194,L:49.94432,M:42.48762,P:10759.22}}]}]);