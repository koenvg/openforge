import { execFile } from 'node:child_process'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const FIXTURE_COMMIT_DATE = '2024-01-01T00:00:00Z'
const REQUIRED_MANIFEST_STRINGS = [
  'projectId',
  'taskId',
  'repoPath',
  'projectName',
  'taskTitle',
  'workspacePath',
  'appDataDir',
  'databasePath',
]

const README = `# OpenForge desktop test repository

This disposable repository is created for full-app desktop and terminal tests.
`

const TERMINAL_OUTPUT_GENERATOR = `#!/usr/bin/env node
const bytesArgument = process.argv.find(argument => argument.startsWith('--bytes='))
const markerArgument = process.argv.find(argument => argument.startsWith('--marker='))
const bytes = Number(bytesArgument?.slice('--bytes='.length))
const marker = markerArgument?.slice('--marker='.length)
if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 64 * 1024 * 1024) {
  console.error('--bytes must be an integer between 0 and 67108864')
  process.exit(2)
}
if (!marker) {
  console.error('--marker is required')
  process.exit(2)
}
process.stdout.write('x'.repeat(bytes))
process.stdout.write(\`\\n\${marker}\\n\`)
`

export async function runDesktopTestCommand(command, args, options = {}) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    windowsHide: true,
  })
}

async function resolveGitRepository(repoPath, runCommand) {
  let resolvedPath
  try {
    resolvedPath = await realpath(repoPath)
    if (!(await stat(resolvedPath)).isDirectory()) throw new Error('path is not a directory')
  } catch (error) {
    throw new Error(`The supplied path ${repoPath} is not a usable Git repository: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    const result = await runCommand('git', ['rev-parse', '--show-toplevel'], { cwd: resolvedPath })
    return realpath(result.stdout.trim())
  } catch (error) {
    throw new Error(`The supplied path ${repoPath} is not a usable Git repository: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function createGeneratedRepository(runRoot, runCommand) {
  const repoPath = join(runRoot, 'repository')
  await mkdir(repoPath, { recursive: true })
  await writeFile(join(repoPath, 'README.md'), README)
  await writeFile(join(repoPath, 'terminal-output.mjs'), TERMINAL_OUTPUT_GENERATOR, { mode: 0o755 })

  await runCommand('git', ['init', '--initial-branch=main'], { cwd: repoPath })
  await runCommand('git', ['config', 'user.email', 'desktop-test@openforge.local'], { cwd: repoPath })
  await runCommand('git', ['config', 'user.name', 'OpenForge Desktop Test'], { cwd: repoPath })
  await runCommand('git', ['add', 'README.md', 'terminal-output.mjs'], { cwd: repoPath })
  await runCommand('git', ['commit', '-m', 'Create desktop test fixture'], {
    cwd: repoPath,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: FIXTURE_COMMIT_DATE,
      GIT_COMMITTER_DATE: FIXTURE_COMMIT_DATE,
    },
  })

  return realpath(repoPath)
}

export async function createFixtureRepository({
  runRoot,
  repoPath = null,
  runCommand = runDesktopTestCommand,
} = {}) {
  if (!runRoot) throw new Error('runRoot is required')
  await mkdir(runRoot, { recursive: true })
  if (repoPath) {
    const resolvedRepoPath = await resolveGitRepository(repoPath, runCommand)
    const outputGeneratorPath = join(runRoot, 'terminal-output.mjs')
    await writeFile(outputGeneratorPath, TERMINAL_OUTPUT_GENERATOR, { mode: 0o755 })
    return {
      generated: false,
      repoPath: resolvedRepoPath,
      outputGeneratorPath,
    }
  }
  const generatedRepoPath = await createGeneratedRepository(runRoot, runCommand)
  return {
    generated: true,
    repoPath: generatedRepoPath,
    outputGeneratorPath: join(generatedRepoPath, 'terminal-output.mjs'),
  }
}

export function parseFixtureManifest(text) {
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`Invalid desktop test fixture manifest JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid desktop test fixture manifest: expected an object')
  }
  if (value.schemaVersion !== 1) {
    throw new Error(`Invalid desktop test fixture manifest schemaVersion: ${String(value.schemaVersion)}`)
  }
  for (const field of REQUIRED_MANIFEST_STRINGS) {
    if (typeof value[field] !== 'string' || value[field].trim() === '') {
      throw new Error(`Invalid desktop test fixture manifest ${field}: expected a non-empty string`)
    }
  }
  return value
}

export async function seedFixtureAppData({
  sidecarPath,
  appDataDir,
  repoPath,
  manifestPath,
  runCommand = runDesktopTestCommand,
} = {}) {
  if (!sidecarPath) throw new Error('sidecarPath is required')
  await runCommand(sidecarPath, [
    'desktop-test-fixture',
    '--app-data-dir', appDataDir,
    '--repo-path', repoPath,
    '--manifest', manifestPath,
  ])
  return parseFixtureManifest(await readFile(manifestPath, 'utf8'))
}

export async function prepareDesktopTestFixture({
  runRoot,
  repoPath = null,
  sidecarPath,
  runCommand = runDesktopTestCommand,
} = {}) {
  if (!runRoot) throw new Error('runRoot is required')
  const repository = await createFixtureRepository({ runRoot, repoPath, runCommand })
  const appDataDir = join(runRoot, 'app-data')
  const manifestPath = join(runRoot, 'fixture.json')
  const manifest = await seedFixtureAppData({
    sidecarPath,
    appDataDir,
    repoPath: repository.repoPath,
    manifestPath,
    runCommand,
  })
  return {
    appDataDir,
    manifestPath,
    repository,
    manifest,
  }
}
