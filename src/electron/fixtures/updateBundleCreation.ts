// Disposable filesystem worker. The contract runner imposes a hard process deadline.
import { cp, rm } from 'node:fs/promises'
import { addElectronRuntime } from './updateElectronBundle.js'

const request = JSON.parse(process.argv[2])
try {
  if (request.action === 'runtime') await addElectronRuntime(request.bundle, request.root, request.hostScript, request.electronExecutable)
  else if (request.action === 'copy') await cp(request.source, request.bundle, { recursive: true, verbatimSymlinks: true })
  else if (request.action === 'remove') await rm(request.bundle, { recursive: true, force: true })
  else throw new Error('Unknown fixture filesystem action')
} catch (error) {
  console.error(`Fixture filesystem work failed. Diagnostics retained at ${request.root}`, error)
  process.exitCode = 1
}
