import { optionalString, requireFlag } from './command-line.js';
import { printJson, requestJson } from './http-transport.js';

const SIDES = ['LEFT', 'RIGHT'];
const STATUSES = ['open', 'resolved', 'dismissed'];

function reviewThreadScope(flags) {
  return {
    namespace: requireFlag(flags, 'namespace'),
    targetKey: requireFlag(flags, 'target'),
    revision: requireFlag(flags, 'revision'),
  };
}

function requireLine(flags) {
  const line = Number(requireFlag(flags, 'line'));
  if (!Number.isInteger(line) || line < 1) {
    throw new Error('review thread create requires a positive integer --line');
  }
  return line;
}

function anchorSide(flags) {
  if (flags.side !== undefined && typeof flags.side !== 'string') {
    throw new Error(`review thread create requires --side ${SIDES.join(' or ')}`);
  }
  const side = optionalString(flags, 'side') ?? 'RIGHT';
  if (!SIDES.includes(side)) {
    throw new Error(`review thread create requires --side ${SIDES.join(' or ')}`);
  }
  return side;
}

async function listReviewThreads(flags) {
  printJson(await requestJson('/review_threads/list', {
    method: 'POST',
    body: JSON.stringify(reviewThreadScope(flags)),
  }));
}

async function createReviewThread(flags) {
  const payload = {
    ...reviewThreadScope(flags),
    origin: 'agent',
    anchor: {
      kind: 'line',
      filePath: requireFlag(flags, 'file'),
      line: requireLine(flags),
      side: anchorSide(flags),
    },
    body: requireFlag(flags, 'body'),
  };
  const runId = optionalString(flags, 'run');
  if (runId !== undefined) payload.runId = runId;
  printJson(await requestJson('/review_threads/create', {
    method: 'POST',
    body: JSON.stringify(payload),
  }));
}

async function replyToReviewThread(flags) {
  printJson(await requestJson('/review_threads/reply', {
    method: 'POST',
    body: JSON.stringify({
      threadId: requireFlag(flags, 'threadId'),
      role: 'agent',
      body: requireFlag(flags, 'body'),
    }),
  }));
}

async function setReviewThreadStatus(flags) {
  const status = requireFlag(flags, 'status');
  if (!STATUSES.includes(status)) {
    throw new Error(`review thread status requires --status ${STATUSES.join(', ')}`);
  }
  printJson(await requestJson('/review_threads/status', {
    method: 'POST',
    body: JSON.stringify({ threadId: requireFlag(flags, 'threadId'), status }),
  }));
}

export const REVIEW_THREAD_COMMAND_SPECS = [
  {
    path: ['review', 'thread', 'list'],
    flags: ['namespace', 'target', 'revision'],
    usage: 'openforge review thread list --namespace <ns> --target <key> --revision <rev>',
    handler: listReviewThreads,
  },
  {
    path: ['review', 'thread', 'create'],
    flags: ['namespace', 'target', 'revision', 'file', 'line', 'side', 'body', 'run'],
    usage: 'openforge review thread create --namespace <ns> --target <key> --revision <rev> --file <path> --line <n> --body <text> [--side LEFT|RIGHT] [--run <id>]',
    handler: createReviewThread,
  },
  {
    path: ['review', 'thread', 'reply'],
    flags: ['threadId', 'body'],
    usage: 'openforge review thread reply --thread-id <id> --body <text>',
    handler: replyToReviewThread,
  },
  {
    path: ['review', 'thread', 'status'],
    flags: ['threadId', 'status'],
    usage: 'openforge review thread status --thread-id <id> --status open|resolved|dismissed',
    handler: setReviewThreadStatus,
  },
];
