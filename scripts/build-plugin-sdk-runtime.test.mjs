import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import * as sdk from '../packages/plugin-sdk/src/index.ts'
import { buildPluginSdkRuntime } from './build-plugin-sdk-runtime.mjs'

const execFileAsync = promisify(execFile)

async function write(root, relativePath, content) {
  const fullPath = path.join(root, relativePath)
  await mkdir(path.dirname(fullPath), { recursive: true })
  await writeFile(fullPath, content)
}

describe('plugin SDK runtime artifact', () => {
  it('defaults to the Electron host runtime output instead of src-tauri', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openforge-plugin-sdk-runtime-default-'))

    try {
      await write(root, 'packages/plugin-sdk/src/index.ts', 'export const defaultRuntime = true\n')

      const generatedPath = await buildPluginSdkRuntime({ workspaceRoot: root, logLevel: 'silent' })

      expect(path.relative(root, generatedPath)).toBe(path.join('dist-electron', 'plugin-host', 'plugin-sdk', 'index.js'))
      await expect(stat(path.join(root, 'src-tauri', 'plugin-host', 'plugin-sdk', 'index.js'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(generatedPath, 'utf8')).resolves.toContain('defaultRuntime')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('builds a standalone ES module with the current SDK exports at an explicit output path', async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), 'openforge-plugin-sdk-runtime-'))

    try {
      const generatedPath = await buildPluginSdkRuntime({ outDir, logLevel: 'silent' })
      expect(generatedPath).toBe(path.join(outDir, 'index.js'))
      expect(await readdir(outDir)).toEqual(['index.js'])

      // A data URL has no package or filesystem resolution context. Loading it in
      // native Node ensures the bundle needs neither Vite nor workspace dependencies.
      const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', `
        import { readFile } from 'node:fs/promises'
        const code = await readFile(process.argv[1], 'utf8')
        const runtime = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
        console.log(JSON.stringify({
          exports: Object.keys(runtime).sort(),
          apiVersion: runtime.OPENFORGE_PLUGIN_API_VERSION,
          validNumber: runtime.parseStrictFiniteNumber('12.5'),
          invalidNumber: runtime.parseStrictFiniteNumber('12.5px'),
        }))
      `, generatedPath])

      expect(JSON.parse(stdout)).toEqual({
        exports: Object.keys(sdk).sort(),
        apiVersion: sdk.OPENFORGE_PLUGIN_API_VERSION,
        validNumber: 12.5,
        invalidNumber: null,
      })
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  })
})
