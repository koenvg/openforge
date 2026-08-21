import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { assertPluginSdkDocVersion } from './check-plugin-sdk-doc-version.mjs'

const repoRoot = join(import.meta.dirname, '..')

function authoringDoc({ dependencyVersion = '0.2.3', guidanceVersion = '0.2.3' } = {}) {
  return `
\`\`\`json
{
  "dependencies": {
    "@openforge-app/plugin-sdk": "^${dependencyVersion}"
  }
}
\`\`\`

The current authoring release on npm is \`@openforge-app/plugin-sdk@${guidanceVersion}\`.
`
}

describe('Plugin SDK documentation version check', () => {
  it('accepts package and guidance versions that match the release version', () => {
    expect(() => assertPluginSdkDocVersion({
      document: authoringDoc(),
      packageVersion: '0.2.3',
    })).not.toThrow()
  })

  it('rejects a stale package example', () => {
    expect(() => assertPluginSdkDocVersion({
      document: authoringDoc({ dependencyVersion: '0.2.1' }),
      packageVersion: '0.2.3',
    })).toThrow('dependency example uses ^0.2.1; expected ^0.2.3')
  })

  it('rejects stale current-release guidance', () => {
    expect(() => assertPluginSdkDocVersion({
      document: authoringDoc({ guidanceVersion: '0.2.1' }),
      packageVersion: '0.2.3',
    })).toThrow('current authoring release is 0.2.1; expected 0.2.3')
  })

  it('keeps the checked-in package and authoring guide aligned with npm latest', async () => {
    const packageJson = JSON.parse(await readFile(
      join(repoRoot, 'packages/plugin-sdk/package.json'),
      'utf8',
    ))
    const document = await readFile(join(repoRoot, 'docs/plugin-authoring.md'), 'utf8')

    expect(packageJson.version).toBe('0.2.3')
    expect(() => assertPluginSdkDocVersion({
      document,
      packageVersion: packageJson.version,
    })).not.toThrow()
  })
})
