/** Format a JS number as a WGSL f32 literal. */
const f = (value: number): string => {
  const text = String(value);
  return text.includes('.') || text.includes('e') ? text : `${text}.0`;
};

/**
 * Camera framing for the left-facing anvil: low product angle, weak perspective,
 * and enough left bias for the wedge horn.
 */
const CAMERA = {
  target: [-0.2, 0.60, 0.0],
  distance: 8.9,
  azimuth: -0.50,
  elevation: 0.30,
  fovY: 0.42,
} as const;

/**
 * The hero visual: a translucent, ray-marched glass anvil on a light technical
 * grid. Everything lives in one fullscreen fragment effect — no mesh assets,
 * no extra passes.
 *
 * `layer` is a build-time debug knob for sculpting: 0 renders only the base,
 * 1 adds the waist, 2 adds the plate and wedge horn (all with matte shading so the
 * geometry reads honestly), 3 is the production glass shading.
 */
export function createHeroCanvasShaderSource(layer = 3): string {
  return `
  struct Params {
    resolution: vec2f,
    time: f32,
    motion: f32,
    detail: f32,
    pad0: f32,
  }

  @group(0) @binding(0) var<uniform> params: Params;

  const LAYER: i32 = ${layer};

  const CAM_TARGET: vec3f = vec3f(${f(CAMERA.target[0])}, ${f(CAMERA.target[1])}, ${f(CAMERA.target[2])});
  const CAM_DIST: f32 = ${f(CAMERA.distance)};
  const CAM_AZ: f32 = ${f(CAMERA.azimuth)};
  const CAM_EL: f32 = ${f(CAMERA.elevation)};
  const CAM_TAN_H: f32 = ${f(Math.tan(CAMERA.fovY / 2))};

  struct CamBasis {
    eye: vec3f,
    fwd: vec3f,
    right: vec3f,
    up: vec3f,
    tanH: f32,
    aspect: f32,
  }

  fn makeCam(aspect: f32, zoom: f32) -> CamBasis {
    let dist = CAM_DIST * zoom;
    let cosEl = cos(CAM_EL);
    let eye = CAM_TARGET + dist * vec3f(cosEl * sin(CAM_AZ), sin(CAM_EL), cosEl * cos(CAM_AZ));
    let fwd = normalize(CAM_TARGET - eye);
    let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
    let up = cross(right, fwd);
    return CamBasis(eye, fwd, right, up, CAM_TAN_H, aspect);
  }

  fn uvToRay(cam: CamBasis, uv: vec2f) -> vec3f {
    let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
    return normalize(cam.fwd + cam.right * (ndc.x * cam.aspect * cam.tanH) + cam.up * (ndc.y * cam.tanH));
  }

  fn worldToUv(cam: CamBasis, w: vec3f) -> vec2f {
    let rel = w - cam.eye;
    let depth = max(dot(rel, cam.fwd), 0.000001);
    let ndcX = dot(rel, cam.right) / (depth * cam.aspect * cam.tanH);
    let ndcY = dot(rel, cam.up) / (depth * cam.tanH);
    return vec2f(ndcX * 0.5 + 0.5, 0.5 - ndcY * 0.5);
  }

  fn hash21(seed: vec2f) -> f32 {
    var p = fract(seed * vec2f(0.1031, 0.1030));
    p += dot(p, p.yx + 33.33);
    return fract((p.x + p.y) * p.x);
  }

  // --- Background: light technical grid with sparse GPU-style markers ---

  fn background(uv: vec2f, aspect: f32, aa: f32, detail: f32) -> vec3f {
    var color = vec3f(0.986, 0.989, 0.992) - vec3f(0.012, 0.010, 0.004) * uv.y;

    // Pixel-crisp grid, same cadence as the page background.
    let gridUv = uv * vec2f(30.0 * aspect, 30.0);
    let gridPx = vec2f(30.0 * aspect, 30.0) / max(params.resolution, vec2f(1.0));
    let gridX = 1.0 - smoothstep(gridPx.x * 0.7, gridPx.x * 1.5, abs(fract(gridUv.x) - 0.5));
    let gridY = 1.0 - smoothstep(gridPx.y * 0.7, gridPx.y * 1.5, abs(fract(gridUv.y) - 0.5));
    color -= vec3f(0.028, 0.034, 0.044) * max(gridX, gridY);

    if (detail > 0.5) {
      let cell = floor(gridUv);
      let cellPick = hash21(cell);
      let cellUv = fract(gridUv) - 0.5;
      let cellPx = cellUv / gridPx;

      // Sparse intersection dots.
      let dotMask = (1.0 - smoothstep(0.8, 1.6, length(cellPx))) * step(0.935, cellPick);
      color = mix(color, vec3f(0.45, 0.52, 0.68), dotMask * 0.30);

      // Rare plus markers.
      let plusPick = hash21(cell + vec2f(17.31, 9.17));
      let plusArm = 2.6;
      let plusLine = 0.45;
      let plusH = (1.0 - smoothstep(plusLine, plusLine + 0.8, abs(cellPx.y))) * (1.0 - smoothstep(plusArm, plusArm + 0.8, abs(cellPx.x)));
      let plusV = (1.0 - smoothstep(plusLine, plusLine + 0.8, abs(cellPx.x))) * (1.0 - smoothstep(plusArm, plusArm + 0.8, abs(cellPx.y)));
      let plus = max(plusH, plusV) * step(0.965, plusPick);
      color = mix(color, vec3f(0.42, 0.48, 0.64), plus * 0.38);
    }
    return color;
  }

  // --- Anvil SDF ---


  fn sdRoundBox(p: vec3f, b: vec3f, r: f32) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
  }

  // Layer 0: low stepped base, narrower than the full face and horn.
  fn baseSdf(p: vec3f) -> f32 {
    var base = sdRoundBox(p - vec3f(-0.10, 0.05, 0.0), vec3f(0.99, 0.05, 0.54), 0.008);
    base = min(base, sdRoundBox(p - vec3f(-0.10, 0.17, 0.0), vec3f(0.82, 0.07, 0.42), 0.008));
    return base;
  }

  // A broad planar upper body, a short curved pinch, and a sloping foot.
  // Signed axial bounds must stay negative inside the solid, not clamp to zero.
  fn waistDistances(p: vec3f) -> vec3f {
    let y = clamp(p.y, 0.24, 1.32);
    let lower = clamp((0.62 - y) / 0.38, 0.0, 1.0);
    let upper = clamp((y - 0.62) / 0.70, 0.0, 1.0);
    let left = -0.30 - 0.55 * lower * lower - 0.22 * smoothstep(0.0, 0.35, upper);
    let right = 0.24 + 0.54 * lower * lower + upper;
    let depth = 0.20 + 0.22 * max(lower, smoothstep(0.0, 0.30, upper));
    return vec3f(max(left - p.x, p.x - right), max(0.24 - p.y, p.y - 1.32), abs(p.z) - depth);
  }

  fn waistSdf(p: vec3f) -> f32 {
    let d = waistDistances(p);
    // Conservative distance bound for the steepest part of the waist profile.
    return (length(max(d, vec3f(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0) - 0.008) * 0.40;
  }

  fn plateSdf(p: vec3f) -> f32 {
    return sdRoundBox(p - vec3f(0.39, 1.365, 0.0), vec3f(0.91, 0.045, 0.42), 0.008);
  }

  // Straight wedge planes, with the shoulder continuing into the upper body.
  fn hornSdf(p: vec3f) -> f32 {
    let u = max((-0.50 - p.x) / 1.20, 0.0);
    let top = p.y - (1.35 - 0.015 * u);
    let bottom = ((0.86 + 0.415 * u) - p.y) / 1.058;
    let side = (abs(p.z) - (0.42 - 0.365 * u)) / 1.046;
    return max(max(max(top, bottom), side), max(-1.70 - p.x, p.x + 0.25)) - 0.008;
  }


  fn anvilSdf(world: vec3f) -> f32 {
    let p = vec3f(world.x, world.y / 0.86, world.z);
    let base = baseSdf(p);
    if (LAYER == 0) { return base * 0.86; }
    let waist = waistSdf(p);
    if (LAYER == 1) { return min(base, waist) * 0.86; }
    return min(min(plateSdf(p), hornSdf(p)), min(waist, base)) * 0.86;
  }

  fn anvilNormal(p: vec3f) -> vec3f {
    let e = vec2f(0.0022, -0.0022);
    return normalize(
      e.xyy * anvilSdf(p + e.xyy) + e.yyx * anvilSdf(p + e.yyx) +
      e.yxy * anvilSdf(p + e.yxy) + e.xxx * anvilSdf(p + e.xxx)
    );
  }

  fn slabBounds(ro: vec3f, rd: vec3f) -> vec2f {
    let inv = 1.0 / rd;
    let bMin = vec3f(-1.76, -0.05, -0.62);
    let bMax = vec3f(1.36, 1.5, 0.62);
    let t0 = (bMin - ro) * inv;
    let t1 = (bMax - ro) * inv;
    let tsm = min(t0, t1);
    let tbg = max(t0, t1);
    let tNear = max(max(tsm.x, tsm.y), tsm.z);
    let tFar = min(min(tbg.x, tbg.y), tbg.z);
    return vec2f(tNear, tFar);
  }

  fn marchAnvil(ro: vec3f, rd: vec3f, maxSteps: i32) -> f32 {
    let bounds = slabBounds(ro, rd);
    if (bounds.x > bounds.y || bounds.y < 0.0) { return -1.0; }
    var t = max(bounds.x, 0.0);
    for (var i = 0; i < 96; i++) {
      if (i >= maxSteps) { break; }
      let d = anvilSdf(ro + rd * t);
      if (d < 0.00008 * max(t, 1.0)) { return t; }
      t += d * 0.9;
      if (t > bounds.y) { break; }
    }
    return -1.0;
  }

  fn anvilThickness(p: vec3f, rdIn: vec3f) -> f32 {
    var t = 0.0;
    for (var i = 0; i < 32; i++) {
      let d = -anvilSdf(p + rdIn * t);
      if (d < 0.0005) { break; }
      t += max(d * 0.9, 0.002);
    }
    return t;
  }

  // Sparse panel divisions, rather than a grid wrapped around every surface.
  fn anvilWire(world: vec3f, n: vec3f, detail: f32) -> f32 {
    if (detail < 0.5) { return 0.0; }
    let p = vec3f(world.x, world.y / 0.86, world.z);
    let vertical = min(abs(p.x + 0.50), abs(p.x - 0.55));
    let horizontal = min(abs(p.y - 0.62), min(abs(p.y - 0.24), abs(p.y - 0.10)));
    let diagonal = abs(p.y + 0.38 * p.x - 0.80) / 1.07;
    let d = min(min(vertical, horizontal), select(1.0, diagonal, p.y > 0.62 && abs(n.z) > 0.8));
    return 1.0 - smoothstep(0.001, 0.005, d);
  }

  fn secondPlane(d: vec4f) -> f32 {
    let hi = vec2f(max(d.x, d.y), max(d.z, d.w));
    let lo = vec2f(min(d.x, d.y), min(d.z, d.w));
    return max(min(hi.x, hi.y), max(lo.x, lo.y));
  }

  fn crystalEdge(world: vec3f) -> f32 {
    let p = vec3f(world.x, world.y / 0.86, world.z);
    var d = vec4f(-10.0);
    if (p.y > 1.315 && p.x > -0.52) {
      let q = abs(p - vec3f(0.39, 1.365, 0.0)) - vec3f(0.91, 0.045, 0.42);
      d = vec4f(q, -10.0);
    } else if (p.x < -0.52 && p.y > 0.85) {
      let u = max((-0.50 - p.x) / 1.20, 0.0);
      d = vec4f(p.y - (1.35 - 0.015 * u), (0.86 + 0.415 * u) - p.y, abs(p.z) - (0.42 - 0.365 * u), -1.70 - p.x);
    } else if (p.y < 0.245) {
      let plinth = p.y < 0.11;
      let center = select(vec3f(-0.10, 0.17, 0.0), vec3f(-0.10, 0.05, 0.0), plinth);
      let size = select(vec3f(0.82, 0.07, 0.42), vec3f(0.99, 0.05, 0.54), plinth);
      d = vec4f(abs(p - center) - size, -10.0);
    } else {
      d = vec4f(waistDistances(p), -10.0);
    }
    return 1.0 - smoothstep(0.001, 0.015, abs(secondPlane(d)));
  }

  // --- Main ---

  @fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
    let aspect = params.resolution.x / max(params.resolution.y, 1.0);
    let time = params.time;
    let motion = params.motion;

    let zoom = mix(1.22, 1.0, smoothstep(0.62, 1.0, aspect));
    let cam = makeCam(aspect, zoom);

    // Background and ground contact shadow under the base.
    var color = background(uv, aspect, 0.0, params.detail);
    let baseUv = worldToUv(cam, vec3f(-0.10, 0.0, 0.0));
    let shadowP = (uv - baseUv) * vec2f(aspect, 1.0);
    let shadow = (1.0 - smoothstep(0.22, 1.0, length(shadowP / vec2f(0.30, 0.055)))) * 0.26;
    color = mix(color, vec3f(0.42, 0.46, 0.58), shadow);

    let intro = mix(1.0, smoothstep(0.05, 0.95, time), motion);
    let maxSteps = select(64, 96, params.detail > 0.5);
    let ro = cam.eye;
    let rd = uvToRay(cam, uv);
    let hit = marchAnvil(ro, rd, maxSteps);
    if (hit > 0.0) {
      let pos = ro + rd * hit;
      let n = anvilNormal(pos);
      let edge = crystalEdge(pos);
      let fres = pow(clamp(1.0 - dot(n, -rd), 0.0, 1.0), 2.6);
      let wire = anvilWire(pos, n, params.detail);

      if (LAYER < 3) {
        // Sculpt-debug shading: matte grey so the geometry reads honestly.
        let key = normalize(vec3f(0.5, 0.8, 0.6));
        let ndl = max(dot(n, key), 0.0);
        var matte = vec3f(0.80, 0.82, 0.86) * (0.38 + 0.62 * ndl);
        matte += fres * vec3f(0.95, 0.96, 1.0) * 0.55;
        matte -= vec3f(0.22, 0.22, 0.24) * wire;
        color = mix(color, matte, 0.94 * intro);
      } else {
        // Bend the camera ray through the solid to reveal the back faces.
        var rdIn = refract(rd, n, 0.70);
        if (dot(rdIn, rdIn) < 0.5) { rdIn = rd; }
        let entry = pos + rdIn * 0.004;
        let thickness = anvilThickness(entry, rdIn);
        let exitPos = entry + rdIn * thickness;
        let exitUv = worldToUv(cam, exitPos);
        var glass = mix(background(clamp(exitUv, vec2f(0.0), vec2f(1.0)), aspect, 0.0, params.detail), vec3f(0.985), 0.80);

        // Neutral smoke-glass transmission and broad white studio reflections.
        glass *= exp(-thickness * vec3f(0.30, 0.29, 0.27));
        let faceShade = clamp(0.65 - 0.65 * n.y, 0.0, 1.0);
        glass *= mix(vec3f(0.78, 0.79, 0.80), vec3f(0.48, 0.50, 0.54), faceShade);
        let reflection = reflect(rd, n);
        let studio = pow(max(0.0, 1.0 - abs(reflection.x + 0.22)), 5.0);
        glass += vec3f(0.94, 0.96, 0.98) * studio * (0.08 + 0.15 * faceShade);
        let softbox = exp(-pow((pos.z + 0.12 * pos.x) * 3.0, 2.0));
        glass += vec3f(0.98, 0.99, 1.0) * softbox * max(n.y, 0.0) * 0.16;
        let exitNormal = anvilNormal(exitPos);
        let backEdge = max(crystalEdge(exitPos), anvilWire(exitPos, exitNormal, params.detail));
        glass += vec3f(0.92, 0.96, 0.98) * backEdge * 0.07;
        glass = mix(glass, vec3f(0.90, 0.93, 0.95), smoothstep(0.15, 0.95, exitNormal.y) * 0.10);

        // Sparse structural seams and ordinary external reflections.
        glass += vec3f(0.86, 0.91, 1.0) * wire * 0.30;
        let keyLight = normalize(vec3f(0.45, 0.85, 0.55));
        let spec = pow(max(dot(reflect(rd, n), keyLight), 0.0), 52.0) * 0.30;
        let fill = pow(max(dot(reflect(rd, n), normalize(vec3f(-0.62, 0.30, 0.42))), 0.0), 16.0) * 0.08;

        // Reference-color splits: cyan at the horn tip, faint rose at the heel.
        glass += vec3f(0.48, 0.84, 1.0) * fres * smoothstep(1.35, 1.70, -pos.x) * 0.10;
        glass += vec3f(1.0, 0.74, 0.86) * fres * smoothstep(0.95, 1.30, pos.x) * 0.06;
        let rim = fres * vec3f(0.94, 0.98, 1.0) * 0.25;

        let glassCol = mix(glass + vec3f(spec + fill) + rim, vec3f(0.92, 0.98, 1.0), edge * 0.92);
        let coverage = 0.97 * intro;
        color = mix(color, glassCol, coverage);
      }
    }

    // Gentle vignette keeps edges airy.
    let vignette = 1.0 - smoothstep(0.30, 1.02, length(uv - vec2f(0.5)));
    color = mix(vec3f(1.0), color, 0.90 + 0.10 * vignette);
    return vec4f(min(color, vec3f(1.0)), 1.0);
  }
`;
}

export const HERO_CANVAS_SHADER_SOURCE = createHeroCanvasShaderSource();
