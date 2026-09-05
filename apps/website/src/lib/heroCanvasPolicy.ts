export interface HeroCanvasCapabilities {
  prefersReducedMotion: boolean;
  usesCompactRendering: boolean;
}

export interface HeroCanvasPolicy {
  animate: boolean;
  devicePixelRatio: number | readonly [number, number];
  shaderDetail: 0 | 1;
  targetFramesPerSecond: number;
}

export function getHeroCanvasPolicy({
  prefersReducedMotion,
  usesCompactRendering,
}: HeroCanvasCapabilities): HeroCanvasPolicy {
  const compactPolicy = {
    devicePixelRatio: 1,
    shaderDetail: 0 as const,
    targetFramesPerSecond: 18,
  };
  const renderingPolicy = usesCompactRendering
    ? compactPolicy
    : {
        devicePixelRatio: [1, 1.5] as const,
        shaderDetail: 1 as const,
        targetFramesPerSecond: 30,
      };

  if (prefersReducedMotion) {
    return {
      ...renderingPolicy,
      animate: false,
      targetFramesPerSecond: 0,
    };
  }

  return { ...renderingPolicy, animate: true };
}
