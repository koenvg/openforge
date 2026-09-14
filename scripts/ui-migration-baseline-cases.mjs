// Explicit selectors are part of the baseline contract. Shell controls are never substitutes.
export const baselineCases = [
  { story: 'pages-attention-overview--loading', targets: [
    { id: 'feedback', selector: '[role="dialog"] span:text-is("Gathering what needs your attention…")' },
    { id: 'spinner', selector: '[role="dialog"] span[data-size="md"]' },
  ] },
  { story: 'pages-attention-overview--failure', targets: [
    { id: 'feedback', selector: '[role="dialog"] [role="alert"]' },
    { id: 'retry', selector: '[role="dialog"] button:text-is("Retry")' },
  ], interaction: '[role="dialog"] button:text-is("Retry")' },
  { story: 'pages-attention-overview--narrow', targets: [
    { id: 'dialog', selector: '[role="dialog"]' },
    { id: 'task', selector: 'text=Normalize the greeting' },
  ] },
  { story: 'pages-self-review--loading', narrowGap: 'KVG-4897: existing narrow diff pane has zero width', targets: [
    { id: 'feedback', selector: '[role="status"]:has-text("Loading diff...")' },
    { id: 'spinner', selector: '[role="status"]:has-text("Loading diff...") .loading' },
  ] },
  { story: 'pages-self-review--failure', narrowGap: 'KVG-4897: existing narrow diff pane has zero width', targets: [
    { id: 'feedback', selector: '[role="alert"]:has-text("Failed to load diff. Please try again.")' },
    { id: 'retry', selector: 'button:text-is("Retry loading diff")' },
  ], interaction: 'button:text-is("Retry loading diff")' },
  { story: 'pages-task-detail--review', targets: [
    { id: 'review-file', selector: '[role="treeitem"][aria-label="Select file src/greet.ts"]' },
  ] },
  { story: 'pages-file-viewer--file-loading', targets: [
    { id: 'spinner', selector: '[aria-label="Loading file content"]' },
  ] },
  { story: 'pages-file-viewer--file-failure', targets: [
    { id: 'feedback', selector: 'text=Unable to load file' },
  ] },
  { story: 'pages-terminal--runtime-unavailable', targets: [
    { id: 'feedback', selector: 'text=Terminal runtime unavailable' },
  ] },
  { story: 'pages-global-settings--loading', targets: [
    { id: 'feedback', selector: 'main >> text=Loading settings…' },
    { id: 'spinner', selector: 'main .loading' },
  ] },
  { story: 'pages-project-settings--saving', targets: [
    { id: 'feedback', selector: 'main [aria-live="polite"]:has-text("Saving changes…")' },
    { id: 'spinner', selector: 'main .loading' },
  ] },
  { story: 'pages-project-setup--empty', targets: [
    { id: 'dialog', selector: '[role="dialog"][aria-label="Add Project"]' },
    { id: 'selected-mode', selector: '[role="radio"][aria-checked="true"]' },
    { id: 'disabled-submit', selector: 'button:text-is("Create Project"):disabled' },
  ], interaction: '[data-select-repository]' },
  { story: 'pages-project-setup--failure', targets: [
    { id: 'feedback', selector: '#add-project-creation-feedback[role="alert"]' },
    { id: 'name', selector: '[data-project-name-input]' },
  ], interaction: 'button:text-is("Create Project")' },
  { story: 'pages-project-setup--success', targets: [
    { id: 'feedback', selector: '#add-project-creation-feedback[role="status"]' },
    { id: 'name', selector: '[data-project-name-input]' },
  ] },
]
