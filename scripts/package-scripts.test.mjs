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
      "pnpm --filter @openforge-app/plugin-sdk build && pnpm -r --filter './plugins/*' --if-present build:bundle",
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
        'pnpm --filter @openforge-app/plugin-sdk build && pnpm run build:bundle',
      )
      expect(packageJson.scripts['build:bundle'], packagePath).toBeTruthy()
      expect(packageJson.scripts['build:bundle'], packagePath).not.toContain('@openforge-app/plugin-sdk')
    }
  })

  it('runs built-in plugin builds in CI so missing package exports fail the pipeline', async () => {
    const ciWorkflow = await readFile(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')

    expect(ciWorkflow).toContain('id: plugin_build')
    expect(ciWorkflow).toContain('pnpm build:plugins 2>&1 | tee /tmp/plugin-build.log')
    expect(ciWorkflow).toContain("steps.plugin_build.outputs.exit_code != '0'")
  })

  it('runs the packaged Electron smoke guardrail in general CI on macOS instead of release-only CI', async () => {
    const ciWorkflow = await readFile(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
    const releaseWorkflow = await readFile(join(repoRoot, '.github/workflows/release.yml'), 'utf8')

    expect(ciWorkflow).toContain('packaged-electron-smoke:')
    expect(ciWorkflow).toContain('runs-on: macos-14')
    expect(ciWorkflow).toContain('pnpm electron:package 2>&1 | tee /tmp/packaged-smoke-package.log')
    expect(ciWorkflow).toContain('pnpm electron:smoke:packaged --skip-package 2>&1 | tee /tmp/packaged-smoke.log')
    expect(ciWorkflow).toContain("steps.package_app.outputs.exit_code != '0' || steps.smoke.outputs.exit_code != '0'")
    expect(releaseWorkflow).not.toContain('electron:smoke:packaged')
  })

  it('checks the packed Plugin SDK contract and publishes it through one reusable workflow', async () => {
    const rootPackage = await readJson('package.json')
    const sdkPackage = await readJson('packages/plugin-sdk/package.json')
    const ciWorkflow = await readFile(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
    const publishWorkflow = await readFile(join(repoRoot, '.github/workflows/publish-plugin-sdk.yml'), 'utf8')
    const releaseWorkflow = await readFile(join(repoRoot, '.github/workflows/release.yml'), 'utf8')
    const reusablePublishWorkflow = await readFile(
      join(repoRoot, '.github/workflows/reusable-publish-plugin-sdk.yml'),
      'utf8',
    )

    expect(sdkPackage.version).toBe('0.2.1')
    expect(sdkPackage.scripts['check:contract']).toBe('node ./scripts/check-published-contract.mjs')
    expect(sdkPackage.scripts.prepublishOnly).toBe('pnpm run check:contract')
    expect(rootPackage.scripts['packages:contract:check']).toBe('pnpm --filter @openforge-app/plugin-sdk check:contract')
    expect(ciWorkflow).toContain('pnpm packages:contract:check')

    const sharedPublishSteps = [
      'Set SDK package version',
      'pnpm --filter @openforge-app/plugin-sdk build',
      'pnpm --filter @openforge-app/plugin-sdk test',
      'pnpm packages:contract:check',
      'npm view "@openforge-app/plugin-sdk@$PACKAGE_VERSION"',
      'pnpm packages:metadata:check',
      'npm pack --dry-run',
      'npm publish --access public --provenance',
    ]

    for (const callerWorkflow of [publishWorkflow, releaseWorkflow]) {
      expect(callerWorkflow).toContain('uses: ./.github/workflows/reusable-publish-plugin-sdk.yml')
      for (const sharedStep of sharedPublishSteps) {
        expect(callerWorkflow).not.toContain(sharedStep)
      }
    }

    expect(reusablePublishWorkflow).toContain('workflow_call:')
    for (const sharedStep of sharedPublishSteps) {
      expect(reusablePublishWorkflow).toContain(sharedStep)
    }
    expect(reusablePublishWorkflow).toContain('npm publish --access public --provenance --tag "${{ inputs.npm_tag }}"')
    expect(releaseWorkflow).toContain('package_version: ${{ github.ref_name }}')
    expect(publishWorkflow).toContain('dry_run: ${{ inputs.dry_run }}')
  })
})
