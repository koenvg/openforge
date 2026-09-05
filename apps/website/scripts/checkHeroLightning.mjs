// Optional real-WebGPU checks. Run with Node 24 and a working vgpu/node adapter.
import assert from 'node:assert/strict';
import { effect, init, target } from 'vgpu/node';
import { createHeroCanvasShaderSource } from '../src/lib/heroCanvasShader.ts';

const size = [880, 1000];
function changes(first, next) {
  const result = { pixels: 0, peak: 0, horn: 0, heel: 0, base: 0 };
  for (let i = 0; i < first.length; i += 4) {
    const delta = Math.max(...[0, 1, 2].map(channel => Math.abs(first[i + channel] - next[i + channel])));
    result.peak = Math.max(result.peak, delta);
    if (delta <= 24) continue;
    result.pixels++;
    const x = (i / 4) % size[0];
    const y = Math.floor(i / 4 / size[0]);
    if (x < size[0] * 0.32) result.horn++;
    if (x > size[0] * 0.66) result.heel++;
    if (y > size[1] * 0.60) result.base++;
  }
  return result;
}

const gpu = await init();
try {
  const source = createHeroCanvasShaderSource(3);
  const output = target(gpu, { size });
  const params = { resolution: size, time: 3.25, motion: 1, detail: 1, hover: 0, pointer: [0.5, 0.5] };
  const shader = effect(gpu, source, { set: { params } });
  shader.draw(output);
  const first = await output.read();

  shader.set({ params: { hover: 1, pointer: [0.1, 0.4] } }).draw(output);
  const leftHover = await output.read();
  shader.set({ params: { pointer: [0.9, 0.4] } }).draw(output);
  const attraction = changes(leftHover, await output.read());
  assert(attraction.pixels > 150 && attraction.horn > 30 && attraction.heel > 30,
    `Mouse movement must visibly relocate the discharge: ${JSON.stringify(attraction)}`);

  shader.set({ params: { hover: 0, time: 3.85 } }).draw(output);
  const motion = changes(first, await output.read());
  assert(motion.pixels > 150 && motion.peak > 60, 'Slower lightning must remain visibly animated');
  const coverage = { horn: 0, heel: 0, base: 0 };
  for (let step = 1; step <= 12; step++) {
    shader.set({ params: { time: 3.25 + step * 0.8 } }).draw(output);
    const delta = changes(first, await output.read());
    for (const region of Object.keys(coverage)) coverage[region] += delta[region];
  }
  assert(Object.values(coverage).every(count => count > 100),
    `Ambient discharges must reach beyond the center: ${JSON.stringify(coverage)}`);

  shader.set({ params: { time: 3.25, motion: 0 } }).draw(output);
  const frozen = await output.read();
  shader.set({ params: { time: 18.25, hover: 1, pointer: [0.1, 0.2] } }).draw(output);
  assert.deepEqual(frozen, await output.read(), 'Reduced motion must freeze lighting even with mouse input');

  // Diagnostic probes execute the shipped WGSL, not a CPU reimplementation.
  const helpers = source.slice(0, source.indexOf('@fragment'));
  const probe = target(gpu, { size: [1, 1], format: 'rgba32float' });
  const probeSource = `${helpers}
    @fragment fn fs_main() -> @location(0) vec4f {
      var outside = -1.0;
      for (var site = 0; site < 7; site++) {
        for (var x = -2; x <= 2; x++) {
          for (var y = -2; y <= 2; y++) {
            for (var z = -2; z <= 2; z++) {
              let local = vec3f(f32(x), f32(y), f32(z)) * 0.5;
              outside = max(outside, anvilSdf(lightningSite(site) + lightningSpread(site) * local));
            }
          }
        }
        for (var e = 0; e < 64; e++) {
          let epoch = f32(e);
          for (var i = 1; i <= 4; i++) {
            let a = lightningPoint(i - 1, epoch, site);
            let b = lightningPoint(i, epoch, site);
            for (var j = 0; j <= 4; j++) {
              outside = max(outside, anvilSdf(mix(a, b, f32(j) / 4.0)));
            }
          }
          let junction = lightningPoint(2, epoch, site);
          let elbow = lightningBranchPoint(epoch, site, 1);
          let end = lightningBranchPoint(epoch, site, 2);
          for (var j = 0; j <= 4; j++) {
            outside = max(outside, anvilSdf(mix(junction, elbow, f32(j) / 4.0)));
            outside = max(outside, anvilSdf(mix(elbow, end, f32(j) / 4.0)));
            for (var i = 0; i < 2; i++) {
              outside = max(outside, anvilSdf(lightningSparkPoint(i, epoch, site, f32(j) / 4.0)));
            }
          }
        }
      }
      let p = lightningPoint(2, 0.0, 2);
      let rgb = internalLightRadiance(p + vec3f(0.0, 0.0, 0.3), vec3f(0.0, 0.0, -1.0), 0.6, 0.2, 1.0, 2);
      return vec4f(rgb, outside);
    }
  `;
  effect(gpu, probeSource, { set: { params } }).draw(probe);
  const values = await probe.readFloats();
  assert(values[0] > 0.5, 'Lightning core must remain bright');
  assert.equal(values[0], values[1], 'Lightning must be neutral white');
  assert.equal(values[1], values[2], 'Lightning must be neutral white');
  assert(values[3] < 0, `Discharge volumes and paths must stay inside the anvil: ${values[3]}`);

  const timingSource = `${helpers}
    @fragment fn fs_main() -> @location(0) vec4f {
      var regions = 0u;
      for (var e = 0; e < 64; e++) {
        for (var lane = 0; lane < 3; lane++) {
          regions |= 1u << u32(lightningRegion(lane, f32(e), -1));
        }
      }
      return vec4f(lightningCycle(0.2, 1.0, 0).x, lightningCycle(0.6, 1.0, 0).x,
        lightningCycle(0.9, 1.0, 0).x, f32(regions));
    }
  `;
  effect(gpu, timingSource, { set: { params } }).draw(probe);
  assert.deepEqual([...await probe.readFloats()], [0, 0, 1, 127],
    'Paths must hold longer than 600ms, renew by 900ms, and visit all seven regions');

  console.log('Visible motion:', motion, 'Mouse attraction:', attraction, 'Ambient coverage:', coverage);
  console.log('Slower timing, frozen reduced motion, neutral-white emission and seven-region containment passed.');
} finally {
  gpu.dispose();
}
