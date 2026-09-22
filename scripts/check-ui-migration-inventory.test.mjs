import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { execFile, spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  UI_MIGRATION_ALLOWLIST,
  inventoryLegacyUiConsumers,
  findUiMigrationInventoryViolations,
  readMigratedUiSources,
} from './check-ui-migration-inventory.mjs'

describe('legacy presentation inventory', () => {
  it('classifies feedback variants consistently in markup, CSS and script producers', () => {
    const records = inventoryLegacyUiConsumers([
      { path: 'src/View.svelte', contents: '<div class="hover:loading-spinner md:alert-error" />' },
      { path: 'src/theme.css', contents: '.hover\\:loading-spinner { display: inline; }' },
      { path: 'src/spinner.ts', contents: 'export const spinner = "loading loading-spinner"' },
      { path: 'src/Script.svelte', contents: '<script>const spinner = () => "md:progress-primary";</script>' },
    ])
    expect(records.map(record => [record.kind, record.token])).toEqual([
      ['component', 'hover:loading-spinner'], ['component', 'md:alert-error'],
      ['component', 'hover:loading-spinner'], ['script-component-candidate', 'loading'],
      ['script-component-candidate', 'loading-spinner'], ['script-component-candidate', 'md:progress-primary'],
    ])
  })
  it('keeps uncertain spreads and mutable class bindings visible', () => {
    const sources = [
      { path: 'src/Spread.svelte', contents: '<script>const props = external;</script><div {...props}/>' },
      { path: 'src/Mutable.svelte', contents: '<script>let paint = "text-of-text"; paint = external;</script><div class={paint}/>' },
    ]
    expect(inventoryLegacyUiConsumers(sources).map(record => [record.kind, record.token])).toEqual([
      ['unresolved', '{...props}'], ['unresolved', 'class={paint}'],
    ])
  })
  it('does not hide the dynamic branch of an OR fallback or script template producer', () => {
    const records = inventoryLegacyUiConsumers([
      { path: 'src/View.svelte', contents: '<script>let external;</script><div class={external || "text-primary"} />' },
      { path: 'src/classes.ts', contents: 'export const classes = `bg-${tone}`' },
    ])
    expect(records.filter(record => record.kind === 'unresolved').map(record => record.path)).toEqual(['src/View.svelte', 'src/classes.ts'])
  })
  it('records compatibility definitions, inline geometry reads, and the dependency build input', () => {
    const records = inventoryLegacyUiConsumers([
      { path: 'src/adapter.css', contents: ':root { --color-primary: var(--of-accent); --radius-field: var(--of-radius-control); }' },
      { path: 'src/Field.svelte', contents: '<div style="border-radius:var(--radius-field)" />' },
      { path: 'package.json', contents: '{"dependencies":{"daisyui":"^5.7.27"}}' },
    ])
    expect(records.map(r => [r.kind, r.token])).toEqual([
      ['compatibility-definition', '--color-primary'], ['compatibility-definition', '--radius-field'],
      ['geometry-variable', '--radius-field'], ['build-input', 'daisyui'],
    ])
  })
  it('finds feedback controls and unconsumed Svelte script producers without treating select-none as a control', () => {
    const records = inventoryLegacyUiConsumers([{ path: 'src/Feedback.svelte', contents: `
      <script>const colorFor = () => 'text-error/80';</script>
      <span class="loading loading-spinner select-none" /><div class="alert alert-error" />
    ` }])
    expect(records.map(r => [r.kind, r.token])).toEqual([
      ['component', 'loading'], ['component', 'loading-spinner'],
      ['component', 'alert'], ['component', 'alert-error'], ['script-candidate', 'text-error/80'],
    ])
  })
  it('supports declarations and reports unparseable sources as unresolved', () => {
    expect(inventoryLegacyUiConsumers([{ path: 'src/api.d.ts', contents: 'export const name: string;' }])).toEqual([])
    expect(inventoryLegacyUiConsumers([{ path: 'src/broken.ts', contents: 'const =' }])).toEqual([
      expect.objectContaining({ path: 'src/broken.ts', kind: 'unresolved', token: expect.stringContaining('Parse error:') }),
    ])
  })
  it('exposes the expanded inventory through the existing command', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'legacy-ui-inventory-'))
    try {
      mkdirSync(resolve(root, 'storybook/fixtures'), { recursive: true })
      writeFileSync(resolve(root, 'storybook/fixtures/View.svelte'), '<div class="text-error" />')
      const result = spawnSync(process.execPath, ['scripts/check-ui-migration-inventory.mjs', '--root', root, '--legacy-inventory'], { encoding: 'utf8', timeout: 4_000 })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout).records).toEqual([expect.objectContaining({
        path: 'storybook/fixtures/View.svelte', token: 'text-error', replacement: 'text-of-danger',
      })])
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('keeps script class candidates visible while excluding comments and text-selection utilities', () => {
    const records = inventoryLegacyUiConsumers([{ path: 'packages/example/classes.ts', contents: `
      // text-error is only a comment
      export const paint = enabled ? 'hover:bg-primary/10' : 'text-base-content'
      export const ordinary = 'select-none native select'
    ` }])
    expect(records.map(r => [r.kind, r.token])).toEqual([
      ['script-candidate', 'hover:bg-primary/10'], ['script-candidate', 'text-base-content'],
      // A script string cannot prove whether "select" is a tag name or a class.
      ['script-component-candidate', 'select'],
    ])
  })
  it('includes CSS selectors, apply, arbitrary variables, geometry aliases and build inputs', () => {
    const records = inventoryLegacyUiConsumers([
      { path: 'src/style.css', contents: '/* .text-error */ .bg-primary { @apply ring-offset-primary; color: var(--color-error); border-radius: var(--radius-field); }' },
      { path: 'src/View.svelte', contents: '<div class="bg-[var(--color-base-100)] text-[var(--of-text)] select-none" />' },
      { path: 'src/app.css', contents: '@plugin "daisyui"; @import "./styles/theme-adapter.css";' },
    ])
    expect(records.map(r => r.token)).toEqual([
      'bg-primary', 'ring-offset-primary', '--color-error', '--radius-field',
      'bg-[var(--color-base-100)]', 'daisyui', './styles/theme-adapter.css',
    ])
    expect(records.find(r => r.token === 'bg-[var(--color-base-100)]')?.replacement).toBe('bg-[var(--of-surface)]')
    expect(records.find(r => r.token === '--radius-field')?.kind).toBe('geometry-variable')
  })
  it('reports unresolved dynamic construction instead of claiming it is migrated', () => {
    const records = inventoryLegacyUiConsumers([{ path: 'plugins/example/View.svelte', contents:
      '<script>let role = "primary"; let external;</script><div class={`bg-${role} ${external}`} />',
    }])
    expect(records).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: 'unresolved', token: 'class={`bg-${role} ${external}`}', subsystem: 'plugins/example',
    })]))
  })
  it('recognizes full directional, ring-offset and gradient colors but excludes ordinary Tailwind classes', () => {
    const records = inventoryLegacyUiConsumers([{ path: 'src/View.svelte', contents:
      '<div class="select-none text-current bg-red-500 border-x-base-300/50 focus:ring-offset-primary from-primary/20 via-secondary to-error/0" />',
    }])
    expect(records.map(r => r.replacement)).toEqual([
      'border-x-of-border/50', 'focus:ring-offset-of-accent', 'from-of-accent/20', 'via-of-control', 'to-of-danger/0',
    ])
  })
  it('preserves conditional, directive and script-held classes with complete variants and opacity', () => {
    const records = inventoryLegacyUiConsumers([{ path: 'src/Example.svelte', contents: `
      <script>let active = false; const paint = active ? 'md:hover:bg-primary/10' : 'text-base-content/70'</script>
      <div class={paint} class:border-l-error={active} />
    ` }])
    expect(records.filter(r => r.kind === 'color').map(r => [r.token, r.replacement])).toEqual([
      ['md:hover:bg-primary/10', 'md:hover:bg-of-accent/10'],
      ['text-base-content/70', 'text-of-text/70'],
      ['border-l-error', 'border-l-of-danger'],
    ])
    expect(records).toEqual(expect.arrayContaining([expect.objectContaining({
      path: 'src/Example.svelte', subsystem: 'host', line: 3,
    })]))
  })
})

