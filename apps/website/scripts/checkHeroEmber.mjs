// Optional real-WebGPU checks. Run with Node 24 and a working vgpu/node adapter.
import assert from 'node:assert/strict';
import { effect, init, target } from 'vgpu/node';
import { createHeroCanvasShaderSource } from '../src/lib/heroCanvasShader.ts';

const size = [880, 1000];
const flickerPeriod = (2 * Math.PI) / 1.4;

function changes(first, next) {
  const result = { pixels: 0, horn: 0, heel: 0 };
  for (let i = 0; i < first.length; i += 4) {
    const delta = Math.max(...[0, 1, 2].map(channel => Math.abs(first[i + channel] - next[i + channel])));
    if (delta <= 12) continue;
    result.pixels++;
    const x = (i / 4) % size[0];
    if (x < size[0] * 0.32) result.horn++;
    if (x > size[0] * 0.66) result.heel++;
  }
  return result;
}

const gpu = await init();
try {
  const source = createHeroCanvasShaderSource();
  const params = { resolution: size, time: 3.25, motion: 1, detail: 1, hover: 0, pointer: [0.5, 0.5] };
  const output = target(gpu, { size });
  const shader = effect(gpu, source, { set: { params } });
  const render = async (next) => {
    shader.set({ params: next }).draw(output);
    return output.read();
  };

  const idle = await render({});
  const drifted = changes(idle, await render({ time: 3.25 + flickerPeriod }));
  assert(drifted.pixels > 150, `Ember must drift while the mouse is away: ${JSON.stringify(drifted)}`);

  const left = await render({ hover: 1, pointer: [0.12, 0.42] });
  const moved = changes(left, await render({ pointer: [0.88, 0.36] }));
  assert(moved.horn > 30 && moved.heel > 30,
    `Moving the mouse across must move the ember across the anvil: ${JSON.stringify(moved)}`);

  const frozen = await render({ time: 3.25, motion: 0, hover: 0 });
  assert.deepEqual(frozen, await render({ time: 18.25, hover: 1, pointer: [0.1, 0.2] }),
    'Reduced motion must freeze lighting even with mouse input');

  // The probe executes the shipped WGSL, not a CPU reimplementation.
  const helpers = source.slice(0, source.indexOf('@fragment'));
  const probe = target(gpu, { size: [1, 1], format: 'rgba32float' });
  const probeSource = `${helpers}
    @fragment fn fs_main() -> @location(0) vec4f {
      var outside = -1.0;
      for (var x = 0; x <= 60; x++) {
        for (var y = 0; y <= 40; y++) {
          for (var z = 0; z <= 20; z++) {
            let aim = vec3f(-3.0, -1.0, -1.0) + vec3f(f32(x), f32(y), f32(z)) * 0.1;
            outside = max(outside, anvilSdf(containEmber(aim)));
          }
        }
      }

      let cam = heroCam(${size[0] / size[1]});
      var driftStep = 0.0;
      var previous = emberPoint(cam, 0.0, 0.0, vec2f(0.5));
      for (var frame = 1; frame <= 24000; frame++) {
        let next = emberPoint(cam, f32(frame) / 60.0, 0.0, vec2f(0.5));
        driftStep = max(driftStep, distance(previous, next));
        previous = next;
      }

      var sweepStep = 0.0;
      for (var line = 0; line <= 20; line++) {
        let across = f32(line) / 20.0;
        var lastRow = emberPoint(cam, 0.0, 1.0, vec2f(0.0, across));
        var lastColumn = emberPoint(cam, 0.0, 1.0, vec2f(across, 0.0));
        for (var i = 1; i <= 1000; i++) {
          let along = f32(i) / 1000.0;
          let row = emberPoint(cam, 0.0, 1.0, vec2f(along, across));
          let column = emberPoint(cam, 0.0, 1.0, vec2f(across, along));
          sweepStep = max(sweepStep, max(distance(lastRow, row), distance(lastColumn, column)));
          lastRow = row;
          lastColumn = column;
        }
      }
      return vec4f(outside, driftStep, sweepStep, 0.0);
    }
  `;
  effect(gpu, probeSource, { set: { params } }).draw(probe);
  const [outside, driftStep, sweepStep] = await probe.readFloats();
  assert(outside < 0, `Ember must stay inside the glass for every aim point: ${outside}`);
  assert(driftStep < 0.02, `Idle drift must not jump between frames: ${driftStep}`);
  assert(sweepStep < 0.02, `Sweeping the mouse must not make the ember jump: ${sweepStep}`);

  console.log('Drift:', drifted, 'Mouse:', moved, 'Steps:', { driftStep, sweepStep });
  console.log('Frozen reduced motion, ember containment, and continuity passed.');
} finally {
  gpu.dispose();
}
