// Optional real-WebGPU checks. Run with Node 24 and a working vgpu/node adapter.
import assert from 'node:assert/strict';
import { effect, init, target } from 'vgpu/node';
import { createHeroCanvasShaderSource } from '../src/lib/heroCanvasShader.ts';

const gpu = await init();
try {
  const source = createHeroCanvasShaderSource(3);
  const output = target(gpu, { size: [880, 1000] });
  const params = { resolution: output.size, time: 3.25, motion: 1, detail: 1, pad0: 0 };
  const shader = effect(gpu, source, { set: { params } });

  shader.draw(output);
  const first = await output.read();
  shader.set({ params: { time: 3.45 } }).draw(output);
  const next = await output.read();
  let changedPixels = 0;
  let maximumDelta = 0;
  for (let i = 0; i < first.length; i += 4) {
    const delta = Math.max(...[0, 1, 2].map(channel => Math.abs(first[i + channel] - next[i + channel])));
    if (delta > 24) changedPixels++;
    maximumDelta = Math.max(maximumDelta, delta);
  }
  assert(changedPixels > 150 && maximumDelta > 60, 'Lightning must visibly relocate within 200ms');

  shader.set({ params: { time: 3.25, motion: 0 } }).draw(output);
  const frozen = await output.read();
  shader.set({ params: { time: 18.25 } }).draw(output);
  assert.deepEqual(frozen, await output.read(), 'Reduced motion must freeze arcs and sparks');

  // Use the shipped geometry and lighting helpers, not a CPU port of the shader.
  const helpers = source.slice(0, source.indexOf('@fragment'));
  const probe = target(gpu, { size: [1, 1], format: 'rgba32float' });
  const probeSource = `${helpers}
    @fragment fn fs_main() -> @location(0) vec4f {
      var outside = -1.0;
      for (var e = 0; e < 64; e++) {
        let epoch = f32(e);
        for (var i = 1; i <= 8; i++) {
          let a = lightningPoint(i - 1, epoch);
          let b = lightningPoint(i, epoch);
          for (var j = 0; j <= 4; j++) {
            outside = max(outside, anvilSdf(mix(a, b, f32(j) / 4.0)));
          }
          if (i == 3 || i == 5 || i == 7) {
            let elbow = lightningBranchPoint(i, epoch, 1);
            let end = lightningBranchPoint(i, epoch, 2);
            for (var j = 0; j <= 4; j++) {
              outside = max(outside, anvilSdf(mix(b, elbow, f32(j) / 4.0)));
              outside = max(outside, anvilSdf(mix(elbow, end, f32(j) / 4.0)));
            }
          }
        }
        for (var i = 0; i < 3; i++) {
          for (var j = 0; j <= 4; j++) {
            outside = max(outside, anvilSdf(lightningSparkPoint(i, epoch, f32(j) / 4.0)));
          }
        }
      }
      let p = lightningPoint(4, 0.0);
      let rgb = internalLightRadiance(p + vec3f(0.0, 0.0, 0.3), vec3f(0.0, 0.0, -1.0), 0.6, 0.0, 0.0);
      return vec4f(rgb, outside);
    }
  `;
  effect(gpu, probeSource, { set: { params } }).draw(probe);
  const values = await probe.readFloats();
  assert(values[0] > 0.5, 'Lightning core must be bright enough to read against glass');
  assert.equal(values[0], values[1], 'Lightning must be neutral white');
  assert.equal(values[1], values[2], 'Lightning must be neutral white');
  assert(values[3] < 0, 'Sampled arcs, branches and sparks must stay inside the anvil');

  console.log(`Lightning passed: ${changedPixels} pixels visibly changed in 200ms; peak delta ${maximumDelta}.`);
  console.log('Reduced motion, neutral-white emission and 64-epoch containment checks passed.');
} finally {
  gpu.dispose();
}
