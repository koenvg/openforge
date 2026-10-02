<script lang="ts">
  import { onDestroy } from 'svelte'
  import { DARK_THEME, LIGHT_THEME } from '../../lib/themeContract'
  import { createThemeRegistry } from '../../lib/themeRegistry'
  import { createThemeDocumentAdapter } from '../../lib/themeDocumentAdapter'
  import SettingsPreferencesCard from './SettingsPreferencesCard.svelte'
  import SettingsGeneralCard from './SettingsGeneralCard.svelte'
  import HierarchicalSettingsCard from './HierarchicalSettingsCard.svelte'
  import type { TerminalFontId } from '../../lib/terminalFont'

  const adapter = createThemeDocumentAdapter(document.documentElement)
  const registry = createThemeRegistry({ applyTheme: adapter.apply })
  let copperTheme = registry.registerContributedTheme({
    ...LIGHT_THEME, id: 'com.example.copper:copper', label: 'Copper',
    tokens: { ...LIGHT_THEME.tokens, surface: '#fbefd9', text: '#312419', accent: '#a34621', radiusControl: '12px' },
  }, { pluginId: 'com.example.copper', generation: 1 })
  const customTheme = registry.registerContributedTheme({
    ...DARK_THEME,
    id: 'com.example.ink:ink',
    label: 'Ink',
    tokens: { ...DARK_THEME.tokens, field: '#202c30', accent: '#7de3cb', radiusControl: '8px' },
  }, { pluginId: 'com.example.ink', generation: 1 })
  const { availableThemes, selectedTheme } = registry
  adapter.apply(LIGHT_THEME)
  let copperGeneration = 1
  async function reloadCopper() {
    await registry.withPluginReload('com.example.copper', async () => {
      await copperTheme.dispose()
      copperTheme = registry.registerContributedTheme({
        ...LIGHT_THEME, id: 'com.example.copper:copper', label: 'Copper',
        tokens: { ...LIGHT_THEME.tokens, surface: '#e8ddfa', text: '#29133f', accent: '#6439a4', radiusControl: '12px' },
      }, { pluginId: 'com.example.copper', generation: ++copperGeneration })
      return true
    })
  }

  let projectName = $state('OpenForge')
  let projectPath = $state('/workspace/openforge')
  let runCommand = $state('pnpm dev')
  let terminalFont = $state<TerminalFontId>('jetbrains-mono')
  let terminalFontSize = $state(13)
  let values = $state({ use_worktrees: 'true', task_id_prefix: 'OF', pr_review_guidance: 'Review changes and explain risks.' })

  onDestroy(() => { void customTheme.dispose(); void copperTheme.dispose() })
</script>

<main class="mx-auto flex max-w-5xl flex-col gap-5 p-6" aria-label="Settings migration fixture">
  <button data-testid="reload-copper" hidden onclick={() => { void reloadCopper() }}>Reload Copper palette</button>
  <div data-testid="semantic-colors" class="text-of-text border border-of-border bg-of-surface">
    Semantic utility text
    <span data-testid="semantic-accent" class="text-of-accent bg-of-accent border border-of-accent">Accent</span>
    <span data-testid="semantic-on-accent" class="text-of-on-accent">On accent</span>
  </div>
  <button data-testid="semantic-interaction" class="bg-of-surface text-of-text hover:bg-of-accent/10 active:bg-of-accent/20">Opaque child</button>
  <div data-testid="semantic-compatibility" class="absolute text-of-text border border-of-border/50 bg-of-surface" aria-hidden="true"></div>
  <SettingsPreferencesCard availableThemes={$availableThemes} selectedThemeId={$selectedTheme.id}
    onThemeChange={(id) => { void registry.selectTheme(id) }}
    {terminalFont} onTerminalFontChange={(font) => { terminalFont = font }}
    {terminalFontSize} onTerminalFontSizeChange={(size) => { terminalFontSize = size }} />
  <SettingsGeneralCard {projectName} {projectPath} {runCommand} disabled={false}
    onProjectNameChange={(value) => { projectName = value }}
    onProjectPathChange={(value) => { projectPath = value }}
    onRunCommandChange={(value) => { runCommand = value }} />
  <HierarchicalSettingsCard mode="project" {values} includeKeys={['use_worktrees', 'task_id_prefix', 'pr_review_guidance']}
    onChange={(key, value) => { values = { ...values, [key]: value } }} />
</main>
