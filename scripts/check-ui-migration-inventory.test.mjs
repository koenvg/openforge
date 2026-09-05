import { describe, expect, it } from 'vitest'
import {
  UI_MIGRATION_ALLOWLIST,
  findUiMigrationInventoryViolations,
  readMigratedUiSources,
} from './check-ui-migration-inventory.mjs'

describe('shell and navigation UI migration inventory', () => {
  it('rejects covered daisyUI classes and fixed geometry', () => {
    const violations = findUiMigrationInventoryViolations([
      {
        path: 'fixture.svelte',
        contents: '<button class="btn btn-ghost h-9 rounded-md">Save</button><input class="input input-sm w-[12rem]" />',
      },
    ])

    expect(violations.map(({ token }) => token)).toEqual([
      'btn',
      'btn-ghost',
      'h-9',
      'rounded-md',
      'input',
      'input-sm',
      'w-[12rem]',
    ])
  })

  it('rejects class directives and classes embedded in Svelte expressions', () => {
    const violations = findUiMigrationInventoryViolations([
      {
        path: 'fixture.svelte',
        contents: `<button class:btn={enabled} class={['btn-ghost', 'h-9', enabled && 'rounded-md']}>Save</button><span class={{ badge: enabled, 'w-9': enabled }}>2</span>`,
      },
    ])

    expect(violations.map(({ token }) => token)).toEqual(['btn', 'btn-ghost', 'h-9', 'rounded-md', 'badge', 'w-9'])
  })

  it('permits documented feature-layout geometry without allowing control geometry generally', () => {
    const violations = findUiMigrationInventoryViolations([
      {
        path: 'src/components/shell/AppSidebar.svelte',
        contents: '<aside class="of-app-sidebar w-16 w-[17rem]"><div class="of-sidebar-header h-12"></div></aside><button class="h-12">Toggle</button>',
      },
    ], UI_MIGRATION_ALLOWLIST)

    expect(violations.map(({ token }) => token)).toEqual(['h-12'])
    expect(UI_MIGRATION_ALLOWLIST['src/components/shell/AppSidebar.svelte']).toEqual([
      { tag: 'aside', marker: 'of-app-sidebar', token: 'w-16' },
      { tag: 'aside', marker: 'of-app-sidebar', token: 'w-[17rem]' },
      { tag: 'div', marker: 'of-sidebar-header', token: 'h-12' },
      { tag: 'div', marker: 'dev-badge-gradient', token: 'h-12' },
    ])
  })

  it('reports no covered direct control or fixed-geometry classes in migrated areas', () => {
    expect(findUiMigrationInventoryViolations(readMigratedUiSources(), UI_MIGRATION_ALLOWLIST)).toEqual([])
  })
})
