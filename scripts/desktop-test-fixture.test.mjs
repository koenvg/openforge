import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createFixtureRepository,
  parseFixtureManifest,
  prepareDesktopTestFixture,
} from './desktop-test/fixture.mjs'

const execFileAsync = promisify(execFile)
const temporaryDirectories = []

async function temporaryDirectory(name) {
  const directory = await mkdtemp(join(tmpdir(), `${name}-`))
  temporaryDirectories.push(directory)
  return directory
}

async function git(cwd, ...args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' })
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('desktop test fixture setup', () => {
  it('creates a deterministic committed repository with a terminal output generator', async () => {
    const runRoot = await temporaryDirectory('openforge-desktop-fixture')

    const fixture = await createFixtureRepository({ runRoot })

    expect(fixture.generated).toBe(true)
    expect(fixture.repoPath).toBe(await realpath(join(runRoot, 'repository')))
    expect((await git(fixture.repoPath, 'status', '--porcelain')).stdout).toBe('')
    expect((await git(fixture.repoPath, 'rev-list', '--count', 'HEAD')).stdout.trim()).toBe('1')
    expect((await git(fixture.repoPath, 'ls-files')).stdout.trim().split('\n')).toEqual([
      'README.md',
      'terminal-output.mjs',
    ])
    expect(await readFile(join(fixture.repoPath, 'README.md'), 'utf8')).toContain('OpenForge desktop test repository')

    const output = await execFileAsync(process.execPath, [
      join(fixture.repoPath, 'terminal-output.mjs'),
      '--bytes=32',
      '--marker=fixture-complete',
    ], { encoding: 'utf8' })
    expect(output.stdout).toBe(`${'x'.repeat(32)}\nfixture-complete\n`)
  })

  it('uses a supplied Git repository without modifying it', async () => {
    const runRoot = await temporaryDirectory('openforge-desktop-supplied')
    const repoPath = join(runRoot, 'supplied')
    await mkdir(repoPath)
    await git(repoPath, 'init', '--initial-branch=main')
    await git(repoPath, 'config', 'user.email', 'desktop-test@openforge.local')
    await git(repoPath, 'config', 'user.name', 'OpenForge Desktop Test')
    await writeFile(join(repoPath, 'existing.txt'), 'existing\n')
    await git(repoPath, 'add', 'existing.txt')
    await git(repoPath, 'commit', '-m', 'Existing fixture')
    const statusBefore = (await git(repoPath, 'status', '--porcelain')).stdout

    const fixture = await createFixtureRepository({ runRoot, repoPath })

    expect(fixture).toEqual({
      generated: false,
      repoPath: await realpath(repoPath),
      outputGeneratorPath: join(runRoot, 'terminal-output.mjs'),
    })
    expect((await git(repoPath, 'status', '--porcelain')).stdout).toBe(statusBefore)
  })

  it('rejects missing paths and directories that are not Git repositories', async () => {
    const runRoot = await temporaryDirectory('openforge-desktop-invalid')
    const plainDirectory = join(runRoot, 'plain')
    await mkdir(plainDirectory)

    await expect(createFixtureRepository({ runRoot, repoPath: join(runRoot, 'missing') }))
      .rejects.toThrow(/missing.*Git repository/i)
    await expect(createFixtureRepository({ runRoot, repoPath: plainDirectory }))
      .rejects.toThrow(/plain.*Git repository/i)
  })

  it('validates fixture manifests before returning them to the launcher', () => {
    const valid = {
      schemaVersion: 1,
      projectId: 'P-1',
      taskId: 'T-1',
      projectName: 'Desktop Test Project',
      taskTitle: 'Terminal performance fixture',
      repoPath: '/tmp/repo',
      workspacePath: '/tmp/repo',
      appDataDir: '/tmp/app-data',
      databasePath: '/tmp/app-data/openforge-dev.db',
    }

    expect(parseFixtureManifest(JSON.stringify(valid))).toEqual(valid)
    expect(() => parseFixtureManifest('{"schemaVersion":2}')).toThrow(/schemaVersion/)
    expect(() => parseFixtureManifest('{"schemaVersion":1,"projectId":"P-1"}')).toThrow(/taskId/)
    expect(() => parseFixtureManifest('not json')).toThrow(/fixture manifest/i)
  })

  it('seeds app data with the sidecar adapter and returns the persisted manifest', async () => {
    const runRoot = await temporaryDirectory('openforge-desktop-seed')
    const calls = []
    const runCommand = async (command, args, options = {}) => {
      if (command === 'git') {
        return execFileAsync(command, args, {
          cwd: options.cwd,
          env: options.env,
          encoding: 'utf8',
        })
      }
      calls.push({ command, args })
      const value = {
        schemaVersion: 1,
        projectId: 'P-1',
        taskId: 'T-1',
        projectName: 'Desktop Test Project',
        taskTitle: 'Terminal performance fixture',
        repoPath: join(runRoot, 'repository'),
        workspacePath: join(runRoot, 'repository'),
        appDataDir: join(runRoot, 'app-data'),
        databasePath: join(runRoot, 'app-data', 'openforge-dev.db'),
      }
      const manifestIndex = args.indexOf('--manifest')
      await writeFile(args[manifestIndex + 1], `${JSON.stringify(value)}\n`)
      return { stdout: `${JSON.stringify(value)}\n`, stderr: '' }
    }

    const fixture = await prepareDesktopTestFixture({
      runRoot,
      sidecarPath: '/tmp/openforge-sidecar',
      runCommand,
    })

    expect(fixture.manifest.projectId).toBe('P-1')
    expect(fixture.repository.generated).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe('/tmp/openforge-sidecar')
    expect(calls[0].args).toEqual([
      'desktop-test-fixture',
      '--app-data-dir', join(runRoot, 'app-data'),
      '--repo-path', await realpath(join(runRoot, 'repository')),
      '--manifest', join(runRoot, 'fixture.json'),
    ])
  })
})
