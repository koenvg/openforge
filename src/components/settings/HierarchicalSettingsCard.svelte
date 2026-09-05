<script lang="ts">
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import Select from '@openforge-app/plugin-sdk/ui/Select.svelte'
  import { createAttachmentKey, fromAction } from 'svelte/attachments'
  const fitAttachment = createAttachmentKey()
  import Textarea from '@openforge-app/plugin-sdk/ui/Textarea.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  import Switch from '@openforge-app/plugin-sdk/ui/Switch.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import { ChevronsDownUp, ChevronsUpDown, Info, RotateCcw, SlidersHorizontal } from '@lucide/svelte'
  import type { Snippet } from 'svelte'
  import { HIERARCHICAL_SETTINGS } from '../../lib/hierarchicalSettings'
  import type { HierarchicalSettingDef, SettingLevel } from '../../lib/hierarchicalSettings'

  interface Props {
    mode: 'global' | 'project'
    values: Record<string, string>
    overrides?: Record<string, string | null>
    pluginRows?: { id: string; name: string; enabled: boolean }[]
    onChange: (key: string, value: string) => void
    onPluginToggle?: (pluginId: string, enabled: boolean) => void
    onResetToGlobal?: () => void
    onResetSetting?: (key: string) => void
    excludeKeys?: string[]
    /** Render only these keys, in HIERARCHICAL_SETTINGS order. Overrides excludeKeys. */
    includeKeys?: string[]
    /** Card heading. Defaults to the scope name ("Global defaults" / "Project configuration"). */
    title?: string
    /** Text under the heading. Defaults to the inheritance explainer. */
    subtitle?: string
    /** Distinguishes the DOM ids when more than one card renders on a page. */
    sectionId?: string
    providerField?: Snippet
    disabled?: boolean
    resettingKey?: string | null
  }

  let {
    mode,
    values,
    overrides = {},
    pluginRows = [],
    onChange,
    onPluginToggle,
    onResetToGlobal,
    onResetSetting,
    excludeKeys = [],
    includeKeys,
    title,
    subtitle,
    sectionId = 'configuration',
    providerField,
    disabled = false,
    resettingKey = null,
  }: Props = $props()

  const visibleSettings = $derived(
    HIERARCHICAL_SETTINGS.filter((setting) => {
      if (!setting.levels.includes(mode as SettingLevel)) return false
      return includeKeys ? includeKeys.includes(setting.key) : !excludeKeys.includes(setting.key)
    }),
  )

  const helperText = $derived(
    subtitle ??
      (mode === 'global'
        ? 'These defaults apply app-wide. A project can override individual settings without changing other projects.'
        : 'Settings inherited from your global defaults. Change one to override it for this project only; reset it to resume inheriting.'),
  )

  const heading = $derived(title ?? (mode === 'global' ? 'Global defaults' : 'Project configuration'))

  let expandedKeys = $state<Record<string, boolean>>({})

  function currentValue(key: string): string {
    return values[key] ?? ''
  }

  function isOverridden(key: string): boolean {
    return mode === 'project' && overrides[key] != null
  }

  function settingStatus(setting: HierarchicalSettingDef): string {
    return isOverridden(setting.key) ? 'Overridden' : 'Inherited'
  }

  /**
   * Long-form values (prompts) are unreadable in the narrow right-hand control column,
   * so they stack under their label and take the full card width instead.
   */
  function isFullWidth(setting: HierarchicalSettingDef): boolean {
    return setting.control === 'textarea'
  }

  function isExpanded(key: string): boolean {
    return expandedKeys[key] === true
  }

  function toggleExpanded(key: string): void {
    expandedKeys = { ...expandedKeys, [key]: !isExpanded(key) }
  }

  function differsFromDefault(setting: HierarchicalSettingDef): boolean {
    return currentValue(setting.key) !== setting.default
  }

  /**
   * Grows an expanded textarea to fit its whole value so the full prompt is visible in one
   * click, and hands height back to the stylesheet (and to manual resizing) when collapsed.
   * Measuring is deferred so it runs after Svelte has written the new value to the element.
   */
  function fitToContent(node: HTMLTextAreaElement, options: { expanded: boolean; value: string }) {
    let expanded = options.expanded

    function apply(): void {
      if (!expanded) {
        node.style.height = ''
        return
      }
      node.style.height = 'auto'
      node.style.height = `${node.scrollHeight}px`
    }

    const handleInput = (): void => apply()
    node.addEventListener('input', handleInput)
    queueMicrotask(apply)

    return {
      update(next: { expanded: boolean; value: string }): void {
        expanded = next.expanded
        queueMicrotask(apply)
      },
      destroy(): void {
        node.removeEventListener('input', handleInput)
      },
    }
  }
