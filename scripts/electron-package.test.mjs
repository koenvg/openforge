import { mkdir, readFile, readlink, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  APP_NAME,
  ELECTRON_APP_PACKAGE_NAME,
  ELECTRON_BUNDLE_IDENTIFIER,
  createElectronAppPackageJson,
  electronBundlePath,
  updatePlistBooleanValue,
  updatePlistStringValue,
} from './electron-package/app-metadata.mjs'
import {
  assertPackageArchitectureCompatibility,
  expectedDarwinArchForTarget,
} from './electron-package/architecture-validation.mjs'
import { buildAndPackageElectronApp } from './electron-package/build-orchestration.mjs'
import { packageElectronApp } from './electron-package/package-assembly.mjs'
import { hydrateElectronTemplate } from './electron-package/runtime-hydration.mjs'
import { readBuiltinPluginCatalog } from './electron-package/runtime-assets.mjs'
import { BACKEND_LAYOUT_CONFIG_FILE, resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'

const currentLayoutConfig = {
  backendCrateRoot: 'src-tauri',
  manifestPath: 'src-tauri/Cargo.toml',
  binaryName: 'openforge',
  iconPath: 'src-tauri/icons/icon.icns',
  electronBundleRoot: 'src-tauri/target/release/bundle/electron/macos',
}

async function writeExecutable(path, content = '#!/bin/sh\n') {
  await writeFile(path, content, { mode: 0o755 })
}

async function writeBackendLayoutConfig(repoRoot, config = currentLayoutConfig) {
  await writeFile(join(repoRoot, BACKEND_LAYOUT_CONFIG_FILE), `${JSON.stringify(config, null, 2)}\n`)
}

async function writeElectronBuildOutputs(repoRoot) {
  await mkdir(join(repoRoot, 'dist'), { recursive: true })
  await writeFile(join(repoRoot, 'dist/index.html'), '<!doctype html>')
  await mkdir(join(repoRoot, 'dist-electron', 'plugin-host'), { recursive: true })
  await writeFile(
    join(repoRoot, 'dist-electron/main.js'),
    "import { classifyTaskBrowserDevToolsShortcut } from '@openforge-app/plugin-sdk/taskBrowserDevToolsShortcuts'\nexport { classifyTaskBrowserDevToolsShortcut }\n",
  )
  await writeFile(join(repoRoot, 'dist-electron', 'plugin-host', 'index.js'), 'console.log("bundled backend plugin host")')
}

async function writeBuiltinPluginCatalog(repoRoot, plugins) {
  await writeFile(join(repoRoot, 'builtin-plugins.json'), `${JSON.stringify({ plugins }, null, 2)}\n`)
}

async function writeElectronRuntimeDependencyArtifacts(repoRoot) {
  const dependencyRoot = join(repoRoot, 'node_modules', 'es-module-lexer')
  await mkdir(join(dependencyRoot, 'dist'), { recursive: true })
  await writeFile(join(dependencyRoot, 'package.json'), JSON.stringify({
    name: 'es-module-lexer',
    version: '2.1.0',
    type: 'module',
    exports: './dist/lexer.js',
  }))
  await writeFile(join(dependencyRoot, 'dist', 'lexer.js'), 'export const init = Promise.resolve(); export function parse() { return [[]]; }\n')

  const pluginSdkRoot = join(repoRoot, 'packages', 'plugin-sdk')
  await mkdir(join(pluginSdkRoot, 'dist'), { recursive: true })
  await writeFile(join(pluginSdkRoot, 'package.json'), JSON.stringify({
    name: '@openforge-app/plugin-sdk',
    version: '0.2.5',
    type: 'module',
    exports: {
      './taskBrowserDevToolsShortcuts': './dist/taskBrowserDevToolsShortcuts.js',
    },
  }))
  await writeFile(
    join(pluginSdkRoot, 'dist', 'taskBrowserDevToolsShortcuts.js'),
    'export function classifyTaskBrowserDevToolsShortcut() { return null; }\n',
  )
  await mkdir(join(repoRoot, 'node_modules', '@openforge-app'), { recursive: true })
  await symlink(pluginSdkRoot, join(repoRoot, 'node_modules', '@openforge-app', 'plugin-sdk'))
}

async function writeBuiltInPluginRuntimeArtifacts(repoRoot, directoryName, pluginId = `com.openforge.${directoryName}`) {
  const pluginRoot = join(repoRoot, 'plugins', directoryName)
  await mkdir(join(pluginRoot, 'dist'), { recursive: true })
  await writeFile(join(pluginRoot, 'package.json'), JSON.stringify({
    name: `@openforge-app/plugin-${directoryName}`,
    type: 'module',
    openforge: {
      id: pluginId,
      frontend: './dist/frontend.js',
    },
  }))
  await writeFile(join(pluginRoot, 'dist', 'frontend.js'), 'export const packagedPlugin = true;\n')
  await writeFile(join(pluginRoot, 'dist', 'style.css'), '.plugin {}\n')
  await mkdir(join(pluginRoot, 'src'), { recursive: true })
  await writeFile(join(pluginRoot, 'src', 'index.ts'), 'export const sourceOnly = true;\n')
  await mkdir(join(pluginRoot, 'node_modules', 'left-pad'), { recursive: true })
  await writeFile(join(pluginRoot, 'node_modules', 'left-pad', 'index.js'), 'module.exports = () => {};\n')
}

async function writeCurrentDataIdentityManifest(repoRoot) {
  const manifest = await readFile(join(import.meta.dirname, '..', 'openforge-data-identity.json'), 'utf8')
  await writeFile(join(repoRoot, 'openforge-data-identity.json'), manifest)
}

async function writeAlternateDataIdentityManifest(repoRoot) {
  await writeFile(join(repoRoot, 'openforge-data-identity.json'), JSON.stringify({
    dataIdentity: {
      appDataIdentifier: 'com.example.alternate-openforge',
      appDataDirEnv: 'ALTERNATE_OPENFORGE_APP_DATA_DIR',
      databaseFilenames: {
        debug: 'alternate_openforge_dev.db',
        release: 'alternate_openforge.db',
      },
      keychain: {
        debugService: 'alternate-openforge-dev',
        releaseService: 'alternate-openforge',
        secretAccounts: ['alternate_github_token'],
      },
    },
    packageIdentity: {
      appName: 'Alternate Forge',
      electronAppPackageName: 'alternate-forge-electron-app',
      bundleIdentifier: 'com.example.alternate-forge.electron',
      electronTemplateAppName: 'Alternate Electron.app',
    },
    legacySources: {
      homeDirNames: { old: '.alternate-old', current: '.alternate-forge' },
      dataDirNames: { old: 'alternate-old', current: 'alternate-forge' },
      appIdentifiers: { old: 'com.example.alternate-old', previousOpenForge: 'com.example.alternate-previous-openforge' },
      databaseFilenames: {
        debug: 'alternate_old_dev.db',
        release: 'alternate_old.db',
      },
    },
  }))
}

describe('Electron macOS packaging helpers', () => {
  it('places the Electron install bundle in the existing release bundle tree', () => {
    expect(resolveRustSidecarLayout({ repoRoot: '/repo', config: currentLayoutConfig }).electronAppPath).toBe('/repo/src-tauri/target/release/bundle/electron/macos/Open Forge.app')
  })

  it('creates app package identity from the shared data identity manifest', () => {
    expect(APP_NAME).toBe('Open Forge')
    expect(ELECTRON_APP_PACKAGE_NAME).toBe('openforge-electron-app')
    expect(ELECTRON_BUNDLE_IDENTIFIER).toBe('com.openforge.app.electron')
    expect(createElectronAppPackageJson()).toEqual({
      name: ELECTRON_APP_PACKAGE_NAME,
      version: '0.0.1',
      type: 'module',
      main: 'dist-electron/main.js',
      private: true,
    })
  })

  it('packages an alternate repoRoot with the package identity from that repoRoot data identity manifest', async () => {
    const root = await import('node:os').then(os => os.tmpdir()).then(tmp => join(tmp, `openforge-electron-package-alternate-identity-${process.pid}-${Date.now()}`))
    const template = join(root, 'node_modules/electron/dist/Alternate Electron.app')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, BACKEND_LAYOUT_CONFIG_FILE), JSON.stringify(currentLayoutConfig))
    await writeAlternateDataIdentityManifest(root)

    const output = electronBundlePath(root)
    expect(output).toBe(join(root, 'src-tauri/target/release/bundle/electron/macos/Alternate Forge.app'))

    await mkdir(join(template, 'Contents/MacOS'), { recursive: true })
    await mkdir(join(template, 'Contents/Resources'), { recursive: true })
    await writeExecutable(join(template, 'Contents/MacOS/Electron'))
    await writeFile(join(template, 'Contents/Info.plist'), '<plist><dict><key>CFBundleExecutable</key><string>Electron</string><key>CFBundleName</key><string>Electron</string><key>CFBundleDisplayName</key><string>Electron</string></dict></plist>')
    await writeElectronBuildOutputs(root)
    await writeElectronRuntimeDependencyArtifacts(root)
    await writeBuiltinPluginCatalog(root, [])
    await mkdir(join(root, 'src-tauri/target/release'), { recursive: true })
    await writeExecutable(join(root, 'src-tauri/target/release/openforge'), '#!/bin/sh\necho sidecar\n')

    await packageElectronApp({ repoRoot: root })

    await expect(stat(join(output, 'Contents/MacOS/Alternate Forge'))).resolves.toBeTruthy()
    await expect(readFile(join(output, 'Contents/Resources/app/package.json'), 'utf8').then(JSON.parse)).resolves.toMatchObject({
      name: 'alternate-forge-electron-app',
      main: 'dist-electron/main.js',
    })
    await expect(readFile(join(output, 'Contents/Info.plist'), 'utf8')).resolves.toContain('<key>CFBundleExecutable</key><string>Alternate Forge</string>')
    await expect(readFile(join(output, 'Contents/Info.plist'), 'utf8')).resolves.toMatch(/<key>CFBundleIdentifier<\/key>\s*<string>com\.example\.alternate-forge\.electron<\/string>/)
  })

  it('updates plist string and boolean values while preserving the rest of the document', () => {
    const plist = '<plist><dict><key>CFBundleExecutable</key><string>Electron</string><key>CFBundleName</key><string>Electron</string></dict></plist>'
    const updated = updatePlistBooleanValue(
      updatePlistStringValue(updatePlistStringValue(plist, 'CFBundleExecutable', 'Open Forge'), 'CFBundleName', 'Open Forge'),
      'ApplePressAndHoldEnabled',
      false,
    )

    expect(updated).toContain('<key>CFBundleExecutable</key><string>Open Forge</string>')
    expect(updated).toContain('<key>ApplePressAndHoldEnabled</key>')
    expect(updated).toContain('<false/>')
  })

  it('builds plugin frontend artifacts before renderer and Electron packaging builds', async () => {
    const commands = []

    await buildAndPackageElectronApp({
      repoRoot: '/repo',
      rustSidecarLayout: resolveRustSidecarLayout({ repoRoot: '/repo', config: currentLayoutConfig }),
      runCommand: async (command, args, options) => {
        commands.push({ command, args, cwd: options.cwd })
      },
      packageApp: async ({ repoRoot }) => {
        commands.push({ command: 'packageElectronApp', args: [], cwd: repoRoot })
        return { appPath: `${repoRoot}/app`, sidecarPath: `${repoRoot}/sidecar` }
      },
    })

    expect(commands).toEqual([
      { command: 'pnpm', args: ['build:plugins'], cwd: '/repo' },
      { command: 'pnpm', args: ['build'], cwd: '/repo' },
      { command: 'pnpm', args: ['electron:build'], cwd: '/repo' },
      { command: 'cargo', args: ['build', '--release'], cwd: '/repo/src-tauri' },
      { command: 'packageElectronApp', args: [], cwd: '/repo' },
    ])
  })

  it('maps Rust target triples to Mach-O architecture names used by Electron packaging', () => {
    expect(expectedDarwinArchForTarget('aarch64-apple-darwin')).toBe('arm64')
    expect(expectedDarwinArchForTarget('x86_64-apple-darwin')).toBe('x86_64')
    expect(expectedDarwinArchForTarget('')).toBe(null)
  })

  it('rejects target packages whose Electron runtime architecture does not match the Rust sidecar', async () => {
    await expect(assertPackageArchitectureCompatibility({
      cargoBuildTarget: 'x86_64-apple-darwin',
      appExecutablePath: '/app/Contents/MacOS/Open Forge',
      sidecarPath: '/app/Contents/MacOS/openforge-sidecar',
      readExecutableArchitectures: async path => (path.includes('Open Forge') ? ['arm64'] : ['x86_64']),
    })).rejects.toThrow(/Electron runtime architecture.*x86_64/)
  })

  it('accepts packages when Electron runtime and Rust sidecar both include the target architecture', async () => {
    await expect(assertPackageArchitectureCompatibility({
      cargoBuildTarget: 'aarch64-apple-darwin',
      appExecutablePath: '/app/Contents/MacOS/Open Forge',
      sidecarPath: '/app/Contents/MacOS/openforge-sidecar',
      readExecutableArchitectures: async () => ['arm64', 'x86_64'],
    })).resolves.toEqual({ expectedArch: 'arm64', appArchitectures: ['arm64', 'x86_64'], sidecarArchitectures: ['arm64', 'x86_64'] })
  })

  it('builds and packages a configured Rust target sidecar from the layout Module crate root and artifacts', async () => {
    const commands = []
    const rustSidecarLayout = resolveRustSidecarLayout({
      repoRoot: '/repo',
      config: {
        backendCrateRoot: 'crates/openforge-backend',
        manifestPath: 'crates/openforge-backend/Cargo.toml',
        binaryName: 'openforge-backend',
        iconPath: 'assets/icon.icns',
        electronBundleRoot: 'target/electron/macos',
      },
    })

    await buildAndPackageElectronApp({
      repoRoot: '/repo',
      rustSidecarLayout,
      cargoBuildTarget: 'aarch64-apple-darwin',
      runCommand: async (command, args, options) => {
        commands.push({ command, args, cwd: options.cwd })
      },
      packageApp: async ({ repoRoot, sidecarBinaryPath, cargoBuildTarget }) => {
        commands.push({ command: 'packageElectronApp', args: [sidecarBinaryPath, cargoBuildTarget], cwd: repoRoot })
        return { appPath: `${repoRoot}/app`, sidecarPath: sidecarBinaryPath }
      },
    })

    expect(commands).toContainEqual({
      command: 'cargo',
      args: ['build', '--release', '--target', 'aarch64-apple-darwin'],
      cwd: '/repo/crates/openforge-backend',
    })
    expect(commands).toContainEqual({
      command: 'packageElectronApp',
      args: ['/repo/crates/openforge-backend/target/aarch64-apple-darwin/release/openforge-backend', 'aarch64-apple-darwin'],
      cwd: '/repo',
    })
  })

  it('retries Electron template hydration after transient install failures', async () => {
    const root = await import('node:os').then(os => os.tmpdir()).then(tmp => join(tmp, `openforge-electron-hydration-retry-${process.pid}-${Date.now()}`))
    const electronPackageRoot = join(root, 'node_modules/electron')
    const electronTemplatePath = join(electronPackageRoot, 'dist/Electron.app')
    const calls = []
    const delays = []
    await mkdir(electronPackageRoot, { recursive: true })
    await writeFile(join(electronPackageRoot, 'install.js'), '')

    const result = await hydrateElectronTemplate({
      electronPackageRoot,
      electronTemplatePath,
      maxAttempts: 3,
      retryDelayMs: 100,
      sleep: async delayMs => { delays.push(delayMs) },
      runCommand: async () => {
        calls.push('install')
        if (calls.length < 3) throw new Error(`transient failure ${calls.length}`)
        await mkdir(electronTemplatePath, { recursive: true })
      },
    })

    expect(result).toEqual({ hydrated: true })
    expect(calls).toEqual(['install', 'install', 'install'])
    expect(delays).toEqual([100, 200])
  })

  it('stops Electron template hydration after the configured attempt limit', async () => {
    const root = await import('node:os').then(os => os.tmpdir()).then(tmp => join(tmp, `openforge-electron-hydration-limit-${process.pid}-${Date.now()}`))
    const electronPackageRoot = join(root, 'node_modules/electron')
    const electronTemplatePath = join(electronPackageRoot, 'dist/Electron.app')
    const calls = []
    await mkdir(electronPackageRoot, { recursive: true })
    await writeFile(join(electronPackageRoot, 'install.js'), '')

    await expect(hydrateElectronTemplate({
      electronPackageRoot,
      electronTemplatePath,
      maxAttempts: 3,
      retryDelayMs: 100,
      sleep: async () => {},
      runCommand: async () => {
        calls.push('install')
        throw new Error(`install failure ${calls.length}`)
      },
    })).rejects.toThrow('install failure 3')

    expect(calls).toEqual(['install', 'install', 'install'])
  })

  it('hydrates the Electron app template when the installed electron package is missing its dist payload', async () => {
    const root = await import('node:os').then(os => os.tmpdir()).then(tmp => join(tmp, `openforge-electron-package-hydrate-template-${process.pid}-${Date.now()}`))
    const template = join(root, 'node_modules/electron/dist/Electron.app')
    const hydrateCalls = []
    await mkdir(root, { recursive: true })
    await writeFile(join(root, BACKEND_LAYOUT_CONFIG_FILE), JSON.stringify(currentLayoutConfig))
    await writeCurrentDataIdentityManifest(root)
    await writeElectronBuildOutputs(root)
    await writeElectronRuntimeDependencyArtifacts(root)
    await writeBuiltinPluginCatalog(root, [])
    await mkdir(join(root, 'src-tauri/target/release'), { recursive: true })
    await writeExecutable(join(root, 'src-tauri/target/release/openforge'), '#!/bin/sh\necho sidecar\n')

    await packageElectronApp({
      repoRoot: root,
      hydrateElectronTemplate: async ({ electronPackageRoot, electronTemplatePath }) => {
        hydrateCalls.push({ electronPackageRoot, electronTemplatePath })
        await mkdir(join(template, 'Contents/MacOS'), { recursive: true })
        await mkdir(join(template, 'Contents/Resources'), { recursive: true })
        await writeExecutable(join(template, 'Contents/MacOS/Electron'))
        await writeFile(join(template, 'Contents/Info.plist'), '<plist><dict><key>CFBundleExecutable</key><string>Electron</string><key>CFBundleName</key><string>Electron</string><key>CFBundleDisplayName</key><string>Electron</string></dict></plist>')
      },
    })

    expect(hydrateCalls).toEqual([{
      electronPackageRoot: join(root, 'node_modules/electron'),
      electronTemplatePath: template,
    }])
    await expect(stat(join(electronBundlePath(root), 'Contents/MacOS/Open Forge'))).resolves.toBeTruthy()
  })

  it('copies OpenForge CLI assets from the configured Backend Crate root', async () => {
    const root = await import('node:os').then(os => os.tmpdir()).then(tmp => join(tmp, `openforge-electron-package-cli-alt-backend-${process.pid}-${Date.now()}`))
    const template = join(root, 'node_modules/electron/dist/Electron.app')
    const alternateLayoutConfig = {
      backendCrateRoot: 'crates/openforge-backend',
      manifestPath: 'crates/openforge-backend/Cargo.toml',
      binaryName: 'openforge-backend',
      iconPath: 'crates/openforge-backend/icons/icon.icns',
      electronBundleRoot: 'target/electron/macos',
    }
    await mkdir(root, { recursive: true })
    await writeBackendLayoutConfig(root, alternateLayoutConfig)
    await writeCurrentDataIdentityManifest(root)
    await mkdir(join(template, 'Contents/MacOS'), { recursive: true })
    await mkdir(join(template, 'Contents/Resources'), { recursive: true })
    await writeExecutable(join(template, 'Contents/MacOS/Electron'))
    await writeFile(join(template, 'Contents/Info.plist'), '<plist><dict><key>CFBundleExecutable</key><string>Electron</string><key>CFBundleName</key><string>Electron</string><key>CFBundleDisplayName</key><string>Electron</string></dict></plist>')
    await writeElectronBuildOutputs(root)
    await writeElectronRuntimeDependencyArtifacts(root)
    await writeBuiltinPluginCatalog(root, [])
    await mkdir(join(root, 'crates/openforge-backend/target/release'), { recursive: true })
    await writeExecutable(join(root, 'crates/openforge-backend/target/release/openforge-backend'), '#!/bin/sh\necho sidecar\n')
    await mkdir(join(root, 'crates/openforge-backend/src/openforge-cli'), { recursive: true })
    await writeFile(join(root, 'crates/openforge-backend/src/openforge-cli/runtime-assets.json'), `${JSON.stringify({
      runtimeFiles: ['cli.js', 'configured-command.js'],
    })}\n`)
    await writeFile(join(root, 'crates/openforge-backend/src/openforge-cli/cli.js'), '#!/usr/bin/env node\nconsole.log("configured openforge cli")\n')
    await writeFile(
      join(root, 'crates/openforge-backend/src/openforge-cli/configured-command.js'),
      'configured command module\n',
    )
    await writeFile(join(root, 'crates/openforge-backend/src/openforge-cli/openforge-skill.md'), 'configured openforge skill docs\n')
    await writeFile(join(root, 'crates/openforge-backend/src/openforge-cli/openforge-plugin-dev-skill.md'), 'configured openforge plugin dev skill docs\n')

    await packageElectronApp({ repoRoot: root })

    const output = electronBundlePath(root)
    await expect(readFile(join(output, 'Contents/Resources/openforge-cli/cli.js'), 'utf8')).resolves.toContain('configured openforge cli')
    await expect(readFile(join(output, 'Contents/Resources/openforge-cli/configured-command.js'), 'utf8')).resolves.toContain('configured command module')
    await expect(readFile(join(output, 'Contents/Resources/openforge-cli/openforge-skill.md'), 'utf8')).resolves.toContain('configured openforge skill docs')
    await expect(readFile(join(output, 'Contents/Resources/openforge-cli/openforge-plugin-dev-skill.md'), 'utf8')).resolves.toContain('configured openforge plugin dev skill docs')
  })

  it('packages the compiled renderer, Electron main process, and Rust sidecar into a macOS .app bundle', async () => {
    const root = await import('node:os').then(os => os.tmpdir()).then(tmp => join(tmp, `openforge-electron-package-${process.pid}-${Date.now()}`))
    const template = join(root, 'node_modules/electron/dist/Electron.app')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, BACKEND_LAYOUT_CONFIG_FILE), JSON.stringify(currentLayoutConfig))
    await writeCurrentDataIdentityManifest(root)
    const output = electronBundlePath(root)

    await mkdir(join(template, 'Contents/MacOS'), { recursive: true })
    await mkdir(join(template, 'Contents/Resources'), { recursive: true })
    await mkdir(join(template, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources'), { recursive: true })
    await symlink('A', join(template, 'Contents/Frameworks/Electron Framework.framework/Versions/Current'))
    await symlink('Versions/Current/Resources', join(template, 'Contents/Frameworks/Electron Framework.framework/Resources'))
    await writeFile(join(template, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/icudtl.dat'), 'icu')
    await writeExecutable(join(template, 'Contents/MacOS/Electron'))
    await writeFile(join(template, 'Contents/Info.plist'), '<plist><dict><key>CFBundleExecutable</key><string>Electron</string><key>CFBundleName</key><string>Electron</string><key>CFBundleDisplayName</key><string>Electron</string></dict></plist>')
    await writeElectronBuildOutputs(root)
    await writeElectronRuntimeDependencyArtifacts(root)
    await mkdir(join(root, 'src-tauri/target/release'), { recursive: true })
    await writeExecutable(join(root, 'src-tauri/target/release/openforge'), '#!/bin/sh\necho sidecar\n')
    await mkdir(join(root, 'src-tauri/src/openforge-cli'), { recursive: true })
    const runtimeAssetManifest = JSON.parse(
      await readFile(new URL('../src-tauri/src/openforge-cli/runtime-assets.json', import.meta.url), 'utf8'),
    )
    await writeFile(
      join(root, 'src-tauri/src/openforge-cli/runtime-assets.json'),
      `${JSON.stringify(runtimeAssetManifest)}\n`,
    )
    for (const filename of runtimeAssetManifest.runtimeFiles) {
      await writeFile(
        join(root, 'src-tauri/src/openforge-cli', filename),
        filename === 'cli.js' ? '#!/usr/bin/env node\nconsole.log("openforge cli")\n' : `packaged ${filename}\n`,
      )
    }
    await writeFile(join(root, 'src-tauri/src/openforge-cli/openforge-skill.md'), 'openforge skill docs\n')
    await writeFile(join(root, 'src-tauri/src/openforge-cli/openforge-plugin-dev-skill.md'), 'openforge plugin dev skill docs\n')
    const builtInPluginCatalog = [
      { id: 'com.openforge.file-viewer', directoryName: 'file-viewer' },
      { id: 'com.openforge.github-sync', directoryName: 'github-sync' },
      { id: 'com.openforge.task-browser', directoryName: 'task-browser' },
      { id: 'com.openforge.task-schedules', directoryName: 'task-schedules' },
      { id: 'com.openforge.terminal', directoryName: 'terminal' },
      { id: 'com.openforge.catalog-only-test', directoryName: 'catalog-only-test' },
    ]
    await writeBuiltinPluginCatalog(root, builtInPluginCatalog)
    for (const plugin of builtInPluginCatalog) {
      await writeBuiltInPluginRuntimeArtifacts(root, plugin.directoryName, plugin.id)
    }

    await expect(readBuiltinPluginCatalog(root)).resolves.toEqual(builtInPluginCatalog)

    await packageElectronApp({ repoRoot: root })
    const packagedElectronMain = await import(pathToFileURL(
      join(output, 'Contents/Resources/app/dist-electron/main.js'),
    ).href)
    expect(packagedElectronMain.classifyTaskBrowserDevToolsShortcut).toBeTypeOf('function')
    await expect(stat(join(output, 'Contents/MacOS/Open Forge'))).resolves.toBeTruthy()
    await expect(stat(join(output, 'Contents/MacOS/openforge-sidecar'))).resolves.toBeTruthy()
    await expect(stat(join(output, 'Contents/Resources/app/dist/index.html'))).resolves.toBeTruthy()
    await expect(stat(join(output, 'Contents/Resources/app/dist-electron/main.js'))).resolves.toBeTruthy()
    for (const { directoryName } of builtInPluginCatalog) {
      const packagedPluginRoot = join(output, 'Contents/Resources/app/plugins', directoryName)
      await expect(readFile(join(packagedPluginRoot, 'package.json'), 'utf8').then(JSON.parse)).resolves.toMatchObject({
        openforge: { frontend: './dist/frontend.js' },
      })
      await expect(readFile(join(packagedPluginRoot, 'dist/frontend.js'), 'utf8')).resolves.toContain('packagedPlugin')
      await expect(readFile(join(packagedPluginRoot, 'dist/style.css'), 'utf8')).resolves.toContain('.plugin')
      await expect(stat(join(packagedPluginRoot, 'src/index.ts'))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(join(packagedPluginRoot, 'node_modules/left-pad/index.js'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
    await expect(readFile(join(output, 'Contents/MacOS/plugin-host/index.js'), 'utf8')).resolves.toContain('bundled backend plugin host')
    await expect(readFile(join(output, 'Contents/Resources/openforge-cli/cli.js'), 'utf8')).resolves.toContain('openforge cli')
    await expect(readFile(join(output, 'Contents/Resources/openforge-cli/plugin-commands.js'), 'utf8')).resolves.toContain('packaged plugin-commands.js')
    await expect(readFile(join(output, 'Contents/Resources/openforge-cli/openforge-skill.md'), 'utf8')).resolves.toContain('openforge skill docs')
    await expect(readFile(join(output, 'Contents/Resources/openforge-cli/openforge-plugin-dev-skill.md'), 'utf8')).resolves.toContain('openforge plugin dev skill docs')
    await expect(readlink(join(output, 'Contents/Frameworks/Electron Framework.framework/Versions/Current'))).resolves.toBe('A')
    await expect(readlink(join(output, 'Contents/Frameworks/Electron Framework.framework/Resources'))).resolves.toBe('Versions/Current/Resources')
    await expect(readFile(join(output, 'Contents/Resources/app/package.json'), 'utf8').then(JSON.parse)).resolves.toMatchObject({
      main: 'dist-electron/main.js',
      dependencies: {
        '@openforge-app/plugin-sdk': '0.2.5',
        'es-module-lexer': '2.1.0',
      },
    })
    await expect(readFile(join(output, 'Contents/Resources/app/node_modules/es-module-lexer/package.json'), 'utf8').then(JSON.parse)).resolves.toMatchObject({
      name: 'es-module-lexer',
      version: '2.1.0',
    })
    await expect(readFile(join(output, 'Contents/Resources/app/node_modules/es-module-lexer/dist/lexer.js'), 'utf8')).resolves.toContain('parse')
    await expect(readFile(join(output, 'Contents/Resources/app/node_modules/@openforge-app/plugin-sdk/package.json'), 'utf8').then(JSON.parse)).resolves.toMatchObject({
      name: '@openforge-app/plugin-sdk',
      exports: {
        './taskBrowserDevToolsShortcuts': './dist/taskBrowserDevToolsShortcuts.js',
      },
    })
    await expect(readFile(join(output, 'Contents/Resources/app/node_modules/@openforge-app/plugin-sdk/dist/taskBrowserDevToolsShortcuts.js'), 'utf8')).resolves.toContain('classifyTaskBrowserDevToolsShortcut')
    await expect(readFile(join(output, 'Contents/Info.plist'), 'utf8')).resolves.toContain('<key>CFBundleExecutable</key><string>Open Forge</string>')
    await expect(readFile(join(output, 'Contents/Info.plist'), 'utf8')).resolves.toMatch(/<key>CFBundleIdentifier<\/key>\s*<string>com\.openforge\.app\.electron<\/string>/)
    await expect(readFile(join(output, 'Contents/Info.plist'), 'utf8')).resolves.toMatch(/<key>ApplePressAndHoldEnabled<\/key>\s*<false\/>/)
  })
})
