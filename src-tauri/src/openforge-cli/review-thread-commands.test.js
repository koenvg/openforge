import { describe, expect, it } from 'vitest';
import { runCli, runCliAgainstJsonBridge } from './cli-test-utils.js';
import contract from '../../../docs/contracts/review-thread-write-contract-fixtures.json';

const SCOPE_BODY = contract.scope;
const SCOPE_ARGS = [
  '--namespace', SCOPE_BODY.namespace,
  '--target', SCOPE_BODY.targetKey,
  '--revision', SCOPE_BODY.revision,
];
const THREAD = { id: contract.reply.threadId, status: 'open', messages: [{ role: 'agent', body: contract.create.body }] };

describe('OpenForge Review Thread Commands', () => {
  it('anchors a created thread to a file and line, defaulting to the post-image side', async () => {
    const created = await runCliAgainstJsonBridge(
      [
        'review', 'thread', 'create', ...SCOPE_ARGS,
        '--file', contract.create.anchor.filePath,
        '--line', String(contract.create.anchor.line),
        '--body', contract.create.body,
      ],
      {
        url: '/review_threads/create',
        method: 'POST',
        response: THREAD,
        expectedBody: contract.create,
      },
    );

    expect(created).toEqual(THREAD);
  });

  it('sends the pre-image side and the run it belongs to when both are given', async () => {
    await runCliAgainstJsonBridge(
      ['review', 'thread', 'create', ...SCOPE_ARGS, '--file', 'src/main.rs', '--line', '7', '--side', 'LEFT', '--body', 'Why remove this?', '--run', 'run-3'],
      {
        url: '/review_threads/create',
        method: 'POST',
        response: THREAD,
        expectedBody: {
          ...SCOPE_BODY,
          origin: 'agent',
          anchor: { kind: 'line', filePath: 'src/main.rs', line: 7, side: 'LEFT' },
          body: 'Why remove this?',
          runId: 'run-3',
        },
      },
    );
  });

  it('lists the threads stored under one target and revision', async () => {
    const listed = await runCliAgainstJsonBridge(['review', 'thread', 'list', ...SCOPE_ARGS], {
      url: '/review_threads/list',
      method: 'POST',
      response: [THREAD],
      expectedBody: SCOPE_BODY,
    });

    expect(listed).toEqual([THREAD]);
  });

  it('replies as the agent and sets a reviewer decision on an existing thread', async () => {
    await runCliAgainstJsonBridge(
      ['review', 'thread', 'reply', '--thread-id', contract.reply.threadId, '--body', contract.reply.body],
      {
        url: '/review_threads/reply',
        method: 'POST',
        response: THREAD,
        expectedBody: contract.reply,
      },
    );

    await runCliAgainstJsonBridge(
      ['review', 'thread', 'status', '--thread-id', contract.status.threadId, '--status', contract.status.status],
      {
        url: '/review_threads/status',
        method: 'POST',
        response: { ...THREAD, status: contract.status.status },
        expectedBody: contract.status,
      },
    );
  });

  it('names the missing flag instead of posting an incomplete thread', async () => {
    const cases = [
      [['review', 'thread', 'create', '--target', 'gh:acme/web#1421', '--revision', '0f1c2d3', '--file', 'a.rs', '--line', '1', '--body', 'x'], '--namespace'],
      [['review', 'thread', 'create', ...SCOPE_ARGS, '--line', '1', '--body', 'x'], '--file'],
      [['review', 'thread', 'create', ...SCOPE_ARGS, '--file', 'a.rs', '--line', '1'], '--body'],
      [['review', 'thread', 'list', '--namespace', 'github', '--target', 'gh:acme/web#1421'], '--revision'],
      [['review', 'thread', 'reply', '--thread-id', 'rt_9f2'], '--body'],
      [['review', 'thread', 'status', '--thread-id', 'rt_9f2'], '--status'],
    ];

    for (const [args, flag] of cases) {
      await expect(runCli(args)).rejects.toThrow(`missing required flag ${flag}`);
    }
  });

  it('rejects an anchor, a side, or a decision the host would refuse', async () => {
    await expect(
      runCli(['review', 'thread', 'create', ...SCOPE_ARGS, '--file', 'a.rs', '--line', '0', '--body', 'x']),
    ).rejects.toThrow('positive integer --line');
    await expect(
      runCli(['review', 'thread', 'create', ...SCOPE_ARGS, '--file', 'a.rs', '--line', 'forty', '--body', 'x']),
    ).rejects.toThrow('positive integer --line');
    await expect(
      runCli(['review', 'thread', 'create', ...SCOPE_ARGS, '--file', 'a.rs', '--line', '4', '--side', 'BOTH', '--body', 'x']),
    ).rejects.toThrow('--side LEFT or RIGHT');
    await expect(
      runCli(['review', 'thread', 'create', ...SCOPE_ARGS, '--file', 'a.rs', '--line', '4', '--side', '--body', 'x']),
    ).rejects.toThrow('--side LEFT or RIGHT');
    await expect(
      runCli(['review', 'thread', 'status', '--thread-id', 'rt_9f2', '--status', 'archived']),
    ).rejects.toThrow('--status open, resolved, dismissed');
  });

  it('refuses an idempotency key the CLI does not expose yet', async () => {
    await expect(
      runCli(['review', 'thread', 'create', ...SCOPE_ARGS, '--file', 'a.rs', '--line', '4', '--body', 'x', '--key', 'finding-1']),
    ).rejects.toThrow('review thread create does not support --key');
  });
});
