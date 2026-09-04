import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION_TARGETS: readonly {
  relativePath: string
  publicComponents: readonly string[]
}[] = [
  { relativePath: 'review/pr/PrReviewDetailSection.svelte', publicComponents: ['Badge', 'Button', 'Tabs'] },
  { relativePath: 'review/pr/PrReviewListSection.svelte', publicComponents: ['Badge', 'Button'] },
  { relativePath: 'review/pr/PrWalkthroughButton.svelte', publicComponents: ['Badge', 'Button'] },
  { relativePath: 'review/pr/RepositoryFilterSection.svelte', publicComponents: ['Badge', 'Button', 'IconButton', 'Panel', 'TextField'] },
  { relativePath: 'review/pr/TicketCoveragePanel.svelte', publicComponents: ['Badge', 'Button', 'Panel', 'TextField'] },
  { relativePath: 'review/pr/WalkthroughAiQuestions.svelte', publicComponents: ['Badge', 'Button', 'Panel', 'TextField', 'Textarea'] },
  { relativePath: 'review/pr/WalkthroughStepNavigation.svelte', publicComponents: ['Button'] },
  { relativePath: 'review/pr/WalkthroughTab.svelte', publicComponents: ['Button', 'IconButton'] },
  { relativePath: 'settings/JiraSettingsSection.svelte', publicComponents: ['Button', 'TextField'] },
  { relativePath: 'task/PullRequestCard.svelte', publicComponents: ['Badge', 'Button'] },
  { relativePath: 'task/PullRequestLinkForm.svelte', publicComponents: ['Button', 'Panel', 'TextField'] },
  { relativePath: 'task/TaskPullRequestStatus.svelte', publicComponents: ['Badge', 'Button', 'IconButton'] },
]

const NATIVE_CONTROL_ALLOWLIST: Readonly<Record<string, readonly RegExp[]>> = {
  'review/pr/WalkthroughStepNavigation.svelte': [
    /aria-current=\{index === currentIndex \? 'step' : undefined\}/,
  ],
  'task/PullRequestCard.svelte': [
    /aria-label=\{`#\$\{prNumber\(pr\)\} \$\{pr\.title\}`\}/,
  ],
}

const LEGACY_COMPONENT_CLASS = /(?:^|\s)(?:btn|input|textarea|select|checkbox|toggle|badge|card|tabs?|menu)(?:-|\s|$)/
const CLASS_ATTRIBUTE = /\bclass=(['"])(.*?)\1/g
const NATIVE_CONTROL = /<button\b[\s\S]*?<\/button>|<input\b[\s\S]*?>|<textarea\b[\s\S]*?<\/textarea>|<select\b[\s\S]*?<\/select>/g
const IMPORT_SPECIFIER = /\bfrom\s+['"]([^'"]+)['"]/g
const SDK_UI_COMPONENT_IMPORT = /\/ui\/([^/'"]+)\.svelte$/

function source(relativePath: string): string {
  return readFileSync(resolve(import.meta.dirname, relativePath), 'utf8')
}

function legacyClasses(relativePath: string): string[] {
  return [...source(relativePath).matchAll(CLASS_ATTRIBUTE)]
    .map((match) => match[2])
    .filter((className) => LEGACY_COMPONENT_CLASS.test(className))
}

describe('GitHub Sync public UI migration', () => {
  it('does not use legacy component classes in migrated plugin UI', () => {
    for (const { relativePath } of MIGRATION_TARGETS) {
      expect(legacyClasses(relativePath), relativePath).toEqual([])
    }
  })

  it('imports each migrated shared control from its public SDK UI entrypoint', () => {
    for (const { relativePath, publicComponents } of MIGRATION_TARGETS) {
      const fileSource = source(relativePath)
      const imports = [...fileSource.matchAll(IMPORT_SPECIFIER)].map((match) => match[1])

      for (const component of publicComponents) {
        expect(imports, `${relativePath}: ${component}`).toContain(
          `@openforge-app/plugin-sdk/ui/${component}.svelte`,
        )
      }

      for (const specifier of imports) {
        const uiComponent = specifier.match(SDK_UI_COMPONENT_IMPORT)?.[1]
        if (uiComponent) {
          expect(specifier, `${relativePath}: ${uiComponent}`).toBe(
            `@openforge-app/plugin-sdk/ui/${uiComponent}.svelte`,
          )
        }
        expect(specifier, relativePath).not.toMatch(/@openforge-app\/plugin-sdk\/src\//)
        expect(specifier, relativePath).not.toMatch(/^(?:\.\.\/)+(?:packages\/plugin-sdk\/src|src)\//)
      }
    }
  })

  it('keeps native shared controls only where an explicit custom-control exception applies', () => {
    for (const { relativePath } of MIGRATION_TARGETS) {
      const controls = [...source(relativePath).matchAll(NATIVE_CONTROL)].map((match) => match[0])
      const allowlist = NATIVE_CONTROL_ALLOWLIST[relativePath] ?? []

      expect(controls, relativePath).toHaveLength(allowlist.length)
      for (const control of controls) {
        expect(
          allowlist.some((allowedControl) => allowedControl.test(control)),
          `${relativePath}: ${control}`,
        ).toBe(true)
      }
    }
  })
})
