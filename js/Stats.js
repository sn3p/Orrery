// Inspired by Stats.js
// https://github.com/mrdoob/stats.js

// Stats.js bookmarklet:
// javascript:(function(){var script=document.createElement('script');script.onload=function(){var stats=new Stats();document.body.appendChild(stats.dom);requestAnimationFrame(function loop(){stats.update();requestAnimationFrame(loop)});};script.src='//rawgit.com/mrdoob/stats.js/master/build/stats.min.js';document.head.appendChild(script);})()

class Stats {
  constructor() {
    this.performance = (performance || Date);
    this.fps = 0;
    this.frames = 0;
    this.beginTime = this.performance.now();
    this.prevTime = this.beginTime;
  }

  begin() {
    this.beginTime = this.performance.now();
  }

  end() {
    this.frames ++;
    const time = this.performance.now();

    if (time > this.prevTime + 1000) {
      this.fps = Math.round((this.frames * 1000) / (time - this.prevTime));
      this.prevTime = time;
      this.frames = 0;
    }

    return time;
  }

  update() {
    this.beginTime = this.end();
  }
};
