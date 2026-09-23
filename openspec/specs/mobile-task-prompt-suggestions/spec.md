# mobile-task-prompt-suggestions Specification

## Purpose

Defines how the mobile Create Task composer presents command and skill suggestions so users can find and insert a prompt shortcut while the on-screen keyboard is open.

## Requirements

### Requirement: Suggestions appear above the mobile prompt
When a mobile Create Task prompt begins with the active provider's command or skill trigger and has matching suggestions, the composer SHALL present the matches immediately above the prompt input. With the on-screen keyboard open on a phone, the prompt input and at least one selectable match SHALL remain visible together without requiring the user to dismiss the keyboard. The composer SHALL constrain and scroll a longer list of matches rather than let it extend behind the keyboard or offscreen.

#### Scenario: Slash suggestions with keyboard open
- **WHEN** a user types `/` followed by part of a matching command name in the mobile Create Task prompt with the keyboard open
- **THEN** the matching suggestions appear above the prompt, and both the prompt and a selectable match remain visible

#### Scenario: Many matches on a small phone
- **WHEN** the active trigger matches more suggestions than fit in the available space above the keyboard
- **THEN** the user can scroll the suggestions to reach additional matches while the prompt remains available for editing

### Requirement: Suggestions remain legible and easy to select
The mobile suggestion picker SHALL show each match's name and available description, retain its command or skill identity, and offer touch-friendly rows. Choosing a match SHALL insert the active provider's trigger and selected name into the prompt, followed by a space, without creating the Task.

#### Scenario: Select a command
- **WHEN** the user taps a visible command suggestion
- **THEN** the prompt contains the provider trigger, command name, and trailing space, and no Task is created

#### Scenario: Select a skill
- **WHEN** the user taps a visible skill suggestion
- **THEN** the prompt contains the provider trigger, skill name, and trailing space, and no Task is created

### Requirement: Provider filtering remains intact
The picker SHALL show matches only for the active provider's trigger and current query, and SHALL hide the list when the prompt no longer contains a valid suggestion query.

#### Scenario: Codex uses the dollar trigger
- **WHEN** the active provider uses `$` and the user types a matching `$` query
- **THEN** the picker shows matching skills above the prompt and selects them with the `$` prefix

#### Scenario: Query ends
- **WHEN** the user replaces the trigger query with ordinary prompt text
- **THEN** the suggestion picker closes without altering the entered text
