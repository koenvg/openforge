import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findUnusedSvelteImports } from './check-svelte-unused-imports.mjs'

describe('findUnusedSvelteImports', () => {
  it('reports stale imports from Svelte script blocks', () => {
    const source = `<script lang="ts">
      import UsedComponent from './UsedComponent.svelte'
      import UnusedComponent from './UnusedComponent.svelte'
      import { usedHelper, unusedHelper } from './helpers'

      const value = usedHelper()
    </script>

    <UsedComponent {value} />`

    expect(findUnusedSvelteImports(source).map((item) => item.name)).toEqual([
      'UnusedComponent',
      'unusedHelper',
    ])
  })

  it('counts Svelte store auto-subscriptions and type references as usage', () => {
    const source = `<script lang="ts">
      import type { Component, Snippet } from 'svelte'
      import { activeProjectId } from './stores'

      interface Props {
        children?: Snippet
      }

      function getComponent(): Component | null {
        return null
      }
    </script>

    {#if $activeProjectId}
      <p>Project selected</p>
    {/if}`

    expect(findUnusedSvelteImports(source)).toEqual([])
  })

  it('does not count comments as usage', () => {
    const source = `<script lang="ts">
      import CommentOnly from './CommentOnly.svelte'
      import TemplateCommentOnly from './TemplateCommentOnly.svelte'

      // CommentOnly appears in documentation.
    </script>

    <!-- TemplateCommentOnly appears in documentation. -->`

    expect(findUnusedSvelteImports(source).map((item) => item.name)).toEqual([
      'CommentOnly',
      'TemplateCommentOnly',
    ])
  })

  it('does not count string literals as usage', () => {
    const source = `<script lang="ts">
      import ScriptStringOnly from './ScriptStringOnly.svelte'
      import AttributeStringOnly from './AttributeStringOnly.svelte'

      const label = 'ScriptStringOnly'
    </script>

    <p title="AttributeStringOnly">{label}</p>`

    expect(findUnusedSvelteImports(source).map((item) => item.name)).toEqual([
      'ScriptStringOnly',
      'AttributeStringOnly',
    ])
  })

  it('does not count references to shadowing script or template bindings as import usage', () => {
    const source = `<script lang="ts">
      import ScriptShadowed from './ScriptShadowed.svelte'
      import TemplateShadowed from './TemplateShadowed.svelte'

      function render(ScriptShadowed: string) {
        return ScriptShadowed
      }

      const values = ['local value']
    </script>

    <p>{render('local value')}</p>
    {#each values as TemplateShadowed}
      <p>{TemplateShadowed}</p>
    {/each}`

    expect(findUnusedSvelteImports(source).map((item) => item.name)).toEqual([
      'ScriptShadowed',
      'TemplateShadowed',
    ])
  })

  it('reports unused TypeScript imports through the command line', () => {
    const fixtureDir = mkdtempSync(path.join(tmpdir(), 'openforge-svelte-imports-'))
    const fixturePath = path.join(fixtureDir, 'Component.svelte')
    const scriptPath = fileURLToPath(new URL('./check-svelte-unused-imports.mjs', import.meta.url))

    try {
      writeFileSync(
        fixturePath,
        `<script context="module" lang="ts">
  import type { ModuleType } from './types'
</script>
<script lang="ts">
  import UsedComponent, { usedHelper, unusedHelper as staleHelper } from './helpers'
  import * as staleNamespace from './namespace'
  const value: ModuleType = usedHelper()
</script>
<UsedComponent {value} />`,
      )

      const result = spawnSync(process.execPath, [scriptPath, fixturePath], {
        cwd: fixtureDir,
        encoding: 'utf8',
      })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Unused Svelte imports found:')
      expect(result.stderr).toContain("Component.svelte:5: unused import 'staleHelper'")
      expect(result.stderr).toContain("Component.svelte:6: unused import 'staleNamespace'")
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  })
})
