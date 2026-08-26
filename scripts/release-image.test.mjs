import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RELEASE_IMAGE_VOLUME_NAME,
  createReleaseDmg,
  normalizeReleaseVersion,
  releaseDmgArgs,
  releaseImageArchForTarget,
  releaseImageFilename,
} from './release-image.mjs'

describe('Electron release image artifacts', () => {
  it('names DMG images exactly like the public install script downloads them', () => {
    expect(releaseImageFilename('1.2.3', 'aarch64-apple-darwin')).toBe('Open.Forge_1.2.3_aarch64.dmg')
    expect(releaseImageFilename('v1.2.3', 'x86_64-apple-darwin')).toBe('Open.Forge_1.2.3_x64.dmg')
  })

  it('requires a release version when naming DMG images', () => {
    expect(normalizeReleaseVersion('v1.2.3')).toBe('1.2.3')
    expect(() => normalizeReleaseVersion('')).toThrow(/version is required/)
    expect(() => normalizeReleaseVersion(undefined)).toThrow(/version is required/)
  })

  it('maps GitHub release matrix targets to installer architecture names', () => {
    expect(releaseImageArchForTarget('aarch64-apple-darwin')).toBe('aarch64')
    expect(releaseImageArchForTarget('x86_64-apple-darwin')).toBe('x64')
    expect(() => releaseImageArchForTarget('unknown-target')).toThrow(/Unsupported release image target/)
  })

  it('generates the hdiutil command with the volume name mounted by install.sh', () => {
    expect(releaseDmgArgs({
      sourceFolder: '/tmp/openforge-dmg-stage',
      outputPath: '/repo/Open.Forge_1.2.3_aarch64.dmg',
    })).toEqual([
      'create',
      '-volname', RELEASE_IMAGE_VOLUME_NAME,
      '-srcfolder', '/tmp/openforge-dmg-stage',
      '-ov',
      '-format', 'UDZO',
      '/repo/Open.Forge_1.2.3_aarch64.dmg',
    ])
  })

  it('stages the .app bundle before creating a compressed DMG image', async () => {
    const commands = []
    const removed = []

    const outputPath = await createReleaseDmg({
      appPath: '/build/Open Forge.app',
      version: '1.2.3',
      target: 'aarch64-apple-darwin',
      outputDir: '/repo',
      createTempDir: async () => '/tmp/openforge-dmg-stage',
      removeDir: async path => { removed.push(path) },
      run: async (command, args) => { commands.push({ command, args }) },
    })

    expect(outputPath).toBe('/repo/Open.Forge_1.2.3_aarch64.dmg')
    expect(commands).toEqual([
      { command: 'ditto', args: ['/build/Open Forge.app', '/tmp/openforge-dmg-stage/Open Forge.app'] },
      {
        command: 'hdiutil',
        args: ['create', '-volname', 'Open Forge', '-srcfolder', '/tmp/openforge-dmg-stage', '-ov', '-format', 'UDZO', '/repo/Open.Forge_1.2.3_aarch64.dmg'],
      },
    ])
    expect(removed).toEqual(['/tmp/openforge-dmg-stage'])
  })

  it('keeps the GitHub release workflow publishing DMG images instead of app zip archives', async () => {
    const workflow = await readFile(join(import.meta.dirname, '..', '.github/workflows/release.yml'), 'utf8')

    expect(workflow).toContain('node scripts/release-image.mjs create')
    expect(workflow).toContain('steps.release-image.outputs.dmg-path')
    expect(workflow).toContain('steps.release-image.outputs.dmg-name')
    expect(workflow).not.toContain('openforge-${{ matrix.target }}.zip')
  })

  it('prepares pinned Ghostty dependencies before packaging release DMGs', async () => {
    const workflow = await readFile(join(import.meta.dirname, '..', '.github/workflows/release.yml'), 'utf8')
    const zigStep = workflow.indexOf('- name: Install Zig 0.16')
    const ghosttyStep = workflow.indexOf('- name: Prepare pinned Ghostty dependencies')
    const ghosttyEnvExport = workflow.indexOf('grep \'^GHOSTTY_\' /tmp/ghostty-prepare.log >> "$GITHUB_ENV"')
    const offlineCargoExport = workflow.indexOf('echo \'CARGO_NET_OFFLINE=true\' >> "$GITHUB_ENV"')
    const packageStep = workflow.indexOf('- name: Package Electron app')

    expect(zigStep).toBeGreaterThan(-1)
    expect(workflow).toContain('uses: mlugg/setup-zig@v2')
    expect(workflow).toContain('version: 0.16.0')
    expect(ghosttyStep).toBeGreaterThan(zigStep)
    expect(workflow).toContain('node scripts/prepare-ghostty-vt.mjs')
    expect(ghosttyEnvExport).toBeGreaterThan(ghosttyStep)
    expect(offlineCargoExport).toBeGreaterThan(ghosttyEnvExport)
    expect(packageStep).toBeGreaterThan(offlineCargoExport)
  })
})
