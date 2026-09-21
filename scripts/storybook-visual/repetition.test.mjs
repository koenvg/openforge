import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { verifyRepeatedCapture, verifyRepeatFromInitial } from './repetition.mjs'

const directories = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const entry = { catalog: 'components', story: 'sdk-overlays--modal', theme: 'openforge-light', viewport: { width: 2, height: 1 } }
function image(red) {
  const image = new PNG({ width: 2, height: 1 })
  image.data.set([red, 0, 0, 255, 0, 0, 0, 255])
  return PNG.sync.write(image)
}

it('retains both failed repeats and their difference with the full capture identity', async () => {
  const output = await mkdtemp(join(tmpdir(), 'visual-repetition-'))
  directories.push(output)
  const first = image(0), second = image(255)
  await expect(verifyRepeatedCapture(entry, first, second, output)).rejects.toThrow('components/sdk-overlays--modal--openforge-light--2x1: repeated capture must pass (1 changed pixels)')
  const root = join(output, 'self-test', 'repeated')
  const id = 'components/sdk-overlays--modal--openforge-light--2x1'
  expect(await readFile(join(root, id, 'first.png'))).toEqual(first)
  expect(await readFile(join(root, id, 'second.png'))).toEqual(second)
  expect(PNG.sync.read(await readFile(join(root, id, 'difference.png'))).width).toBe(2)
  expect(JSON.parse(await readFile(join(root, 'results.json'), 'utf8'))).toEqual([
    { id, pixels: 1, matches: false, images: ['first', 'second', 'difference'] },
  ])
  expect(await readFile(join(root, 'index.html'), 'utf8')).toContain(`${id}/first.png`)
})

it('keeps the declared comparison bound and does not write failure artifacts for an accepted repeat', async () => {
  const output = await mkdtemp(join(tmpdir(), 'visual-repetition-'))
  directories.push(output)
  await verifyRepeatedCapture({ ...entry, tolerance: { maxPixels: 1, maxChannelDelta: 1 } }, image(10), image(11), output)
  expect(await readdir(output)).toEqual([])
})

it('reuses the initial artifact and obtains exactly one fresh sample', async () => {
  const output = await mkdtemp(join(tmpdir(), 'visual-repetition-'))
  directories.push(output)
  const directory = join(output, 'components/sdk-overlays--modal--openforge-light--2x1')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'current.png'), image(10))
  let captures = 0
  await verifyRepeatFromInitial({ ...entry, expectedErrors: [] }, output, async () => {
    captures++
    return { bytes: image(10), diagnostics: [] }
  })
  expect(captures).toBe(1)
})

it('validates fresh diagnostics even when repeated pixels match', async () => {
  const output = await mkdtemp(join(tmpdir(), 'visual-repetition-'))
  directories.push(output)
  const directory = join(output, 'components/sdk-overlays--modal--openforge-light--2x1')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'current.png'), image(10))
  await expect(verifyRepeatFromInitial({ ...entry, expectedErrors: [] }, output, async () => ({
    bytes: image(10), diagnostics: ['unexpected failure'],
  }))).rejects.toThrow('unexpected failure')
})

it('fails without capturing when the initial artifact is missing', async () => {
  const output = await mkdtemp(join(tmpdir(), 'visual-repetition-'))
  directories.push(output)
  let captures = 0
  await expect(verifyRepeatFromInitial(entry, output, async () => { captures++ })).rejects.toThrow('current.png')
  expect(captures).toBe(0)
})

it('compares against the persisted sample with the declared tolerance and keeps mismatch evidence', async () => {
  const output = await mkdtemp(join(tmpdir(), 'visual-repetition-'))
  directories.push(output)
  const id = 'components/sdk-overlays--modal--openforge-light--2x1'
  await mkdir(join(output, id), { recursive: true })
  await writeFile(join(output, id, 'current.png'), image(10))
  const bounded = { ...entry, expectedErrors: [], tolerance: { maxPixels: 1, maxChannelDelta: 1 } }
  await verifyRepeatFromInitial(bounded, output, async () => ({ bytes: image(11), diagnostics: [] }))
  await expect(verifyRepeatFromInitial(bounded, output, async () => ({ bytes: image(255), diagnostics: [] }))).rejects.toThrow('repeated capture must pass')
  expect(await readFile(join(output, 'self-test/repeated', id, 'first.png'))).toEqual(image(10))
  expect(await readFile(join(output, 'self-test/repeated', id, 'second.png'))).toEqual(image(255))
})

it('retains the report for every failed identity when a shard continues after failure', async () => {
  const output = await mkdtemp(join(tmpdir(), 'visual-repetition-'))
  directories.push(output)
  const other = { ...entry, story: 'another-story' }
  await expect(verifyRepeatedCapture(entry, image(0), image(255), output)).rejects.toThrow('repeated capture must pass')
  await expect(verifyRepeatedCapture(other, image(0), image(255), output)).rejects.toThrow('repeated capture must pass')
  const root = join(output, 'self-test/repeated')
  const results = JSON.parse(await readFile(join(root, 'results.json'), 'utf8'))
  expect(results.map(result => result.id)).toEqual(['components/sdk-overlays--modal--openforge-light--2x1', 'components/another-story--openforge-light--2x1'])
  for (const result of results) expect(await readFile(join(root, 'index.html'), 'utf8')).toContain(`${result.id}/first.png`)
})
