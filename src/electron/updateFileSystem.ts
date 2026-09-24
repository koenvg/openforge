import * as nodeFs from 'node:fs'
import { createRequire } from 'node:module'

// Bundle authority covers archive bytes, not Electron's virtual ASAR directories.
// Do not toggle process.noAsar: other app I/O may be running concurrently.
export const updateFileSystem: typeof nodeFs = process.versions.electron
  ? createRequire(import.meta.url)('original-fs') as typeof nodeFs
  : nodeFs
