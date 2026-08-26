import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  formatMetadataErrors,
  validateWorkspacePackageMetadata,
} from './check-workspace-package-metadata.mjs'
import { readWorkspacePackages } from './workspace-packages.mjs'

async function createWorkspacePackage(root, dirName, manifest, files = {}) {
  const packageDir = join(root, 'packages', dirName)
  await mkdir(packageDir, { recursive: true })
  await writeFile(join(packageDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  for (const [relativePath, content] of Object.entries(files)) {
    await writeFile(join(packageDir, relativePath), content)
  }
}

async function withWorkspace(callback) {
  const root = await mkdtemp(join(tmpdir(), 'openforge-package-metadata-'))
  await mkdir(join(root, 'packages'))
  try {
    return await callback(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('workspace package metadata checks', () => {
  it('accepts explicitly publishable MIT packages and private app-licensed packages', async () => {
    await withWorkspace(async root => {
      await createWorkspacePackage(root, 'plugin-sdk', {
        name: '@openforge-app/plugin-sdk',
        version: '0.1.0',
        license: 'MIT',
        publishConfig: { access: 'public' },
      }, { LICENSE: 'MIT License\n' })
      await createWorkspacePackage(root, 'plugin-runtime', {
        name: '@openforge-app/plugin-runtime',
        version: '0.1.0',
        private: true,
        license: 'SEE LICENSE IN ../../LICENSE',
      })
      await writeFile(join(root, 'LICENSE'), 'OpenForge Source-Available License\n')

      const packages = readWorkspacePackages(root)

      expect(validateWorkspacePackageMetadata(packages)).toEqual([])
    })
  })

  it('rejects public workspace package names without license metadata', async () => {
    const errors = await withWorkspace(async root => {
      await createWorkspacePackage(root, 'ambiguous', {
        name: '@openforge-app/ambiguous',
        version: '0.1.0',
      })

      return validateWorkspacePackageMetadata(readWorkspacePackages(root))
    })

    expect(formatMetadataErrors(errors)).toContain('@openforge-app/ambiguous must either set private:true or declare an explicit license')
  })

  it('rejects public packages that are not wired into publish dry-runs', async () => {
    const errors = await withWorkspace(async root => {
      await createWorkspacePackage(root, 'terminal-runtime', {
        name: '@openforge-app/terminal-runtime',
        version: '0.1.0',
        license: 'MIT',
      }, { LICENSE: 'MIT License\n' })

      return validateWorkspacePackageMetadata(readWorkspacePackages(root))
    })

    expect(formatMetadataErrors(errors)).toContain('@openforge-app/terminal-runtime is public/non-private but lacks publishConfig')
  })

  it('rejects private packages with publishConfig and missing referenced license files', async () => {
    const errors = await withWorkspace(async root => {
      await createWorkspacePackage(root, 'private-runtime', {
        name: '@openforge-app/private-runtime',
        version: '0.1.0',
        private: true,
        license: 'SEE LICENSE IN ../../LICENSE',
        publishConfig: { access: 'public' },
      })

      return validateWorkspacePackageMetadata(readWorkspacePackages(root))
    })

    const formatted = formatMetadataErrors(errors)
    expect(formatted).toContain('@openforge-app/private-runtime is private but still declares publishConfig')
    expect(formatted).toContain('@openforge-app/private-runtime points license metadata at ../../LICENSE')
  })

  it('requires package-local license files for MIT workspace packages', async () => {
    const errors = await withWorkspace(async root => {
      await createWorkspacePackage(root, 'plugin-sdk', {
        name: '@openforge-app/plugin-sdk',
        version: '0.1.0',
        license: 'MIT',
        publishConfig: { access: 'public' },
      })

      return validateWorkspacePackageMetadata(readWorkspacePackages(root))
    })

    expect(formatMetadataErrors(errors)).toContain('@openforge-app/plugin-sdk declares MIT but does not include a package-local LICENSE file')
  })
})
