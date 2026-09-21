<script lang="ts">
  import TaskListItem from '../../../src/components/focus-board/TaskListItem.svelte'
  import { getTaskReasonText } from '../../../src/lib/taskStatePresentation'
  import type { TaskState } from '../../../src/lib/taskState'
  import type { PullRequestInfo } from '../../../src/lib/types'
  import { createPullRequest, createTask } from '../../shared/fixtures/appFixtures'

  type Gallery = 'agent-workflow' | 'pull-request-progress' | 'pull-request-attention'

  interface GalleryCase {
    label: string
    state: TaskState
    isMerging?: boolean
  }

  interface GalleryDefinition {
    title: string
    description: string
    cases: GalleryCase[]
  }

  let { gallery }: { gallery: Gallery } = $props()

  const galleries: Record<Gallery, GalleryDefinition> = {
    'agent-workflow': {
      title: 'Agent workflow states',
      description: 'Task states before pull request review begins.',
      cases: [
        { label: 'Backlog', state: 'backlog' },
        { label: 'Idle', state: 'idle' },
        { label: 'Active', state: 'active' },
        { label: 'Needs input', state: 'needs-input' },
        { label: 'Paused', state: 'paused' },
        { label: 'Agent done', state: 'agent-done' },
        { label: 'Failed', state: 'failed' },
        { label: 'Interrupted', state: 'interrupted' },
        { label: 'Done', state: 'done' },
      ],
    },
    'pull-request-progress': {
      title: 'Pull request progress',
      description: 'The normal path from draft through merge or closure.',
      cases: [
        { label: 'Draft', state: 'pr-draft' },
        { label: 'Open', state: 'pr-open' },
        { label: 'CI running', state: 'ci-running' },
        { label: 'Review pending', state: 'review-pending' },
        { label: 'Ready to merge', state: 'ready-to-merge' },
        { label: 'Ready to enqueue', state: 'ready-to-enqueue' },
        { label: 'Queued', state: 'pr-queued' },
        { label: 'Merged', state: 'pr-merged' },
        { label: 'Closed', state: 'pr-closed' },
      ],
    },
    'pull-request-attention': {
      title: 'Pull request attention states',
      description: 'Review, CI, and merge conditions that need a clear visual signal.',
      cases: [
        { label: 'CI failed', state: 'ci-failed' },
        { label: 'Changes requested', state: 'changes-requested' },
        { label: 'Unaddressed comments', state: 'unaddressed-comments' },
        { label: 'Merge conflict', state: 'merge-conflict' },
        { label: 'Merging', state: 'ready-to-merge', isMerging: true },
      ],
    },
  }

  const definition = $derived(galleries[gallery])

  function taskFor(entry: GalleryCase, index: number) {
    const status = entry.state === 'backlog' ? 'backlog' : entry.state === 'done' ? 'done' : 'doing'
    return createTask({ id: `T-${index + 1}`, title: `${entry.label} task`, status })
  }

  function pullRequestsFor(entry: GalleryCase): PullRequestInfo[] {
    if (!entry.state.startsWith('pr-') && ![
      'ci-running',
      'review-pending',
      'ci-failed',
      'changes-requested',
      'unaddressed-comments',
      'ready-to-merge',
      'ready-to-enqueue',
      'merge-conflict',
    ].includes(entry.state)) return []

    if (entry.state === 'pr-draft') return [createPullRequest({ draft: true })]
    if (entry.state === 'pr-merged') return [createPullRequest({ state: 'merged' })]
    if (entry.state === 'pr-closed') return [createPullRequest({ state: 'closed' })]
    if (entry.state === 'unaddressed-comments') return [createPullRequest({ unaddressed_comment_count: 3 })]
    return [createPullRequest()]
  }
</script>

<main class="task-list-gallery" data-task-list-gallery-ready={gallery}>
  <header>
    <p>Task list status gallery</p>
    <h1>{definition.title}</h1>
    <span>{definition.description}</span>
  </header>

  <section aria-label={definition.title}>
    {#each definition.cases as entry, index}
      {@const pullRequests = pullRequestsFor(entry)}
      <article data-gallery-case={entry.state}>
        <div class="case-label">
          <h2>{entry.label}</h2>
          <code>{entry.isMerging ? 'merging' : entry.state}</code>
        </div>
        <TaskListItem
          task={taskFor(entry, index)}
          state={entry.state}
          session={null}
          {pullRequests}
          reasonText={getTaskReasonText(entry.state, pullRequests)}
          hasUnreadAgentOutput={entry.state === 'needs-input'}
          isSelected={false}
          isFocused={false}
          isMerging={entry.isMerging ?? false}
          onSelect={() => {}}
          onContextMenu={() => {}}
        />
      </article>
    {/each}
  </section>
</main>

<style>
  .task-list-gallery {
    box-sizing: border-box;
    width: 100%;
    min-height: 100vh;
    padding: 28px;
    color: var(--of-text);
    font-family: var(--of-font-sans);
  }

  header {
    margin-bottom: 20px;
  }

  header p,
  header h1,
  header span,
  .case-label h2 {
    margin: 0;
  }

  header p {
    margin-bottom: 4px;
    color: var(--of-accent);
    font-size: var(--of-text-xs);
    font-weight: var(--of-weight-semibold);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  header h1 {
    font-size: var(--of-text-xl);
    line-height: var(--of-line-height-xl);
  }

  header span {
    display: block;
    margin-top: 4px;
    color: var(--of-text-secondary);
    font-size: var(--of-text-sm);
  }

  section {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 20px;
  }

  article {
    min-width: 0;
  }

  .case-label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
    padding-inline: 2px;
  }

  .case-label h2 {
    font-size: var(--of-text-md);
    font-weight: var(--of-weight-semibold);
    line-height: var(--of-line-height-md);
  }

  .case-label code {
    color: var(--of-text-muted);
    font-family: var(--of-font-mono);
    font-size: var(--of-text-xs);
  }
</style>
