import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { createDeveloperLogSink, createDeveloperLogStore } from './developerLogs'

function tempLogPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'openforge-developer-logs-')), 'openforge.log')
}

describe('developer logs', () => {
  it('writes log entries to disk while keeping only a bounded UI tail in memory', () => {
    const logFilePath = tempLogPath()
    const store = createDeveloperLogStore({ maxEntries: 2, logFilePath })

    for (let index = 1; index <= 3; index += 1) {
      store.append('info', `entry ${index}`)
    }

    expect(store.getRecentLogs()).toEqual([
      expect.objectContaining({ id: 2, message: 'entry 2' }),
      expect.objectContaining({ id: 3, message: 'entry 3' }),
    ])
    expect(store.getSnapshot()).toEqual({
      entries: [
        expect.objectContaining({ id: 2, message: 'entry 2' }),
        expect.objectContaining({ id: 3, message: 'entry 3' }),
      ],
      logFilePath,
      totalEntries: 3,
    })
    expect(readFileSync(logFilePath, 'utf8')).toContain('entry 1')
    expect(readFileSync(logFilePath, 'utf8')).toContain('entry 3')
  })

  it('rotates bounded log archives before appending a line beyond the file limit', () => {
    const logFilePath = tempLogPath()
    const store = createDeveloperLogStore({
      logFilePath,
      maxFileBytes: 1,
      maxArchiveFiles: 2,
    })

    store.append('info', 'entry 1')
    store.append('info', 'entry 2')
    store.append('info', 'entry 3')

    expect(readFileSync(logFilePath, 'utf8')).toContain('entry 3')
    expect(readFileSync(`${logFilePath}.1`, 'utf8')).toContain('entry 2')
    expect(readFileSync(`${logFilePath}.2`, 'utf8')).toContain('entry 1')
    expect(existsSync(`${logFilePath}.3`)).toBe(false)
  })

  it('keeps the in-memory log available when disk persistence fails', () => {
    const blockingPath = tempLogPath()
    writeFileSync(blockingPath, 'not a directory')
    const store = createDeveloperLogStore({ logFilePath: join(blockingPath, 'openforge.log') })

    expect(() => store.append('error', 'startup failed')).not.toThrow()
    expect(store.getRecentLogs()).toEqual([
      expect.objectContaining({ level: 'error', message: 'startup failed' }),
    ])
  })

  it('leaves archive rotation to the process holding the rotation lock', () => {
    const logFilePath = tempLogPath()
    const store = createDeveloperLogStore({ logFilePath, maxFileBytes: 1 })
    store.append('info', 'entry 1')
    mkdirSync(`${logFilePath}.rotation-lock`)

    store.append('info', 'entry 2')

    expect(readFileSync(logFilePath, 'utf8')).toContain('entry 1')
    expect(readFileSync(logFilePath, 'utf8')).toContain('entry 2')
    expect(existsSync(`${logFilePath}.1`)).toBe(false)
  })

  it('reclaims a stale rotation lock left by a terminated process', () => {
    const logFilePath = tempLogPath()
    const store = createDeveloperLogStore({ logFilePath, maxFileBytes: 1 })
    store.append('info', 'entry 1')
    const rotationLockPath = `${logFilePath}.rotation-lock`
    mkdirSync(rotationLockPath)
    const staleTime = new Date(Date.now() - 60_000)
    utimesSync(rotationLockPath, staleTime, staleTime)

    store.append('info', 'entry 2')

    expect(readFileSync(logFilePath, 'utf8')).toContain('entry 2')
    expect(readFileSync(`${logFilePath}.1`, 'utf8')).toContain('entry 1')
    expect(existsSync(rotationLockPath)).toBe(false)
  })

  it('records delegated Electron and sidecar log output', () => {
    const store = createDeveloperLogStore({ logFilePath: tempLogPath() })
    const delegate = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const logger = createDeveloperLogSink(store, delegate)

    logger.info('[electron] ready')
    logger.error('[sidecar:error] failed')

    expect(delegate.info).toHaveBeenCalledWith('[electron] ready')
    expect(delegate.error).toHaveBeenCalledWith('[sidecar:error] failed')
    expect(store.getRecentLogs()).toEqual([
      expect.objectContaining({ level: 'info', message: '[electron] ready' }),
      expect.objectContaining({ level: 'error', message: '[sidecar:error] failed' }),
    ])
  })

  it('persists sanitized Rust sidecar logger lines captured from stdout and stderr', () => {
    const logFilePath = tempLogPath()
    const store = createDeveloperLogStore({ logFilePath })
    const delegate = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const logger = createDeveloperLogSink(store, delegate)

    logger.info('[sidecar] level=INFO module=openforge::main message=[electron-sidecar] using database filename=openforge_dev.db app_data_dir_resolved=true')
    logger.error('[sidecar:error] level=ERROR module=openforge::http_server message=[http_server] startup failed path=<redacted>')

    const diskLog = readFileSync(logFilePath, 'utf8')
    expect(store.getRecentLogs()).toEqual([
      expect.objectContaining({ level: 'info', message: expect.stringContaining('level=INFO module=openforge::main') }),
      expect.objectContaining({ level: 'error', message: expect.stringContaining('level=ERROR module=openforge::http_server') }),
    ])
    expect(diskLog).toContain('filename=openforge_dev.db')
    expect(diskLog).toContain('path=<redacted>')
    expect(diskLog).not.toContain('/Users/')
  })
})
