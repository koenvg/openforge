import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let temporaryPathSequence = 0

export function temporaryTestPath(label) {
  temporaryPathSequence += 1
  return join(tmpdir(), `openforge-${label}-${process.pid}-${Date.now()}-${temporaryPathSequence}`)
}
