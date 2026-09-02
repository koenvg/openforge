# Focus Board Backlog Label Ordering Specification

## Purpose

Defines a predictable order for Backlog label filters so labels attached to the most Backlog Tasks appear first.

## Requirements

### Requirement: Backlog label filters are ordered by usage
The system SHALL order labels in the Backlog label filter dropdown by descending Backlog Task count, then alphabetically by label name when counts are equal.

#### Scenario: Labels have different Backlog Task counts
- **WHEN** the user opens the Backlog label filter dropdown
- **THEN** labels with higher Backlog Task counts appear before labels with lower counts

#### Scenario: Labels have equal Backlog Task counts
- **WHEN** two or more available labels have the same Backlog Task count
- **THEN** those labels appear in alphabetical order by label name

#### Scenario: Backlog Task counts change
- **WHEN** a label's Backlog Task count changes while it remains available as a filter
- **THEN** the system updates the label order using the current counts

#### Scenario: A label is selected
- **WHEN** the user selects or deselects a label
- **THEN** selected state does not override count-first and alphabetical ordering
