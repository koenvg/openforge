#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'
import { OPENFORGE_DATA_IDENTITY } from './data-identity.mjs'

const execute = promisify(execFile)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function coldInstallUsage() {
  return 'Usage: pnpm electron:install [--skip-build | --inspect | --recover]\nCold installation is the default; --cold remains an alias.\nOptions: --app PATH --install-dir PATH --profile PATH --daemon-root PATH\nRequires explicit native local build approval and refuses running OpenForge processes.\nLive updates remain disabled. Cold installation does not preserve sessions.'
}

function parse(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (['--skip-build', '--inspect', '--recover', '--help'].includes(flag)) options[flag] = true
    else if (['--app', '--install-dir', '--profile', '--daemon-root'].includes(flag)) {
      const value = argv[++index]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
      options[flag] = resolve(value)
    } else throw new Error(`Unknown cold-install option: ${flag}`)
  }
  if (options['--recover'] && (options['--inspect'] || options['--app'] || options['--skip-build'])) {
    throw new Error('Cold recovery cannot select a different build')
  }
  return options
}

async function run(command, args) {
  const child = spawn(command, args, { cwd: repoRoot, stdio: 'inherit' })
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (status, signal) => status === 0 ? resolve() : reject(new Error(`${command} failed with ${signal ?? status}`)))
  })
}

async function main(argv) {
  const options = parse(argv)
  if (options['--help']) { console.log(coldInstallUsage()); return }
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Cold installation supports macOS arm64 only')
  const support = join(homedir(), 'Library/Application Support')
  const profileOverride = process.env.OPENFORGE_ELECTRON_USER_DATA_DIR
  const profile = options['--profile'] ?? (profileOverride?.trim() ? resolve(profileOverride) : join(support, OPENFORGE_DATA_IDENTITY.packageIdentity.electronAppPackageName))
  const appData = process.env.OPENFORGE_APP_DATA_DIR || join(support, OPENFORGE_DATA_IDENTITY.dataIdentity.appDataIdentifier)
  const dataRoot = options['--daemon-root'] ?? process.env.OPENFORGE_SESSION_DAEMON_ROOT ?? join(appData, 'session-daemon')
  const destination = join(options['--install-dir'] ?? '/Applications', `${OPENFORGE_DATA_IDENTITY.packageIdentity.appName}.app`)
  let source = options['--app'] ?? resolveRustSidecarLayout({ repoRoot }).electronAppPath
  let helper
  if (options['--recover']) {
    const { coldRecoveryHelper } = await import('./cold-install/recovery.mjs')
    helper = await coldRecoveryHelper(profile, destination)
  } else {
    if (!options['--inspect'] && !options['--skip-build'] && !options['--app']) {
      const { buildAndPackageElectronApp } = await import('./electron-package/build-orchestration.mjs')
      source = (await buildAndPackageElectronApp({ repoRoot })).appPath
    }
    // The installer is trusted local tooling built from this checkout, not code
    // selected from an as-yet-unapproved target application.
    const layout = resolveRustSidecarLayout({ repoRoot })
    helper = join(layout.electronAppPath, 'Contents/MacOS/openforge-update-helper')
  }
  await execute('/usr/bin/codesign', ['--verify', '--strict', helper], { timeout: 30_000, env: { PATH: '/usr/bin:/bin' } })
  if (options['--inspect']) {
    await run(helper, ['--cold-inspect', source, destination])
    return
  }
  if (options['--recover']) await run(helper, ['--cold-recover', destination, profile])
  else await run(helper, ['--cold-install', source, destination, profile, dataRoot])
  // Refresh from the installed, verified payload only after native publication has
  // committed. A failure is reported and --recover can retry this step.
  await run('/bin/sh', ['-eu', '-c', '. "$1"; install_openforge_cli "$2" error', 'openforge-cold-cli', join(repoRoot, 'scripts/openforge-cli-install.sh'), destination])
  console.log(`Installed cold build at ${destination}. Launch normally with: open ${JSON.stringify(destination)}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
}
