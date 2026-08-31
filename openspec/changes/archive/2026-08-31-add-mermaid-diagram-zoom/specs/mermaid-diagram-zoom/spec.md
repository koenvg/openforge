## Purpose

Provide a consistent way to enlarge and inspect Mermaid diagrams rendered from Markdown while keeping the surrounding document readable and preserving safe SVG rendering.

## ADDED Requirements

### Requirement: Rendered diagrams can be expanded
The system SHALL provide a keyboard-operable expand action for each successfully rendered Mermaid diagram in shared Markdown content. Activating the action SHALL open that diagram in a near-fullscreen preview without changing the size of the inline diagram.

#### Scenario: Expand a rendered diagram
- **WHEN** a user activates the expand action for a successfully rendered Mermaid diagram
- **THEN** the system opens a near-fullscreen preview containing that diagram
- **AND** the inline Markdown layout remains unchanged

#### Scenario: Multiple diagrams remain independent
- **WHEN** Markdown content contains more than one successfully rendered Mermaid diagram
- **THEN** each diagram has its own expand action
- **AND** activating an action opens the corresponding diagram

#### Scenario: Failed diagram has no preview action
- **WHEN** a Mermaid diagram is empty, unsafe, or cannot be rendered
- **THEN** the system continues to show the existing source fallback and error message
- **AND** the system does not offer an expand action for that diagram

### Requirement: Expanded diagrams support controlled zooming
The expanded preview SHALL start fitted within the available viewport and SHALL provide zoom in, zoom out, reset-to-100-percent, and fit-to-window controls. Zoom SHALL remain within defined minimum and maximum limits, and controls that would exceed a limit SHALL be disabled.

#### Scenario: Preview starts fitted
- **WHEN** an expanded preview opens
- **THEN** the complete diagram is visible within the available preview viewport whenever its aspect ratio permits
- **AND** the preview indicates that fit-to-window is active

#### Scenario: Zoom in for detail
- **WHEN** a user activates zoom in below the maximum zoom limit
- **THEN** the diagram becomes larger
- **AND** the preview reports the resulting zoom percentage

#### Scenario: Zoom out for context
- **WHEN** a user activates zoom out above the minimum zoom limit
- **THEN** the diagram becomes smaller
- **AND** the preview reports the resulting zoom percentage

#### Scenario: Reset to actual size
- **WHEN** a user activates reset-to-100-percent
- **THEN** the diagram is displayed at 100 percent scale
- **AND** fit-to-window is no longer active

#### Scenario: Fit after manual zoom
- **WHEN** a user activates fit-to-window after manually changing the zoom level
- **THEN** the system scales the complete diagram to the available preview viewport
- **AND** the preview indicates that fit-to-window is active

#### Scenario: Zoomed diagram exceeds the viewport
- **WHEN** the scaled diagram is wider or taller than the available preview viewport
- **THEN** the user can scroll in each overflowing direction to inspect the complete diagram
- **AND** the diagram remains rendered as scalable vector content

### Requirement: Diagram preview is accessible from the keyboard
The system SHALL expose descriptive names and visible focus states for all preview controls. While the preview is open, the system SHALL support keyboard shortcuts for zoom in, zoom out, reset-to-100-percent, fit-to-window, and closing the preview.

#### Scenario: Open and operate without a pointer
- **WHEN** a keyboard user focuses a diagram's expand action and activates it
- **THEN** focus moves into the preview
- **AND** every zoom and close operation can be completed from the keyboard

#### Scenario: Close the preview
- **WHEN** a user closes the preview with its close control or the Escape key
- **THEN** the preview closes
- **AND** focus returns to the expand action that opened it

#### Scenario: Zoom shortcut announces state
- **WHEN** a keyboard shortcut changes the zoom mode or percentage
- **THEN** assistive technology can determine the updated zoom state

### Requirement: Preview preserves rendering safety and theme behavior
The expanded preview SHALL use the same sanitized Mermaid SVG content and active application theme as the inline diagram. Expanding or zooming a diagram MUST NOT enable external resource loading or restore content removed during sanitization.

#### Scenario: Open a sanitized diagram
- **WHEN** a successfully rendered diagram is expanded
- **THEN** the preview contains only the sanitized SVG content accepted for the inline diagram
- **AND** the preview does not load external resources from the Mermaid source or generated SVG

#### Scenario: Open under the active theme
- **WHEN** a diagram is expanded in a light or dark application theme
- **THEN** the preview uses the matching Mermaid theme

#### Scenario: Theme changes while preview is open
- **WHEN** the application theme changes while an expanded preview is open
- **THEN** the preview updates to the matching Mermaid theme without reopening

### Requirement: Zoom is available across shared Markdown surfaces
The system SHALL provide the Mermaid expand and zoom interaction wherever the shared Markdown renderer displays a successfully rendered Mermaid diagram.

#### Scenario: Diagram rendered on different Markdown surfaces
- **WHEN** a supported application or plugin surface renders Mermaid content through the shared Markdown renderer
- **THEN** the rendered diagram offers the same expand and zoom behavior without requiring surface-specific integration
