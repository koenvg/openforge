import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

type PullRequestComment = {
  id: number;
  body: string;
};

type ScriptHarness = ReturnType<typeof createScriptHarness>;

const RESULT_PATHS = {
  frontendTypecheck: '/tmp/frontend-results/typecheck-exit-code',
  frontendTests: '/tmp/frontend-results/tests-exit-code',
  rustFormat: '/tmp/rust-results/format-exit-code',
  rustClippy: '/tmp/rust-results/clippy-exit-code',
  rustTests: '/tmp/rust-results/tests-exit-code',
} as const;

const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
  ...parameters: string[]
) => (...arguments_: unknown[]) => Promise<unknown>;

function extractGitHubScripts(workflow: string): string[] {
  const lines = workflow.split('\n');
  const scripts: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const usesIndent = lines[index].match(/^(\s*)uses:\s*actions\/github-script@/)?.[1].length;
    if (usesIndent === undefined) continue;

    for (let scriptIndex = index + 1; scriptIndex < lines.length; scriptIndex += 1) {
      const line = lines[scriptIndex];
      const indentation = line.search(/\S/);
      if (line.trim() && indentation < usesIndent) break;

      const scriptIndent = line.match(/^(\s*)script:\s*\|\s*$/)?.[1].length;
      if (scriptIndent === undefined) continue;

      const rawBody: string[] = [];
      for (scriptIndex += 1; scriptIndex < lines.length; scriptIndex += 1) {
        const bodyLine = lines[scriptIndex];
        const bodyIndent = bodyLine.search(/\S/);
        if (bodyLine.trim() && bodyIndent <= scriptIndent) break;
        rawBody.push(bodyLine);
      }

      const bodyIndent = Math.min(
        ...rawBody.filter((bodyLine) => bodyLine.trim()).map((bodyLine) => bodyLine.search(/\S/)),
      );
      scripts.push(rawBody.map((bodyLine) => bodyLine.slice(bodyIndent)).join('\n'));
      index = scriptIndex - 1;
      break;
    }
  }

  return scripts;
}

function createScriptHarness({
  files = {},
  comments = [],
}: {
  files?: Record<string, string>;
  comments?: PullRequestComment[];
} = {}) {
  const issues = {
    listComments: vi.fn().mockResolvedValue({ data: comments }),
    createComment: vi.fn().mockResolvedValue({ data: {} }),
    updateComment: vi.fn().mockResolvedValue({ data: {} }),
    deleteComment: vi.fn().mockResolvedValue({ data: {} }),
  };
  const actions = new Proxy<Record<string, ReturnType<typeof vi.fn>>>({}, {
    get: () => vi.fn().mockResolvedValue({ data: { artifacts: [] } }),
  });
  const fs = {
    readFileSync: vi.fn((path: string) => {
      if (Object.hasOwn(files, path)) return files[path];
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    }),
    writeFileSync: vi.fn(),
  };

  return {
    github: { rest: { issues, actions } },
    context: {
      repo: { owner: 'open-forge', repo: 'openforge' },
      payload: { workflow_run: { id: 9001, pull_requests: [{ number: 42 }] } },
    },
    core: {
      setOutput: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    },
    requireModule(specifier: string) {
      if (specifier === 'fs') return fs;
      throw new Error(`Unexpected module request: ${specifier}`);
    },
  };
}

async function executeGitHubScript(script: string, harness: ScriptHarness): Promise<void> {
  const executable = new AsyncFunction(
    'github',
    'context',
    'core',
    'require',
    script.replace(/\$\{\{[\s\S]*?\}\}/g, '42'),
  );
  await executable(harness.github, harness.context, harness.core, harness.requireModule);
}

async function findCommentScript(workflow: string): Promise<string> {
  for (const script of extractGitHubScripts(workflow)) {
    const harness = createScriptHarness({ files: passingResultFiles() });
    await executeGitHubScript(script, harness);
    if (harness.github.rest.issues.listComments.mock.calls.length > 0) return script;
  }

  throw new Error('No GitHub Script in the workflow synchronized pull request comments');
}

function passingResultFiles(): Record<string, string> {
  return Object.fromEntries(Object.values(RESULT_PATHS).map((path) => [path, '0']));
}

function frontendFailureFiles(log = 'src/example.ts:4:2 error TS2322: wrong type'): Record<string, string> {
  return {
    ...passingResultFiles(),
    [RESULT_PATHS.frontendTypecheck]: '1',
    '/tmp/frontend-logs/typecheck.log': `compiler startup\n${log}\nwatching for changes`,
  };
}

function createdCommentBody(harness: ScriptHarness, heading: string): string {
  const request = harness.github.rest.issues.createComment.mock.calls
    .map(([call]) => call as { body: string })
    .find(({ body }) => body.includes(heading));
  expect(request, `Expected a created comment containing ${heading}`).toBeDefined();
  return request?.body ?? '';
}

