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

async function publishablePackageManifests() {
  const packageEntries = await readdir(join(repoRoot, 'packages'), { withFileTypes: true })
  const packagePaths = packageEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/package.json`)
    .sort()

  const packages = await Promise.all(
    packagePaths.map(async (packagePath) => ({
      packagePath,
      packageJson: await readJson(packagePath),
    })),
  )

  return packages.filter(
    ({ packageJson }) => packageJson.private !== true && packageJson.publishConfig,
  )
}

describe('package build scripts', () => {
  it('builds the plugin SDK package once before built-in plugin bundles', async () => {
    const packageJson = await readJson('package.json')

    expect(packageJson.scripts['build:plugins']).toBe(
      "pnpm --filter @openforge-app/plugin-sdk build && pnpm -r --filter './plugins/*' --if-present build:bundle",
    )
  })

  it('builds and tests every publishable workspace package', async () => {
    const rootPackage = await readJson('package.json')
    const publishablePackages = await publishablePackageManifests()

    expect(publishablePackages.length).toBeGreaterThan(0)

    for (const scriptName of ['build', 'test']) {
      const expectedCommands = publishablePackages.map(({ packagePath, packageJson }) => {
        expect(packageJson.scripts?.[scriptName], packagePath).toBeTruthy()
        return `pnpm --filter ${packageJson.name} ${scriptName}`
      })

      expect(rootPackage.scripts[`packages:${scriptName}`].split(' && ')).toEqual(expectedCommands)
    }
  })

  it('runs publishable package coverage regression in the npm readiness job', async () => {
    const ciWorkflow = await readFile(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
    const jobStart = ciWorkflow.indexOf('  npm-packages:')
    const nextJob = ciWorkflow.slice(jobStart + 1).search(/^  [\w-]+:/m)
    const npmPackagesJob = ciWorkflow.slice(
      jobStart,
      nextJob === -1 ? undefined : jobStart + nextJob + 1,
    )

    expect(jobStart).toBeGreaterThan(-1)
    expect(npmPackagesJob).toContain('id: package_readiness_coverage')
    expect(npmPackagesJob).toContain(
      'pnpm test scripts/package-scripts.test.mjs 2>&1 | tee /tmp/npm-package-readiness-coverage.log',
    )
    expect(npmPackagesJob).toContain(
      "steps.package_readiness_coverage.outputs.exit_code != '0'",
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

  it('uses Node.js 24-backed GitHub Action releases', async () => {
    const workflowDirectory = join(repoRoot, '.github/workflows')
    const workflowFiles = (await readdir(workflowDirectory)).filter((name) => name.endsWith('.yml'))
    const workflowSource = (
      await Promise.all(
        workflowFiles.map((name) => readFile(join(workflowDirectory, name), 'utf8')),
      )
    ).join('\n')

    for (const action of [
      'actions/checkout',
      'actions/setup-node',
      'actions/upload-artifact',
      'pnpm/action-setup',
    ]) {
      const versions = [...workflowSource.matchAll(new RegExp(`${action}@([^\\s]+)`, 'g'))].map(
        ([, version]) => version,
      )

      expect(versions.length, action).toBeGreaterThan(0)
      expect(new Set(versions), action).toEqual(new Set(['v6']))
    }
  })

  it('prepares pinned Ghostty dependencies through one reusable action for every compiling job', async () => {
    const ghosttyActionPath = '.github/actions/prepare-ghostty/action.yml'
    const ghosttyAction = await readFile(join(repoRoot, ghosttyActionPath), 'utf8')
    const ciWorkflow = await readFile(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
    const releaseWorkflow = await readFile(join(repoRoot, '.github/workflows/release.yml'), 'utf8')
    const reusableActionUse = 'uses: ./.github/actions/prepare-ghostty'

    expect(ghosttyAction).toContain('using: composite')
    expect(ghosttyAction).toContain('uses: mlugg/setup-zig@v2')
    expect(ghosttyAction).toContain('version: 0.16.0')
    expect(ghosttyAction).toContain('node scripts/prepare-ghostty-vt.mjs')
    expect(ghosttyAction).toContain(`grep '^GHOSTTY_'`)
    expect(ghosttyAction).toContain(`echo 'CARGO_NET_OFFLINE=true' >> "$GITHUB_ENV"`)

    for (const [workflow, jobName] of [
      [ciWorkflow, 'ghostty-compatibility'],
      [ciWorkflow, 'rust'],
      [ciWorkflow, 'packaged-electron-smoke'],
      [releaseWorkflow, 'release'],
    ]) {
      const jobStart = workflow.indexOf(`  ${jobName}:`)
      const nextJob = workflow.slice(jobStart + 1).search(/^  [\w-]+:/m)
      const job = workflow.slice(jobStart, nextJob === -1 ? undefined : jobStart + nextJob + 1)

      expect(jobStart, jobName).toBeGreaterThan(-1)
      expect(job, jobName).toContain(reusableActionUse)
    }

    expect(ciWorkflow).not.toContain('uses: mlugg/setup-zig@v2')
    expect(releaseWorkflow).not.toContain('uses: mlugg/setup-zig@v2')
    expect(ciWorkflow).not.toContain('node scripts/prepare-ghostty-vt.mjs')
    expect(releaseWorkflow).not.toContain('node scripts/prepare-ghostty-vt.mjs')
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

    expect(sdkPackage.version).toBe('0.2.5')
    expect(sdkPackage.repository).toEqual({
      type: 'git',
      url: 'https://github.com/koenvg/openforge.git',
      directory: 'packages/plugin-sdk',
    })
    expect(sdkPackage.scripts['check:contract']).toBe('node ./scripts/check-published-contract.mjs')
    expect(sdkPackage.scripts.prepublishOnly).toBe('pnpm run check:contract')
    expect(rootPackage.scripts['packages:contract:check']).toBe('pnpm --filter @openforge-app/plugin-sdk check:contract')
    expect(ciWorkflow).toContain('pnpm packages:contract:check')
    expect(ciWorkflow).toContain('oven-sh/setup-bun@v2')

    const sharedPublishSteps = [
      'Set SDK package version',
      'pnpm --filter @openforge-app/plugin-sdk build',
      'pnpm --filter @openforge-app/plugin-sdk test',
      'pnpm packages:contract:check',
      'npm view "@openforge-app/plugin-sdk@$PACKAGE_VERSION"',
      'pnpm packages:metadata:check',
      'pnpm pack --dry-run',
      'npm install --global npm@^11.5.1',
      'oven-sh/setup-bun@v2',
      'pnpm publish --no-git-checks --access public --provenance',
    ]

    expect(publishWorkflow).toContain('uses: ./.github/workflows/reusable-publish-plugin-sdk.yml')
    expect(releaseWorkflow).not.toContain('uses: ./.github/workflows/reusable-publish-plugin-sdk.yml')
    for (const callerWorkflow of [publishWorkflow, releaseWorkflow]) {
      for (const sharedStep of sharedPublishSteps) {
        expect(callerWorkflow).not.toContain(sharedStep)
      }
    }

    expect(reusablePublishWorkflow).toContain('workflow_call:')
    expect(reusablePublishWorkflow).toContain('node-version: 24')
    for (const sharedStep of sharedPublishSteps) {
      expect(reusablePublishWorkflow).toContain(sharedStep)
    }

    const validationStepIndex = reusablePublishWorkflow.indexOf('name: Validate npm dist-tag')
    const publishStepIndex = reusablePublishWorkflow.indexOf(
      'pnpm publish --no-git-checks --access public --provenance --tag "$NPM_TAG"',
    )
    expect(validationStepIndex).toBeGreaterThan(-1)
    expect(publishStepIndex).toBeGreaterThan(validationStepIndex)
    expect(reusablePublishWorkflow).toContain('NPM_TAG: ${{ inputs.npm_tag }}')
    expect(reusablePublishWorkflow).toContain('run: node scripts/npm-dist-tag.mjs')
    expect(reusablePublishWorkflow).not.toContain('--tag "${{ inputs.npm_tag }}"')
    expect(publishWorkflow).toContain('- "v*"')
    expect(publishWorkflow).toContain('description: "SDK version to publish manually; leave blank to use the checked-in version"')
    expect(publishWorkflow).toContain("package_version: ${{ github.event_name == 'push' && github.ref_name || inputs.package_version }}")
    expect(publishWorkflow).toContain("npm_tag: ${{ inputs.npm_tag || 'latest' }}")
    expect(publishWorkflow).toContain("dry_run: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run }}")
  })
})
