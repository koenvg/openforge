## Purpose

Defines how OpenForge discovers, applies, persists, and safely falls back between built-in and contributed application themes.

## ADDED Requirements

### Requirement: Built-in theme availability
The application SHALL provide built-in light and dark OpenForge themes with stable identifiers, user-facing names, and explicit light or dark appearance metadata.

#### Scenario: User opens theme settings
- **WHEN** the user opens the application theme preference
- **THEN** the built-in light and dark OpenForge themes are available for selection

### Requirement: Angular OpenForge visual language
The built-in OpenForge themes SHALL use the website's visual language: neutral canvases, high-contrast text, crisp one-pixel separation, a blue primary accent, restrained elevation, compact corner geometry, and monospaced treatment for technical metadata. The dark theme SHALL provide its own accessible values rather than mechanically invert the light theme.

#### Scenario: Built-in light theme is active
- **WHEN** the user selects the built-in light theme
- **THEN** application controls and content regions use the angular light visual language consistently

#### Scenario: Built-in dark theme is active
- **WHEN** the user selects the built-in dark theme
- **THEN** application controls and content regions use a dark palette with the same angular geometry and hierarchy

### Requirement: Semantic theme contract
Every selectable theme SHALL provide the complete semantic values required for application colors, text, borders, focus indication, typography, geometry, elevation, motion, code presentation, status presentation, and terminal presentation. Application UI built from OpenForge building blocks SHALL consume those semantic values instead of relying on a theme's name.

#### Scenario: Theme selection changes
- **WHEN** the user selects a different valid theme
- **THEN** all mounted OpenForge building blocks update to the selected theme without an application restart

#### Scenario: Theme omits a required value
- **WHEN** a theme definition does not provide a valid required semantic value
- **THEN** the application rejects that theme and retains the current valid theme

### Requirement: Theme selection persistence
The application SHALL persist the selected theme by stable theme identifier and restore it after restart.

#### Scenario: Selected theme remains available
- **WHEN** the application starts after the user selected a theme in a previous session
- **THEN** the application restores that theme before presenting the main renderer UI

### Requirement: Existing preference migration
The application SHALL map the existing stored `light` and `dark` theme preferences to the corresponding built-in theme identifiers without requiring user action.

#### Scenario: Existing light preference is loaded
- **WHEN** the stored theme preference is `light`
- **THEN** the application selects and persists the built-in light OpenForge theme identifier

#### Scenario: Existing dark preference is loaded
- **WHEN** the stored theme preference is `dark`
- **THEN** the application selects and persists the built-in dark OpenForge theme identifier

### Requirement: Unavailable theme fallback
The application SHALL use the built-in light OpenForge theme when the stored or active theme identifier is unavailable or invalid. It SHALL update the stored selection to that fallback and report a diagnostic that identifies the unavailable theme.

#### Scenario: Stored contributed theme is unavailable at startup
- **WHEN** app-level plugin activation has completed and the stored theme identifier is not registered
- **THEN** the application applies and persists the built-in light theme and records a diagnostic naming the unavailable identifier

#### Scenario: Active theme becomes unavailable
- **WHEN** the active theme is unregistered
- **THEN** the application immediately applies and persists the built-in light theme without leaving partially applied theme styling

### Requirement: Explicit appearance for theme-sensitive content
Diff rendering, Mermaid rendering, Markdown previews, code presentation, and terminal presentation SHALL use the selected theme's explicit appearance and semantic presentation values rather than infer behavior from the theme identifier text.

#### Scenario: Dark theme identifier lacks the word dark
- **WHEN** the selected theme declares dark appearance but its identifier does not contain `dark`
- **THEN** diff, Mermaid, Markdown, and terminal content use their dark presentation

#### Scenario: Light theme identifier contains the word dark
- **WHEN** the selected theme declares light appearance but its identifier contains `dark`
- **THEN** diff, Mermaid, Markdown, and terminal content use their light presentation

### Requirement: Accessible theme states
Every built-in theme SHALL preserve visible keyboard focus, readable disabled states, and required text and control contrast. Theme transitions SHALL respect the user's reduced-motion preference.

#### Scenario: Keyboard user moves focus
- **WHEN** a keyboard user focuses an interactive OpenForge building block under either built-in theme
- **THEN** the focused control has a visible focus indicator that is not conveyed by color alone

#### Scenario: Reduced motion is requested
- **WHEN** the operating system requests reduced motion and the user changes theme
- **THEN** theme-dependent transitions do not introduce nonessential motion
