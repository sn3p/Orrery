import Asteroids from "../src/unified/pixi/Asteroids";
import { orbitGLSL, REFERENCE_JED, REBASE_DAYS, MAX_PHASE_ADVANCE } from "../src/js/asteroidOrbits";

const check = (condition, message) => { if (!condition) throw new Error(message); };

// Independent double precision bisection, bounded even near e=1. Deliberately
// uses the true-anomaly projection rather than the shader's orbital bases.
export function reference(d, jed) {
  const rad = Math.PI / 180, tau = 2 * Math.PI;
  const n = d.n == null ? tau / d.P : d.n * rad;
  let M = d.M * rad + n * (jed - d.epoch);
  M = ((M + Math.PI) % tau + tau) % tau - Math.PI;
  let lo = -Math.PI, hi = Math.PI;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (mid - d.e * Math.sin(mid) < M) lo = mid;
    else hi = mid;
  }
  const E = (lo + hi) / 2;
  const v = Math.atan2(Math.sqrt(1 - d.e * d.e) * Math.sin(E), Math.cos(E) - d.e);
  const r = d.a * (1 - d.e * Math.cos(E)) * 100;
  const o = d.W * rad, w = ((d.wbar ?? d.w + d.W) - d.W) * rad, inc = d.i * rad;
  return [-r * (Math.cos(o) * Math.cos(v + w) - Math.sin(o) * Math.sin(v + w) * Math.cos(inc)),
    r * (Math.sin(o) * Math.cos(v + w) + Math.cos(o) * Math.sin(v + w) * Math.cos(inc))];
}

function feedback(gl, cloud) {
  const program = gl.createProgram();
  const shaders = [];
  for (const [type, source] of [[gl.VERTEX_SHADER, `#version 300 es
    precision highp float;
    in vec4 aBasis; in vec2 aElements; in float aMeanAnomaly; uniform float time; out vec2 result;
    ${orbitGLSL}
    void main() { result = orbitPosition(aBasis.xy, aBasis.zw, aElements, aMeanAnomaly, time); gl_Position=vec4(result,0,1); }`],
    [gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float; out vec4 c; void main(){c=vec4(1);}"]]) {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    check(gl.getShaderParameter(shader, gl.COMPILE_STATUS), gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader); shaders.push(shader);
  }
  gl.transformFeedbackVaryings(program, ["result"], gl.INTERLEAVED_ATTRIBS);
  gl.linkProgram(program); check(gl.getProgramParameter(program, gl.LINK_STATUS), gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const buffers = [];
  for (const [name, size] of [["aBasis", 4], ["aElements", 2], ["aMeanAnomaly", 1]]) {
    const buffer = gl.createBuffer(); buffers.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, cloud.geometry.getBuffer(name).data, gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  }
  const count = cloud.discoveryDates.length;
  const tf = gl.createTransformFeedback(); gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
  const destination = gl.createBuffer(); buffers.push(destination);
  gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, destination);
  gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, count * 8, gl.STREAM_READ);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, destination);
  gl.enable(gl.RASTERIZER_DISCARD);
  gl.uniform1f(gl.getUniformLocation(program, "time"), cloud.uniforms.uOrbitTime);
  gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, count); gl.endTransformFeedback();
  const result = new Float32Array(count * 2); gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, result);
  check(gl.getError() === gl.NO_ERROR, "Transform feedback GL error");
  gl.disable(gl.RASTERIZER_DISCARD); gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
  buffers.forEach(b => gl.deleteBuffer(b)); gl.deleteTransformFeedback(tf); gl.deleteVertexArray(vao);
  gl.deleteProgram(program); shaders.forEach(s => gl.deleteShader(s));
  return result;
}

export function shaderAccuracy(texture, catalog, planets = []) {
  const canvas = document.createElement("canvas"), gl = canvas.getContext("webgl2");
  if (!gl) return { unavailable: "WebGL2 transform feedback unavailable" };
  const special = [0, 0.8, 0.961, 0.99, 0.9999, 0.99999994].flatMap(e =>
    [0, 0.000001, -0.000001, 0.0001, -0.0001, 1, -1, 179.999, -179.999].map(M => ({
      a: 1, e, M, i: 0, W: 0, wbar: 0, n: 1, epoch: REFERENCE_JED, disc: REFERENCE_JED,
    })));
  const samples = catalog;
  const motionLimit = MAX_PHASE_ADVANCE / REBASE_DAYS;
  const fastest = [0, 0.99, 0.99999994].flatMap(e => [0, 45].flatMap(M =>
    [{ n: motionLimit * 180 / Math.PI }, { P: 2 * Math.PI / motionLimit }].map(motion => ({
      a: 1, e, M, i: 0, W: 0, wbar: 0, ...motion, epoch: REFERENCE_JED, disc: REFERENCE_JED,
    }))));
  const report = [];
  for (const [label, data] of [["catalogue", samples], ["high-e", special], ["motion-limit", fastest], ["planets", planets.map(p => ({ ...p.ephemeris, disc: REFERENCE_JED }))]]) {
    const sorted = data.slice().sort((a, b) => a.disc - b.disc);
    const cloud = new Asteroids(data, texture, REFERENCE_JED);
    let maxWorldError = 0, worst;
    for (const offset of [0, REBASE_DAYS, REBASE_DAYS + 0.01, -REBASE_DAYS, -REBASE_DAYS - 0.01, -50000, 50000]) {
      // Start each case at the same origin so both edges really are exercised.
      cloud.update(REFERENCE_JED);
      const jed = REFERENCE_JED + offset;
      cloud.update(jed);
      const actual = feedback(gl, cloud);
      sorted.forEach((d, i) => {
        const expected = reference(d, jed);
        const error = Math.hypot(actual[i * 2] - expected[0], actual[i * 2 + 1] - expected[1]);
        check(Number.isFinite(error), `Nonfinite shader position ${label}/${i}/${offset}`);
        if (error > maxWorldError) { maxWorldError = error; worst = { i, offset, e: d.e }; }
        check(error * 20 < 0.25, `Shader error exceeds 0.25px at 20x zoom: ${label}/${i}/${offset}: ${error * 20}`);
        check(Math.hypot(...expected) < cloud.bounds.maxX, "Orbit outside conservative bounds");
      });
    }
    report.push({ label, count: data.length, maxWorldError, pixelsAt20x: maxWorldError * 20, worst });
    cloud.destroy();
  }
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return report;
}