// Exercise the real CLI against a small migrated tree; each subprocess has its own deadline.
async function withMigratedFixture(test) {
  const root = mkdtempSync(resolve(tmpdir(), 'ui-inventory-'))
  const seed = (path, contents) => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true })
    writeFileSync(resolve(root, path), contents)
  }
  const run = () => new Promise((resolveRun, rejectRun) => {
    execFile(process.execPath, [resolve('scripts/check-ui-migration-inventory.mjs'), '--root', root],
      { encoding: 'utf8', timeout: 4_000 },
      (error, stdout, stderr) => {
        if (error?.killed) rejectRun(error)
        else resolveRun({ status: error ? error.code : 0, stdout, stderr })
      })
  })
  try {
    for (const path of ['src/components', 'packages/pr-review-ui/src', 'packages/terminal-runtime/src',
      'packages/plugin-sdk/src', 'plugins/file-viewer/src', 'plugins/task-browser/src',
      'plugins/task-schedules/src', 'plugins/github-sync/src', 'plugins/terminal/src']) seed(`${path}/Seed.svelte`, '<div />')
    seed('scripts/ui-migration-allowlist.json', '{}')
    await test({ root, seed, run })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

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

  it('discovers new migrated files and reports every seeded rule through the command', async () => {
    await withMigratedFixture(async ({ seed, run }) => {
      expect((await run()).status).toBe(0)
      const cases = [
        ['src/components/New.svelte', '<button class="btn">Save</button>', 'btn'],
        ['plugins/github-sync/src/New.svelte', '<button style:height="32px">Save</button>', 'height: 32px'],
        ['plugins/terminal/src/new.ts', 'export * from "bits-ui"', 'bits-ui'],
        ['plugins/terminal/src/new.d.cts', 'import Bits = require("bits-ui"); export = Bits;', 'bits-ui'],
        ['src/components/shared/ui/Modal.svelte', '<div />', 'obsolete implementation'],
      ]
      for (const [path, contents] of cases) seed(path, contents)
      const result = await run()
      expect(result.status, result.stderr).toBe(1)
      for (const [path, , diagnostic] of cases) {
        expect(result.stderr.split('\n').some(line => line.includes(`${path}:`) && line.includes(diagnostic))).toBe(true)
      }
    })
  })

  it('accepts a justified exception and rejects it after its source is deleted', async () => {
    await withMigratedFixture(async ({ root, seed, run }) => {
      seed('src/components/Pane.svelte', '<aside class="w-16" />')
      seed('scripts/ui-migration-allowlist.json', JSON.stringify({
        'src/components/Pane.svelte': [{ tag: 'aside', context: 'class="w-16"', tokens: ['w-16'], count: 1, reason: 'Pane width.' }],
      }))
      expect((await run()).status).toBe(0)
      rmSync(resolve(root, 'src/components/Pane.svelte'))
      const result = await run()
      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).toContain('Exception source is missing')
    })
  })

  it('does not transfer exceptions to a renamed source', async () => {
    await withMigratedFixture(async ({ seed, run }) => {
      seed('src/components/RenamedPane.svelte', '<aside class="w-16" />')
      seed('scripts/ui-migration-allowlist.json', JSON.stringify({
        'src/components/Pane.svelte': [{ tag: 'aside', context: 'class="w-16"', tokens: ['w-16'], count: 1, reason: 'Pane width.' }],
      }))
      const result = await run()
      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).toContain('src/components/RenamedPane.svelte:')
      expect(result.stderr).toContain('w-16')
      expect(result.stderr).toContain('Exception source is missing')
    })
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
