/**
 * @process openforge/rebase-pr-on-main
 * @description Rebase a PR branch on the latest main branch with conflict handling, verification, and push status tracking
 * @process methodologies/gsd/skills/git-integration
 * @process methodologies/gastown/skills/merge-queue
 * @inputs { branch: string, base: string, remote: string, shouldPush: boolean }
 * @outputs { success: boolean, branch: string, base: string, rebase: object, verification: object, push: object | null }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export const prepareTask = defineTask('rebase-prepare', (args) => ({
  kind: 'shell',
  title: `Prepare ${args.branch} for rebase`,
  description: 'Fetch latest refs and check out the PR branch locally.',
  shell: {
    command: [
      'git status --short --branch',
      `git fetch ${args.remote} ${args.base}:refs/remotes/rebase-target/${args.base} ${args.branch}:refs/remotes/rebase-target/${args.branch}`,
      `git switch -C ${args.branch} refs/remotes/rebase-target/${args.branch}`,
      'git status --short --branch',
      `git log --oneline --decorate --max-count=6 refs/remotes/rebase-target/${args.base}..HEAD`
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'git', 'rebase', 'prepare']
}));

export const rebaseTask = defineTask('rebase-branch', (args) => ({
  kind: 'shell',
  title: `Rebase ${args.branch} onto ${args.base}`,
  description: 'Run the actual git rebase. Conflicts are surfaced for explicit resolution.',
  shell: {
    command: [
      `git rebase refs/remotes/rebase-target/${args.base}`,
      'git status --short --branch',
      'git diff --name-only --diff-filter=U'
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'git', 'rebase']
}));

export const verifyTask = defineTask('rebase-verify', (args) => ({
  kind: 'shell',
  title: `Verify rebased ${args.branch}`,
  description: 'Confirm the branch is based on latest main and inspect resulting status.',
  shell: {
    command: [
      `test "$(git merge-base HEAD refs/remotes/rebase-target/${args.base})" = "$(git rev-parse refs/remotes/rebase-target/${args.base})"`,
      'git status --short --branch',
      `git log --oneline --decorate --max-count=8 refs/remotes/rebase-target/${args.base}..HEAD`,
      `git diff --stat refs/remotes/rebase-target/${args.base}...HEAD`
    ].join(' && '),
    cwd: '.'
  },
  labels: ['shell', 'git', 'verification']
}));

export const pushTask = defineTask('rebase-push', (args) => ({
  kind: 'shell',
  title: `Push rebased ${args.branch}`,
  description: 'Update the remote PR branch with force-with-lease after successful rebase.',
  shell: {
    command: `git push --force-with-lease ${args.remote} HEAD:${args.branch}`,
    cwd: '.'
  },
  labels: ['shell', 'git', 'push', 'force-with-lease']
}));

export async function process(inputs = {}, ctx) {
  const branch = inputs.branch || 'openforge/AVIV-7';
  const base = inputs.base || 'main';
  const remote = inputs.remote || 'origin';
  const shouldPush = inputs.shouldPush !== false;

  const prepare = await ctx.task(prepareTask, { branch, base, remote });
  const rebase = await ctx.task(rebaseTask, { branch, base, remote });
  const verification = await ctx.task(verifyTask, { branch, base, remote });
  const push = shouldPush ? await ctx.task(pushTask, { branch, base, remote }) : null;

  return {
    success: true,
    branch,
    base,
    prepare,
    rebase,
    verification,
    push,
    metadata: {
      processId: 'openforge/rebase-pr-on-main',
      timestamp: ctx.now()
    }
  };
}
