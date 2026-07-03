import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { createDeveloperLogSink, createDeveloperLogStore } from './developerLogs'

function tempLogPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'openforge-developer-logs-')), 'openforge.log')
}

describe('developer logs', () => {
  it('writes the full current-session log trace to disk while keeping only a bounded UI tail in memory', () => {
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
})