</script>

{#snippet resetToGlobalButton(setting: HierarchicalSettingDef)}
  {#if mode === 'project' && setting.control !== 'plugins' && isOverridden(setting.key)}
    <Button
      type="button"
      variant="ghost" size="sm" class="shrink-0"
      aria-label="Reset {setting.label} to global default"
      disabled={disabled || resettingKey === setting.key}
      onclick={() => onResetSetting?.(setting.key)}
    >
      <RotateCcw size={14} aria-hidden="true" />
      {resettingKey === setting.key ? 'Resetting…' : 'Reset'}
    </Button>
  {/if}
{/snippet}

<Panel
  id="section-{sectionId}"
  aria-labelledby="{sectionId}-heading"
  padding="none"
>
  {#snippet header()}
  <div class="settings-layout flex min-h-14 flex-wrap items-center justify-between gap-3">
    <div class="settings-layout flex min-w-0 items-center gap-3">
      <div class="grid shrink-0 place-items-center text-[var(--of-accent)]" aria-hidden="true">
        <SlidersHorizontal size={18} />
      </div>
      <div class="settings-layout min-w-0">
        <h2 id="{sectionId}-heading" class="m-0 text-sm font-semibold text-[var(--of-text)]">
          {heading}
        </h2>
        <p class="m-0 mt-0.5 text-xs leading-5 text-[var(--of-text-muted)]">{helperText}</p>
      </div>
    </div>

    {#if mode === 'project' && onResetToGlobal}
      <Button
        type="button"
        variant="outline" size="sm"
        disabled={disabled}
        onclick={onResetToGlobal}
        data-testid="reset-to-global"
      >
        <RotateCcw size={15} aria-hidden="true" />
        Reset all overrides
      </Button>
    {/if}
  </div>

  {/snippet}

  <div class="divide-y divide-[var(--of-border)]">
    {#each visibleSettings as setting (setting.key)}
      {@const fullWidth = isFullWidth(setting)}
      <div
        class="settings-layout grid min-h-16 gap-3 px-5 py-3 {fullWidth ? '' : 'md:grid-cols-[minmax(12rem,1fr)_minmax(12rem,0.85fr)] md:items-center'}"
        data-testid="row-{setting.key}"
        data-layout={fullWidth ? 'stacked' : 'split'}
      >
        <div class="settings-layout flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div class="settings-layout min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm font-medium text-[var(--of-text)]">{setting.label}</span>
              {#if mode === 'project' && setting.control !== 'plugins'}
                <Badge variant={isOverridden(setting.key) ? 'warning' : 'success'} data-testid="status-{setting.key}">
                  {settingStatus(setting)}
                </Badge>
              {/if}
            </div>
            <p class="m-0 mt-0.5 text-xs leading-5 text-[var(--of-text-muted)] {fullWidth ? 'max-w-4xl' : ''}">{setting.description}</p>
          </div>

          {#if fullWidth}
            <!-- Anchored beside the label so the toggle stays put while the field grows below it. -->
            <div class="flex shrink-0 flex-wrap items-center gap-1">
              <Button
                type="button"
                variant="ghost" size="sm"
                aria-expanded={isExpanded(setting.key)}
                aria-controls="setting-{setting.key}"
                aria-label="{isExpanded(setting.key) ? 'Collapse' : 'Expand'} {setting.label}"
                onclick={() => toggleExpanded(setting.key)}
                data-testid="expand-{setting.key}"
              >
                {#if isExpanded(setting.key)}
                  <ChevronsDownUp size={14} aria-hidden="true" />
                  Collapse
                {:else}
                  <ChevronsUpDown size={14} aria-hidden="true" />
                  Expand
                {/if}
              </Button>
              {#if mode === 'global' && differsFromDefault(setting)}
                <Button
                  type="button"
                  variant="ghost" size="sm"
                  aria-label="Reset {setting.label} to default"
                  disabled={disabled}
                  onclick={() => onChange(setting.key, setting.default)}
                  data-testid="reset-default-{setting.key}"
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  Reset to default
                </Button>
              {/if}
              {@render resetToGlobalButton(setting)}
            </div>
          {/if}
        </div>

        <div class="settings-layout flex min-w-0 gap-3 {fullWidth ? 'flex-col items-stretch' : 'items-center justify-between md:justify-end'}">
          {#if setting.notice}
            <!-- Sits above the field, not in the description, because it states what
                 the value can and cannot do — easy to miss once the field is expanded. -->
            <Panel padding="none" variant="subtle">
              <p
              class="m-0 flex items-start gap-1.5 px-2.5 py-1.5 text-xs leading-5 text-[var(--of-text-secondary)]"
              data-testid="notice-{setting.key}"
            >
              <Info size={14} class="mt-0.5 shrink-0 text-[var(--of-warning)]" aria-hidden="true" />
              <span>{setting.notice}</span>
            </p>
            </Panel>
          {/if}
          {#if setting.control === 'toggle'}
            <div class="flex items-center gap-2">
              <Switch label={setting.label} hideLabel
                checked={currentValue(setting.key) === 'true'}
                disabled={disabled}
                onchange={(event) => onChange(setting.key, event.currentTarget.checked ? 'true' : 'false')}
                data-testid={setting.key}
              />
              <span class="settings-layout min-w-6 text-xs text-[var(--of-text-secondary)]">{currentValue(setting.key) === 'true' ? 'On' : 'Off'}</span>
            </div>
          {:else if setting.control === 'select'}
            {#if setting.key === 'ai_provider' && providerField}
              <div class="settings-layout min-w-0 flex-1 md:max-w-md">{@render providerField()}</div>
            {:else}
              <Select
                label={setting.label} hideLabel
                class="w-full md:max-w-64"
                value={currentValue(setting.key)}
                {disabled}
                onValueChange={(value) => onChange(setting.key, value)}
                testId={setting.key}
                options={setting.options ?? []}
              />
            {/if}
          {:else if setting.control === 'text'}
            <TextField label={setting.label} hideLabel
              type="text"
              class="w-full md:max-w-64"
              value={currentValue(setting.key)}
              disabled={disabled}
              oninput={(event) => onChange(setting.key, event.currentTarget.value)}
              data-testid={setting.key}
            />
          {:else if setting.control === 'number'}
            <TextField label={setting.label} hideLabel
              type="number"
              class="w-full md:max-w-64"
              value={currentValue(setting.key)}
              disabled={disabled}
              oninput={(event) => onChange(setting.key, event.currentTarget.value)}
              data-testid={setting.key}
            />
          {:else if setting.control === 'textarea'}
            <Textarea label={setting.label} hideLabel
              id="setting-{setting.key}"
              class="w-full resize-y"
              style="min-height: 12rem; font-family: var(--of-font-mono); font-size: var(--of-text-xs); line-height: var(--of-line-height-md)"
              value={currentValue(setting.key)}
              disabled={disabled}
              oninput={(event) => onChange(setting.key, event.currentTarget.value)}
              data-testid={setting.key}
              {...{ [fitAttachment]: fromAction(fitToContent, () => ({ expanded: isExpanded(setting.key), value: currentValue(setting.key) })) }}
            ></Textarea>
          {:else if setting.control === 'plugins'}
            <div class="flex w-full flex-col gap-2">
              {#if pluginRows.length === 0}
                <span class="text-xs text-[var(--of-text-muted)]">No plugins installed</span>
              {:else}
                {#each pluginRows as plugin (plugin.id)}
                  <div class="flex items-center justify-between gap-4">
                    <span class="text-sm">{plugin.name}</span>
                    <Switch label="Toggle plugin default: {plugin.name}" hideLabel
                      checked={plugin.enabled}
                      disabled={disabled}
                      onchange={(event) => onPluginToggle?.(plugin.id, event.currentTarget.checked)}
                      data-testid="plugin-default-{plugin.id}"
                    />
                  </div>
                {/each}
              {/if}
            </div>
          {/if}

          {#if !fullWidth}
            {@render resetToGlobalButton(setting)}
          {/if}
        </div>
      </div>
    {/each}
  </div>
</Panel>
