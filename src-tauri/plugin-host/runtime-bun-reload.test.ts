import { execFile, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const bunExecutable = process.env.OPENFORGE_BUN_PATH ?? 'bun'
const bunAvailable = spawnSync(bunExecutable, ['--version'], { stdio: 'ignore', timeout: 5_000 }).status === 0

async function parseProbeResult<T>(
  probeName: string,
  result: SpawnSyncReturns<string>,
  resultPath: string,
): Promise<T> {
  const diagnostics = [
    `exit status: ${result.status ?? 'none'}`,
    `signal: ${result.signal ?? 'none'}`,
    `spawn error: ${result.error?.message ?? 'none'}`,
    `stdout: ${JSON.stringify(result.stdout ?? '')}`,
    `stderr: ${JSON.stringify(result.stderr ?? '')}`,
  ].join('\n')

  if (result.error || result.status !== 0 || result.signal !== null) {
    throw new Error(`${probeName} failed\n${diagnostics}`)
  }

  let output: string
  try {
    output = await readFile(resultPath, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${probeName} did not emit a JSON result: ${message}\n${diagnostics}`)
  }

  try {
    return JSON.parse(output) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${probeName} emitted invalid JSON: ${message}\n${diagnostics}`)
  }
}

describe.skipIf(!bunAvailable)('plugin-host Bun backend reload lifecycle', () => {
  it('reloads lazy CommonJS dependencies without retaining prior generations', async () => {
    const testDirectory = await mkdtemp(join(tmpdir(), 'openforge-bun-backend-reload-'))
    const probePath = join(testDirectory, 'probe.ts')
    const resultPath = join(testDirectory, 'result.json')
    const runtimeUrl = pathToFileURL(resolve('src-tauri/plugin-host/index.ts')).href

    await writeFile(probePath, `
      import { mkdtemp, writeFile } from 'node:fs/promises'
      import { tmpdir } from 'node:os'
      import { join } from 'node:path'
      import { createPluginHostRuntime } from ${JSON.stringify(runtimeUrl)}

      const directory = await mkdtemp(join(tmpdir(), 'openforge-bun-backend-module-'))
      const backendPath = join(directory, 'backend.cjs')
      const dependencyPath = join(directory, 'lazy.cjs')
      const markers = []
      globalThis.__bunReloadMarkers = markers
      await writeFile(backendPath, \`
        module.exports = {
          activate(openforge, context) {
            let dependency
            context.subscriptions.add(openforge.backend.registerMethod('generation', {
              handler() {
                dependency ??= require('./lazy.cjs')
                return dependency.generation
              }
            }))
          }
        }
      \`)

      const runtime = createPluginHostRuntime()
      for (let generation = 1; generation <= 20; generation += 1) {
        await writeFile(dependencyPath, \`
          const marker = { retained: new Uint8Array(512 * 1024) }
          globalThis.__bunReloadMarkers.push(new WeakRef(marker))
          module.exports = { generation: \${generation}, marker }
        \`)
        await runtime.activateBackend({ pluginId: 'bun-reload', backendPath })
        const loadedGeneration = await runtime.invokeBackend({ pluginId: 'bun-reload', command: 'generation' })
        if (loadedGeneration !== generation) throw new Error(\`stale generation \${loadedGeneration}\`)
        await runtime.deactivateBackend('bun-reload')
      }

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await Bun.sleep(0)
        Bun.gc(true)
      }
      await writeFile(${JSON.stringify(resultPath)}, JSON.stringify({
        generations: 20,
        retainedModules: markers.filter(marker => marker.deref() !== undefined).length,
      }))
    `)

    const result = spawnSync(bunExecutable, [probePath], {
      cwd: process.cwd(),
      timeout: 30_000,
      encoding: 'utf8',
    })
    const output = await parseProbeResult<{ generations: number; retainedModules: number }>(
      'Lazy CommonJS reload probe',
      result,
      resultPath,
    )

    expect(output).toEqual({ generations: 20, retainedModules: 0 })
  })

  it('runs ESM backends in terminable workers under Bun', async () => {
    const testDirectory = await mkdtemp(join(tmpdir(), 'openforge-bun-worker-host-'))
    const probePath = join(testDirectory, 'probe.ts')
    const runtimeUrl = pathToFileURL(resolve('src-tauri/plugin-host/index.ts')).href
    const isolatedRuntimeUrl = pathToFileURL(resolve('src-tauri/plugin-host/isolated-runtime.ts')).href
    await writeFile(probePath, `
      import { mkdtemp, writeFile } from 'node:fs/promises'
      import { tmpdir } from 'node:os'
      import { join } from 'node:path'
      import { IsolatedPluginHostRuntime } from ${JSON.stringify(isolatedRuntimeUrl)}

      const directory = await mkdtemp(join(tmpdir(), 'openforge-bun-esm-worker-'))
      const backendPath = join(directory, 'backend.mjs')
      await writeFile(backendPath, \`
        import { threadId } from 'node:worker_threads'
        export default {
          activate(openforge, context) {
            context.subscriptions.add(openforge.backend.registerMethod('threadId', { handler() { return threadId } }))
          }
        }
      \`)
      const runtime = new IsolatedPluginHostRuntime(${JSON.stringify(runtimeUrl)}, async () => null)
      const response = await runtime.handleJsonRpcRequest({
        jsonrpc: '2.0', id: 1, method: 'worker.threadId',
        params: { pluginId: 'worker', backendPath, command: 'threadId' }
      })
      await runtime.handleJsonRpcRequest({
        jsonrpc: '2.0', id: 2, method: 'plugin.backend.deactivate', params: { pluginId: 'worker' }
      })
      console.log(JSON.stringify(response))
    `)

    const { stdout } = await execFileAsync(bunExecutable, [probePath], {
      cwd: process.cwd(),
      timeout: 30_000,
    })
    const response = JSON.parse(stdout.trim()) as { result?: number }
    expect(response.result).toBeGreaterThan(0)
  })
})
