import { describe, expect, it } from 'vitest'

import {
  countNonApplicationFiles,
  filterApplicationFiles,
  isNonApplicationFile,
} from './applicationFiles'

describe('isNonApplicationFile', () => {
  describe('classifies non-application files (matches the reviewer pattern list)', () => {
    const nonApplicationPaths: Array<[string, string]> = [
      ['Playwright e2e spec', 'apps/web/e2e/login.spec.ts'],
      ['Playwright e2e page object', 'apps/web/e2e/pages/LoginPage.ts'],
      ['Playwright e2e fixture', 'apps/api/e2e/fixtures/data.json'],
      ['Cypress component test (tsx)', 'libs/shared/src/widgets/AssetsByRiskRating/AssetsByRiskRating.cy.tsx'],
      ['Cypress component test (ts)', 'shared/charts/src/hooks/useChartTooltip.cy.ts'],
      ['unit test (tsx)', 'shared/charts/src/hooks/useChartTooltip.test.tsx'],
      ['unit test (ts)', 'src/lib/parse.test.ts'],
      ['spec test (tsx)', 'src/components/Widget.spec.tsx'],
      ['spec test (ts)', 'src/lib/util.spec.ts'],
      ['Cypress test-harness HTML', 'cypress/support/component-index.html'],
      ['Storybook story (ts)', 'src/components/Button.stories.ts'],
      ['Storybook story (tsx)', 'src/components/Button.stories.tsx'],
      ['Figma Code Connect', 'src/components/Button.figma.tsx'],
      ['__mocks__ directory', 'src/__mocks__/fs.ts'],
      ['__tests__ directory', 'src/feature/__tests__/feature.ts'],
      ['test-utils directory', 'packages/test-utils/render.ts'],
      ['test-helpers directory', 'libs/test-helpers/setup.ts'],
      ['dotted mock file', 'src/service.mock.ts'],
      ['dotted mocks file', 'src/service.mocks.tsx'],
      ['nested mocks entry', 'src/api/mocks.ts'],
      ['jest snapshot', 'src/__snapshots__/Button.test.ts.snap'],
      ['fixtures directory', 'src/data/fixtures/user.json'],
      ['__fixtures__ directory', 'test/__fixtures__/payload.json'],
      ['markdown doc', 'README.md'],
      ['mdx doc', 'docs/guide.mdx'],
      ['mdc doc', 'rules/coding.mdc'],
      ['Nx generator template', 'tools/generators/app/files/__tmpl__/src/index.ts'],
      ['gitkeep placeholder', 'apps/web/src/assets/.gitkeep'],
      ['patch file', 'patches/react+18.0.0.patch'],
    ]

    for (const [label, path] of nonApplicationPaths) {
      it(`${label}: ${path}`, () => {
        expect(isNonApplicationFile(path)).toBe(true)
      })
    }
  })

  describe('treats real application source as application files', () => {
    const applicationPaths: Array<[string, string]> = [
      ['renderer entry', 'src/index.ts'],
      ['Svelte component', 'src/components/Button.svelte'],
      ['Rust sidecar', 'src-tauri/src/main.rs'],
      ['app source under apps', 'apps/web/src/main.ts'],
      ['package manifest', 'package.json'],
      ['plain html not the cypress harness', 'src/public/index.html'],
      ['story-like name that is not a story', 'src/components/ButtonStories.ts'],
      ['e2e outside the anchored apps/*/e2e tree', 'packages/e2e-utils/runner.ts'],
      ['apps e2e not at the anchored position', 'libs/apps/web/e2e/thing.ts'],
      ['top-level mocks without a leading slash', 'mocks.ts'],
      ['stories in an unsupported extension', 'src/components/Button.stories.js'],
      ['source hook alongside its cypress test', 'shared/charts/src/hooks/useChartTooltip.tsx'],
      ['component with test-like word in name', 'src/components/TestRunner.tsx'],
    ]

    for (const [label, path] of applicationPaths) {
      it(`${label}: ${path}`, () => {
        expect(isNonApplicationFile(path)).toBe(false)
      })
    }
  })
})

describe('countNonApplicationFiles', () => {
  it('counts only the non-application files in a mixed list', () => {
    const files = [
      { filename: 'src/index.ts' },
      { filename: 'README.md' },
      { filename: 'src/__mocks__/fs.ts' },
      { filename: 'src/components/Button.svelte' },
    ]
    expect(countNonApplicationFiles(files)).toBe(2)
  })

  it('returns 0 when every file is an application file', () => {
    const files = [{ filename: 'src/index.ts' }, { filename: 'src/app.ts' }]
    expect(countNonApplicationFiles(files)).toBe(0)
  })
})

describe('filterApplicationFiles', () => {
  const files = [
    { filename: 'src/index.ts' },
    { filename: 'README.md' },
    { filename: 'src/__snapshots__/x.snap' },
  ]

  it('hides non-application files when non-application files are excluded', () => {
    const result = filterApplicationFiles(files, false)
    expect(result.map((f) => f.filename)).toEqual(['src/index.ts'])
  })

  it('keeps every file when non-application files are included', () => {
    const result = filterApplicationFiles(files, true)
    expect(result.map((f) => f.filename)).toEqual([
      'src/index.ts',
      'README.md',
      'src/__snapshots__/x.snap',
    ])
  })

  it('does not mutate the input list', () => {
    const original = [...files]
    filterApplicationFiles(files, false)
    expect(files).toEqual(original)
  })
})
