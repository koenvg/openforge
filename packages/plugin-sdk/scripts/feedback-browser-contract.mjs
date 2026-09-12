import assert from 'node:assert/strict'
import { PNG } from 'pngjs'

async function barPixel(progress, fraction) {
  const image = PNG.sync.read(await progress.screenshot())
  const offset = (Math.floor(image.height / 2) * image.width + Math.floor(image.width * fraction)) * 4
  return [...image.data.subarray(offset, offset + 3)]
}

async function paint(locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element)
    const { width, height } = element.getBoundingClientRect()
    return { color: style.color, background: style.backgroundColor, border: style.borderTopColor, radius: style.borderRadius, animation: style.animationName, width, height }
  })
}

async function reference(page, property, value) {
  return page.locator('main').evaluate((root, { property, value }) => {
    const probe = document.createElement('span')
    probe.style.setProperty(property, value)
    root.append(probe)
    const result = getComputedStyle(probe).getPropertyValue(property)
    probe.remove()
    return result
  }, { property, value })
}

export async function assertFeedbackBrowserContract(page, url, themes) {
  const errors = []
  const onError = error => errors.push(error.message)
  page.on('pageerror', onError)
  try {
    await page.addInitScript(themes => { window.feedbackThemes = themes }, themes)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(url)
    await page.getByRole('progressbar', { name: 'Download', exact: true }).waitFor()
    await page.evaluate(() => document.fonts.ready)
    const draft = page.getByRole('textbox', { name: 'Draft' })
    await draft.fill('Edited plugin draft')
    const indicator = await page.getByRole('status', { name: 'Loading md', exact: true }).elementHandle()
    const progress = await page.getByRole('progressbar', { name: 'Download', exact: true }).elementHandle()
    const alert = await page.getByRole('group', { name: 'danger feedback', exact: true }).elementHandle()
    for (const theme of themes) {
      await page.getByLabel('Theme', { exact: true }).selectOption(theme.id)
      await draft.focus()
      assert.equal(await page.locator('main').getAttribute('data-theme'), theme.id)
      assert.equal(await draft.inputValue(), 'Edited plugin draft')
      for (const handle of [indicator, progress, alert]) assert.equal(await handle.evaluate(el => el.isConnected), true)
      for (const [size, ratio] of [['xs', .5], ['sm', .625], ['md', .75], ['lg', .875]]) {
        const style = await paint(page.getByRole('status', { name: `Loading ${size}`, exact: true }))
        assert.equal(style.color, await reference(page, 'color', 'var(--of-accent)'))
        const dimension = parseFloat(await reference(page, 'width', `calc(var(--of-control-height-compact) * ${ratio})`))
        assert.equal(style.width, dimension)
        assert.equal(style.height, dimension)
        assert.equal(style.border, style.color)
      }
      for (const variant of ['neutral', 'info', 'success', 'warning', 'danger']) {
        const style = await paint(page.getByRole('group', { name: `${variant} feedback`, exact: true }))
        assert.equal(style.background, await reference(page, 'background-color', `var(--of-${variant === 'neutral' ? 'surface-subtle' : variant})`))
        assert.equal(style.color, await reference(page, 'color', `var(--of-${variant === 'neutral' ? 'text' : `on-${variant}`})`))
        assert.equal(style.radius, theme.properties['--of-radius-container'])
        // Baseline single-line alert: 20px line + 12px vertical padding + token borders.
        const border = parseFloat(theme.properties['--of-border-width'])
        assert.equal(style.height, 44 + border * 2)
      }
      for (const variant of ['neutral', 'primary', 'info', 'success', 'warning', 'danger']) {
        const style = await paint(page.getByRole('progressbar', { name: `${variant} progress`, exact: true }))
        const token = variant === 'neutral' ? 'text' : variant === 'primary' ? 'accent' : variant
        assert.equal(style.color, await reference(page, 'color', `var(--of-${token})`))
        assert.equal(style.height, 8)
        assert.equal(style.radius, theme.properties['--of-radius-container'])
        assert.equal(style.background, await reference(page, 'background-color', `color-mix(in oklab, var(--of-${token}) 20%, transparent)`))
      }
      const owned = await paint(page.getByRole('group', { name: 'Plugin owned' }))
      assert.equal(owned.background, 'rgb(1, 2, 3)')
      assert.equal(owned.color, 'rgb(250, 251, 252)')
      assert.equal(await draft.evaluate(el => document.activeElement === el), true)
    }

    // Mutate the active contributed palette without selecting a fixture-specific ID.
    await page.locator('main').evaluate(root => {
      root.style.setProperty('--of-accent', 'rgb(19, 117, 173)')
      root.style.setProperty('--of-danger', 'rgb(131, 23, 89)')
      root.style.setProperty('--of-control-height-compact', '40px')
    })
    assert.equal((await paint(indicator)).color, 'rgb(19, 117, 173)')
    assert.equal((await paint(indicator)).width, 30)
    assert.equal((await paint(progress)).color, 'rgb(19, 117, 173)')
    assert.equal((await paint(alert)).background, 'rgb(131, 23, 89)')
    assert.equal(await page.getByRole('status', { name: 'Loading files', exact: true }).count(), 1)
    assert.equal(await page.getByRole('status', { name: 'Polite feedback' }).getAttribute('aria-live'), 'polite')
    assert.equal(await page.getByRole('alert', { name: 'Urgent feedback' }).count(), 1)

    assert.deepEqual(await progress.evaluate(el => [el.value, el.max, el.position]), [25, 50, .5])
    // Sample actual native fill, not just the progress element's inherited color.
    assert.deepEqual(await barPixel(progress, .25), [19, 117, 173])
    assert.notDeepEqual(await barPixel(progress, .75), [19, 117, 173])
    await page.getByRole('button', { name: 'Overflow value' }).click()
    assert.deepEqual(await progress.evaluate(el => [el.value, el.max, el.position]), [50, 50, 1])
    assert.deepEqual(await barPixel(progress, .75), [19, 117, 173])
    await page.getByRole('button', { name: 'Invalid range' }).click()
    assert.deepEqual(await progress.evaluate(el => [el.value, el.max, el.position]), [0, 1, 0])
    await page.getByRole('button', { name: 'Toggle indeterminate' }).click()
    assert.equal(await progress.evaluate(el => el.position), -1)
    assert.equal(await progress.getAttribute('value'), null)
    assert.equal(await progress.getAttribute('aria-valuenow'), null)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    assert.notEqual((await paint(indicator)).animation, 'none')
    assert.notEqual((await paint(progress)).animation, 'none')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal((await paint(indicator)).animation, 'none')
    assert.equal((await paint(progress)).animation, 'none')
    assert.notEqual(await progress.evaluate(el => getComputedStyle(el).backgroundImage), 'none')

    const view = page.getByRole('region', { name: 'Plugin view', exact: true })
    const retry = view.getByRole('button', { name: 'Retry', exact: true })
    await retry.focus()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    assert.equal(await retry.evaluate(el => el.matches(':focus-visible')), true)
    assert.notEqual(await retry.evaluate(el => getComputedStyle(el).outlineStyle), 'none')
    await page.keyboard.press('Enter')
    await view.getByRole('status').waitFor()
    assert.equal(await view.getByRole('status').count(), 1)
    assert.equal(await view.getByRole('status').getAttribute('aria-live'), 'polite')
    assert.equal(await view.locator('[aria-label]').count(), 0)
    assert.equal(await page.locator('[aria-label="Retry count"]').textContent(), '1')
    await page.getByRole('button', { name: 'Finish loading' }).click()
    assert.equal(await view.textContent(), 'Plugin records ready')
    await page.getByRole('button', { name: 'Fail loading' }).click()
    assert.equal(await view.getByRole('alert').getAttribute('aria-live'), 'assertive')
    await page.getByLabel('Disable retry').check()
    assert.equal(await retry.isDisabled(), true)
    await page.getByLabel('Disable retry').uncheck()
    await retry.focus()
    await page.keyboard.press('Space')
    await view.getByRole('status').waitFor()
    assert.equal(await page.locator('[aria-label="Retry count"]').textContent(), '2')
    await page.setViewportSize({ width: 280, height: 900 })
    assert.equal(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth), true)
    assert.deepEqual(errors, [])
  } finally {
    page.off('pageerror', onError)
  }
}
