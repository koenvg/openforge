// Advance application timers only while the story is still interacting. Host/CDP
// latency must not consume the lifetime of a transient final state.
export async function finishStoryPlay(page, timeout) {
  let timer
  // Playwright's timeout rejection can itself wait for a blocked renderer to
  // abort its polling task. Keep the same deadline independently on the host.
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout ${timeout}ms exceeded waiting for Storybook interaction`)), timeout)
  })
  const complete = Promise.race([
    page.waitForFunction(() => ['finished', 'errored'].includes(window.__STORYBOOK_PREVIEW__?.currentRender?.phase)),
    deadline,
  ])
  let settled = false
  void complete.then(() => { settled = true }, () => { settled = true })
  await Promise.resolve()
  try {
    let lastStep = performance.now()
    while (!settled) {
      const phase = await Promise.race([
        page.evaluate(() => window.__STORYBOOK_PREVIEW__?.currentRender?.phase),
        complete.then(() => 'finished'),
      ])
      if (settled || ['finished', 'errored'].includes(phase)) break
      // Never outrun real asynchronous work or its application deadlines. Cap
      // each step at two frames so a slow host cannot consume transient results.
      const now = performance.now()
      const elapsed = Math.min(32, now - lastStep)
      const ticks = Math.floor(elapsed)
      await Promise.race([page.clock.runFor(ticks), deadline])
      lastStep = now - (elapsed - ticks)
    }
    await complete
  } finally {
    clearTimeout(timer)
  }
}
