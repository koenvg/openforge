<script lang="ts">
  import TerminalTaskPaneSurface from '../../packages/terminal-runtime/src/TerminalTaskPaneSurface.svelte'
  import TerminalTabsSurface from '../../packages/terminal-runtime/src/TerminalTabsSurface.svelte'
  import TerminalProjectView from '../../plugins/terminal/src/TerminalProjectView.svelte'
  import type { TerminalSurfaceAdapter } from '../../packages/terminal-runtime/src/terminalSurfaceAdapter'

  let { adapter }: { adapter: TerminalSurfaceAdapter } = $props()
</script>

<main>
  <section aria-label="Running terminal" class="terminal-fixture-running">
    <TerminalTabsSurface {adapter} taskId="presentation" workspacePath="/fixture" shortcutHintsVisible={true} />
  </section>
  <section aria-label="Running plugin terminal" class="terminal-fixture-running">
    <TerminalProjectView projectId="running-fixture" projectName="Running fixture" projectPath="/fixture" />
  </section>
  <section aria-label="Loading terminal" class="feedback">
    <TerminalTaskPaneSurface {adapter} taskId="loading" shortcutHintsVisible={false} />
  </section>
  <section aria-label="Unavailable project" class="feedback">
    <TerminalProjectView projectId="fixture" projectName="Fixture" />
  </section>
</main>

<style>
  main { font-family: var(--of-font-sans); color: var(--of-text); background: var(--of-canvas); }
  section { min-width: 0; }
  .terminal-fixture-running { height: 280px; }
  .feedback { height: 200px; }
</style>
