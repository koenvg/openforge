## Why

Backlog label filters currently occupy a full inline row and grow wider as a project gains labels. Moving the same choices into a compact multiselect dropdown keeps the Backlog view usable without changing how filtering works.

## What Changes

- Replace the inline Backlog label filter chips with a dropdown multiselect.
- Show each available Backlog label and its existing task count inside the dropdown.
- Preserve the current multi-label OR behavior, selected-label state, project-switch behavior, and zero-count pruning.
- Keep the top-level Focus, In Flight, Out of Focus, and Backlog controls unchanged.
- Do not add dependency-readiness or other new filter criteria.

## Capabilities

### New Capabilities

- `focus-board-backlog-filtering`: Defines how users select multiple Task Labels to filter the Focus Board Backlog view through a compact dropdown.

### Modified Capabilities

None.

## Impact

- Focus Board Backlog filter presentation and interaction tests.
- Existing renderer-side label filter state and filtering logic remain authoritative.
- No backend, IPC, database, plugin, or dependency changes.
