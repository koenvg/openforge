## Why

Mermaid diagrams are confined to the Markdown content width, which can make detailed diagrams hard to read. Users need a consistent way to enlarge and inspect diagrams without disrupting the surrounding document layout.

## What Changes

- Add an expand action to successfully rendered Mermaid diagrams in Markdown content.
- Open expanded diagrams in a near-fullscreen preview with fit-to-window, zoom in, zoom out, and reset controls.
- Support keyboard operation and scrolling for diagrams that exceed the preview viewport.
- Preserve sanitized SVG rendering, theme-aware colors, and the existing source fallback for diagrams that cannot be rendered.
- Make the interaction available wherever the shared plugin SDK Markdown renderer is used.

## Capabilities

### New Capabilities

- `mermaid-diagram-zoom`: Expandable, accessible Mermaid diagram previews with controlled zooming and panning.

### Modified Capabilities

None.

## Impact

- Affects Mermaid rendering and Markdown presentation in `packages/plugin-sdk`.
- Affects shared Markdown styling in `src/app.css` and the visual fixtures that cover Mermaid diagrams.
- Requires unit and visual coverage for successful rendering, zoom controls, keyboard interaction, theme changes, and render fallbacks.
- Does not change Markdown syntax, persisted data, IPC contracts, or external dependencies.
