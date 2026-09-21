import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compare, report, verifyDiagnostics } from './comparison.mjs'
import { identity } from './manifest.mjs'

export async function verifyRepeatedCapture(entry, first, second, output) {
  const comparison = compare(first, second, entry.tolerance)
  if (comparison.matches) return

  const id = identity(entry)
  const root = join(output, 'self-test', 'repeated')
  const directory = join(root, id)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'first.png'), first)
  await writeFile(join(directory, 'second.png'), second)
  await writeFile(join(directory, 'difference.png'), comparison.difference)
  const previous = await readFile(join(root, 'results.json'), 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const results = [...previous.filter(result => result.id !== id), { id, pixels: comparison.pixels, matches: false, images: ['first', 'second', 'difference'] }]
  await writeFile(join(root, 'results.json'), JSON.stringify(results, null, 2))
  await writeFile(join(root, 'index.html'), report(results))
  throw new Error(`${id}: repeated capture must pass (${comparison.pixels} changed pixels). Review ${root}/index.html`)
}

export async function verifyRepeatFromInitial(entry, output, captureNext) {
  const first = await readFile(join(output, identity(entry), 'current.png'))
  const second = await captureNext()
  verifyDiagnostics(second.diagnostics, entry.expectedErrors)
  await verifyRepeatedCapture(entry, first, second.bytes, output)
}
