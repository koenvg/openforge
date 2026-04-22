import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDir = dirname(fileURLToPath(import.meta.url))
const defaultCapabilitiesPath = join(currentDir, '../../src-tauri/capabilities/default.json')

describe('Tauri capabilities', () => {
  it('grants window destroy permission for the quit confirmation flow', () => {
    const capabilities = JSON.parse(readFileSync(defaultCapabilitiesPath, 'utf8')) as {
      permissions?: string[]
    }

    expect(capabilities.permissions).toContain('core:window:allow-destroy')
  })
})
