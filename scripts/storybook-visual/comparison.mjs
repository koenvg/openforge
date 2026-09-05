import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

export function compare(baseline, current, tolerance) {
  const before = PNG.sync.read(baseline)
  const after = PNG.sync.read(current)
  const width = Math.max(before.width, after.width)
  const height = Math.max(before.height, after.height)
  const pad = (image) => {
    const padded = new PNG({ width, height })
    PNG.bitblt(image, padded, 0, 0, image.width, image.height, 0, 0)
    return padded.data
  }
  const diff = new PNG({ width, height })
  const pixels = pixelmatch(pad(before), pad(after), diff.data, width, height, { threshold: 0, includeAA: true })
  const sameSize = before.width === after.width && before.height === after.height
  let maxChannelDelta = 0
  if (sameSize && tolerance && pixels > 0 && pixels <= tolerance.maxPixels) {
    for (let index = 0; index < before.data.length; index++) {
      maxChannelDelta = Math.max(maxChannelDelta, Math.abs(before.data[index] - after.data[index]))
    }
  }
  const matches = sameSize && (pixels === 0 || Boolean(tolerance && pixels <= tolerance.maxPixels && maxChannelDelta <= tolerance.maxChannelDelta))
  return { pixels: sameSize ? pixels : Math.max(1, pixels), matches, difference: PNG.sync.write(diff) }
}

export function verifyDiagnostics(actual, expected) {
  const remaining = [...expected]
  const unexpected = []
  for (const diagnostic of actual) {
    const index = remaining.indexOf(diagnostic)
    if (index < 0) unexpected.push(diagnostic)
    else remaining.splice(index, 1)
  }
  if (unexpected.length || remaining.length) throw new Error([
    unexpected.length && `unexpected diagnostics: ${unexpected.join('\n')}`,
    remaining.length && `missing expected diagnostics: ${remaining.join('\n')}`,
  ].filter(Boolean).join('\n'))
}

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
export function report(results) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>OpenForge visual review</title>
<style>body{font:16px system-ui;margin:2rem}section{border-top:1px solid #aaa;padding:1rem 0}.images{display:flex;gap:1rem}figure{margin:0;min-width:0;flex:1}img{max-width:100%;border:1px solid #aaa}pre{white-space:pre-wrap}</style>
<h1>OpenForge visual review</h1>${results.map(result => `<section><h2>${escape(result.id)}</h2><pre>${escape(result.error ?? (result.added ? 'New baseline' : `${result.pixels} changed pixels${result.matches && result.pixels ? '; within declared allowance: ' + result.tolerance.reason : ''}`))}</pre><div class="images">${(result.images ?? ['baseline', 'current', 'difference']).map(name => `<figure><figcaption>${name}</figcaption><a href="${escape(result.id)}/${name}.png"><img alt="${name}" src="${escape(result.id)}/${name}.png"></a></figure>`).join('')}</div></section>`).join('')}</html>`
}
