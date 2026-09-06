import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  UI_MIGRATION_ALLOWLIST,
  findUiMigrationInventoryViolations,
  readMigratedUiSources,
} from './check-ui-migration-inventory.mjs'

describe('completed UI migration inventory', () => {
  it('detects named sizes and CSS length units and percentages', () => {
    const violations = findUiMigrationInventoryViolations([{ path: 'fixture.svelte',
      contents: '<button class="h-px max-w-sm md:size-lg" style="width: 20ch; border-radius: 50%; height: 2dvh" />',
    }])
    expect(violations.map(v => v.token)).toEqual(expect.arrayContaining([
      'h-px', 'max-w-sm', 'md:size-lg', 'width: 20ch', 'border-radius: 50%', 'height: 2dvh',
    ]))
  })

  it('resolves template-local constants without leaking bindings between blocks', () => {
    const contents = `<script>const shape = 'text-current'</script>
      {#if true}{@const shape = 'btn rounded-xl'}<button class={shape} />{/if}
      {#if true}<span class={shape} />{/if}
      {#if true}{@const shape = 'text-current'}<span class={shape} />{/if}`
    expect(findUiMigrationInventoryViolations([{ path: 'fixture.svelte', contents }]).map(v => v.token))
      .toEqual(['btn', 'rounded-xl'])
    expect(findUiMigrationInventoryViolations([{ path: 'fixture.svelte',
      contents: `<script>const shape = 'btn'</script>{#each [] as shape}<span class={shape} />{:else}<button class={shape} />{/each}`,
    }]).map(v => v.token)).toEqual(['btn'])
  })

  it('detects TypeScript external module references for both forbidden import families', () => {
    expect(findUiMigrationInventoryViolations([{
      path: 'src/components/shared/ui/imports.d.cts',
      contents: 'import Bits = require("bits-ui"); import Old = require("./Modal.svelte"); export = Bits;',
    }]).map(v => v.token)).toEqual(['bits-ui', './Modal.svelte'])
  })

  it('rejects exception paths after source deletion or rename', () => {
    const policy = { 'old.svelte': [{ tag: 'aside', context: 'class="w-16"', tokens: ['w-16'], count: 1, reason: 'Pane width.' }] }
    expect(findUiMigrationInventoryViolations([], policy)).toEqual([
      expect.objectContaining({ path: 'old.svelte', rule: 'allowlist' }),
    ])
    expect(findUiMigrationInventoryViolations([{ path: 'new.svelte', contents: '<aside class="w-16" />' }], policy).map(v => v.rule))
      .toEqual(['geometry', 'allowlist'])
  })

  it('rejects covered overlay, tooltip and disclosure control classes', () => {
    expect(findUiMigrationInventoryViolations([{
      path: 'fixture.svelte', contents: '<div class="modal-box tooltip tooltip-right dropdown-content menu collapse" />',
    }]).map(v => v.token)).toEqual(['modal-box', 'tooltip', 'tooltip-right', 'dropdown-content', 'menu', 'collapse'])
  })

  it('rejects Bits UI type imports in declarations without rejecting ambient declarations', () => {
    expect(findUiMigrationInventoryViolations([{
      path: 'packages/plugin-sdk/src/public.d.mts',
      contents: 'export const version: string; export type Dialog = import("bits-ui").Dialog',
    }]).map(v => v.token)).toEqual(['bits-ui'])
  })

  it('checks class forwarding props, CSS files and same-directory obsolete imports', () => {
    const sources = [
      { path: 'fixture.svelte', contents: '<Tooltip triggerClass="btn" /><Modal boxClass="rounded-xl" />' },
      { path: 'src/components/controls.css', contents: '.control { height: 32px; }' },
      { path: 'src/components/shared/ui/new.ts', contents: 'export { default } from "./Modal.svelte"; type Bits = import("bits-ui").Dialog' },
    ]
    const violations = findUiMigrationInventoryViolations(sources)
    expect(violations.map(v => v.token)).toEqual(expect.arrayContaining(['btn', 'rounded-xl', 'height: 32px', './Modal.svelte', 'bits-ui']))
    expect(violations.find(v => v.path.endsWith('.css'))?.context).toBe('.control')
    expect(findUiMigrationInventoryViolations([{ path: 'fixture.ts', contents: '// import("bits-ui")\nconst name = "bits-ui"' }])).toEqual([])
  })

  it('discovers new migrated files and fails the command for each seeded rule', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'ui-inventory-'))
    const seed = (path, contents) => {
      mkdirSync(dirname(resolve(root, path)), { recursive: true })
      writeFileSync(resolve(root, path), contents)
    }
    const run = () => spawnSync(process.execPath, [resolve('scripts/check-ui-migration-inventory.mjs'), '--root', root], { encoding: 'utf8' })
    try {
      for (const path of ['src/components', 'packages/pr-review-ui/src', 'packages/terminal-runtime/src',
        'packages/plugin-sdk/src', 'plugins/file-viewer/src', 'plugins/task-browser/src',
        'plugins/task-schedules/src', 'plugins/github-sync/src', 'plugins/terminal/src']) seed(`${path}/Seed.svelte`, '<div />')
      seed('scripts/ui-migration-allowlist.json', '{}')
      expect(run().status).toBe(0)
      for (const [path, contents, diagnostic] of [
        ['src/components/New.svelte', '<button class="btn">Save</button>', 'btn'],
        ['plugins/github-sync/src/New.svelte', '<button style:height="32px">Save</button>', 'height: 32px'],
        ['plugins/terminal/src/new.ts', 'export * from "bits-ui"', 'bits-ui'],
        ['plugins/terminal/src/new.d.cts', 'import Bits = require("bits-ui"); export = Bits;', 'bits-ui'],
        ['src/components/shared/ui/Modal.svelte', '<div />', 'obsolete implementation'],
      ]) {
        seed(path, contents)
        const result = run()
        expect(result.status, result.stderr).toBe(1)
        expect(result.stderr).toContain(diagnostic)
        rmSync(resolve(root, path))
      }
      seed('src/components/Pane.svelte', '<aside class="w-16" />')
      seed('scripts/ui-migration-allowlist.json', JSON.stringify({
        'src/components/Pane.svelte': [{ tag: 'aside', context: 'class="w-16"', tokens: ['w-16'], count: 1, reason: 'Pane width.' }],
      }))
      expect(run().status).toBe(0)
      rmSync(resolve(root, 'src/components/Pane.svelte'))
      expect(run().stderr).toContain('Exception source is missing')
      expect(run().status).toBe(1)
      seed('src/components/RenamedPane.svelte', '<aside class="w-16" />')
      expect(run().status).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('checks variant utilities, referenced classes, inline styles and scoped CSS geometry', () => {
    const contents = `<script>const shape = 'h-2.5'; const control = 'btn-primary'</script>
      <button class={['hover:btn', shape, control, 'size-9', 'rounded-t-lg']} style="height: 32px">Save</button>
      <style>button { border-radius: 6px; }</style>`
    const tokens = findUiMigrationInventoryViolations([{ path: 'fixture.svelte', contents }]).map(({ token }) => token)
    expect(tokens).toEqual(expect.arrayContaining([
      'hover:btn', 'h-2.5', 'btn-primary', 'size-9', 'rounded-t-lg', 'height: 32px', 'border-radius: 6px',
    ]))
    expect(findUiMigrationInventoryViolations([{
      path: 'fixture.svelte',
      contents: '<div class="select-none h-[var(--of-control-height)] rounded-[var(--of-radius-container)]" />',
    }])).toEqual([])
  })

  it('rejects restored obsolete shared controls and imports of deleted controls', () => {
    expect(findUiMigrationInventoryViolations([
      { path: 'src/components/shared/ui/AnchoredMenu.svelte', contents: '<div />' },
      { path: 'src/components/shell/Seed.svelte', contents: '<script>import Menu from "../shared/ui/HoverTooltip.svelte"</script>' },
    ]).map(({ token }) => token)).toEqual([
      'obsolete implementation', '../shared/ui/HoverTooltip.svelte',
    ])
  })

  it('rejects direct Bits UI imports outside the SDK implementation', () => {
    const sources = [
      { path: 'src/components/shell/Seed.svelte', contents: '<script>import { Dialog } from "bits-ui"</script>' },
      { path: 'plugins/terminal/src/seed.ts', contents: 'export { Dialog } from "bits-ui"' },
      { path: 'src/lib/seed.ts', contents: 'const bits = import("bits-ui/dialog")' },
    ]
    expect(findUiMigrationInventoryViolations(sources).map(({ token }) => token)).toEqual([
      'bits-ui', 'bits-ui', 'bits-ui/dialog',
    ])
    expect(findUiMigrationInventoryViolations([
      { path: 'packages/plugin-sdk/src/ui/Modal.svelte', contents: sources[0].contents },
    ])).toEqual([])
  })

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

  it('bounds justified geometry exceptions by file, element, exact context and count', () => {
    const allowlist = {
      'fixture.svelte': [{ tag: 'aside', context: 'class="pane w-16"', tokens: ['w-16'], count: 1, reason: 'Navigation pane width.' }],
    }
    const source = { path: 'fixture.svelte', contents: '<aside class="pane w-16" />' }
    expect(findUiMigrationInventoryViolations([source], allowlist)).toEqual([])
    const contents = `${source.contents}${source.contents}<button class="pane w-16" /><aside class="other w-16" />`
    expect(findUiMigrationInventoryViolations([{ ...source, contents }], allowlist).map(v => v.token)).toEqual(['w-16', 'w-16', 'w-16'])
    expect(findUiMigrationInventoryViolations([{ ...source, path: 'other.svelte' }], allowlist).map(v => v.rule)).toEqual(['geometry', 'allowlist'])
    expect(findUiMigrationInventoryViolations([{ ...source, contents: '<aside />' }], allowlist).map(v => v.rule)).toEqual(['allowlist'])
    expect(findUiMigrationInventoryViolations([{ ...source, contents: '<aside class="pane btn" />' }], {
      'fixture.svelte': [{ ...allowlist['fixture.svelte'][0], context: 'class="pane btn"', tokens: ['btn'] }],
    }).some(v => v.token === 'btn')).toBe(true)
  })

  it('reports no covered direct control or fixed-geometry classes in migrated areas', () => {
    expect(findUiMigrationInventoryViolations(readMigratedUiSources(), UI_MIGRATION_ALLOWLIST)).toEqual([])
  })
})
