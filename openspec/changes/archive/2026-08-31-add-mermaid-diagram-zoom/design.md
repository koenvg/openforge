## Context

The shared `MarkdownContent.svelte` component renders Markdown with `{@html}` and then asks `mermaid.ts` to find Mermaid code fences, render them, sanitize the generated SVG, and replace each source block inside a stable wrapper. Theme observation reruns this pipeline when the application theme changes. The wrapper currently constrains presentation to the Markdown content area.

The feature must work in every consumer of the shared plugin SDK renderer. App-level image preview wiring is not a suitable integration point because several Markdown surfaces import the SDK component directly, and the existing review image lightbox only supports fitted or actual-size raster images. See `proposal.md` for motivation and `specs/mermaid-diagram-zoom/spec.md` for observable behavior.

## Goals / Non-Goals

**Goals:**

- Keep Mermaid rendering, sanitization, and preview behavior owned by the plugin SDK.
- Reuse the existing modal focus management and application visual conventions.
- Keep inline diagram dimensions stable while allowing detailed inspection in a separate viewport.
- Make zoom state deterministic and independently testable.
- Update an open preview when theme-driven Mermaid rerendering replaces its SVG.

**Non-Goals:**

- Changing Mermaid syntax, configuration, or source validation.
- Adding drag-to-pan, wheel zoom, pinch gestures, diagram editing, downloading, or persistence of zoom state.
- Generalizing the existing review image lightbox as part of this change.
- Adding surface-specific integration code for individual Markdown consumers.

## Decisions

### Keep expansion and preview ownership in the plugin SDK

`MarkdownContent.svelte` will own the active preview state and conditionally render a dedicated Mermaid preview component built on the SDK `Modal.svelte`. `mermaid.ts` will continue to own the generated diagram DOM and will add a semantic expand button only after a diagram renders successfully.

The Markdown root's existing delegated click handling will recognize the expand button, focus it, identify its stable diagram wrapper, and capture the wrapper's sanitized SVG for the preview. Native button behavior provides Enter and Space activation without custom key simulation. Failed render wrappers never receive the action.

This keeps behavior consistent across PR descriptions, comments, rich Markdown diffs, task prompts, and plugin surfaces. An app-level callback was rejected because it would require every consumer to opt in and would leave direct SDK consumers inconsistent. Treating the entire diagram as a button was rejected because it would conflict with diagram scrolling and provide a weak focus target.

### Reuse the sanitized SVG already displayed inline

The preview will receive only the root SVG from the successfully rendered wrapper, not Mermaid source or arbitrary Markdown HTML. It will display that sanitized SVG through an internal component and override only root sizing. Zoom operations will never rerun Mermaid or modify child SVG content.

Each wrapper remains the identity of a diagram for the lifetime of the current Markdown DOM. After a theme rerender completes, `MarkdownContent.svelte` will refresh the active preview from the current SVG when its wrapper is still connected. If content replacement removes the active wrapper, the preview will close.

This avoids a second Mermaid render whenever the user expands a diagram and keeps the preview byte-for-byte aligned with the accepted inline SVG. Rendering the Mermaid source again inside the modal was rejected because it duplicates work and introduces another asynchronous render lifecycle. Converting the SVG to a data URL was rejected because it complicates security review, theme updates, and sizing.

### Model zoom as fit mode or manual percentage

The preview will use a small zoom state module with two modes:

- `fit`: derive scale from the SVG view box and the measured preview viewport.
- `manual`: apply an explicit percentage to the SVG's intrinsic view-box width and height.

Manual zoom will use 25 percentage-point steps from 25 percent through 400 percent. Reset selects 100 percent. Zooming in or out from fit mode starts from the current computed fit scale and enters manual mode. Fit mode recomputes when the preview viewport changes size through one `ResizeObserver` owned and released by the preview component.

The SVG root will receive explicit rendered width and height, while its content remains vector based. The scroll viewport will center content that fits and expose native horizontal and vertical scrolling when it does not. CSS transforms were rejected because transformed pixels do not update scroll extents reliably. Inline zoom was rejected because it would change document height and create nested scrolling in compact comments and rich diffs.

### Use explicit controls and scoped keyboard shortcuts

The modal header will contain zoom out, current percentage or fit status, zoom in, reset, fit-to-window, and close controls. Icon buttons will have descriptive accessible names, titles, visible focus styles, disabled boundary states, and target sizes consistent with existing modal controls. A polite live status will expose zoom mode and percentage changes to assistive technology.

While focus is within the modal, `+` or `=` zooms in, `-` zooms out, `0` resets to 100 percent, and `f` selects fit mode. `Modal.svelte` continues to handle Escape, focus trapping, and return focus. Shortcut handling will ignore modified key combinations and events already handled by an interactive control.

Hidden hover-only controls were rejected because they are hard to discover and inaccessible to touch and keyboard users. The inline expand action will remain visible in the diagram frame.

### Keep zoom logic separate from DOM orchestration

Scale clamping, step transitions, fit-scale calculation, control availability, and display labels will live in pure TypeScript helpers. The Svelte preview component will handle measurement and rendering, while `mermaid.ts` will remain responsible for Mermaid rendering and successful-wrapper decoration.

This split allows boundary and mode transitions to be tested without browser geometry. DOM tests will cover delegation, modal lifecycle, keyboard behavior, focus return, theme refresh, and failure behavior.

## Risks / Trade-offs

- [The preview can become stale after Markdown or theme rerendering] -> Track the originating wrapper and synchronize the active SVG only after the current render run completes; close the preview if that wrapper is removed.
- [Large diagrams can create a large scrollable element at maximum zoom] -> Cap manual zoom at 400 percent and keep only one preview mounted at a time.
- [Viewport measurement is unavailable or reports zero during initial layout] -> Keep the preview in fit mode, wait for a valid observer measurement, and avoid applying invalid dimensions.
- [Injected controls and delegated events can drift apart] -> Define shared class or data-attribute constants in the Mermaid module and test successful, failed, and multiple-diagram cases.
- [SVG root sizing rules can conflict with inline Mermaid styles] -> Scope preview sizing rules to the modal and override only root width, height, and max-width properties.
- [Keyboard shortcuts can interfere with platform commands] -> Scope them to the open modal, reject modifier combinations, and retain visible button alternatives for every operation.

## Migration Plan

1. Add the zoom state helpers and preview component without changing existing Markdown call sites.
2. Decorate successfully rendered Mermaid wrappers with the expand action and connect delegated activation to the preview.
3. Add scoped preview styles and update unit and visual fixtures.
4. Validate plugin SDK tests and build, PR review UI static checks and visual tests, root renderer tests, and lint checks affected by the shared component.

The change is additive and requires no data migration or feature flag. Rollback consists of removing the expand decoration, preview component, and related styles; existing inline Mermaid rendering and source fallbacks remain intact.
