<script lang="ts">
  type WidgetConfig = {
    lineNumber: number
    side: number
    initiallyOpen?: boolean
  }

  type Props = {
    diffFile?: unknown
    onAddWidgetClick?: (lineNumber: number, side: number) => void
    renderWidgetLine?: (props: {
      lineNumber: number
      side: number
      diffFile: unknown
      onClose: () => void
    }) => unknown
  }

  const initialWidgetConfig = (globalThis as typeof globalThis & {
    __diffViewerTestWidget?: WidgetConfig
  }).__diffViewerTestWidget
  let { diffFile, onAddWidgetClick, renderWidgetLine }: Props = $props()
  let widgetOpen = $state(initialWidgetConfig?.initiallyOpen !== false)

  const widgetConfig = $derived((globalThis as typeof globalThis & {
    __diffViewerTestWidget?: WidgetConfig
  }).__diffViewerTestWidget)
</script>

<div data-testid="mock-diff-view">
  {#if widgetConfig?.initiallyOpen === false}
    <button
      type="button"
      aria-label="Add comment to source diff line {widgetConfig.lineNumber}"
      onmousedown={() => {
        onAddWidgetClick?.(widgetConfig.lineNumber, widgetConfig.side)
        widgetOpen = true
      }}
    >+</button>
  {/if}
  {#if widgetConfig && widgetOpen && renderWidgetLine}
    {@render renderWidgetLine({
      lineNumber: widgetConfig.lineNumber,
      side: widgetConfig.side,
      diffFile,
      onClose: () => { widgetOpen = false },
    })}
  {/if}
</div>
