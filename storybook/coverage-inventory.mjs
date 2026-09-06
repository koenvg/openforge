/** @type {import('./coverage-types.ts').CoverageInventory} */
const inventory = {
  pages: [
    {
      source: 'src/components/shell/ApplicationShell.svelte',
      stories: [
        'application-shell--expanded',
        'application-shell--collapsed',
        'application-shell--zen',
        'application-shell--global-view',
        'application-shell--toggle-sidebar',
      ],
    },
    {
      source: 'src/components/focus-board/FocusBoard.svelte',
      stories: [
        'pages-focus-board--populated',
        'pages-focus-board--empty',
        'pages-focus-board--loading',
        'pages-focus-board--failure',
        'pages-focus-board--attention',
        'pages-focus-board--filtered',
        'pages-focus-board--narrow',
        'pages-focus-board--overflow',
        'infrastructure-host-frames--host-page',
      ],
    },
    {
      source: 'src/components/task-detail/TaskDetailView.svelte',
      stories: [
        'pages-task-detail--backlog',
        'pages-task-detail--active',
        'pages-task-detail--waiting',
        'pages-task-detail--failed',
        'pages-task-detail--completed',
        'pages-task-detail--dependency',
        'pages-task-detail--terminal',
        'pages-task-detail--long-content',
        'pages-task-detail--review',
      ],
    },
    {
      source: 'src/components/task-detail/SelfReviewView.svelte',
      stories: [
        'pages-self-review--populated',
        'pages-self-review--empty',
        'pages-self-review--loading',
        'pages-self-review--failure',
        'pages-self-review--long-content',
        'pages-self-review--narrow',
        'pages-self-review--send-feedback',
        'pages-self-review--finish-loading',
      ],
    },
  ],
  components: [
    { source: 'packages/plugin-sdk/src/ui/Button.svelte', stories: ['components-button--primary'] },
  ],
  // Unadopted UI is reported by discovery, never parked here to silence coverage.
  exclusions: [],
}

export default inventory
