import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CrashSafeFilePersistence } from './crashSafeFilePersistence'

async function temporaryPath(name = 'state.json'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'openforge-crash-safe-file-'))
  return join(directory, name)
}

describe('CrashSafeFilePersistence', () => {
  it('reads a missing file as null without hiding other read failures', async () => {
    const persistence = new CrashSafeFilePersistence()
    const path = await temporaryPath()

    await expect(persistence.readUtf8IfExists(path)).resolves.toBeNull()

    await mkdir(path)
    await expect(persistence.readUtf8IfExists(path)).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('atomically replaces a file through a private temporary write', async () => {
    const persistence = new CrashSafeFilePersistence()
    const path = await temporaryPath('nested/state.json')
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, 'old', { mode: 0o644 })

    await persistence.writeUtf8Atomic(path, 'new')

    await expect(readFile(path, 'utf8')).resolves.toBe('new')
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    await expect(readdir(join(path, '..'))).resolves.toEqual(['state.json'])
  })

  it('removes its temporary file when the atomic rename fails', async () => {
    const persistence = new CrashSafeFilePersistence()
    const path = await temporaryPath()
    await mkdir(path)

    await expect(persistence.writeUtf8Atomic(path, 'content')).rejects.toBeDefined()

    const entries = await readdir(join(path, '..'))
    expect(entries).toEqual(['state.json'])
  })

  it('serializes operations in submission order and keeps working after a rejection', async () => {
    const persistence = new CrashSafeFilePersistence()
    const events: string[] = []
    let releaseFirst!: () => void
    const firstMayFinish = new Promise<void>(resolve => { releaseFirst = resolve })

    const first = persistence.runExclusive(async () => {
      events.push('first:start')
      await firstMayFinish
      events.push('first:end')
    })
    const second = persistence.runExclusive(async () => {
      events.push('second')
      throw new Error('expected failure')
    })
    const third = persistence.runExclusive(async () => {
      events.push('third')
      return 3
    })

    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    releaseFirst()

    await expect(first).resolves.toBeUndefined()
    await expect(second).rejects.toThrow('expected failure')
    await expect(third).resolves.toBe(3)
    expect(events).toEqual(['first:start', 'first:end', 'second', 'third'])
  })
})
