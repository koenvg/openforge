<script lang="ts">
  import { Folder, Plug, Brain, KeyRound, Zap } from 'lucide-svelte'

  interface Props {
    activeSection: string
    onNavigate: (sectionId: string) => void
    hasProject: boolean
  }

  let { activeSection, onNavigate, hasProject }: Props = $props()

  const navItems: { id: string; label: string; Icon: typeof Folder; projectOnly: boolean }[] = [
    { id: 'general', label: 'General', Icon: Folder, projectOnly: true },
    { id: 'integrations', label: 'Integrations', Icon: Plug, projectOnly: true },
    { id: 'ai', label: 'AI', Icon: Brain, projectOnly: false },
    { id: 'credentials', label: 'Credentials', Icon: KeyRound, projectOnly: false },
    { id: 'actions', label: 'Actions', Icon: Zap, projectOnly: true },
  ]

  function handleNavigate(sectionId: string) {
    onNavigate(sectionId)
  }
</script>

<div class="w-[220px] bg-base-100 border-r border-base-300 flex flex-col py-6 px-4 shrink-0">
  <div class="text-xs font-semibold text-base-content/50 uppercase tracking-wider mb-6">
    Settings
  </div>

  <nav class="flex flex-col gap-1">
    {#each navItems as { id, label, Icon, projectOnly }}
      {@const isActive = activeSection === id}
      {@const isDimmed = projectOnly && !hasProject}
      <a
        href="#section-{id}"
        role="link"
        class="flex items-center gap-3 px-3 py-2 rounded transition-colors {isActive
          ? 'border-l-[3px] border-l-primary bg-primary/5 text-primary'
          : 'text-base-content/50'} {isDimmed ? 'opacity-50 pointer-events-none' : ''}"
        onclick={(e) => {
          e.preventDefault()
          handleNavigate(id)
        }}
      >
        <Icon size={20} class="shrink-0" />
        <span class="text-sm font-medium">{label}</span>
      </a>
    {/each}
  </nav>
</div>
