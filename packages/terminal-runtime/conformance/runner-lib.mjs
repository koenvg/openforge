import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

export function assertPresentation(recording, presentation) {
  const expected = recording.presentation
  if (!expected) return
  const visibleText = presentation.lines.map(line => line.text).join('\n')
  for (const text of expected.textIncludes ?? []) {
    if (!visibleText.includes(text)) {
      throw new Error(`${recording.id}: presentation does not include ${JSON.stringify(text)}`)
    }
  }

  const cells = presentation.lines.flatMap(line => line.cells)
  for (const [style, text] of Object.entries(expected.styledText ?? {})) {
    const styledText = cells.filter(cell => cell[style]).map(cell => cell.text).join('')
    if (!styledText.includes(text)) {
      throw new Error(`${recording.id}: ${style} cells do not include ${JSON.stringify(text)}`)
    }
  }

  for (const expectedForeground of expected.foregroundText ?? []) {
    const matched = presentation.lines.some(line => line.cells.some((_, start) => {
      const run = []
      let text = ''
      for (let index = start; index < line.cells.length && text.length < expectedForeground.text.length; index += 1) {
        run.push(line.cells[index])
        text += line.cells[index].text
      }
      return text === expectedForeground.text
        && run.every(cell => cell.foreground.value === expectedForeground.value)
    }))
    if (!matched) {
      throw new Error(`${recording.id}: ${JSON.stringify(expectedForeground.text)} does not have foreground value ${expectedForeground.value}`)
    }
  }

  if (expected.minimumWideCells !== undefined) {
    const wideCells = cells.filter(cell => cell.width === 2).length
    if (wideCells < expected.minimumWideCells) {
      throw new Error(`${recording.id}: expected at least ${expected.minimumWideCells} wide cells, found ${wideCells}`)
    }
  }

  if (expected.activeBuffer && presentation.activeBuffer !== expected.activeBuffer) {
    throw new Error(`${recording.id}: expected ${expected.activeBuffer} buffer, found ${presentation.activeBuffer}`)
  }
}

export function assertTerminalScreenshotHasInk(screenshotBuffer, options) {
  const image = PNG.sync.read(screenshotBuffer)
  const inset = options.insetPixels ?? 0
  const inspectedEndY = Math.min(
    image.height - inset,
    Math.max(inset + 1, Math.floor(image.height * options.topFraction)),
  )
  const inspectedWidth = Math.max(1, image.width - inset * 2)
  const colorCounts = new Map()
  const inspectedPixels = inspectedWidth * (inspectedEndY - inset)
  for (let y = inset; y < inspectedEndY; y += 1) {
    for (let x = inset; x < image.width - inset; x += 1) {
      const offset = (y * image.width + x) * 4
      const color = `${image.data[offset]},${image.data[offset + 1]},${image.data[offset + 2]},${image.data[offset + 3]}`
      colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1)
    }
  }
  const backgroundPixels = Math.max(...colorCounts.values())
  const inkPixels = inspectedPixels - backgroundPixels
  if (inkPixels < options.minimumInkPixels) {
    throw new Error(`no visible terminal text: found ${inkPixels} non-background pixels, expected at least ${options.minimumInkPixels}`)
  }
  return { inkPixels, inspectedPixels }
}

export function assertTerminalScreenshotCursorAtCell(screenshotBuffer, options) {
  const image = PNG.sync.read(screenshotBuffer)
  const { screen, geometry, cursor, cursorColor } = options
  const left = Math.max(0, Math.floor(screen.x + cursor.x * screen.width / geometry.cols))
  const right = Math.min(image.width, Math.ceil(screen.x + (cursor.x + 1) * screen.width / geometry.cols))
  const top = Math.max(0, Math.floor(screen.y + cursor.y * screen.height / geometry.rows))
  const bottom = Math.min(image.height, Math.ceil(screen.y + (cursor.y + 1) * screen.height / geometry.rows))
  let matchingPixels = 0
  const inspectedPixels = Math.max(0, right - left) * Math.max(0, bottom - top)
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * image.width + x) * 4
      if (cursorColor.every((channel, index) => image.data[offset + index] === channel)) {
        matchingPixels += 1
      }
    }
  }
  const coverage = inspectedPixels === 0 ? 0 : matchingPixels / inspectedPixels
  if (coverage < options.minimumCoverage) {
    throw new Error(
      `painted cursor covers ${coverage.toFixed(3)} of semantic cell (${cursor.x}, ${cursor.y}); expected at least ${options.minimumCoverage}`,
    )
  }
  return { coverage, matchingPixels, inspectedPixels }
}

export function comparePngBuffers(baselineBuffer, actualBuffer, bounds) {
  const baseline = PNG.sync.read(baselineBuffer)
  const actual = PNG.sync.read(actualBuffer)
  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      passed: false,
      reason: `image dimensions differ: ${baseline.width}x${baseline.height} vs ${actual.width}x${actual.height}`,
      diffPixels: actual.width * actual.height,
      diffPixelRatio: 1,
      diff: actualBuffer,
    }
  }

  const diffImage = new PNG({ width: actual.width, height: actual.height })
  const diffPixels = pixelmatch(
    baseline.data,
    actual.data,
    diffImage.data,
    actual.width,
    actual.height,
    { threshold: bounds.pixelThreshold },
  )
  const diffPixelRatio = diffPixels / (actual.width * actual.height)
  return {
    passed: diffPixelRatio <= bounds.maxDiffPixelRatio,
    diffPixels,
    diffPixelRatio,
    diff: PNG.sync.write(diffImage),
  }
}

function descendants(rows, rootPid) {
  const selected = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (selected.has(row.parentPid) && !selected.has(row.pid)) {
        selected.add(row.pid)
        changed = true
      }
    }
  }
  return rows.filter(row => selected.has(row.pid))
}

export function summarizeChromiumProcessMemory(rows, browserPid, javascriptHeapUsedBytes) {
  if (!browserPid || rows.length === 0) {
    return {
      available: false,
      reason: 'browser process information is unavailable on this platform',
      javascriptHeapUsedBytes,
    }
  }
  const processRows = descendants(rows, browserPid)
  if (processRows.length === 0) {
    return {
      available: false,
      reason: `browser process ${browserPid} was not present in the process table`,
      javascriptHeapUsedBytes,
    }
  }
  const bytes = selected => selected.reduce((total, row) => total + row.rssKiB * 1024, 0)
  return {
    available: true,
    browserProcessRssBytes: bytes(processRows.filter(row => row.pid === browserPid)),
    rendererProcessRssBytes: bytes(processRows.filter(row => row.command.includes('--type=renderer'))),
    gpuProcessRssBytes: bytes(processRows.filter(row => row.command.includes('--type=gpu-process'))),
    processTreeRssBytes: bytes(processRows),
    javascriptHeapUsedBytes,
    processCount: processRows.length,
  }
}

export function parsePsProcessRows(output) {
  return output.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) return []
    return [{
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      rssKiB: Number(match[3]),
      command: match[4],
    }]
  })
}
