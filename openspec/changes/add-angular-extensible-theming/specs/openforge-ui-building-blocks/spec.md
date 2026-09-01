## Purpose

Defines the supported plugin-safe UI building blocks that let the host and plugins share behavior, accessibility, and active-theme presentation.

## ADDED Requirements

### Requirement: Public building block coverage
The plugin SDK SHALL publish supported Svelte building blocks for buttons, icon-only actions, text fields, select fields, text areas, checkboxes, switches, badges, content panels, tabs, modal dialogs, anchored menus, and tooltips. Existing public UI exports SHALL remain available.

#### Scenario: Plugin imports a documented building block
- **WHEN** a plugin imports a documented `@openforge-app/plugin-sdk/ui/*` component from the published package
- **THEN** the component resolves without importing renderer-private source

#### Scenario: Existing plugin imports a current component
- **WHEN** a plugin upgrades the SDK while continuing to import an existing public UI component
- **THEN** the documented import remains compatible unless separately deprecated through the SDK compatibility process

### Requirement: Theme-responsive presentation
Every OpenForge building block SHALL derive its visual presentation from the active semantic theme contract and SHALL update when the selected theme changes.

#### Scenario: Host switches themes with a component mounted
- **WHEN** the active application theme changes while an OpenForge building block is mounted
- **THEN** the component adopts the new theme without remounting or losing its state

#### Scenario: Plugin uses a contributed application theme
- **WHEN** a plugin view renders OpenForge building blocks under a valid contributed theme
- **THEN** those components use the same theme values as host-rendered components

### Requirement: Accessible component behavior
OpenForge building blocks SHALL use appropriate native semantics, expose accessible names and states, support keyboard operation, preserve visible focus, and respect disabled state behavior. Overlay building blocks SHALL manage focus and dismissal according to their documented contracts.

#### Scenario: Keyboard operates a control
- **WHEN** a keyboard user focuses and activates an enabled OpenForge control
- **THEN** the control exposes its state and performs the same action available to pointer users

#### Scenario: Disabled control is activated
- **WHEN** a user attempts to activate a disabled OpenForge control
- **THEN** no action fires and assistive technology can identify the disabled state

#### Scenario: Modal opens and closes
- **WHEN** a modal building block opens and is later dismissed
- **THEN** focus moves into the modal, remains contained while open, and returns according to the modal contract after dismissal

### Requirement: Host and built-in plugin adoption
The host renderer and built-in plugins SHALL use public OpenForge building blocks for shared control behavior and durable visual structures covered by the SDK. Feature-specific layout and domain presentation MAY remain local.

#### Scenario: Shared control appears in host and built-in plugin UI
- **WHEN** the host and a built-in plugin require the same supported control behavior
- **THEN** both compose the public OpenForge building block rather than maintain separate visual implementations

### Requirement: Layout and custom composition remain caller-owned
The building block contract SHALL NOT require plugins to wrap ordinary layout markup in OpenForge components. Plugins MAY use Tailwind utilities, native elements, or plugin-owned styles for layout and deliberately custom presentation.

#### Scenario: Plugin creates a custom layout
- **WHEN** a plugin combines OpenForge controls with its own grid, spacing, and branded content styling
- **THEN** the plugin can do so without depending on undocumented host classes or renderer-private components

### Requirement: Stable documented interfaces
Each public building block SHALL document its import path, properties, events, accessibility ownership, supported variants, and theming behavior. Tests SHALL exercise observable behavior rather than utility-class or internal-markup details.

#### Scenario: Plugin author looks up a building block
- **WHEN** a plugin author consults the SDK reference
- **THEN** the author can determine how to import, label, operate, theme, and test the component through its supported interface
