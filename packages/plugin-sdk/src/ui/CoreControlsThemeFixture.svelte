<script lang="ts">
  import { createRawSnippet } from 'svelte'
  import Badge from './Badge.svelte'
  import Button from './Button.svelte'
  import Checkbox from './Checkbox.svelte'
  import IconButton from './IconButton.svelte'
  import Panel from './Panel.svelte'
  import Switch from './Switch.svelte'
  import Textarea from './Textarea.svelte'
  import TextField from './TextField.svelte'

  type ThemeFixture = 'light' | 'dark' | 'custom'

  let { theme, invalid = false }: { theme: ThemeFixture; invalid?: boolean } = $props()

  const icons = createRawSnippet(() => ({ render: () => '<span aria-hidden="true">↻</span>' }))
  const themeColors: Record<ThemeFixture, string> = {
    light: '#2947ff;--of-on-accent:#ffffff;--of-surface:#ffffff;--of-text:#17191d',
    dark: '#8494ff;--of-on-accent:#0d0f14;--of-surface:#14171d;--of-text:#f4f6f8',
    custom: '#8b3dff;--of-on-accent:#ffffff;--of-surface:#fff8ef;--of-text:#32134d',
  }

  let themeStyle = $derived(`
    --of-accent:${themeColors[theme]};
    --of-accent-hover:#193bcc;--of-accent-pressed:#102688;
    --of-border:#777;--of-border-strong:#555;--of-border-interactive:#666;
    --of-control:#ddd;--of-control-hover:#ccc;--of-control-pressed:#bbb;
    --of-control-disabled:#aaa;--of-control-text:var(--of-text);--of-control-text-disabled:#666;
    --of-field:var(--of-surface);--of-field-hover:var(--of-surface);--of-field-invalid:#fee;
    --of-focus-ring:var(--of-accent);--of-danger:#b42318;--of-on-danger:#fff;
    --of-info:#175cd3;--of-info-subtle:#eff8ff;--of-success:#067647;--of-success-subtle:#ecfdf3;
    --of-warning:#b54708;--of-warning-subtle:#fffaeb;--of-danger-subtle:#fef3f2;
    --of-status-neutral:#667085;--of-status-neutral-subtle:#f2f4f7;--of-on-status-neutral:#344054;
    --of-status-danger:#912018;--of-icon:var(--of-text);--of-text-muted:#667085;
    --of-surface-subtle:var(--of-surface);--of-surface-raised:var(--of-surface);
    --of-border-width:1px;--of-focus-width:2px;--of-radius-control:3px;--of-radius-container:2px;
    --of-radius-round:999px;--of-control-height-compact:1.75rem;--of-control-height:2.25rem;
    --of-control-height-touch:2.75rem;--of-space1:.25rem;--of-space2:.5rem;--of-space3:.75rem;
    --of-space4:1rem;--of-space5:1.25rem;--of-font-sans:system-ui;
    --of-text-xs:.75rem;--of-text-sm:.875rem;--of-text-md:1rem;
    --of-line-height-xs:1.25;--of-line-height-sm:1.4;--of-line-height-md:1.5;
    --of-weight-medium:500;--of-shadow-raised:0 2px 4px rgb(0 0 0 / 15%);
    --of-duration-press:80ms;--of-duration-fast:140ms;--of-ease-standard:ease;
    --of-ease-enter:ease-out;
  `)
</script>

<div data-theme-fixture={theme} style={themeStyle}>
  <div role="group" aria-label="Button"><Button type="button">Run review</Button></div>
  <div role="group" aria-label="IconButton"><IconButton label="Refresh tasks">{@render icons()}</IconButton></div>
  <div role="group" aria-label="TextField"><TextField label="Repository name" value="openforge" {invalid} /></div>
  <div role="group" aria-label="Textarea"><Textarea label="Review note" value="Ready" {invalid} /></div>
  <div role="group" aria-label="Checkbox"><label><Checkbox checked /> Include generated files</label></div>
  <div role="group" aria-label="Switch"><Switch label="Enable notifications" checked /></div>
  <Badge role="status" variant="success">Ready</Badge>
  <Panel aria-label="Review summary"><p>Two files changed.</p></Panel>
  {#each ['primary', 'danger'] as const as variant}
    {#each [false, true] as disabled}
      <div>
        <Button {variant} {disabled}>{variant} Button{disabled ? ' disabled' : ''}</Button>
        <IconButton {variant} {disabled} label={`${variant} IconButton${disabled ? ' disabled' : ''}`}>{@render icons()}</IconButton>
      </div>
    {/each}
  {/each}
</div>
