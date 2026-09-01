## Purpose

Defines how app-level Trusted Plugins contribute selectable application themes and how the host manages those themes through plugin lifecycle changes.

## ADDED Requirements

### Requirement: Declared theme capability
A Trusted Plugin SHALL declare the documented theme capability before registering application themes, and theme contribution SHALL be available only to app-enabled frontend plugins.

#### Scenario: App-enabled plugin declares theme capability
- **WHEN** an active app-enabled frontend plugin with the theme capability registers a valid theme
- **THEN** the host accepts the registration

#### Scenario: Plugin lacks theme capability
- **WHEN** a plugin without the theme capability attempts to register a theme
- **THEN** the host rejects the call with a named capability error and does not change the available themes

#### Scenario: Project-enabled plugin attempts registration
- **WHEN** a project-enabled plugin attempts to register an application theme
- **THEN** the host rejects the registration because application theme availability is app-scoped

### Requirement: Namespaced theme registration
A plugin-contributed theme SHALL have a host-qualified stable identifier, user-facing name, explicit light or dark appearance, and a complete valid semantic theme definition. Local theme identifiers SHALL be unique within the contributing plugin.

#### Scenario: Plugin registers a valid theme
- **WHEN** an app-enabled plugin registers a valid local theme identifier and definition
- **THEN** the host exposes it under an identifier qualified by the plugin id

#### Scenario: Plugin registers a duplicate local identifier
- **WHEN** a plugin registers the same local theme identifier twice during one activation
- **THEN** the host rejects the duplicate without replacing the first registration

#### Scenario: Plugin registers an invalid definition
- **WHEN** a plugin theme has invalid metadata, appearance, or semantic values
- **THEN** the host rejects it with validation details and keeps all existing themes unchanged

### Requirement: Contributed theme discovery and selection
Valid themes from active app-level plugins SHALL appear in the same theme preference as built-in themes and SHALL be selectable by the user.

#### Scenario: Theme plugin activates
- **WHEN** an app-level theme plugin activates successfully
- **THEN** each valid registered theme appears in the application theme preference with plugin ownership identified

#### Scenario: User selects contributed theme
- **WHEN** the user selects a registered plugin theme
- **THEN** the host applies it through the application theme contract and persists its qualified identifier

### Requirement: Active-theme styling scope
Theme-specific styling supplied by a plugin SHALL affect the host only while one of that plugin's registered themes is selected. Selecting another theme SHALL remove the prior theme's host-wide effects. Plugin-owned view styling MAY remain active according to the existing frontend stylesheet lifecycle.

#### Scenario: Contributed theme is not selected
- **WHEN** a theme plugin is active but none of its themes is selected
- **THEN** its theme-specific styling does not alter host UI outside plugin-owned content

#### Scenario: User switches away from contributed theme
- **WHEN** the user selects another valid theme
- **THEN** the previously selected plugin theme no longer affects host controls or content regions

### Requirement: Theme contribution lifecycle
The host SHALL tie contributed theme registrations and theme-specific styling to the owning plugin activation generation.

#### Scenario: Theme plugin reloads
- **WHEN** an active theme plugin reloads successfully
- **THEN** stale registrations and styling from its previous activation are removed before the new registrations become available

#### Scenario: Theme plugin is disabled or uninstalled
- **WHEN** a theme plugin is disabled or uninstalled
- **THEN** all of its themes and theme-specific styling are removed

#### Scenario: Reload fails while its theme was active
- **WHEN** a theme plugin reload fails and its previous active theme is no longer valid
- **THEN** the host applies the standard unavailable-theme fallback and reports the plugin failure

### Requirement: Theme failures are isolated
A plugin theme registration or styling failure SHALL NOT prevent built-in themes, other plugins, or settings from operating.

#### Scenario: One contributed theme fails validation
- **WHEN** one theme registration fails validation during plugin activation
- **THEN** the failure is attributed to the owning plugin while built-in and other valid contributed themes remain usable

### Requirement: Custom plugin appearance remains supported
Frontend plugins SHALL remain free to compose OpenForge building blocks, native elements, and plugin-owned CSS inside their contributed UI without registering an application theme.

#### Scenario: Plugin ships custom view styling only
- **WHEN** a frontend plugin styles its own view through declared frontend styles and does not register a theme
- **THEN** the custom view remains supported and does not appear as an application theme
