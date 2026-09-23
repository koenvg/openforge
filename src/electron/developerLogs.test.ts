import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { createDeveloperLogSink, createDeveloperLogStore } from './developerLogs'

const ENTRY_LINE_BYTES = Buffer.byteLength(`[${new Date(0).toISOString()}] INFO entry 1\n`)

function tempLogPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'openforge-developer-logs-')), 'openforge.log')
}

describe('developer logs', () => {
  it('writes log entries to disk while keeping only a bounded UI tail in memory', async () => {
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
    await store.flush()
    expect(readFileSync(logFilePath, 'utf8')).toContain('entry 1')
    expect(readFileSync(logFilePath, 'utf8')).toContain('entry 3')
  })

  it('keeps a bounded number of archives when every line exceeds the file limit', async () => {
    const logFilePath = tempLogPath()
    const store = createDeveloperLogStore({
      logFilePath,
      maxFileBytes: 1,
      maxArchiveFiles: 2,
    })

    for (let index = 1; index <= 3; index += 1) {
      store.append('info', `entry ${index}`)
      await store.flush()
    }

    expect(readFileSync(logFilePath, 'utf8')).toContain('entry 3')
    expect(readFileSync(`${logFilePath}.1`, 'utf8')).toContain('entry 2')
    expect(readFileSync(`${logFilePath}.2`, 'utf8')).toContain('entry 1')
    expect(existsSync(`${logFilePath}.3`)).toBe(false)
  })

  it('keeps the in-memory log available when disk persistence fails', async () => {
    const blockingPath = tempLogPath()
    writeFileSync(blockingPath, 'not a directory')
    const store = createDeveloperLogStore({ logFilePath: join(blockingPath, 'openforge.log') })

    expect(() => store.append('error', 'startup failed')).not.toThrow()
    await expect(store.flush()).resolves.toBeUndefined()
    expect(store.getRecentLogs()).toEqual([
      expect.objectContaining({ level: 'error', message: 'startup failed' }),
    ])
  })

  it('leaves archive rotation to the process holding the rotation lock', async () => {
    const logFilePath = tempLogPath()
    const store = createDeveloperLogStore({ logFilePath, maxFileBytes: 1 })
    store.append('info', 'entry 1')
    await store.flush()
    mkdirSync(`${logFilePath}.rotation-lock`)

    store.append('info', 'entry 2')
    await store.flush()

    expect(readFileSync(logFilePath, 'utf8')).toContain('entry 1')
    expect(readFileSync(logFilePath, 'utf8')).toContain('entry 2')
    expect(existsSync(`${logFilePath}.1`)).toBe(false)
  })

  it('reclaims a stale rotation lock left by a terminated process', async () => {
    const logFilePath = tempLogPath()
    const store = createDeveloperLogStore({ logFilePath, maxFileBytes: 1 })
    store.append('info', 'entry 1')
    await store.flush()
    const rotationLockPath = `${logFilePath}.rotation-lock`
    mkdirSync(rotationLockPath)
    const staleTime = new Date(Date.now() - 60_000)
    utimesSync(rotationLockPath, staleTime, staleTime)

    store.append('info', 'entry 2')
    await store.flush()

    expect(readFileSync(logFilePath, 'utf8')).toContain('entry 2')
    expect(readFileSync(`${logFilePath}.1`, 'utf8')).toContain('entry 1')
    expect(existsSync(rotationLockPath)).toBe(false)
  })

  it('does not touch the disk while appending', () => {
    const logFilePath = tempLogPath()
    const store = createDeveloperLogStore({ logFilePath })

    store.append('info', 'entry 1')

    expect(existsSync(logFilePath)).toBe(false)
  })

  it('flushes buffered lines to disk on the flush interval', async () => {
    const logFilePath = tempLogPath()
    const store = createDeveloperLogStore({ logFilePath, flushIntervalMs: 5 })

    store.append('info', 'entry 1')

    await vi.waitFor(() => expect(readFileSync(logFilePath, 'utf8')).toContain('entry 1'))
  })

  it('keeps line order when appends arrive during a flush', async () => {
    const logFilePath = tempLogPath()
    const store = createDeveloperLogStore({ logFilePath })

    store.append('info', 'entry 1')
    const firstFlush = store.flush()
    store.append('info', 'entry 2')
    await Promise.all([firstFlush, store.flush()])

    expect(readFileSync(logFilePath, 'utf8')).toMatch(/entry 1\n.*entry 2\n$/s)
  })

  it('rotates only when the next batch crosses the file size limit', async () => {
    const logFilePath = tempLogPath()
    const store = createDeveloperLogStore({ logFilePath, maxFileBytes: ENTRY_LINE_BYTES * 2 })

    store.append('info', 'entry 1')
    store.append('info', 'entry 2')
    await store.flush()
    expect(existsSync(`${logFilePath}.1`)).toBe(false)
    store.append('info', 'entry 3')
    await store.flush()

    const archive = readFileSync(`${logFilePath}.1`, 'utf8')
    expect(archive).toContain('entry 1')
    expect(archive).toContain('entry 2')
    expect(readFileSync(logFilePath, 'utf8')).not.toContain('entry 2')
    expect(readFileSync(logFilePath, 'utf8')).toContain('entry 3')
  })

  it('counts an existing log file toward the size limit', async () => {
    const logFilePath = tempLogPath()
    writeFileSync(logFilePath, 'x'.repeat(ENTRY_LINE_BYTES))
    const store = createDeveloperLogStore({ logFilePath, maxFileBytes: ENTRY_LINE_BYTES + 1 })

    store.append('info', 'entry 1')
    await store.flush()

    expect(readFileSync(`${logFilePath}.1`, 'utf8')).toBe('x'.repeat(ENTRY_LINE_BYTES))
    expect(readFileSync(logFilePath, 'utf8')).toContain('entry 1')
  })

  it('drops lines beyond the pending limit and records how many were dropped', async () => {
    const logFilePath = tempLogPath()
    const store = createDeveloperLogStore({ logFilePath, maxPendingLines: 2 })

    for (let index = 1; index <= 4; index += 1) {
      store.append('info', `entry ${index}`)
    }
    await store.flush()

    const diskLog = readFileSync(logFilePath, 'utf8')
    expect(diskLog).toContain('entry 2')
    expect(diskLog).not.toContain('entry 3')
    expect(diskLog).toContain('dropped 2 developer log lines')
    expect(store.getRecentLogs().map(entry => entry.message)).toContain('entry 4')
  })

  it('returns recent entries oldest first after the ring buffer wraps', () => {
    const store = createDeveloperLogStore({ maxEntries: 3, logFilePath: tempLogPath() })

    for (let index = 1; index <= 7; index += 1) {
      store.append('info', `entry ${index}`)
    }

    expect(store.getRecentLogs().map(entry => entry.id)).toEqual([5, 6, 7])
    expect(store.getRecentLogs(2).map(entry => entry.id)).toEqual([6, 7])
    expect(store.getRecentLogs(10).map(entry => entry.id)).toEqual([5, 6, 7])
    expect(store.getSnapshot().totalEntries).toBe(7)
  })

  it('truncates very long messages in memory and on disk', async () => {
    const logFilePath = tempLogPath()
    const store = createDeveloperLogStore({ logFilePath, maxMessageChars: 10 })

    const entry = store.append('info', 'x'.repeat(25))
    await store.flush()

    expect(entry.message).toBe(`${'x'.repeat(10)}... [truncated 15 chars]`)
    expect(readFileSync(logFilePath, 'utf8')).toContain(`${'x'.repeat(10)}... [truncated 15 chars]\n`)
  })

  it('truncates messages longer than 8192 characters by default', () => {
    const store = createDeveloperLogStore({ logFilePath: tempLogPath() })

    const entry = store.append('info', 'x'.repeat(9000))

    expect(entry.message).toBe(`${'x'.repeat(8192)}... [truncated 808 chars]`)
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

  it('persists sanitized Rust sidecar logger lines captured from stdout and stderr', async () => {
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

    await store.flush()
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
