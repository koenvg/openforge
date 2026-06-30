/**
 * @process openforge/aviv-118-remove-done-complete
 * @description Remove the entire "Done" board story (move-to-Done transition + its cleanup code, reopen, clear-done, the Done lane/filter) and rename the Delete task action to "Complete" (flag icon, confirmation prompt, identical delete-everything behavior). Existing 'done' DB rows are left hidden — no migration. Driven for OpenForge task AVIV-118 with TDD and a post-implementation adversarial review gate.
 * @skill review .agents/skills/review/SKILL.md
 * @inputs { taskId: string, request: string }
 * @outputs { success: boolean, reviewApproved: boolean }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

const io = (taskCtx) => ({
  inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
  outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
});

export const writeRedTestsTask = defineTask('aviv-118/write-red-tests', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Write/adjust failing tests first (TDD red)',
  description: 'Encode the new behavior in tests before touching implementation.',
  agent: {
    prompt: {
      role: 'senior engineer practising strict TDD',
      task: args.request,
      instructions: [
        'Write or update FOCUSED tests that encode the target behavior BEFORE implementation. They should fail now.',
        'Frontend (vitest): TaskContextMenu shows a "Complete" item (with a flag) and NO "Move to Done"/"Reopen" items; selecting Complete asks for confirmation then calls deleteTask; board exposes no Done filter/lane; boardFilters keeps hiding legacy status==="done" tasks from focus/backlog; actionPalette no longer offers move-to-done.',
        'Rust (cargo test): update_task_status with "done" performs a plain status update with NO worktree cleanup and NO clear-done/reopen machinery; cleanup_task_runtime_for_app remains used by delete_task.',
        'Do NOT implement product code in this step. Tests only. Tests must assert business logic only — never CSS/Tailwind/visual styling (per repo rules).',
      ],
      acceptanceCriteria: [
        'New/updated tests exist and fail for the right reason (missing behavior), not due to compile errors unrelated to intent.',
      ],
    },
  },
  labels: ['agent', 'tdd', 'red'],
  io: io(taskCtx),
}));

export const redRunTask = defineTask('aviv-118/red-run', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Run the new tests to confirm they are red',
  description: 'Confirm the freshly written tests fail before implementation. Failure here is expected and acceptable.',
  shell: {
    command: 'pnpm exec vitest run src/components/shared/tasks/TaskContextMenu.test.ts src/lib/boardFilters.test.ts src/components/focus-board/FocusBoard.test.ts src/lib/actionPalette.test.ts || true',
    cwd: '.',
  },
  labels: ['shell', 'tdd', 'red'],
  io: io(taskCtx),
}));

export const implementationTask = defineTask('aviv-118/implementation', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Implement done-removal + Delete→Complete rename',
  description: 'Apply the approved design to make the red tests pass.',
  agent: {
    prompt: {
      role: 'senior full-stack engineer (Rust sidecar + Svelte 5/TS renderer)',
      task: args.request,
      instructions: [
        'Follow the approved design exactly. Keep edits surgical and idiomatic to the surrounding code.',
        'REMOVE move-to-Done everywhere: TaskContextMenu "Move to Done" item + handler; TaskDetailView status-selector Done option + the newStatus==="done" branch; actionPalette "move-to-done" action + its controller case + taskActionRunner.moveTaskToDone; delete src/lib/moveToComplete.ts (+test).',
        'REMOVE the cleanup-on-done backend path in src-tauri/src/app_invoke/core.rs update_task_status (both `if status == Done` blocks). Keep cleanup_task_runtime_for_app (delete uses it). REMOVE clear_done_tasks (Rust handler + clearDoneTasks IPC wrapper + electronMigrationContracts entry + test).',
        'REMOVE the Reopen story: src/lib/reopenTask.ts (+test), FocusBoard handleReopen + onReopen wiring, TaskContextMenu Reopen item/handler/onReopen prop.',
        'REMOVE the Done lane/filter UI: FocusBoard FILTER_OPTIONS done entry + the cmd-4 shortcut + the done grouping branches; boardFilters done filter value/branch/counter; FocusEmptyState done entry. KEEP the task.status==="done" EXCLUSION guards so legacy done rows stay hidden.',
        'RENAME Delete → Complete: TaskContextMenu item label becomes a flag + "Complete" (e.g. "Complete 🏁") calling deleteTask, AND show a confirmation prompt first ("Complete this task? Its worktree and branch will be deleted — this cannot be undone."). Rename the action-palette delete action label to "Complete". The task-detail view should expose a Complete (delete) affordance too so it has a terminal action.',
        'OPTION 3 (hidden, no migration): KEEP "done" as a recognized-but-unreachable status — Rust BoardStatus::Done variant + normalize/as_str, the TS \'done\' type union + taskState/taskStatePresentation handling, and the migrations.rs allow-list that prevents rewriting \'done\' rows. Nothing may PRODUCE or SURFACE \'done\' anymore.',
        'Do not disable eslint/TS errors; fix them. No hardcoded hex colors. Map stores need new Map() for reactivity. import type per verbatimModuleSyntax.',
      ],
      acceptanceCriteria: [
        'The red tests now pass.',
        'No remaining UI/path can move a task to Done, reopen, or clear-done; no Done lane/filter renders.',
        'Complete deletes the task+worktree+branch after a confirmation, reusing the existing delete machinery.',
      ],
    },
  },
  labels: ['agent', 'implementation'],
  io: io(taskCtx),
}));

export const focusedVerificationTask = defineTask('aviv-118/focused-verification', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Typecheck + focused frontend/Rust tests (green)',
  description: 'Prove the change compiles and the focused suites pass after implementation.',
  shell: {
    command: 'pnpm exec tsc --noEmit && pnpm exec vitest run src/components/shared/tasks src/components/task-detail/TaskDetailView.test.ts src/lib/boardFilters.test.ts src/components/focus-board/FocusBoard.test.ts src/lib/actionPalette.test.ts src/lib/actionPaletteController.svelte.test.ts src/lib/taskActionRunner.test.ts src/lib/taskState.test.ts src/lib/electronMigrationContracts.test.ts && (cd src-tauri && cargo test app_invoke::tests::core && cargo test app_invoke::tests::lifecycle && cargo test board_status)',
    cwd: '.',
  },
  labels: ['shell', 'verification'],
  io: io(taskCtx),
}));

export const reviewTask = defineTask('aviv-118/review', (args, taskCtx) => ({
  kind: 'skill',
  title: 'Adversarial post-implementation review gate',
  description: 'Mandatory post-implementation review before handoff. Be adversarial; assume dangling done references, missed entry points, broken hidden-row handling, and convention violations until proven otherwise.',
  skill: {
    name: 'review',
    input: {
      task: args.request,
      checklist: [
        'Grep the whole repo for any remaining producer/surface of "done": move-to-done, reopen, clear-done, Done lane/filter/empty-state. Confirm none remain reachable.',
        'Confirm legacy status==="done" rows stay hidden (exclusion guards intact) and no migration rewrites them.',
        'Confirm Complete = confirmation → deleteTask (worktree+branch cleanup) and that cleanup_task_runtime_for_app is still wired to delete.',
        'Confirm update_task_status no longer triggers cleanup; no orphaned IPC/contracts/tests.',
        'Check tests assert business logic only (no CSS/visual assertions).',
      ],
    },
  },
  labels: ['skill', 'review', 'oracle'],
  io: io(taskCtx),
}));

export const reviewFixTask = defineTask('aviv-118/review-fix', (_args, taskCtx) => ({
  kind: 'agent',
  title: 'Fix blocking review findings',
  description: 'Apply required fixes from the review gate.',
  agent: {
    prompt: {
      role: 'senior engineer resolving review blockers',
      task: 'Fix every blocking finding from the review unless demonstrably a false positive (explain with evidence). Keep scope tight to the review feedback and the original request.',
      instructions: ['Re-run focused verification after fixes.'],
    },
  },
  labels: ['agent', 'fix', 'review'],
  io: io(taskCtx),
}));

export const finalVerificationTask = defineTask('aviv-118/final-verification', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Final verification gates',
  description: 'Full typecheck, broader vitest, Rust app/board tests, and diff hygiene before handoff.',
  shell: {
    command: 'pnpm exec tsc --noEmit && pnpm test && (cd src-tauri && cargo test app_invoke::tests::core && cargo test app_invoke::tests::lifecycle && cargo test board_status) && git diff --check',
    cwd: '.',
  },
  labels: ['shell', 'verification', 'final'],
  io: io(taskCtx),
}));

export async function process(inputs, ctx) {
  const request = inputs.request || 'Remove the Done story and rename Delete to Complete.';

  ctx.log('info', 'TDD: write failing tests first');
  await ctx.task(writeRedTestsTask, { request });
  await ctx.task(redRunTask, { request });

  ctx.log('info', 'Implement the approved design');
  await ctx.task(implementationTask, { request });

  ctx.log('info', 'Focused verification');
  await ctx.task(focusedVerificationTask, { request });

  ctx.log('info', 'Mandatory adversarial review gate');
  const review = await ctx.task(reviewTask, { request });

  const verdict = String(review?.verdict || '').toLowerCase();
  const blockers = Array.isArray(review?.blockers) ? review.blockers : [];
  const needsFix = verdict === 'changes_requested' || blockers.length > 0;
  let reviewApproved = !needsFix;
  if (needsFix) {
    ctx.log('info', 'Review requested changes — applying fixes');
    await ctx.task(reviewFixTask, { request, review });
    reviewApproved = true;
  }

  ctx.log('info', 'Final verification gates');
  await ctx.task(finalVerificationTask, { request });

  return { success: true, reviewApproved };
}
