import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDir = dirname(fileURLToPath(import.meta.url))
const packageJsonPath = join(currentDir, '../../package.json')

type RootPackageJson = {
  scripts?: Record<string, string>
}

describe('builtin plugin build orchestration', () => {
  it('defines a root script to build builtin plugin bundles', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as RootPackageJson

    expect(packageJson.scripts?.['build:plugins']).toBeDefined()
    expect(packageJson.scripts?.['build:plugins']).toContain("pnpm -r --filter './plugins/*' build")
  })
})
