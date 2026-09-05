import { describe, it, expect } from 'vitest'
import { PNG } from 'pngjs'
import { compare, report, verifyDiagnostics } from './comparison.mjs'

function png(value, width = 4) {
  const result = new PNG({ width, height: 4 })
  result.data.fill(value)
  return PNG.sync.write(result)
}
describe('visual comparisons', () => {
  it('passes identical pixels and fails a disposable visual change with a difference PNG', () => {
    expect(compare(png(255), png(255)).pixels).toBe(0)
    const changed = compare(png(255), png(0))
    expect(changed.pixels).toBeGreaterThan(0)
    expect(PNG.sync.read(changed.difference).width).toBe(4)
  })
  it('reports size drift', () => { expect(compare(png(255), png(255, 5)).pixels).toBeGreaterThan(0) })
  it('bounds declared one-level raster noise by both channel delta and pixel count', () => {
    const before = new PNG({ width: 4, height: 4 }); before.data.fill(255)
    const after = new PNG({ width: 4, height: 4 }); after.data.fill(255); after.data[0] = 254
    const a = PNG.sync.write(before); const b = PNG.sync.write(after)
    const tolerance = { maxPixels: 1, maxChannelDelta: 1 }
    expect(compare(a, b).matches).toBe(false)
    expect(compare(a, b, tolerance)).toMatchObject({ matches: true, pixels: 1 })
    after.data[4] = 254
    expect(compare(a, PNG.sync.write(after), tolerance).matches).toBe(false)
    after.data[4] = 255; after.data[0] = 253
    expect(compare(a, PNG.sync.write(after), tolerance).matches).toBe(false)
  })
  it('requires exact diagnostic multiplicities', () => {
    expect(() => verifyDiagnostics(['expected'], ['expected'])).not.toThrow()
    expect(() => verifyDiagnostics(['expected extra'], ['expected'])).toThrow(/unexpected/)
    expect(() => verifyDiagnostics([], ['expected'])).toThrow(/missing expected/)
    expect(() => verifyDiagnostics(['expected', 'expected'], ['expected'])).toThrow(/unexpected/)
  })
  it('does not link absent images for a new baseline or readiness failure', () => {
    const added = report([{ id: 'new', added: true, images: ['current'] }])
    expect(added).toContain('New baseline')
    expect(added).not.toContain('baseline.png')
    expect(added).not.toContain('difference.png')
    const failed = report([{ id: 'broken', error: 'missing readiness', images: [] }])
    expect(failed).not.toContain('<img')
  })
  it('links all review images and escapes diagnostics', () => {
    const html = report([{ id: 'pages/test', error: '<bad>', pixels: 1 }])
    for (const name of ['baseline', 'current', 'difference']) expect(html).toContain(`pages/test/${name}.png`)
    expect(html).toContain('&lt;bad&gt;')
  })
})
