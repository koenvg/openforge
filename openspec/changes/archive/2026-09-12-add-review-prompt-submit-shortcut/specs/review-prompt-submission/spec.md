## Purpose

Let users submit reviewed agent feedback from the keyboard without disrupting multiline editing or bypassing send restrictions.

## ADDED Requirements

### Requirement: Submit the reviewed draft with the platform shortcut

The review-prompt dialog SHALL submit with Command+Enter on macOS and Ctrl+Enter on Windows/Linux while focus is within the dialog. Submission SHALL have the same result as clicking Send to agent, including sending the exact current draft, closing the dialog, and the existing sent-comment handling. This SHALL apply in both Address and Analyze mode.

#### Scenario: Send an edited draft on macOS
- **WHEN** the open dialog contains an eligible edited draft and the user presses Command+Enter on macOS
- **THEN** the exact edited draft is sent once and the dialog closes with the same result as clicking Send to agent

#### Scenario: Send from either mode on Windows or Linux
- **WHEN** the open dialog is in Address or Analyze mode with an eligible draft and the user presses Ctrl+Enter on Windows or Linux
- **THEN** its current draft is sent once with the same result as clicking Send to agent

#### Scenario: Focus is on another dialog control
- **WHEN** the draft is eligible and the user presses the platform submit shortcut while a mode or action button has focus inside the dialog
- **THEN** the current draft is submitted without activating a different action

### Requirement: Preserve submission guards and editing behavior

Keyboard submission MUST NOT bypass the button's send restrictions. Empty or whitespace-only drafts and agents with running or paused status SHALL prevent submission. Plain Enter and Shift+Enter in the draft SHALL remain multiline editing actions. Composition events, repeated keydown events, and shortcuts with additional Alt or Shift modifiers SHALL NOT submit. The shortcut SHALL NOT submit this dialog's draft when the dialog is closed or focus is outside it. A handled submit shortcut SHALL NOT insert a newline or trigger another application action.

#### Scenario: Empty draft
- **WHEN** the user presses the submit shortcut with an empty or whitespace-only draft
- **THEN** nothing is sent and the dialog stays open

#### Scenario: Agent becomes busy
- **WHEN** the agent becomes running or paused after the dialog opens and the user presses the submit shortcut
- **THEN** nothing is sent and the draft remains available

#### Scenario: Multiline editing
- **WHEN** the user presses Enter or Shift+Enter in the draft without the platform submit modifier
- **THEN** the draft accepts a newline without sending

#### Scenario: Composition or held keys
- **WHEN** a submit-like key event occurs during text composition or is a repeated keydown
- **THEN** no submission occurs

#### Scenario: Additional modifiers
- **WHEN** the platform submit shortcut is pressed with Alt or Shift also held
- **THEN** no submission occurs

#### Scenario: Dialog does not own focus
- **WHEN** the platform submit shortcut is pressed outside the dialog or after it has closed
- **THEN** the review-prompt draft is not submitted

#### Scenario: Shortcut is consumed
- **WHEN** the open dialog handles a submit shortcut, whether sending is allowed or blocked
- **THEN** it neither inserts a newline nor triggers an enclosing application shortcut

### Requirement: Display the submit shortcut

The dialog SHALL show a visible platform-appropriate shortcut hint beside Send to agent without replacing the action label or obscuring dialog controls.

#### Scenario: Platform hint
- **WHEN** the dialog opens on macOS
- **THEN** the send action displays a Command+Enter hint

#### Scenario: Windows or Linux hint
- **WHEN** the dialog opens on Windows or Linux
- **THEN** the send action displays a Ctrl+Enter hint
