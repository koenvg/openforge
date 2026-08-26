import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { validateOpenForgeCliRuntimeAssetManifest } from './electron-package/runtime-assets.mjs'

const fixtures = JSON.parse(
  await readFile(new URL('../fixtures/openforge-cli-runtime-asset-manifests.json', import.meta.url), 'utf8'),
)

describe('OpenForge CLI runtime asset manifest contract', () => {
  for (const fixture of fixtures.cases) {
    it(fixture.name, () => {
      const validate = () => validateOpenForgeCliRuntimeAssetManifest(fixture.manifest)

      if (fixture.valid) {
        expect(validate()).toEqual(fixture.runtimeFiles)
      } else {
        expect(validate).toThrow()
      }
    })
  }
})
