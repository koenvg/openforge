/**
 * @process openforge/kvg-1611-babysitter-sdk-install-cleanup
 * @description Fix root Babysitter SDK dependency/bin installation warnings by aligning with the installed Babysitter Pi plugin SDK or removing the broken root devDependency.
 * @skill test-driven-development methodologies/superpowers/test-driven-development.js
 * @skill verification-before-completion methodologies/superpowers/verification-before-completion.js
 * @skill requesting-code-review methodologies/superpowers/requesting-code-review.js
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

const auditTask = defineTask('kvg-1611/audit-install-warning', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Audit Babysitter SDK install warning scope',
  description: 'Inspect package manifests, lockfile entries, installed SDK package metadata, and reproduce the pnpm install warning before editing dependency metadata.',
  shell: {
    command: [
      'git status --short --branch',
      "node -e \"const fs=require('fs'); for (const p of ['package.json','.a5c/package.json','/Users/koen/.pi/agent/npm/node_modules/@a5c-ai/babysitter-pi/versions.json','node_modules/@a5c-ai/babysitter-sdk/package.json']) { console.log('--- '+p+' ---'); try { console.log(fs.readFileSync(p,'utf8').slice(0,1200)); } catch(e) { console.log(e.message); } }\"",
      "rg -n '@a5c-ai/babysitter-sdk|babysitter-sdk@' package.json pnpm-lock.yaml .a5c/package.json || true",
      'pnpm i',
    ].join(' && '),
    cwd: '.',
  },
  labels: ['shell', 'audit', 'pnpm', 'dependency'],
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

const implementationTask = defineTask('kvg-1611/implement-dependency-fix', (_args, taskCtx) => ({
  kind: 'agent',
  title: 'Implement dependency metadata fix',
  description: 'Update root dependency metadata/lockfile so pnpm install no longer attempts broken Babysitter SDK 5.0.0 bins.',
  agent: {
    name: 'general-purpose',
    prompt: {
      role: 'TypeScript/package-maintenance implementer',
      task: 'Fix OpenForge root install warnings for @a5c-ai/babysitter-sdk.',
      context: {
        taskId: 'KVG-1611',
        worktree: '.',
        request: 'pnpm i warns that node_modules/.bin/babysitter, babysitter-sdk, and babysitter-mcp-server cannot be created because @a5c-ai/babysitter-sdk@5.0.0 is missing dist/cli entry files. Align dependency/version with installed Babysitter Pi plugin SDK version or remove broken root devDependency so local installs are clean.',
      },
      instructions: [
        'Inspect package.json, pnpm-lock.yaml, and the installed Babysitter Pi plugin SDK version.',
        'Prefer the smallest metadata-only change that makes local pnpm installs clean.',
        'Do not alter product behavior.',
        'Return changed files and rationale.',
      ],
      outputFormat: 'JSON with fields changedFiles, rationale, risks',
    },
    outputSchema: {
      type: 'object',
      required: ['changedFiles', 'rationale', 'risks'],
      properties: {
        changedFiles: { type: 'array', items: { type: 'string' } },
        rationale: { type: 'string' },
        risks: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  labels: ['agent', 'implementation', 'pnpm', 'dependency'],
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

const verificationTask = defineTask('kvg-1611/verify-clean-install', (_args, taskCtx) => ({
  kind: 'shell',
  title: 'Verify clean pnpm install and dependency state',
  description: 'Run pnpm install and focused dependency checks to confirm broken Babysitter SDK bin warnings are gone.',
  shell: {
    command: [
      'pnpm i',
      "test ! -d node_modules/@a5c-ai/babysitter-sdk || node -e \"const fs=require('fs'); const p='node_modules/@a5c-ai/babysitter-sdk/package.json'; const pkg=JSON.parse(fs.readFileSync(p,'utf8')); console.log(pkg.version, pkg.bin || {}); for (const entry of Object.values(pkg.bin || {})) { if (!fs.existsSync('node_modules/@a5c-ai/babysitter-sdk/'+entry)) { throw new Error('missing bin entry '+entry); } }\"",
      'pnpm install --frozen-lockfile',
      'git diff --check',
    ].join(' && '),
    cwd: '.',
  },
  labels: ['shell', 'verification', 'pnpm'],
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

const reviewTask = defineTask('kvg-1611/post-implementation-review', (_args, taskCtx) => ({
  kind: 'agent',
  title: 'Post-implementation review',
  description: 'Review the dependency metadata change after objective verification and identify blocking concerns before handoff.',
  agent: {
    name: 'code-reviewer',
    prompt: {
      role: 'Strict package-maintenance reviewer',
      task: 'Review the KVG-1611 dependency/bin install fix.',
      context: {
        taskId: 'KVG-1611',
        worktree: '.',
      },
      instructions: [
        'Inspect git diff and relevant package/lockfile entries.',
        'Confirm the fix is minimal and addresses the pnpm bin warnings without unrelated product changes.',
        'Report blocking findings only; otherwise approve with concise rationale.',
      ],
      outputFormat: 'JSON with fields approved, findings, notes',
    },
    outputSchema: {
      type: 'object',
      required: ['approved', 'findings', 'notes'],
      properties: {
        approved: { type: 'boolean' },
        findings: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
    },
  },
  labels: ['agent', 'review', 'quality-gate'],
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
}));

export async function process(_inputs, ctx) {
  ctx.log('info', 'Audit and reproduce Babysitter SDK install warning');
  await ctx.task(auditTask, {});

  ctx.log('info', 'Implement dependency metadata fix');
  await ctx.task(implementationTask, {});

  ctx.log('info', 'Verify clean install and lockfile consistency');
  await ctx.task(verificationTask, {});

  ctx.log('info', 'Run post-implementation review');
  await ctx.task(reviewTask, {});

  return {
    success: true,
    summary: 'KVG-1611 Babysitter SDK install warning fixed, verified, and reviewed.',
  };
}
