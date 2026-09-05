import { describe, expect, it } from 'vitest';

import { getHeroCanvasPolicy } from './heroCanvasPolicy';

describe('getHeroCanvasPolicy', () => {
  it('keeps animation running on compact or coarse-pointer devices with a reduced rendering budget', () => {
    expect(getHeroCanvasPolicy({ prefersReducedMotion: false, usesCompactRendering: true })).toEqual({
      animate: true,
      devicePixelRatio: 1,
      shaderDetail: 0,
      targetFramesPerSecond: 18,
    });
  });

  it('preserves the full desktop rendering budget', () => {
    expect(getHeroCanvasPolicy({ prefersReducedMotion: false, usesCompactRendering: false })).toEqual({
      animate: true,
      devicePixelRatio: [1, 1.5],
      shaderDetail: 1,
      targetFramesPerSecond: 30,
    });
  });

  it('renders a static final frame when reduced motion is requested', () => {
    expect(getHeroCanvasPolicy({ prefersReducedMotion: true, usesCompactRendering: true })).toEqual({
      animate: false,
      devicePixelRatio: 1,
      shaderDetail: 0,
      targetFramesPerSecond: 0,
    });
  });
});
