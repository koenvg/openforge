import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..')

async function readJson(relativePath) {
  return JSON.parse(await readFile(join(repoRoot, relativePath), 'utf8'))
}

async function pluginPackagePaths() {
  const pluginEntries = await readdir(join(repoRoot, 'plugins'), { withFileTypes: true })

  return pluginEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => `plugins/${entry.name}/package.json`)
    .sort()
}

describe('package build scripts', () => {
  it('builds the plugin SDK package once before built-in plugin bundles', async () => {
    const packageJson = await readJson('package.json')

    expect(packageJson.scripts['build:plugins']).toBe(
      "pnpm --filter @openforge/plugin-sdk build && pnpm -r --filter './plugins/*' --if-present build:bundle",
    )
  })

  it('makes direct filtered plugin builds build the SDK before bundling without duplicating that work in root plugin builds', async () => {
    const pluginPackages = await Promise.all(
      (await pluginPackagePaths()).map(async (packagePath) => ({
        packagePath,
        packageJson: await readJson(packagePath),
      })),
    )
    const pluginPackagesWithBuildScripts = pluginPackages.filter(
      ({ packageJson }) => packageJson.scripts?.build,
    )

    expect(pluginPackagesWithBuildScripts.length).toBeGreaterThan(0)

    for (const { packagePath, packageJson } of pluginPackagesWithBuildScripts) {
      expect(packageJson.scripts.build, packagePath).toBe(
        'pnpm --filter @openforge/plugin-sdk build && pnpm run build:bundle',
      )
      expect(packageJson.scripts['build:bundle'], packagePath).toBeTruthy()
      expect(packageJson.scripts['build:bundle'], packagePath).not.toContain('@openforge/plugin-sdk')
    }
  })

  it('exposes the deterministic Electron smoke target from package scripts', async () => {
    const packageJson = await readJson('package.json')

    expect(packageJson.scripts['test:electron-smoke']).toBe('node scripts/electron-smoke-test.mjs')
  })

  it('runs built-in plugin builds in CI so missing package exports fail the pipeline', async () => {
    const ciWorkflow = await readFile(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')

    expect(ciWorkflow).toContain('id: plugin_build')
    expect(ciWorkflow).toContain('pnpm build:plugins 2>&1 | tee /tmp/plugin-build.log')
    expect(ciWorkflow).toContain("steps.plugin_build.outputs.exit_code != '0'")
  })

  it('runs the Electron smoke target on macos CI and uploads smoke failure artifacts', async () => {
    const ciWorkflow = await readFile(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')

    expect(ciWorkflow).toContain('electron_smoke:')
    expect(ciWorkflow).toContain('runs-on: macos-13')
    expect(ciWorkflow).toContain('pnpm test:electron-smoke')
    expect(ciWorkflow).toContain('path: test-results/electron-smoke')
  })
})
