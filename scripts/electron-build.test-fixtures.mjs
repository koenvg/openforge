import { rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let temporaryPathSequence = 0
const temporaryTestPaths = new Set()

export function temporaryTestPath(label) {
  temporaryPathSequence += 1
  const path = join(tmpdir(), `openforge-${label}-${process.pid}-${Date.now()}-${temporaryPathSequence}`)
  temporaryTestPaths.add(path)
  return path
}

export async function removeTemporaryTestPaths() {
  const paths = [...temporaryTestPaths]
  temporaryTestPaths.clear()
  await Promise.all(paths.map(path => rm(path, { recursive: true, force: true })))
}
