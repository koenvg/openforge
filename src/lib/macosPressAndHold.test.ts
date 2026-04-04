import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDir = dirname(fileURLToPath(import.meta.url))
const infoPlistPath = join(currentDir, '../../src-tauri/Info.plist')

describe('macOS app configuration', () => {
  it('disables press-and-hold so terminal key repeat works in macOS', () => {
    const contents = readFileSync(infoPlistPath, 'utf8')

    expect(contents).toMatch(/<key>ApplePressAndHoldEnabled<\/key>\s*<false\/>/)
  })
})
