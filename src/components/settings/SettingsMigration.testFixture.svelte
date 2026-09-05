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
  const customTheme = registry.registerContributedTheme({
    ...DARK_THEME,
    id: 'com.example.ink:ink',
    label: 'Ink',
    tokens: { ...DARK_THEME.tokens, field: '#202c30', accent: '#7de3cb', radiusControl: '8px' },
  }, { pluginId: 'com.example.ink', generation: 1 })
  const { availableThemes, selectedTheme } = registry
  adapter.apply(LIGHT_THEME)

  let projectName = $state('OpenForge')
  let projectPath = $state('/workspace/openforge')
  let runCommand = $state('pnpm dev')
  let terminalFont = $state<TerminalFontId>('jetbrains-mono')
  let terminalFontSize = $state(13)
  let values = $state({ use_worktrees: 'true', task_id_prefix: 'OF', pr_review_guidance: 'Review changes and explain risks.' })

  onDestroy(() => { void customTheme.dispose() })
</script>

<main class="mx-auto flex max-w-5xl flex-col gap-5 p-6" aria-label="Settings migration fixture">
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
