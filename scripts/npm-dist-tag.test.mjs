import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { validateNpmDistTag } from './npm-dist-tag.mjs'

const validatorScriptPath = fileURLToPath(new URL('./npm-dist-tag.mjs', import.meta.url))

function runValidatorScript(npmTag) {
  return spawnSync(process.execPath, [validatorScriptPath], {
    encoding: 'utf8',
    env: { ...process.env, NPM_TAG: npmTag },
  })
}

describe('npm dist-tag validation', () => {
  it.each(['latest', 'next', 'beta.1', 'release_candidate-1', '1beta'])(
    'accepts the valid dist-tag %s',
    (tag) => {
      expect(validateNpmDistTag(tag)).toBe(tag)
    },
  )

  it.each(['', 'two words', '1.2.3', 'v1.2.3', 'x', 'tag/name'])(
    'rejects the malformed dist-tag %j',
    (tag) => {
      expect(() => validateNpmDistTag(tag)).toThrow(`Invalid npm dist-tag: ${JSON.stringify(tag)}`)
    },
  )

  it.each(['next; echo injected', '$(echo injected)', '`echo injected`', 'next&&echo injected', 'next"'])(
    'rejects the shell-significant dist-tag %j',
    (tag) => {
      expect(() => validateNpmDistTag(tag)).toThrow(`Invalid npm dist-tag: ${JSON.stringify(tag)}`)
    },
  )
})

describe('npm dist-tag validator CLI', () => {
  it('accepts a valid NPM_TAG environment value', () => {
    const result = runValidatorScript('1beta')

    expect(result.status).toBe(0)
  })

  it('rejects a shell-significant NPM_TAG environment value with a nonzero exit', () => {
    const result = runValidatorScript('next; echo injected')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Invalid npm dist-tag: "next; echo injected"')
  })
})
