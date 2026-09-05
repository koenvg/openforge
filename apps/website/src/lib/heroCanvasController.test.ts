import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HERO_CANVAS_SHADER_SOURCE } from './heroCanvasShader';
import { startHeroCanvas } from './heroCanvasController';
import type { HeroCanvasPolicy } from './heroCanvasPolicy';

const vgpu = vi.hoisted(() => ({
  clock: vi.fn(),
  effect: vi.fn(),
  frame: vi.fn(),
  init: vi.fn(),
  surface: vi.fn(),
}));

vi.mock('vgpu', () => vgpu);

class TestIntersectionObserver {
  static instance: TestIntersectionObserver | undefined;

  readonly disconnect = vi.fn();
  readonly observe = vi.fn();

  constructor(private readonly callback: IntersectionObserverCallback) {
    TestIntersectionObserver.instance = this;
  }

  emit(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

const animatedPolicy: HeroCanvasPolicy = {
  animate: true,
  devicePixelRatio: [1, 2],
  shaderDetail: 1,
  targetFramesPerSecond: 30,
};

function eventWith<T extends object>(type: string, properties: T): Event & T {
  return Object.assign(new Event(type), properties);
}

function createElementFixtures() {
  const visual = Object.assign(new EventTarget(), { dataset: {} as Record<string, string> });
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }),
  });

  return {
    visual: visual as unknown as HTMLElement,
    canvas: canvas as unknown as HTMLCanvasElement,
  };
}

describe('startHeroCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    TestIntersectionObserver.instance = undefined;
  });

  it('owns rendering and teardown for an animated canvas', async () => {
    const gpu = { dispose: vi.fn() };
    const target = {
      dispose: vi.fn(),
      onResize: vi.fn(() => vi.fn()),
      size: [640, 480],
    };
    const shader = { set: vi.fn() };
    const timer = {
      time: 0,
      advance: vi.fn(function (this: { time: number }, delta: number) {
        this.time += delta;
      }),
    };
    const pass = vi.fn();
    const documentTarget = Object.assign(new EventTarget(), { hidden: false });
    const windowTarget = new EventTarget();
    const scheduledFrames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;

    vgpu.init.mockResolvedValue(gpu);
    vgpu.surface.mockReturnValue(target);
    vgpu.effect.mockReturnValue(shader);
    vgpu.clock.mockReturnValue(timer);
    vgpu.frame.mockImplementation((_gpu, callback) => callback({ pass }));

    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('window', windowTarget);
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextFrameId++;
      scheduledFrames.set(frameId, callback);
      return frameId;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((frameId: number) => scheduledFrames.delete(frameId)));

    const elements = createElementFixtures();
    const controller = await startHeroCanvas({ ...elements, policy: animatedPolicy });

    expect(vgpu.effect).toHaveBeenCalledWith(gpu, HERO_CANVAS_SHADER_SOURCE, expect.objectContaining({
      label: 'openforge-anvil-hero',
    }));
    expect(TestIntersectionObserver.instance?.observe).toHaveBeenCalledWith(elements.visual);
    expect(vgpu.frame).not.toHaveBeenCalled();

    TestIntersectionObserver.instance?.emit(true);
    const firstFrame = scheduledFrames.values().next().value;
    expect(firstFrame).toBeTypeOf('function');
    if (!firstFrame) throw new Error('Expected an animation frame to be scheduled');
    firstFrame(performance.now() + 40);

    expect(vgpu.frame).toHaveBeenCalledOnce();
    expect(pass).toHaveBeenCalledWith(target, shader);
    expect(elements.visual.dataset.vgpuReady).toBe('true');

    const secondFrame = [...scheduledFrames.values()][1];
    expect(secondFrame).toBeTypeOf('function');
    if (!secondFrame) throw new Error('Expected a second animation frame to be scheduled');
    shader.set.mockClear();
    secondFrame(performance.now() + 80);

    expect(shader.set).toHaveBeenCalledWith({ params: { time: expect.any(Number), pointer: [0.5, 0.5], hover: 0 } });

    const removePointerListener = vi.spyOn(elements.canvas, 'removeEventListener');
    shader.set.mockClear();
    elements.canvas.dispatchEvent(eventWith('pointermove', { clientX: 400, clientY: -50 }));
    expect(shader.set).not.toHaveBeenCalled();
    secondFrame(performance.now() + 160);
    const attracted = shader.set.mock.lastCall?.[0].params;
    expect(attracted.pointer[0]).toBeGreaterThan(0.5);
    expect(attracted.pointer[0]).toBeLessThanOrEqual(1);
    expect(attracted.pointer[1]).toBeGreaterThanOrEqual(0);
    expect(attracted.pointer[1]).toBeLessThan(0.5);
    expect(attracted.hover).toBeGreaterThan(0);

    elements.canvas.dispatchEvent(new Event('pointerleave'));
    secondFrame(performance.now() + 240);
    expect(shader.set.mock.lastCall?.[0].params.hover).toBeLessThan(attracted.hover);

    windowTarget.dispatchEvent(eventWith('pagehide', { persisted: false }));

    expect(controller).toBeDefined();
    expect(TestIntersectionObserver.instance?.disconnect).toHaveBeenCalledOnce();
    expect(target.dispose).toHaveBeenCalledOnce();
    expect(gpu.dispose).toHaveBeenCalledOnce();
    expect(removePointerListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(removePointerListener).toHaveBeenCalledWith('pointerleave', expect.any(Function));
  });

  it('keeps reduced-motion rendering frozen across mouse input and redraws', async () => {
    const shader = { set: vi.fn() };
    const advance = vi.fn();
    vgpu.init.mockResolvedValue({ dispose: vi.fn() });
    vgpu.surface.mockReturnValue({ size: [640, 480], onResize: () => () => {}, dispose: vi.fn() });
    vgpu.effect.mockReturnValue(shader);
    vgpu.clock.mockReturnValue({ time: 0, advance });
    vgpu.frame.mockImplementation(() => {});
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const elements = createElementFixtures();
    const controller = await startHeroCanvas({ ...elements, policy: { ...animatedPolicy, animate: false } });
    TestIntersectionObserver.instance?.emit(true);
    const first = shader.set.mock.lastCall?.[0];
    shader.set.mockClear();
    elements.canvas.dispatchEvent(eventWith('pointermove', { clientX: 200, clientY: 30 }));
    expect(shader.set).not.toHaveBeenCalled();
    TestIntersectionObserver.instance?.emit(true);
    expect(shader.set).toHaveBeenCalledWith(first);
    expect(advance).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    controller?.dispose();
  });

  it('reports initialization errors on the visual element', async () => {
    const elements = createElementFixtures();
    vgpu.init.mockRejectedValue(new Error('adapter failed'));

    const controller = await startHeroCanvas({ ...elements, policy: animatedPolicy });

    expect(controller).toBeUndefined();
    expect(elements.visual.dataset.vgpuError).toBe('adapter failed');
  });
});
