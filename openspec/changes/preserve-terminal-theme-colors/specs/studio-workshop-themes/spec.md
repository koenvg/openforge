## MODIFIED Requirements

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
