# Studio Workshop Themes Specification

## Purpose

Defines the selectable Studio and Workshop visual styles, their light and dark variants, and the consistent, accessible presentation users can expect across the OpenForge workspace.

## Requirements

### Requirement: Studio and Workshop availability
The application SHALL offer OpenForge Light and OpenForge Dark using the Studio Light and Studio Dark designs respectively, plus Workshop Light and Workshop Dark, without requiring plugin installation. OpenForge SHALL retain the identifiers `openforge-light` and `openforge-dark` and its existing labels. Separate `studio-light` and `studio-dark` choices SHALL NOT be registered. Each variant SHALL have a distinct stable identifier and explicit light or dark appearance. The theme preference SHALL identify both the style and appearance of each choice.

#### Scenario: User opens theme settings
- **WHEN** the user opens the application theme preference
- **THEN** OpenForge Light, OpenForge Dark, Workshop Light, and Workshop Dark are available alongside contributed themes
- **AND** the active variant is identifiable

### Requirement: Studio visual identity
Studio SHALL use neutral surfaces, high-contrast text, rounded controls and content panels, near-monochrome primary actions, and restrained shadows. Studio Light SHALL use a white canvas with pale gray secondary surfaces, taking visual inspiration from the Codex app's light appearance. Studio Dark SHALL use independently designed charcoal and gray values while retaining Studio's geometry and hierarchy. Functional status and content colors SHALL remain distinguishable from the neutral primary actions.

#### Scenario: Studio Light is selected
- **WHEN** the user selects OpenForge Light
- **THEN** theme-aware application controls and content regions display the white and pale gray Studio palette, rounded geometry, and restrained elevation
- **AND** primary actions remain distinguishable from secondary controls

#### Scenario: Studio Dark is selected
- **WHEN** the user selects OpenForge Dark
- **THEN** the same controls and content regions display charcoal and gray surfaces with readable text and Studio's rounded geometry
- **AND** status, warning, and error indications remain distinguishable

### Requirement: Workshop visual identity
Workshop SHALL use crisp borders, compact corner geometry, amber primary accents, and monospaced treatment for technical metadata while retaining readable sans-serif body content. Workshop Light SHALL use warm paper surfaces and dark ink text. Workshop Dark SHALL use graphite surfaces and warm light text. Panels SHALL be separated primarily by borders and surface contrast rather than decorative shadows. Workshop SHALL be visibly distinct from Studio in geometry and elevation as well as color.

#### Scenario: Workshop Light is selected
- **WHEN** the user selects Workshop Light
- **THEN** theme-aware controls and content regions use warm paper surfaces, dark text, amber accents, and compact corners
- **AND** technical metadata has monospaced treatment while ordinary content remains readable sans-serif text

#### Scenario: Workshop Dark is selected
- **WHEN** the user selects Workshop Dark
- **THEN** the same controls and content regions use graphite surfaces, warm light text, amber accents, and crisp border separation
- **AND** warnings remain identifiable through explicit labels or icons rather than amber color alone

### Requirement: Immediate and durable variant selection
The application SHALL apply any of the four variants without restart, persist the selected variant, and restore that exact variant after restart. Switching themes SHALL preserve the current workspace, open views, user input, and running sessions rather than recreating them as a consequence of the visual change.

#### Scenario: User switches between styles with active work
- **WHEN** the user switches from OpenForge Light to Workshop Dark while a task view and terminal session are open
- **THEN** mounted theme-aware UI adopts Workshop Dark
- **AND** the same task view, terminal session, and unsent input remain available

#### Scenario: A selected variant is restored
- **WHEN** the application restarts after a successful selection of any Studio or Workshop variant
- **THEN** that exact style and appearance is restored using the saved theme identifier

### Requirement: Existing theme compatibility
Replacing the OpenForge designs and adding Workshop SHALL preserve existing built-in names, stored identifiers, default identifier, and unavailable-theme fallback. Existing OpenForge selections SHALL adopt the corresponding Studio design automatically without a preference migration. Legacy light and dark preferences SHALL continue resolving to OpenForge Light and OpenForge Dark respectively. Contributed themes SHALL remain selectable.

#### Scenario: An existing preference is loaded
- **WHEN** the application loads an existing OpenForge or available contributed-theme selection
- **THEN** it retains that identifier; OpenForge selections use the matching Studio design, while contributed selections remain unchanged

#### Scenario: A legacy or unavailable preference is loaded
- **WHEN** the stored preference is legacy light, legacy dark, or an unavailable identifier
- **THEN** it follows the existing migration or fallback behavior using the redesigned OpenForge theme for built-in selections

### Requirement: Consistent theme-aware content
All four variants SHALL provide coordinated presentation for host controls, shared theme-aware plugin building blocks, Markdown, code, diff additions and removals, diagrams, and terminal content. Light or dark content rendering SHALL follow the selected variant's declared appearance. The terminal renderer and terminal-reported default foreground, background, cursor, and ANSI colours SHALL originate from the same active terminal tokens for built-in and contributed themes. Theme changes SHALL update running terminal defaults without recreating their sessions and SHALL preserve colours explicitly overridden by terminal programs. A plugin's intentionally custom styling and explicit user terminal-font preferences SHALL remain respected.

#### Scenario: User reviews code and terminal output
- **WHEN** the user opens Markdown, a diff, a diagram, and terminal output under any new variant
- **THEN** each uses the selected light or dark presentation and the applicable theme colors
- **AND** added and removed code, syntax, terminal selection, and cursor remain readable

#### Scenario: A theme-aware plugin view is mounted
- **WHEN** a plugin view using shared theme-aware building blocks is open while the user changes variant
- **THEN** those building blocks adopt the selected style without requiring plugin reinstallation or view recreation

#### Scenario: Terminal program inspects the selected theme
- **WHEN** a terminal program queries default colours under a built-in or contributed theme
- **THEN** the reported foreground, background, cursor, and ANSI colours match the active terminal tokens used by the renderer

#### Scenario: User changes theme with a running terminal
- **WHEN** the user selects another theme while a terminal program remains running
- **THEN** the renderer and terminal-reported defaults adopt the new theme after the selection completes
- **AND** the running session, current workspace, user input, and program-defined colour overrides are preserved

### Requirement: Accessible states without layout redesign
Each variant SHALL preserve the application's navigation structure, information density, keyboard operation, and control placement. Normal text SHALL meet at least 4.5:1 contrast, large text at least 3:1, and meaningful control boundaries and focus indicators at least 3:1 against adjacent colors. Hover, pressed, selected, invalid, and disabled states SHALL remain identifiable; inactive controls are exempt from numerical contrast thresholds. Status meaning SHALL NOT rely on color alone. Theme changes SHALL respect reduced-motion preferences. Studio and Workshop SHALL use opaque content surfaces without backdrop blur or glass-like translucency; ordinary overlay scrims, selection highlights, and shadows remain permitted.

#### Scenario: Keyboard navigation across controls
- **WHEN** a keyboard user navigates buttons, fields, tabs, and menus under any of the four variants
- **THEN** focus remains visible and the existing keyboard actions remain available
- **AND** focused, selected, invalid, and disabled states remain identifiable

#### Scenario: Reduced motion and narrow desktop window
- **WHEN** the user selects a new variant with reduced motion enabled in a supported narrow desktop window
- **THEN** the change adds no nonessential motion
- **AND** the theme does not introduce clipped controls, new horizontal overflow, or altered navigation structure
