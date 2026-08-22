import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findPluginImportBoundaryViolations,
  PLUGIN_IMPORT_PACKAGE_MANIFEST_PATHS,
} from './check-plugin-import-boundaries.mjs'

const repoRoot = process.cwd()

function readDocumentedPluginImports() {
  return PLUGIN_IMPORT_PACKAGE_MANIFEST_PATHS.flatMap((manifestPath) => {
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), manifestPath), 'utf8'))
    return Object.keys(manifest.exports).map((subpath) =>
      subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`,
    )
  })
}

function writePluginImportPackageManifests(workspaceRoot, pluginSdkExports) {
  for (const manifestPath of PLUGIN_IMPORT_PACKAGE_MANIFEST_PATHS) {
    const packageDirectory = path.basename(path.dirname(manifestPath))
    const absoluteManifestPath = path.join(workspaceRoot, manifestPath)
    const exports = packageDirectory === 'plugin-sdk' ? pluginSdkExports : {}
    mkdirSync(path.dirname(absoluteManifestPath), { recursive: true })
    writeFileSync(absoluteManifestPath, JSON.stringify({
      name: `@openforge-app/${packageDirectory}`,
      exports,
    }))
  }
}

describe('findPluginImportBoundaryViolations', () => {
  it('reports plugin imports that reach into app-private src code', () => {
    const files = new Map([
      [
        path.join(repoRoot, 'plugins/example/src/LeakyView.svelte'),
        `<script lang="ts">
          import Card from '../../../src/components/shared/Card.svelte'
          import { activeTask } from '../../../src/lib/stores'
        </script>`
      ]
    ])

    expect(findPluginImportBoundaryViolations({ files, repoRoot })).toEqual([
      {
        file: 'plugins/example/src/LeakyView.svelte',
        line: 2,
        importPath: '../../../src/components/shared/Card.svelte',
        message: 'Plugins must not import app-private source under src/**; use documented SDK or host-shared package exports instead.'
      },
      {
        file: 'plugins/example/src/LeakyView.svelte',
        line: 3,
        importPath: '../../../src/lib/stores',
        message: 'Plugins must not import app-private source under src/**; use documented SDK or host-shared package exports instead.'
      }
    ])
  })

  it('allows every documented export from plugin-facing OpenForge packages', () => {
    const documentedImports = readDocumentedPluginImports()
    const files = new Map([
      [
        path.join(repoRoot, 'plugins/example/src/documented-imports.ts'),
        documentedImports.map((importPath) => `import('${importPath}')`).join('\n'),
      ],
    ])

    expect(findPluginImportBoundaryViolations({ files, repoRoot })).toEqual([])
  })

  it('tracks package export additions and removals without checker changes', () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'openforge-import-boundaries-'))
    const pluginFile = path.join(workspaceRoot, 'plugins/example/src/index.ts')
    const importPath = '@openforge-app/plugin-sdk/features/example'
    const files = new Map([[pluginFile, `import('${importPath}')`]])

    try {
      writePluginImportPackageManifests(workspaceRoot, {
        './features/*': './dist/features/*.js',
      })
      expect(findPluginImportBoundaryViolations({ files, repoRoot: workspaceRoot })).toEqual([])

      writePluginImportPackageManifests(workspaceRoot, {})
      expect(findPluginImportBoundaryViolations({ files, repoRoot: workspaceRoot })).toEqual([
        {
          file: 'plugins/example/src/index.ts',
          line: 1,
          importPath,
          message: 'Plugins may only import documented exports from @openforge-app/plugin-sdk.',
        },
      ])
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('honors null exclusions within package export patterns', () => {
    const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'openforge-import-boundaries-'))
    const importPath = '@openforge-app/plugin-sdk/features/private/example'
    const files = new Map([[
      path.join(workspaceRoot, 'plugins/example/src/index.ts'),
      `import('${importPath}')`,
    ]])

    try {
      writePluginImportPackageManifests(workspaceRoot, {
        './features/*': './dist/features/*.js',
        './features/private/*': null,
      })

      expect(findPluginImportBoundaryViolations({ files, repoRoot: workspaceRoot })).toEqual([
        {
          file: 'plugins/example/src/index.ts',
          line: 1,
          importPath,
          message: 'Plugins may only import documented exports from @openforge-app/plugin-sdk.',
        },
      ])
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('allows plugin-local imports, normal dependencies, SDK UI, and documented host-shared UI packages', () => {
    const files = new Map([
      [
        path.join(repoRoot, 'plugins/example/src/PluginView.svelte'),
        `<script lang="ts">
          import { tick } from 'svelte'
          import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
          import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
          import PluginPageHeader from '@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte'
          import PluginViewState from '@openforge-app/plugin-sdk/ui/PluginViewState.svelte'
          import FileTypeIcon from '@openforge-app/plugin-sdk/ui/FileTypeIcon.svelte'
          import { sanitizePluginIcon } from '@openforge-app/plugin-sdk/pluginIcons'
          import TerminalTabsShell from '@openforge-app/terminal-runtime/TerminalTabsShell'
          import PrOverviewTab from '@openforge-app/pr-review-ui/PrOverviewTab.svelte'
          import { getFileStatusLabel } from '@openforge-app/pr-review-ui/fileStatus'
          import LocalCard from './components/LocalCard.svelte'
        </script>`
      ]
    ])

    expect(findPluginImportBoundaryViolations({ files, repoRoot })).toEqual([])
  })

  it('reports private OpenForge workspace package imports and package source reach-through', () => {
    const files = new Map([
      [
        path.join(repoRoot, 'plugins/example/src/backend.ts'),
        `import { validateCommandName } from '@openforge-app/plugin-runtime/commandValidation'
         import HiddenMarkdown from '@openforge-app/plugin-sdk/src/ui/MarkdownContent.svelte'
         import { helper } from '../../../packages/plugin-runtime/src/index'
         export { privateValue } from '../../../packages/pr-review-ui/src/private'`
      ]
    ])

    expect(findPluginImportBoundaryViolations({ files, repoRoot })).toEqual([
      {
        file: 'plugins/example/src/backend.ts',
        line: 1,
        importPath: '@openforge-app/plugin-runtime/commandValidation',
        message: 'Plugins may only import documented OpenForge package surfaces: @openforge-app/plugin-sdk, @openforge-app/terminal-runtime, and @openforge-app/pr-review-ui.'
      },
      {
        file: 'plugins/example/src/backend.ts',
        line: 2,
        importPath: '@openforge-app/plugin-sdk/src/ui/MarkdownContent.svelte',
        message: 'Plugins may only import documented exports from @openforge-app/plugin-sdk.'
      },
      {
        file: 'plugins/example/src/backend.ts',
        line: 3,
        importPath: '../../../packages/plugin-runtime/src/index',
        message: 'Plugins must not import package source paths directly; use documented package exports instead.'
      },
      {
        file: 'plugins/example/src/backend.ts',
        line: 4,
        importPath: '../../../packages/pr-review-ui/src/private',
        message: 'Plugins must not import package source paths directly; use documented package exports instead.'
      }
    ])
  })

  it('reports bare source-like imports before a bundler can resolve them', () => {
    const files = new Map([
      [
        path.join(repoRoot, 'plugins/example/src/PluginView.ts'),
        `import HostCard from 'src/components/shared/ui/Card.svelte'
         import { invoke } from 'src-tauri/plugin-host/private'
         import { internal } from 'packages/plugin-runtime/src/index'`
      ]
    ])

    expect(findPluginImportBoundaryViolations({ files, repoRoot })).toEqual([
      {
        file: 'plugins/example/src/PluginView.ts',
        line: 1,
        importPath: 'src/components/shared/ui/Card.svelte',
        message: 'Plugins must not import app-private source under src/**; use documented SDK or host-shared package exports instead.'
      },
      {
        file: 'plugins/example/src/PluginView.ts',
        line: 2,
        importPath: 'src-tauri/plugin-host/private',
        message: 'Plugins must not import host-private Rust sidecar source under src-tauri/**; use SDK host capabilities instead.'
      },
      {
        file: 'plugins/example/src/PluginView.ts',
        line: 3,
        importPath: 'packages/plugin-runtime/src/index',
        message: 'Plugins must not import package source paths directly; use documented package exports instead.'
      }
    ])
  })

  it('reports CommonJS and TypeScript require-style boundary violations', () => {
    const files = new Map([
      [
        path.join(repoRoot, 'plugins/example/src/commonjs.cjs'),
        `const stores = require('../../../src/lib/stores')
      const runtime = require('../../../packages/plugin-runtime/src/index')`
      ],
      [
        path.join(repoRoot, 'plugins/example/src/importEquals.ts'),
        `import stores = require('../../../src/lib/stores')
         import hidden = require('@openforge-app/plugin-sdk/not-documented')`
      ]
    ])

    expect(findPluginImportBoundaryViolations({ files, repoRoot })).toEqual([
      {
        file: 'plugins/example/src/commonjs.cjs',
        line: 1,
        importPath: '../../../src/lib/stores',
        message: 'Plugins must not import app-private source under src/**; use documented SDK or host-shared package exports instead.'
      },
      {
        file: 'plugins/example/src/commonjs.cjs',
        line: 2,
        importPath: '../../../packages/plugin-runtime/src/index',
        message: 'Plugins must not import package source paths directly; use documented package exports instead.'
      },
      {
        file: 'plugins/example/src/importEquals.ts',
        line: 1,
        importPath: '../../../src/lib/stores',
        message: 'Plugins must not import app-private source under src/**; use documented SDK or host-shared package exports instead.'
      },
      {
        file: 'plugins/example/src/importEquals.ts',
        line: 2,
        importPath: '@openforge-app/plugin-sdk/not-documented',
        message: 'Plugins may only import documented exports from @openforge-app/plugin-sdk.'
      }
    ])
  })
})
