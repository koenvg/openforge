import { clock, effect, frame, init, surface } from 'vgpu';

import { HERO_CANVAS_SHADER_SOURCE } from './heroCanvasShader';
import type { HeroCanvasPolicy } from './heroCanvasPolicy';

export interface HeroCanvasController {
  dispose(): void;
}

export interface HeroCanvasOptions {
  visual: HTMLElement;
  canvas: HTMLCanvasElement;
  policy: HeroCanvasPolicy;
}

export async function startHeroCanvas({
  visual,
  canvas,
  policy,
}: HeroCanvasOptions): Promise<HeroCanvasController | undefined> {
  try {
    const gpu = await init();
    const target = surface(gpu, canvas, { dpr: policy.devicePixelRatio });
    const timer = clock(gpu);
    const shader = effect(gpu, HERO_CANVAS_SHADER_SOURCE, {
      label: 'openforge-anvil-hero',
      set: {
        params: {
          resolution: target.size,
          time: 0,
          motion: policy.animate ? 1 : 0,
          detail: policy.shaderDetail,
          pad0: 0,
        },
      },
    });

    const unsubscribeResize = target.onResize(() => {
      shader.set({ params: { resolution: target.size } });
    });

    let animationFrameId: number | null = null;
    let resizeFrameId: number | null = null;
    let isInViewport = false;
    let isDisposed = false;
    let lastTimestamp = performance.now();

    const drawFrame = (timestamp = performance.now()) => {
      if (isDisposed) return;

      if (policy.animate) {
        const deltaSeconds = Math.min(Math.max((timestamp - lastTimestamp) / 1000, 0), 0.1);
        timer.advance(deltaSeconds);
      }
      lastTimestamp = timestamp;

      shader.set({ params: { time: timer.time } });
      frame(gpu, (currentFrame) => currentFrame.pass(target, shader));
      visual.dataset.vgpuReady = 'true';
    };

    const stopRendering = () => {
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    };

    const renderLoop = (timestamp: number) => {
      if (document.hidden || !isInViewport || isDisposed) {
        animationFrameId = null;
        return;
      }

      const frameInterval = 1000 / policy.targetFramesPerSecond;
      if (timestamp - lastTimestamp >= frameInterval) drawFrame(timestamp);
      animationFrameId = requestAnimationFrame(renderLoop);
    };

    const startRendering = () => {
      if (document.hidden || !isInViewport || isDisposed) return;

      if (!policy.animate) {
        drawFrame();
        return;
      }

      if (animationFrameId === null) {
        lastTimestamp = performance.now();
        animationFrameId = requestAnimationFrame(renderLoop);
      }
    };

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        isInViewport = entry?.isIntersecting ?? false;
        if (isInViewport) startRendering();
        else stopRendering();
      },
      { rootMargin: '120px' },
    );

    const handleVisibilityChange = () => {
      if (document.hidden) stopRendering();
      else startRendering();
    };

    const handleResize = () => {
      if (policy.animate || !isInViewport || resizeFrameId !== null) return;
      resizeFrameId = requestAnimationFrame(() => {
        resizeFrameId = null;
        drawFrame();
      });
    };

    const dispose = () => {
      if (isDisposed) return;
      isDisposed = true;
      stopRendering();
      if (resizeFrameId !== null) cancelAnimationFrame(resizeFrameId);
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
      unsubscribeResize();
      target.dispose();
      gpu.dispose();
    };

    const handlePageHide = (event: PageTransitionEvent) => {
      stopRendering();
      if (!event.persisted) dispose();
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) startRendering();
    };

    intersectionObserver.observe(visual);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);

    return { dispose };
  } catch (error) {
    visual.dataset.vgpuError = error instanceof Error ? error.message : 'WebGPU unavailable';
    return undefined;
  }
}
