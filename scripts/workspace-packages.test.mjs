import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { isPublishableWorkspacePackage, readWorkspacePackages } from './workspace-packages.mjs'

async function withWorkspace(callback) {
  const root = await mkdtemp(join(tmpdir(), 'openforge-workspace-packages-'))
  await mkdir(join(root, 'packages'))
  try {
    return await callback(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function createWorkspacePackage(root, dirName, manifest) {
  const packageDir = join(root, 'packages', dirName)
  await mkdir(packageDir)
  await writeFile(join(packageDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

describe('workspace packages', () => {
  it('loads package manifests in package-name order', async () => {
    await withWorkspace(async root => {
      await createWorkspacePackage(root, 'zeta', { name: '@openforge-app/zeta' })
      await createWorkspacePackage(root, 'alpha', { name: '@openforge-app/alpha' })

      const packages = readWorkspacePackages(root)

      expect(packages).toEqual([
        {
          packageDir: join(root, 'packages', 'alpha'),
          manifest: { name: '@openforge-app/alpha' },
        },
        {
          packageDir: join(root, 'packages', 'zeta'),
          manifest: { name: '@openforge-app/zeta' },
        },
      ])
    })
  })

  it('identifies only non-private packages with publishConfig as publishable', () => {
    expect(isPublishableWorkspacePackage({ private: false, publishConfig: { access: 'public' } })).toBe(true)
    expect(isPublishableWorkspacePackage({ publishConfig: { access: 'public' } })).toBe(true)
    expect(isPublishableWorkspacePackage({ private: true, publishConfig: { access: 'public' } })).toBe(false)
    expect(isPublishableWorkspacePackage({ private: false })).toBe(false)
  })
})
