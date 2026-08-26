import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function repoRootFromScript() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..')
}
