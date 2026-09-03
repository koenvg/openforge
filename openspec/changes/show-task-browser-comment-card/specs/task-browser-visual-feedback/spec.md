## Purpose

Keeps unsent Task Browser visual-feedback comments visible beside their numbered live-page markers without moving review ownership into the page.

## ADDED Requirements

### Requirement: Current-page annotation card
The system SHALL show a fixed lower-right visual-feedback card when the exact URL visible in an attached Task Browser Surface has one or more unsent annotations. The card SHALL show the current-page annotation count and list every current-page comment in ascending annotation-number order.

#### Scenario: Current page has one annotation
- **WHEN** the visible Task Browser URL has one unsent annotation
- **THEN** the page shows an expanded lower-right card with the singular annotation count, annotation number, and comment text

#### Scenario: Current page has several annotations
- **WHEN** the visible Task Browser URL has several unsent annotations
- **THEN** the card shows the plural annotation count and lists the comments in ascending annotation-number order

#### Scenario: Annotations belong only to another URL
- **WHEN** unsent annotations exist but none belongs to the exact visible URL
- **THEN** the visible page does not show the annotation card

#### Scenario: Navigation returns to an annotated URL
- **WHEN** the user returns to an exact URL that has unsent annotations
- **THEN** the system restores that URL's markers and annotation card without showing comments from other URLs

### Requirement: Configured card appearance
The system SHALL render the annotation card using the configured OpenForge light or dark theme and SHALL update a visible card when that configured theme changes. Both appearances MUST preserve readable contrast, visible boundaries, and distinguishable focus and interaction states.

#### Scenario: Light theme is configured
- **WHEN** OpenForge is configured to use its light theme and the visible URL has annotations
- **THEN** the page shows the annotation card with the OpenForge light-theme surface, text, border, marker, and interaction colors

#### Scenario: Dark theme is configured
- **WHEN** OpenForge is configured to use its dark theme and the visible URL has annotations
- **THEN** the page shows the annotation card with the OpenForge dark-theme surface, text, border, marker, and interaction colors

#### Scenario: Configured theme changes
- **WHEN** the user changes the configured OpenForge theme while an annotation card is visible
- **THEN** the card updates to the new configured appearance without changing annotations or disclosure state


### Requirement: Local card disclosure
The system SHALL expand the card when it first appears for a visible URL and SHALL provide an accessible control that collapses the comment list to a compact annotation-count control and reopens it. Synchronizing comment changes for the same visible URL MUST preserve the user's current expanded or collapsed choice.

#### Scenario: User collapses the card
- **WHEN** the user activates the collapse control on an expanded annotation card
- **THEN** the page hides the comment list and keeps a compact control with the current annotation count

#### Scenario: User reopens the card
- **WHEN** the user activates the compact annotation-count control
- **THEN** the page restores the current URL's ordered comment list

#### Scenario: Collapsed card receives an update
- **WHEN** the user has collapsed the card and the plugin synchronizes edited, added, or removed annotations for the same URL
- **THEN** the card remains collapsed and its count reflects the latest synchronized annotations

### Requirement: In-card annotation deletion
The system SHALL provide a labelled, keyboard-operable delete control for each annotation listed in the card. A trusted user activation SHALL request deletion by annotation number from the owning Task Browser plugin, which SHALL apply its existing authoritative draft-deletion workflow and resynchronize the live page.

#### Scenario: User deletes an annotation from the card
- **WHEN** the user activates the delete control for a current-page annotation
- **THEN** the plugin removes that annotation through its existing draft workflow and the next synchronization removes its card row and numbered marker

#### Scenario: User deletes the last current-page annotation
- **WHEN** the user deletes the only annotation for the visible URL from the card
- **THEN** the next synchronization removes the card and its numbered marker

#### Scenario: Annotation deletion fails
- **WHEN** the plugin cannot persist or synchronize a deletion requested from the card
- **THEN** the annotation remains represented in the authoritative draft and the plugin exposes its existing recoverable visual-feedback error

#### Scenario: Page script attempts deletion
- **WHEN** live-page script programmatically triggers or forges an annotation deletion action without trusted user activation
- **THEN** the system ignores the action and leaves the authoritative draft unchanged


### Requirement: Review state remains authoritative
The card SHALL reflect the latest synchronized current-page annotation numbers and comments. Deletion SHALL remain an owning-plugin action even when initiated from the card. The card MUST NOT provide sending, editing, undo, capture management, or persistence-recovery actions; those actions SHALL remain in the Task Browser plugin's existing review controls.

#### Scenario: Plugin edits a comment
- **WHEN** the plugin synchronizes a changed comment for an annotation on the visible URL
- **THEN** the card shows the changed text without changing the live Browser Surface or disclosure state

#### Scenario: Plugin removes the last current-page annotation
- **WHEN** the plugin synchronizes feedback with no annotations for the visible URL
- **THEN** the page removes the card

#### Scenario: User sends or discards all feedback
- **WHEN** the plugin acknowledges sending or confirms discarding the complete feedback collection and clears the live markers
- **THEN** the page removes the card together with the markers

### Requirement: Selection and capture isolation
The system SHALL keep the annotation card out of region selection and captured evidence while restoring it afterward when current-page annotations remain.

#### Scenario: Region selection starts
- **WHEN** the user starts selecting another visual-feedback region
- **THEN** the card and all of its descendants are absent from rendering, hit testing, and the accessibility tree until selection ends

#### Scenario: Region selection ends
- **WHEN** region selection is saved or cancelled and the visible URL still has annotations
- **THEN** the system restores the annotation card with the latest current-page comments

#### Scenario: Visible viewport is captured
- **WHEN** the system captures the visible browser viewport as feedback evidence
- **THEN** neither the annotation card nor the numbered marker overlay appears in the captured image

### Requirement: Accessible bounded presentation
The annotation card SHALL remain within the visible browser viewport, expose its count and comments to assistive technology, provide keyboard-operable disclosure and deletion controls with clear labels and states, and bound overflowing comment content so the underlying page remains usable.

#### Scenario: Browser viewport is constrained
- **WHEN** the browser viewport is narrower or shorter than the card's preferred dimensions
- **THEN** the card stays within the viewport and bounds its comment list instead of overflowing the page

#### Scenario: Keyboard user changes disclosure state
- **WHEN** keyboard focus reaches the card's disclosure control and the user activates it
- **THEN** the card toggles its comment list and communicates the resulting expanded state

#### Scenario: Keyboard user requests deletion
- **WHEN** keyboard focus reaches an annotation's delete control and the user activates it
- **THEN** the system requests deletion of that numbered annotation without moving focus into the live page
