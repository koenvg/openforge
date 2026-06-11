import { spawn } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function runShell(scriptPath) {
  return runScript('sh', [scriptPath])
}

function runScript(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('close', status => resolve({ status, stdout, stderr }))
  })
}

function helperSource() {
  return `. ${shellQuote(join(import.meta.dirname, 'openforge-cli-install.sh'))}`
}

async function installScriptWithoutMain() {
  const installScript = await readFile(join(import.meta.dirname, 'install.sh'), 'utf8')
  return installScript.replace(/\nmain "\$@"\s*$/, '\n')
}

function embeddedHelperSnippet(installScript) {
  const match = installScript.match(/# BEGIN embedded OpenForge CLI install helpers \(generated from scripts\/openforge-cli-install\.sh\)\n([\s\S]*?)\n# END embedded OpenForge CLI install helpers/)
  if (!match) throw new Error('Embedded OpenForge CLI helper snippet not found')
  return match[1]
}

async function writeRunner(root, body, prelude = helperSource()) {
  const runner = join(root, 'run-install-helper.sh')
  await writeFile(runner, `#!/bin/sh
set -eu
${prelude}
${body}
`)
  return runner
}

async function writeExecutable(path, content) {
  await writeFile(path, content)
  await chmod(path, 0o755)
}

describe('macOS installer CLI helpers', () => {
  it('keeps Electron installer stale sidecar cleanup on the structured failure reporting seam', async () => {
    const installScript = await readFile(join(import.meta.dirname, 'install-electron-mac.sh'), 'utf8')

    expect(installScript).toContain('report_failure')
    expect(installScript).toContain('install:stale-sidecar-cleanup')
    expect(installScript).toContain('Decision: ${decision}')
  })

  it('keeps the release installer embedded helper in sync with the shared helper', async () => {
    const [installScript, sharedHelper] = await Promise.all([
      readFile(join(import.meta.dirname, 'install.sh'), 'utf8'),
      readFile(join(import.meta.dirname, 'openforge-cli-install.sh'), 'utf8')
    ])

    expect(embeddedHelperSnippet(installScript)).toBe(sharedHelper.trimEnd())
  })

  it('waits for a stale sidecar to stop before replacing a closed Electron app', async () => {
    const root = await mkdtemp(join(tmpdir(), `openforge-electron-install-sidecar-${process.pid}-`))
    const home = join(root, 'home')
    const installDir = join(root, 'Applications')
    const builtAppPath = join(root, 'build', 'Open Forge.app')
    const payloadDir = join(builtAppPath, 'Contents/Resources/openforge-cli')
    const binDir = join(root, 'bin')
    const logPath = join(root, 'commands.log')
    const sidecarProbeCountPath = join(root, 'sidecar-probes')
    const copyProbeCountPath = join(root, 'copy-sidecar-probes')

    await mkdir(payloadDir, { recursive: true })
    await mkdir(binDir, { recursive: true })
    await mkdir(home, { recursive: true })
    await writeFile(join(payloadDir, 'cli.js'), 'console.log("openforge cli")\n')

    await writeExecutable(join(binDir, 'pnpm'), `#!/bin/sh
echo "pnpm $*" >> ${shellQuote(logPath)}
exit 0
`)
    await writeExecutable(join(binDir, 'node'), `#!/bin/sh
echo "node $*" >> ${shellQuote(logPath)}
if [ "$1" = "scripts/rust-sidecar-layout.mjs" ]; then
  echo ${shellQuote(builtAppPath)}
fi
exit 0
`)
    await writeExecutable(join(binDir, 'pgrep'), `#!/bin/sh
echo "pgrep $*" >> ${shellQuote(logPath)}
if [ "$1" = "-xq" ]; then
  exit 1
fi
if [ "$1" = "-fq" ]; then
  count=0
  if [ -f ${shellQuote(sidecarProbeCountPath)} ]; then count=$(cat ${shellQuote(sidecarProbeCountPath)}); fi
  count=$((count + 1))
  printf '%s\n' "$count" > ${shellQuote(sidecarProbeCountPath)}
  if [ "$count" -lt 3 ]; then exit 0; fi
fi
exit 1
`)
    await writeExecutable(join(binDir, 'pkill'), `#!/bin/sh
echo "pkill $*" >> ${shellQuote(logPath)}
exit 0
`)
    await writeExecutable(join(binDir, 'sleep'), `#!/bin/sh
echo "sleep $*" >> ${shellQuote(logPath)}
exit 0
`)
    await writeExecutable(join(binDir, 'xattr'), `#!/bin/sh
echo "xattr $*" >> ${shellQuote(logPath)}
exit 0
`)
    await writeExecutable(join(binDir, 'open'), `#!/bin/sh
echo "open $*" >> ${shellQuote(logPath)}
exit 0
`)
    await writeExecutable(join(binDir, 'cp'), `#!/bin/sh
echo "cp $*" >> ${shellQuote(logPath)}
cat ${shellQuote(sidecarProbeCountPath)} > ${shellQuote(copyProbeCountPath)}
exec /bin/cp "$@"
`)

    const result = await runScript('bash', [join(import.meta.dirname, 'install-electron-mac.sh')], {
      env: {
        ...process.env,
        HOME: home,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        OPENFORGE_ELECTRON_INSTALL_DIR: installDir,
      }
    })

    const log = await readFile(logPath, 'utf8')
    expect(result.status).toBe(0)
    expect(log).toContain('pnpm electron:package')
    expect(log).toContain('pkill -f Open Forge.app/Contents/MacOS/openforge-sidecar')
    expect(log).toContain(`cp -R ${builtAppPath} ${installDir}/`)
    expect(log).not.toContain('open ')
    await expect(readFile(copyProbeCountPath, 'utf8').then(Number)).resolves.toBeGreaterThanOrEqual(3)
    await expect(readFile(join(installDir, 'Open Forge.app', 'Contents/Resources/openforge-cli/cli.js'), 'utf8')).resolves.toBe('console.log("openforge cli")\n')
  })

  it('keeps release install CLI setup self-contained when no sibling helper file is available', async () => {
    const root = await mkdtemp(join(tmpdir(), `openforge-install-standalone-${process.pid}-`))
    const home = join(root, 'home')
    const appPath = join(root, 'Applications', 'Open Forge.app')
    await mkdir(appPath, { recursive: true })

    const runner = await writeRunner(root, `
HOME=${shellQuote(home)}
install_openforge_cli ${shellQuote(appPath)} warn
`, await installScriptWithoutMain())

    const result = await runShell(runner)

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('WARNING: OpenForge CLI payload not found')
    await expect(readFile(join(home, '.openforge/bin/openforge'), 'utf8')).resolves.toContain('Application Support/openforge/cli/cli.js')
  })

  it('copies the bundled CLI payload into Application Support before writing the launcher', async () => {
    const root = await mkdtemp(join(tmpdir(), `openforge-install-cli-${process.pid}-`))
    const home = join(root, 'home with spaces')
    const appPath = join(root, 'Applications', 'Open Forge.app')
    const payloadDir = join(appPath, 'Contents/Resources/openforge-cli')
    const binDir = join(root, 'bin')
    await mkdir(payloadDir, { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(payloadDir, 'cli.js'), 'console.log("openforge cli")\n')
    await writeFile(join(payloadDir, 'package.json'), '{"type":"module"}\n')
    await writeFile(join(binDir, 'cp'), `#!/bin/sh
if [ -e "${home}/.openforge/bin/openforge" ]; then
  echo "launcher existed before payload copy" >&2
  exit 42
fi
exec /bin/cp "$@"
`)
    await chmod(join(binDir, 'cp'), 0o755)

    const runner = await writeRunner(root, `
HOME=${shellQuote(home)}
PATH=${shellQuote(`${binDir}:${process.env.PATH ?? ''}`)}
install_openforge_cli ${shellQuote(appPath)} error
`)

    const result = await runShell(runner)

    expect(result.status).toBe(0)
    const copiedCli = join(home, 'Library/Application Support/openforge/cli/cli.js')
    await expect(readFile(copiedCli, 'utf8')).resolves.toBe('console.log("openforge cli")\n')
    await expect(readFile(join(home, 'Library/Application Support/openforge/cli/package.json'), 'utf8')).resolves.toBe('{"type":"module"}\n')
    await expect(readFile(join(home, '.openforge/bin/openforge'), 'utf8')).resolves.toContain(copiedCli)
  })

  it('reports an actionable error when the CLI launcher directory is not writable', async () => {
    const root = await mkdtemp(join(tmpdir(), `openforge-install-cli-permission-${process.pid}-`))
    const home = join(root, 'home')
    const appPath = join(root, 'Applications', 'Open Forge.app')
    const payloadDir = join(appPath, 'Contents/Resources/openforge-cli')
    const launcherDir = join(home, '.openforge/bin')
    await mkdir(payloadDir, { recursive: true })
    await mkdir(launcherDir, { recursive: true })
    await writeFile(join(payloadDir, 'cli.js'), 'console.log("openforge cli")\n')
    await writeFile(join(launcherDir, 'openforge'), '#!/bin/sh\necho stale launcher\n')
    await chmod(join(launcherDir, 'openforge'), 0o555)
    await chmod(launcherDir, 0o555)

    const runner = await writeRunner(root, `
HOME=${shellQuote(home)}
install_openforge_cli ${shellQuote(appPath)} error
`)

    const result = await runShell(runner)
    await chmod(launcherDir, 0o755)
    await chmod(join(launcherDir, 'openforge'), 0o755)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('ERROR: OpenForge CLI launcher directory is not writable')
    expect(result.stderr).toContain('sudo chown -R')
    expect(result.stderr).not.toMatch(/line \d+.*Permission denied/)
  })

  it('propagates payload copy failures without writing the launcher', async () => {
    const root = await mkdtemp(join(tmpdir(), `openforge-install-cli-copy-failure-${process.pid}-`))
    const home = join(root, 'home')
    const appPath = join(root, 'Applications', 'Open Forge.app')
    const payloadDir = join(appPath, 'Contents/Resources/openforge-cli')
    const binDir = join(root, 'bin')
    await mkdir(payloadDir, { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(payloadDir, 'cli.js'), 'console.log("openforge cli")\n')
    await writeFile(join(binDir, 'cp'), `#!/bin/sh
echo "simulated payload copy failure" >&2
exit 42
`)
    await chmod(join(binDir, 'cp'), 0o755)

    const runner = await writeRunner(root, `
HOME=${shellQuote(home)}
PATH=${shellQuote(`${binDir}:${process.env.PATH ?? ''}`)}
install_openforge_cli ${shellQuote(appPath)} error
`)

    const result = await runShell(runner)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('simulated payload copy failure')
    await expect(readFile(join(home, '.openforge/bin/openforge'), 'utf8')).rejects.toThrow()
  })

  it('does not write the launcher when strict payload installation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), `openforge-install-cli-strict-${process.pid}-`))
    const home = join(root, 'home')
    const appPath = join(root, 'Applications', 'Open Forge.app')
    await mkdir(appPath, { recursive: true })

    const runner = await writeRunner(root, `
HOME=${shellQuote(home)}
install_openforge_cli ${shellQuote(appPath)} error
`)

    const result = await runShell(runner)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('ERROR: OpenForge CLI payload not found')
    await expect(readFile(join(home, '.openforge/bin/openforge'), 'utf8')).rejects.toThrow()
  })

  it('continues legacy release app installs when the bundled CLI payload is absent', async () => {
    const root = await mkdtemp(join(tmpdir(), `openforge-install-legacy-${process.pid}-`))
    const home = join(root, 'home')
    const appPath = join(root, 'Applications', 'Open Forge.app')
    await mkdir(appPath, { recursive: true })

    const runner = await writeRunner(root, `
HOME=${shellQuote(home)}
install_openforge_cli ${shellQuote(appPath)} warn
`)

    const result = await runShell(runner)

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('WARNING: OpenForge CLI payload not found')
    await expect(readFile(join(home, '.openforge/bin/openforge'), 'utf8')).resolves.toContain('Application Support/openforge/cli/cli.js')
  })
})
