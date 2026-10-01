// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { packageElectronApp } from './electron-package/package-assembly.mjs'
import { sealLocalApplication } from './electron-package/local-integrity.mjs'
import { resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'

const roots = []
const enabled = process.platform === 'darwin' && process.env.RUN_ELECTRON_PACKAGE_CONTRACT === '1'
const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex')

describe.skipIf(!enabled)('local packaged application integrity', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })

  it.each(['signed', 'unsigned', 'invalid'])('prepares %s native executables before retention without mutating inputs or repairing invalid signatures', async state => {
    const root = await mkdtemp(join(tmpdir(), 'openforge-package-integrity-'))
    roots.push(root)
    const outputAppPath = join(root, 'Open Forge.app')
    const layout = resolveRustSidecarLayout({ repoRoot: process.cwd() })
    const sidecar = layout.releaseSidecarBinaryPath({ cargoBuildTarget: process.env.CARGO_BUILD_TARGET ?? '' })
    const sources = {
      sidecarBinaryPath: sidecar,
      sessionDaemonBinaryPath: join(dirname(sidecar), 'openforge-session-daemon'),
      updateHelperBinaryPath: join(dirname(sidecar), 'openforge-update-helper'),
    }
    const options = { outputAppPath }
    const codesign = args => execFileSync('/usr/bin/codesign', args, {
      env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: root }, timeout: 30_000, stdio: 'pipe',
    })
    await mkdir(join(root, 'inputs'))
    for (const [option, source] of Object.entries(sources)) {
      const input = join(root, 'inputs', option)
      await cp(source, input)
      codesign(['--force', '--sign', '-', '--timestamp=none', input])
      if (state === 'unsigned') {
        codesign(['--remove-signature', input])
        expect(() => codesign(['--verify', '--strict', input])).toThrow()
      }
      if (state === 'invalid' && option === 'updateHelperBinaryPath') {
        const bytes = await readFile(input)
        // Change a signed code page without changing the Mach-O architecture header.
        bytes[4096] ^= 1
        await writeFile(input, bytes)
        expect(() => codesign(['--verify', '--strict', input])).toThrow()
      }
      options[option] = input
    }
    const original = await digest(options.sessionDaemonBinaryPath)
    if (state === 'invalid') {
      const helperBefore = await digest(options.updateHelperBinaryPath)
      await expect(packageElectronApp(options)).rejects.toThrow(/invalid signature/)
      expect(await digest(join(outputAppPath, 'Contents/MacOS/openforge-update-helper'))).toBe(helperBefore)
      return
    }
    await packageElectronApp(options)
    expect(await digest(options.sessionDaemonBinaryPath)).toBe(original)
    const retained = join(outputAppPath, 'Contents/Resources/session-runtime')
    const manifest = JSON.parse(await readFile(join(retained, 'manifest.json'), 'utf8'))
    const daemonHash = await digest(join(outputAppPath, 'Contents/MacOS/openforge-session-daemon'))
    if (state === 'signed') expect(daemonHash).toBe(original)
    expect(await digest(join(retained, 'openforge-session-daemon'))).toBe(daemonHash)
    expect(manifest.files.find(file => file.path === 'openforge-session-daemon').sha256).toBe(daemonHash)
    codesign(['--verify', '--strict', join(retained, 'openforge-session-daemon')])
    codesign(['--verify', '--deep', '--strict', outputAppPath])
  }, 120_000)

  it('seals an unsigned Electron crashpad helper before its framework without changing retained daemon bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openforge-package-integrity-'))
    roots.push(root)
    const outputAppPath = join(root, 'Open Forge.app')
    const codesign = args => execFileSync('/usr/bin/codesign', args, {
      env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: root }, timeout: 30_000, stdio: 'pipe',
    })
    await packageElectronApp({
      outputAppPath,
      sealApplication: async appPath => {
        const helper = join(appPath, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler')
        // Model the unsigned helper shipped in the x64 Electron template on either host architecture.
        codesign(['--force', '--sign', '-', '--timestamp=none', helper])
        codesign(['--remove-signature', helper])
        expect(() => codesign(['--verify', '--strict', helper])).toThrow()
        const daemon = join(appPath, 'Contents/Resources/session-runtime/openforge-session-daemon')
        const before = await digest(daemon)
        await sealLocalApplication(appPath)
        expect(await digest(daemon)).toBe(before)
        codesign(['--verify', '--strict', helper])
      },
    })
    codesign(['--verify', '--deep', '--strict', outputAppPath])
  }, 120_000)

  it('seals the complete app after assembly without changing retained daemon bytes, and refuses resource tampering', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openforge-package-integrity-'))
    roots.push(root)
    const outputAppPath = join(root, 'Open Forge.app')
    // Requires built artifacts, but neither installs nor launches this private app.
    await packageElectronApp({ outputAppPath })
    const verify = path => execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', path], {
      env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: root }, timeout: 30_000, stdio: 'pipe',
    })
    expect(() => verify(outputAppPath)).not.toThrow()
    expect(() => verify(join(outputAppPath, 'Contents/MacOS/Open Forge'))).not.toThrow()
    const runtime = join(outputAppPath, 'Contents/Resources/session-runtime')
    const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'))
    const daemonHash = await digest(join(outputAppPath, 'Contents/MacOS/openforge-session-daemon'))
    expect(await digest(join(runtime, 'openforge-session-daemon'))).toBe(daemonHash)
    expect(manifest.files.find(file => file.path === 'openforge-session-daemon').sha256).toBe(daemonHash)
    await writeFile(join(outputAppPath, 'Contents/Resources/app/dist-electron/main.js'), 'tampered')
    expect(() => verify(outputAppPath)).toThrow()
  }, 120_000)
})