describe('CI comment workflow', () => {
  let commentScript: string;

  beforeAll(async () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci-comment.yml'), 'utf8');
    commentScript = await findCommentScript(workflow);
  });

  it('renders frontend failures from the check results and logs', async () => {
    const files = {
      ...frontendFailureFiles(),
      [RESULT_PATHS.frontendTests]: '1',
      '/tmp/frontend-logs/tests.log': 'setup complete\nFAIL src/example.test.ts > rejects invalid input',
    };
    const harness = createScriptHarness({ files });

    await executeGitHubScript(commentScript, harness);

    const body = createdCommentBody(harness, 'Frontend CI Failures');
    expect(body).toContain('### Type Check');
    expect(body).toContain('src/example.ts:4:2 error TS2322: wrong type');
    expect(body).not.toContain('compiler startup');
    expect(body).toContain('### Tests');
    expect(body).toContain('FAIL src/example.test.ts > rejects invalid input');
  });

  it('renders formatting, Clippy, and test failures in the Rust comment', async () => {
    const harness = createScriptHarness({
      files: {
        ...passingResultFiles(),
        [RESULT_PATHS.rustFormat]: '1',
        [RESULT_PATHS.rustClippy]: '1',
        [RESULT_PATHS.rustTests]: '1',
        '/tmp/rust-logs/rust-format.log': 'Diff in src/main.rs:12',
        '/tmp/rust-logs/rust-clippy.log': 'error: redundant clone',
        '/tmp/rust-logs/rust-tests.log': "test parses_config ... FAILED\nthread 'parses_config' panicked",
      },
    });

    await executeGitHubScript(commentScript, harness);

    const body = createdCommentBody(harness, 'Rust CI Failures');
    expect(body).toContain('### Formatting');
    expect(body).toContain('Diff in src/main.rs:12');
    expect(body).toContain('### Clippy');
    expect(body).toContain('error: redundant clone');
    expect(body).toContain('### Tests');
    expect(body).toContain('test parses_config ... FAILED');
    expect(body).toContain("thread 'parses_config' panicked");
  });

  it('creates a comment when a check fails and no matching comment exists', async () => {
    const harness = createScriptHarness({
      files: frontendFailureFiles(),
      comments: [{ id: 11, body: 'A human review comment' }],
    });

    await executeGitHubScript(commentScript, harness);

    expect(harness.github.rest.issues.createComment).toHaveBeenCalledOnce();
    expect(harness.github.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'open-forge',
        repo: 'openforge',
        issue_number: 42,
      }),
    );
    expect(harness.github.rest.issues.updateComment).not.toHaveBeenCalled();
    expect(harness.github.rest.issues.deleteComment).not.toHaveBeenCalled();
  });

  it('updates the matching comment when the same check still fails', async () => {
    const initialHarness = createScriptHarness({ files: frontendFailureFiles('error TS1000: stale failure') });
    await executeGitHubScript(commentScript, initialHarness);
    const existingBody = createdCommentBody(initialHarness, 'Frontend CI Failures');

    const harness = createScriptHarness({
      files: frontendFailureFiles('error TS2000: current failure'),
      comments: [
        { id: 12, body: 'Automated coverage report' },
        { id: 71, body: existingBody },
      ],
    });
    await executeGitHubScript(commentScript, harness);

    expect(harness.github.rest.issues.updateComment).toHaveBeenCalledOnce();
    expect(harness.github.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        comment_id: 71,
        body: expect.stringContaining('error TS2000: current failure'),
      }),
    );
    expect(harness.github.rest.issues.createComment).not.toHaveBeenCalled();
    expect(harness.github.rest.issues.deleteComment).not.toHaveBeenCalled();
  });

  it('deletes the matching comment after its checks pass', async () => {
    const failedHarness = createScriptHarness({ files: frontendFailureFiles() });
    await executeGitHubScript(commentScript, failedHarness);
    const existingBody = createdCommentBody(failedHarness, 'Frontend CI Failures');

    const harness = createScriptHarness({
      files: passingResultFiles(),
      comments: [
        { id: 13, body: 'Deployment preview is ready' },
        { id: 83, body: existingBody },
      ],
    });
    await executeGitHubScript(commentScript, harness);

    expect(harness.github.rest.issues.deleteComment).toHaveBeenCalledOnce();
    expect(harness.github.rest.issues.deleteComment).toHaveBeenCalledWith({
      owner: 'open-forge',
      repo: 'openforge',
      comment_id: 83,
    });
    expect(harness.github.rest.issues.createComment).not.toHaveBeenCalled();
    expect(harness.github.rest.issues.updateComment).not.toHaveBeenCalled();
  });
});
